import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const sql = getDb();
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    let tasks;
    if (sessionId) {
      tasks = await sql`
        SELECT t.id, t.session_id, t.room_id, t.title, t.description,
          t.duration_seconds, t.status, t.completed_at, t.created_at,
          r.name AS room_name
        FROM tasks t
        LEFT JOIN rooms r ON r.id = t.room_id
        JOIN sessions s ON s.id = t.session_id
        WHERE s.user_id = ${auth.userId} AND t.session_id = ${sessionId}
        ORDER BY t.created_at DESC
      `;
    } else {
      tasks = await sql`
        SELECT t.id, t.session_id, t.room_id, t.title, t.description,
          t.duration_seconds, t.status, t.completed_at, t.created_at,
          r.name AS room_name
        FROM tasks t
        LEFT JOIN rooms r ON r.id = t.room_id
        JOIN sessions s ON s.id = t.session_id
        WHERE s.user_id = ${auth.userId}
        ORDER BY t.created_at DESC
      `;
    }

    return NextResponse.json({ tasks });
  } catch (error) {
    console.error("Get tasks error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
