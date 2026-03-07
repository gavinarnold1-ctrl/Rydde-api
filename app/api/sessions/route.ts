import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const sql = getDb();

    const sessions = await sql`
      SELECT
        s.id, s.user_id, s.room_id, s.status,
        s.duration_minutes, s.started_at, s.completed_at,
        s.created_at, r.name AS room_name
      FROM sessions s
      LEFT JOIN rooms r ON r.id = s.room_id
      WHERE s.user_id = ${auth.userId}
      ORDER BY s.created_at DESC
    `;

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("Get sessions error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const { roomId, durationMinutes } = await request.json();

    if (!roomId) {
      return NextResponse.json(
        { error: "roomId is required" },
        { status: 400 }
      );
    }

    if (!durationMinutes || typeof durationMinutes !== "number") {
      return NextResponse.json(
        { error: "durationMinutes is required and must be a number" },
        { status: 400 }
      );
    }

    const sql = getDb();

    const sessions = await sql`
      INSERT INTO sessions (user_id, room_id, duration_minutes, status, started_at)
      VALUES (${auth.userId}, ${roomId}, ${durationMinutes}, 'active', NOW())
      RETURNING id, user_id, room_id, status, duration_minutes, started_at, created_at
    `;

    return NextResponse.json({ session: sessions[0] }, { status: 201 });
  } catch (error) {
    console.error("Create session error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
