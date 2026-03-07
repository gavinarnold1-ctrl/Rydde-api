import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

const VALID_STATUSES = ["active", "paused", "completed", "cancelled"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const { id } = await params;
    const { status } = await request.json();

    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    const sql = getDb();

    const completedAt = status === "completed" ? new Date().toISOString() : null;

    const sessions = await sql`
      UPDATE sessions
      SET
        status = ${status},
        completed_at = COALESCE(${completedAt}::timestamptz, completed_at),
        updated_at = NOW()
      WHERE id = ${id} AND user_id = ${auth.userId}
      RETURNING id, user_id, room_id, status, duration_minutes,
        started_at, completed_at, created_at, updated_at
    `;

    if (sessions.length === 0) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ session: sessions[0] });
  } catch (error) {
    console.error("Update session error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
