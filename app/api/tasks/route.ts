import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const sql = getDb();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const roomId = searchParams.get("room_id");
    const offset = (page - 1) * limit;

    const members = await sql`
      SELECT m.id as member_id, m.household_id
      FROM members m WHERE m.user_id = ${auth.userId} LIMIT 1
    `;

    if (members.length === 0) {
      return NextResponse.json({ tasks: [], page: 1, total_pages: 0 });
    }

    const { household_id } = members[0];

    // Count total tasks
    let countResult;
    if (roomId) {
      countResult = await sql`
        SELECT COUNT(*) as count FROM tasks
        WHERE household_id = ${household_id} AND room_id = ${roomId}
      `;
    } else {
      countResult = await sql`
        SELECT COUNT(*) as count FROM tasks
        WHERE household_id = ${household_id}
      `;
    }

    const totalCount = parseInt(countResult[0].count, 10);
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));

    // Fetch tasks with room name and session info
    let tasks;
    if (roomId) {
      tasks = await sql`
        SELECT t.id, t.session_id, t.room_id, t.title, t.description,
               t.rationale, t.difficulty, t.created_at,
               r.name as room_name,
               s.status, s.duration_minutes, s.completed_at
        FROM tasks t
        LEFT JOIN rooms r ON t.room_id = r.id
        JOIN sessions s ON t.session_id = s.id
        WHERE t.household_id = ${household_id} AND t.room_id = ${roomId}
        ORDER BY t.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      tasks = await sql`
        SELECT t.id, t.session_id, t.room_id, t.title, t.description,
               t.rationale, t.difficulty, t.created_at,
               r.name as room_name,
               s.status, s.duration_minutes, s.completed_at
        FROM tasks t
        LEFT JOIN rooms r ON t.room_id = r.id
        JOIN sessions s ON t.session_id = s.id
        WHERE t.household_id = ${household_id}
        ORDER BY t.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    // Map to expected format
    const formattedTasks = tasks.map((t: any) => ({
      id: t.id,
      session_id: t.session_id,
      room: t.room_name || "Unknown",
      room_id: t.room_id,
      title: t.title,
      status: t.status || "done",
      duration_minutes: t.duration_minutes,
      completed_at: t.completed_at,
      created_at: t.created_at,
    }));

    return NextResponse.json({
      tasks: formattedTasks,
      page,
      total_pages: totalPages,
    });
  } catch (error) {
    console.error("Get tasks error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
