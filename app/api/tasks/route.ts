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

    const { household_id } = members[0];

    const tasks = await sql`
      SELECT t.id, t.session_id, t.household_id, t.room_id, t.title,
             t.description, t.rationale, t.difficulty, t.engine_version, t.created_at,
             r.name as room_name
      FROM tasks t
      LEFT JOIN rooms r ON t.room_id = r.id
      JOIN sessions s ON t.session_id = s.id
      WHERE t.household_id = ${household_id}
      ORDER BY t.created_at DESC
    `;

    return NextResponse.json({ tasks });
  } catch (error) {
    console.error("Get tasks error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
