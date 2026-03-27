import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const { id } = await params;
    const body = await request.json();
    const status = body.status;

    if (!status) {
      return NextResponse.json(
        { error: "status is required" },
        { status: 400 }
      );
    }

    const sql = getDb();

    const completedAt = status === "done" || status === "skipped" ? new Date().toISOString() : null;

    const sessions = await sql`
      UPDATE sessions
      SET status = ${status},
          completed_at = ${completedAt}
      WHERE id = ${id}
      RETURNING id, household_id, member_id, duration_minutes, status, started_at, completed_at
    `;

    if (sessions.length === 0) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(sessions[0]);
  } catch (error) {
    console.error("Update session error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
