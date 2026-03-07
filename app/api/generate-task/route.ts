// Vercel API Route: app/api/generate-task/route.ts
// This endpoint uses a PRIVILEGED query (reads all household data, not just the requesting user's)
import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { authenticate, isAuthError } from "@/lib/middleware";

const sql = neon(process.env.DATABASE_URL!);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const { duration_minutes } = await request.json();

    // Look up the user's household and member record
    const [member] = await sql`
      SELECT m.id as member_id, m.household_id
      FROM members m WHERE m.user_id = ${auth.userId} LIMIT 1
    `;
    if (!member) {
      return NextResponse.json({ error: "No household" }, { status: 400 });
    }

    const { member_id, household_id } = member;

    // Fetch ALL household context (engine is omniscient)
    const [spaces, rooms, painPoints, recentTasks] = await Promise.all([
      sql`SELECT * FROM spaces WHERE household_id = ${household_id} LIMIT 1`,
      sql`SELECT r.* FROM rooms r
          JOIN spaces s ON r.space_id = s.id
          WHERE s.household_id = ${household_id}
          ORDER BY r.sort_order`,
      sql`SELECT * FROM pain_points WHERE household_id = ${household_id}`,
      // Last 60 days of ALL household members' tasks (engine sees everything)
      sql`SELECT t.*, s.member_id, s.status, s.completed_at
          FROM tasks t
          JOIN sessions s ON t.session_id = s.id
          WHERE t.household_id = ${household_id}
          AND t.created_at > NOW() - INTERVAL '60 days'
          ORDER BY t.created_at DESC`,
    ]);

    const space = spaces[0];
    if (!space) {
      return NextResponse.json(
        { error: "No space configured" },
        { status: 400 }
      );
    }

    // Build context for the LLM
    const roomList = rooms
      .map((r: any) => `${r.name} (${r.type})`)
      .join(", ");
    const painPointList = painPoints
      .map((p: any) => p.description)
      .join("; ");

    // Build task history summary
    const completedTasks = recentTasks.filter(
      (t: any) => t.status === "done"
    );
    const skippedTasks = recentTasks.filter(
      (t: any) => t.status === "skipped"
    );

    // Calculate days since each room was last cleaned
    const roomLastCleaned: Record<string, string> = {};
    for (const room of rooms) {
      const lastTask = completedTasks.find(
        (t: any) => t.room_id === room.id
      );
      if (lastTask) {
        const days = Math.floor(
          (Date.now() - new Date(lastTask.completed_at).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        roomLastCleaned[room.name] = `${days} days ago`;
      } else {
        roomLastCleaned[room.name] = "never cleaned in app";
      }
    }

    // Recent task titles to avoid repetition
    const recentTaskTitles = completedTasks
      .slice(0, 15)
      .map((t: any) => t.title);

    // Skipped tasks indicate dislike — avoid similar ones
    const recentSkips = skippedTasks
      .slice(0, 5)
      .map((t: any) => t.title);

    const systemPrompt = `You are the task engine for Rydde, a Scandinavian-style cleaning app. Your job is to suggest ONE specific, actionable cleaning task that will meaningfully improve the user's living space.

PERSONALITY:
- You are a knowledgeable friend, not a drill sergeant
- Your tone is calm, specific, and encouraging
- You never moralize about cleanliness or make anyone feel guilty
- You notice the small things people forget: light switch covers, door handles, baseboards, the top of the fridge, behind the toilet, window tracks, cabinet fronts

RULES:
1. Suggest exactly ONE task that fits within ${duration_minutes} minutes
2. The task must be specific — not "clean the bathroom" but "wipe down the bathroom mirror and the faucet handles with a damp microfiber cloth"
3. Never repeat a task that was completed in the last 7 days
4. Avoid tasks similar to recently skipped ones — the user didn't want to do those
5. Prioritize rooms and areas that haven't been attended to recently
6. Weight the user's stated pain points — if they said the bathroom is a struggle, it should come up more often (but not every time)
7. Include small, overlooked tasks regularly — these are your secret weapon. Things like: wiping light switches, cleaning door handles, dusting the top of the fridge, wiping baseboards in the hallway, cleaning the inside of the microwave, wiping cabinet fronts, cleaning window sills
8. For longer sessions (30-60 min), suggest deeper tasks: reorganize under the sink, deep clean the oven, wash all the windows in one room, clean out and wipe the fridge
9. For short sessions (10-15 min), suggest quick wins: wipe a specific surface, vacuum one room, clean one appliance

Respond in JSON only:
{
  "room_type": "the room type from the available rooms",
  "title": "short task name, 3-8 words",
  "description": "specific step-by-step instructions, 2-3 sentences. Include what tools/supplies to grab.",
  "rationale": "one sentence explaining why this task was chosen right now. Reference time since last clean or the user's stated pain points. Be honest and specific.",
  "difficulty": "light | medium | deep"
}`;

    const userMessage = `HOUSEHOLD CONTEXT:
Home type: ${space.home_type}
Rooms: ${roomList}
Pain points: ${painPointList || "None specified"}

ROOM STATUS (days since last cleaned):
${Object.entries(roomLastCleaned)
  .map(([room, status]) => `- ${room}: ${status}`)
  .join("\n")}

RECENTLY COMPLETED (avoid repeating):
${recentTaskTitles.length > 0 ? recentTaskTitles.join(", ") : "No history yet — this is their first session"}

RECENTLY SKIPPED (avoid similar):
${recentSkips.length > 0 ? recentSkips.join(", ") : "None"}

SESSION: ${duration_minutes} minutes

Generate one task.`;

    // Call Anthropic API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    const result = await response.json();
    const taskJson = JSON.parse(
      result.content[0].text.replace(/```json\n?|\n?```/g, "")
    );

    // Match room_type to actual room ID
    const matchedRoom = rooms.find(
      (r: any) =>
        r.type.toLowerCase() === taskJson.room_type.toLowerCase() ||
        r.name.toLowerCase().includes(taskJson.room_type.toLowerCase())
    );

    // Store the session and task
    const [session] = await sql`
      INSERT INTO sessions (household_id, member_id, duration_minutes, status)
      VALUES (${household_id}, ${member_id}, ${duration_minutes}, 'active')
      RETURNING *
    `;

    const [task] = await sql`
      INSERT INTO tasks (session_id, household_id, room_id, title, description, rationale, difficulty, engine_version)
      VALUES (${session.id}, ${household_id}, ${matchedRoom?.id || null},
              ${taskJson.title}, ${taskJson.description}, ${taskJson.rationale},
              ${taskJson.difficulty}, 'v1')
      RETURNING *
    `;

    return NextResponse.json({
      session_id: session.id,
      task: {
        id: task.id,
        room: matchedRoom?.name || taskJson.room_type,
        title: taskJson.title,
        description: taskJson.description,
        rationale: taskJson.rationale,
        difficulty: taskJson.difficulty,
      },
    });
  } catch (error) {
    console.error("Generate task error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
