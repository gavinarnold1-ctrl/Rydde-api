import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const body = await request.json();
    const roomId = body.roomId ?? body.room_id;
    const title = body.title;
    const description = body.description ?? "";
    const completedAt = body.completedAt ?? body.completed_at ?? new Date().toISOString();

    if (!title || typeof title !== "string") {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 }
      );
    }

    const sql = getDb();

    const members = await sql`
      SELECT m.id as member_id, m.household_id
      FROM members m WHERE m.user_id = ${auth.userId} LIMIT 1
    `;

    if (members.length === 0) {
      return NextResponse.json(
        { error: "No household found" },
        { status: 400 }
      );
    }

    const { member_id, household_id } = members[0];

    // Create a completed session
    const sessionRows = await sql`
      INSERT INTO sessions (household_id, member_id, duration_minutes, status, started_at, completed_at)
      VALUES (${household_id}, ${member_id}, 0, 'done', ${completedAt}, ${completedAt})
      RETURNING *
    `;
    const session = sessionRows[0];

    // Create the task
    const taskRows = await sql`
      INSERT INTO tasks (session_id, household_id, room_id, title, description, rationale, difficulty, engine_version)
      VALUES (${session.id}, ${household_id}, ${roomId || null},
              ${title}, ${description}, 'Manually logged', 'light', 'manual')
      RETURNING *
    `;
    const task = taskRows[0];

    // Get room name
    let roomName = "Unknown";
    if (roomId) {
      const rooms = await sql`SELECT name FROM rooms WHERE id = ${roomId}`;
      if (rooms.length > 0) roomName = rooms[0].name;
    }

    return NextResponse.json({
      task: {
        id: task.id,
        session_id: session.id,
        room: roomName,
        room_id: task.room_id,
        title: task.title,
        status: "done",
        duration_minutes: 0,
        completed_at: completedAt,
        created_at: task.created_at,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Log task error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
