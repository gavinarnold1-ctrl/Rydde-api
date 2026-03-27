import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const sql = getDb();

    const members = await sql`
      SELECT m.id as member_id, m.household_id
      FROM members m WHERE m.user_id = ${auth.userId} LIMIT 1
    `;

    if (members.length === 0) {
      return NextResponse.json(
        { error: "No household found" },
        { status: 404 }
      );
    }

    const { member_id, household_id } = members[0];

    const sessions = await sql`
      SELECT id, household_id, member_id, duration_minutes, status,
             started_at, completed_at
      FROM sessions
      WHERE household_id = ${household_id} AND member_id = ${member_id}
      ORDER BY started_at DESC NULLS LAST
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
    const body = await request.json();
    const durationMinutes = body.durationMinutes ?? body.duration_minutes;

    if (!durationMinutes || typeof durationMinutes !== "number") {
      return NextResponse.json(
        { error: "duration_minutes is required" },
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

    const sessions = await sql`
      INSERT INTO sessions (household_id, member_id, duration_minutes, status, started_at)
      VALUES (${household_id}, ${member_id}, ${durationMinutes}, 'active', NOW())
      RETURNING id, household_id, member_id, duration_minutes, status, started_at
    `;

    return NextResponse.json(sessions[0], { status: 201 });
  } catch (error) {
    console.error("Create session error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
