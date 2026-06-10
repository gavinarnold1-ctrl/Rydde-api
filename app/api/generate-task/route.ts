// Vercel API Route: app/api/generate-task/route.ts
import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { authenticate, isAuthError } from "@/lib/middleware";

const sql = neon(process.env.DATABASE_URL!);

const VALID_CATEGORIES = ["reset", "cycle", "visible", "hygiene", "detail"];

// Universal cycles: keyword patterns + typical interval in days.
// Used for cold-start staleness when tasks lack a category.
const CYCLES: { name: string; pattern: RegExp; intervalDays: number }[] = [
  { name: "laundry", pattern: /laund|fold(ing)? (the )?clothes|hang.*wash/i, intervalDays: 7 },
  { name: "dishes", pattern: /dish|sink full|wash.*up/i, intervalDays: 2 },
  { name: "trash/recycling", pattern: /trash|garbage|recycl|bin/i, intervalDays: 3 },
  { name: "bed sheets", pattern: /sheet|bedding|linen|duvet/i, intervalDays: 14 },
  { name: "floors", pattern: /vacuum|mop|sweep|floor/i, intervalDays: 7 },
];

const STATE_SCORE: Record<string, number> = {
  messy: 2,
  okay: 3,
  clean: 4,
};

const SCORE_LABELS: Record<number, string> = {
  1: "needs rescue",
  2: "messy",
  3: "okay",
  4: "good",
  5: "sparkling",
};

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
    const sessionState = body.state ?? null; // 'messy' | 'okay' | 'clean'

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

    // If the user gave a one-tap state at session start, record it
    if (sessionState && STATE_SCORE[sessionState]) {
      await sql`
        INSERT INTO satisfaction_scores (household_id, member_id, score, source)
        VALUES (${household_id}, ${member_id}, ${STATE_SCORE[sessionState]}, 'session')
      `;
    }

    // Fetch ALL household context
    const [spaces, rooms, painPoints, recentTasks, supplies, satisfaction] =
      await Promise.all([
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
        sql`SELECT score, source, created_at FROM satisfaction_scores
            WHERE household_id = ${household_id}
            ORDER BY created_at DESC LIMIT 8`,
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

    const daysSince = (date: string | Date) =>
      Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));

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
        const days = daysSince(lastTask.completed_at);
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
      const days = daysSince(t.completed_at);
      const room = rooms.find((r: any) => r.id === t.room_id);
      const roomName = room?.name || "Unknown";
      const who = t.member_id === member_id ? "you" : "another member";
      const tag = t.source === "manual" ? ", logged by user" : "";
      return `${i + 1}. "${t.title}" (${roomName}, ${days} days ago, by ${who}${tag})`;
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

    // --- D. Home state: explicit observations + behavioral inference ---
    const lastCompleted = completedTasks[0];
    const daysSinceLastSession = lastCompleted
      ? daysSince(lastCompleted.completed_at)
      : null;
    const sessionsThisWeek = new Set(
      completedTasks
        .filter((t: any) => daysSince(t.completed_at) <= 7)
        .map((t: any) => t.session_id)
    ).size;

    const stateLines: string[] = [];
    if (sessionState && STATE_SCORE[sessionState]) {
      stateLines.push(
        `- User's read RIGHT NOW (just asked): "${sessionState}" (${STATE_SCORE[sessionState]}/5). This is current ground truth — weight it above everything else.`
      );
    }
    if (satisfaction.length > 0) {
      const latest = satisfaction[0];
      const latestAge = daysSince(latest.created_at);
      if (!sessionState) {
        stateLines.push(
          `- Last check-in: ${latest.score}/5 ("${SCORE_LABELS[latest.score]}"), ${latestAge} days ago${latestAge > 7 ? " — stale, the home has likely drifted messier since" : ""}`
        );
      }
      if (satisfaction.length >= 3) {
        const recent = satisfaction.slice(0, 2);
        const older = satisfaction.slice(2);
        const avg = (arr: any[]) =>
          arr.reduce((s, x) => s + x.score, 0) / arr.length;
        const diff = avg(recent) - avg(older);
        const trend =
          diff > 0.4 ? "improving" : diff < -0.4 ? "declining" : "stable";
        stateLines.push(`- Trend: ${trend}`);
      }
    }
    if (satisfaction.length === 0 && !sessionState) {
      stateLines.push(
        "- No check-ins yet. Infer state from activity: long gaps mean accumulated clutter — assume the home needs reset/cycle tasks, not detail work."
      );
    }
    stateLines.push(
      daysSinceLastSession === null
        ? "- No completed tasks yet — first session. Assume clutter has accumulated; start with a high-impact reset or cycle task."
        : `- Days since last completed task: ${daysSinceLastSession}`
    );
    stateLines.push(`- Sessions in the last 7 days: ${sessionsThisWeek}`);

    // --- E. Cycle staleness (keyword match over history, all sources) ---
    const cycleLines = CYCLES.map((cycle) => {
      const match = completedTasks.find((t: any) =>
        cycle.pattern.test(`${t.title} ${t.description || ""}`)
      );
      if (!match) {
        return `- ${cycle.name}: never logged (typical interval ~${cycle.intervalDays} days) — likely due, or handled outside the app`;
      }
      const days = daysSince(match.completed_at);
      const verdict =
        days > cycle.intervalDays
          ? `OVERDUE by ${days - cycle.intervalDays} days`
          : `done recently (${days} days ago)`;
      return `- ${cycle.name}: last ${days} days ago, typical ~${cycle.intervalDays} days → ${verdict}`;
    });

    // --- F. Occupants (entropy prior) ---
    const occupantParts: string[] = [];
    if (space.adults != null) occupantParts.push(`${space.adults} adult(s)`);
    if (space.kids != null && space.kids > 0) occupantParts.push(`${space.kids} kid(s)`);
    if (space.pets != null && space.pets > 0) occupantParts.push(`${space.pets} pet(s)`);
    const occupantLine =
      occupantParts.length > 0 ? occupantParts.join(", ") : "Not specified";

    // --- System prompt (engine v3: impact hierarchy) ---
    const systemPrompt = `You are the task engine for Rydde, a Scandinavian-style home care app. Your job is to suggest the ONE task with the highest impact per minute for this home, right now. Not the most thorough task — the one that makes the home feel meaningfully better fastest.

PERSONALITY:
- You are a knowledgeable friend, not a drill sergeant
- Your tone is calm, specific, and encouraging
- You never moralize about cleanliness or make anyone feel guilty

IMPACT HIERARCHY — task categories ordered by perceived improvement per minute:
1. reset — clear visible clutter: pick clothes up off the floor, clear the kitchen counters, make the bed, deal with the dish pile, tidy the entryway. The single biggest "this room feels better" lever.
2. cycle — start a system and let it work: start a load of laundry, run or empty the dishwasher, take out trash/recycling, change the bed sheets. Three minutes of effort, outsized payoff.
3. visible — high-traffic surfaces and floors people actually see: kitchen counters and stovetop, vacuum the main living areas, bathroom sink and mirror.
4. hygiene — the health-critical zones: toilet, shower, fridge interior, microwave, cutting boards.
5. detail — baseboards, light switches, door handles, top of the fridge, window tracks. Finishing polish for a home that is already tidy and clean.

SELECTION RULES:
1. Suggest exactly ONE task that fits within ${duration_minutes} minutes.
2. Work DOWN the hierarchy: choose the highest category with a real, unmet need. Only suggest a lower tier when the evidence says the tiers above are handled.
3. HOME STATE sets which tiers are in play:
   - 1-2/5 (needs rescue / messy): reset and cycle ONLY. The user needs visible wins. Never suggest detail work in a messy home — wiping baseboards in a cluttered room is wasted effort.
   - 3/5 (okay) or unknown: favor reset, cycle, and visible. Pick up an overdue cycle if there is one.
   - 4-5/5 (good / sparkling): visible, hygiene, and detail are fair game. Detail tasks are a reward for a maintained home, never a default.
4. CYCLE STALENESS is a strong signal: an overdue cycle (laundry, dishes, trash, sheets, floors) is almost always more valuable than another surface wipe. "Never logged" likely means it happens outside the app — suggest it occasionally to find out, framed lightly.
5. DIMINISHING RETURNS: a room cleaned 1-2 days ago has low marginal value. Prioritize the stalest rooms weighted by how often they realistically need attention (kitchen/bathroom decay fast, guest room slowly).
6. OCCUPANTS set the entropy rate: kids and pets mean floors, clutter, and high-touch surfaces degrade much faster — weight reset/visible higher and shorten your assumed intervals.
7. The task must be SPECIFIC — not "tidy the bedroom" but "pick up the clothes on the bedroom floor: hamper for dirty, back in the closet for clean. Then make the bed."
8. Never repeat a task completed in the last 7 days. Avoid tasks similar to recently skipped ones.
9. ROOM ROTATION: avoid the room of the last 2 completed tasks unless every other room is fresher.
10. Weight the user's stated pain points — but pain points do not override HOME STATE tier limits.
11. Tasks the user logged themselves reveal what this household actually does and owns — treat them as the best evidence of real cleaning surfaces and rhythms.
12. ONLY reference supplies from their inventory. If the ideal tool is missing, suggest the best alternative they own. No inventory set up: use generic references.
13. Time of day matters: after 8pm favor quiet tasks (no vacuuming); mornings favor kitchen and common areas; a cycle task like starting laundry is great in the morning, bad late at night.

Respond in JSON only:
{
  "room_type": "the room type from the available rooms",
  "category": "reset | cycle | visible | hygiene | detail",
  "title": "short task name, 3-8 words",
  "description": "specific step-by-step instructions, 2-3 sentences. Include what tools/supplies to grab.",
  "rationale": "one sentence on why THIS task beats everything else right now. Reference home state, an overdue cycle, staleness, or pain points. Be honest and specific.",
  "difficulty": "light | medium | deep"
}`;

    const userMessage = `HOUSEHOLD CONTEXT:
Home type: ${space.home_type}
Occupants: ${occupantLine}
Rooms: ${rooms.map((r: any) => `${r.name} (${r.type})`).join(", ")}
Pain points: ${painPointList || "None specified"}

CURRENT TIME: ${timeLabel} (${timeOfDay})

HOME STATE:
${stateLines.join("\n")}

CYCLE STALENESS:
${cycleLines.join("\n")}

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

    // --- Hardened JSON parsing ---
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

    const category = VALID_CATEGORIES.includes(taskJson.category)
      ? taskJson.category
      : null;

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
      INSERT INTO tasks (session_id, household_id, room_id, title, description, rationale, difficulty, engine_version, source, category)
      VALUES (${session.id}, ${household_id}, ${matchedRoom?.id || null},
              ${taskJson.title}, ${taskJson.description}, ${taskJson.rationale},
              ${taskJson.difficulty}, 'v3', 'engine', ${category})
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
        category: category,
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
