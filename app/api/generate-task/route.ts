// Vercel API Route: app/api/generate-task/route.ts
import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { authenticate, isAuthError } from "@/lib/middleware";

const sql = neon(process.env.DATABASE_URL!);

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set");
    return NextResponse.json(
      { error: "AI service not configured" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const duration_minutes = body.duration_minutes ?? body.durationMinutes;
    const clientHour = body.client_hour ?? body.clientHour ?? null;

    if (!duration_minutes) {
      return NextResponse.json(
        { error: "duration_minutes is required" },
        { status: 400 }
      );
    }

    // Look up the user's household and member record
    const memberRows = await sql`
      SELECT m.id as member_id, m.household_id
      FROM members m WHERE m.user_id = ${auth.userId} LIMIT 1
    `;
    const member = memberRows[0];
    if (!member) {
      return NextResponse.json({ error: "No household" }, { status: 400 });
    }

    const { member_id, household_id } = member;

    // Fetch ALL household context
    const [spaces, rooms, painPoints, recentTasks, supplies] = await Promise.all([
      sql`SELECT * FROM spaces WHERE household_id = ${household_id} LIMIT 1`,
      sql`SELECT r.* FROM rooms r
          JOIN spaces s ON r.space_id = s.id
          WHERE s.household_id = ${household_id}
          ORDER BY r.sort_order`,
      sql`SELECT * FROM pain_points WHERE household_id = ${household_id}`,
      sql`SELECT t.*, s.member_id, s.status, s.completed_at
          FROM tasks t
          JOIN sessions s ON t.session_id = s.id
          WHERE t.household_id = ${household_id}
          AND t.created_at > NOW() - INTERVAL '60 days'
          ORDER BY t.created_at DESC`,
      sql`SELECT name, category FROM supplies
          WHERE household_id = ${household_id} AND active = true
          ORDER BY category, name`,
    ]);

    const space = spaces[0];
    if (!space) {
      return NextResponse.json(
        { error: "No space configured" },
        { status: 400 }
      );
    }

    // Build context for the LLM
    const painPointList = painPoints
      .map((p: any) => p.description)
      .join("; ");

    const completedTasks = recentTasks.filter(
      (t: any) => t.status === "done"
    );
    const skippedTasks = recentTasks.filter(
      (t: any) => t.status === "skipped"
    );

    // --- A. Rich room status with task count and member attribution ---
    const roomStatusLines: string[] = [];
    for (const room of rooms) {
      const roomTasks = completedTasks.filter(
        (t: any) => t.room_id === room.id
      );
      const taskCount = roomTasks.length;
      const lastTask = roomTasks[0]; // already sorted DESC by created_at

      let status: string;
      if (lastTask) {
        const days = Math.floor(
          (Date.now() - new Date(lastTask.completed_at).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        const who =
          lastTask.member_id === member_id ? "you" : "another member";
        status = `last cleaned ${days} days ago, ${taskCount} tasks in last 60 days, last by: ${who}`;
      } else {
        status = "never cleaned in app";
      }
      roomStatusLines.push(`- ${room.name} (${room.type}): ${status}`);
    }

    // --- B. Structured recent history ---
    const recentHistoryLines = completedTasks.slice(0, 10).map((t: any, i: number) => {
      const days = Math.floor(
        (Date.now() - new Date(t.completed_at).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      const room = rooms.find((r: any) => r.id === t.room_id);
      const roomName = room?.name || "Unknown";
      const who = t.member_id === member_id ? "you" : "another member";
      return `${i + 1}. "${t.title}" (${roomName}, ${days} days ago, by ${who})`;
    });

    const recentSkipLines = skippedTasks.slice(0, 5).map((t: any) => {
      const room = rooms.find((r: any) => r.id === t.room_id);
      return `- "${t.title}" (${room?.name || "Unknown"})`;
    });

    // --- C. Time-of-day context ---
    const now = new Date();
    const hour = clientHour ?? now.getUTCHours(); // fallback to UTC if no client hour
    let timeOfDay: string;
    if (hour >= 5 && hour < 12) timeOfDay = "morning";
    else if (hour >= 12 && hour < 17) timeOfDay = "afternoon";
    else if (hour >= 17 && hour < 21) timeOfDay = "evening";
    else timeOfDay = "late night";
    const timeLabel = `${hour}:${String(now.getMinutes()).padStart(2, "0")}`;

    // --- System prompt ---
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
5. Prioritize rooms and areas that haven't been attended to recently. Consider both recency AND frequency — a room with only 2 tasks in 60 days needs more attention than one with 8 tasks even if its last clean was slightly more recent.
6. Weight the user's stated pain points — if they said the bathroom is a struggle, it should come up more often (but not every time)
7. Include small, overlooked tasks regularly — these are your secret weapon. Things like: wiping light switches, cleaning door handles, dusting the top of the fridge, wiping baseboards in the hallway, cleaning the inside of the microwave, wiping cabinet fronts, cleaning window sills
8. For longer sessions (30-60 min), suggest deeper tasks: reorganize under the sink, deep clean the oven, wash all the windows in one room, clean out and wipe the fridge
9. For short sessions (10-15 min), suggest quick wins: wipe a specific surface, vacuum one room, clean one appliance
10. Consider time of day. Late evening (after 8pm) and late night: favor bedrooms, quick surface wipes, and quiet tasks — avoid vacuuming or anything noisy. Morning: favor kitchen and common areas. Afternoon: any task is fair game.
11. ROOM ROTATION: Do not suggest the same room as the user's last 2 completed tasks unless all other rooms have been cleaned more recently. Spread tasks across the full home.
12. ONLY reference cleaning supplies the user has in their inventory. If the ideal tool isn't available, suggest the best alternative from what they own. If they don't have a mop but have a Swiffer, say "use your Swiffer." If no inventory is set up, use generic references.

Respond in JSON only:
{
  "room_type": "the room type from the available rooms",
  "title": "short task name, 3-8 words",
  "description": "specific step-by-step instructions, 2-3 sentences. Include what tools/supplies to grab.",
  "rationale": "one sentence explaining why this task was chosen right now. Reference time since last clean, frequency, or the user's stated pain points. Be honest and specific.",
  "difficulty": "light | medium | deep"
}`;

    const userMessage = `HOUSEHOLD CONTEXT:
Home type: ${space.home_type}
Rooms: ${rooms.map((r: any) => `${r.name} (${r.type})`).join(", ")}
Pain points: ${painPointList || "None specified"}

CURRENT TIME: ${timeLabel} (${timeOfDay})

ROOM STATUS:
${roomStatusLines.length > 0 ? roomStatusLines.join("\n") : "No room data available"}

RECENT HISTORY (last 10 completed):
${recentHistoryLines.length > 0 ? recentHistoryLines.join("\n") : "No history yet — this is their first session"}

RECENTLY SKIPPED (avoid similar):
${recentSkipLines.length > 0 ? recentSkipLines.join("\n") : "None"}

SUPPLIES AVAILABLE:
${supplies.length > 0
  ? supplies.map((s: any) => `- ${s.name} (${s.category})`).join("\n")
  : "No inventory set up — use generic supply references"}

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
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        temperature: 0.7,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Anthropic API error:", result);
      return NextResponse.json(
        { error: "AI service error", detail: result.error?.message },
        { status: 502 }
      );
    }

    if (!result.content || !result.content[0]?.text) {
      console.error("Unexpected Anthropic response:", result);
      return NextResponse.json(
        { error: "AI returned unexpected response" },
        { status: 502 }
      );
    }

    // --- E. Hardened JSON parsing ---
    let taskJson: any;
    const rawText = result.content[0].text;
    try {
      // Try stripping markdown fences first
      taskJson = JSON.parse(rawText.replace(/```json\n?|\n?```/g, ""));
    } catch {
      // Fallback: extract first JSON object from response
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          taskJson = JSON.parse(jsonMatch[0]);
        } catch (innerErr) {
          console.error("JSON parse fallback failed:", innerErr, "Raw:", rawText);
          return NextResponse.json(
            { error: "AI returned malformed response" },
            { status: 502 }
          );
        }
      } else {
        console.error("No JSON found in AI response. Raw:", rawText);
        return NextResponse.json(
          { error: "AI returned malformed response" },
          { status: 502 }
        );
      }
    }

    // Match room_type to actual room ID
    const matchedRoom = rooms.find(
      (r: any) =>
        r.type.toLowerCase() === taskJson.room_type.toLowerCase() ||
        r.name.toLowerCase().includes(taskJson.room_type.toLowerCase())
    );

    // Store the session and task
    const sessionRows = await sql`
      INSERT INTO sessions (household_id, member_id, duration_minutes, status)
      VALUES (${household_id}, ${member_id}, ${duration_minutes}, 'active')
      RETURNING *
    `;
    const session = sessionRows[0];

    const taskRows = await sql`
      INSERT INTO tasks (session_id, household_id, room_id, title, description, rationale, difficulty, engine_version)
      VALUES (${session.id}, ${household_id}, ${matchedRoom?.id || null},
              ${taskJson.title}, ${taskJson.description}, ${taskJson.rationale},
              ${taskJson.difficulty}, 'v2')
      RETURNING *
    `;
    const task = taskRows[0];

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
