import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const body = await request.json();
    const score = body.score;
    const source = body.source === "session" ? "session" : "weekly";

    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return NextResponse.json(
        { error: "score must be an integer between 1 and 5" },
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

    const rows = await sql`
      INSERT INTO satisfaction_scores (household_id, member_id, score, source)
      VALUES (${household_id}, ${member_id}, ${score}, ${source})
      RETURNING id, score, source, created_at
    `;

    return NextResponse.json({ satisfaction: rows[0] }, { status: 201 });
  } catch (error) {
    console.error("Create satisfaction error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const sql = getDb();

    const members = await sql`
      SELECT m.household_id FROM members m WHERE m.user_id = ${auth.userId} LIMIT 1
    `;

    if (members.length === 0) {
      return NextResponse.json({ scores: [] });
    }

    const scores = await sql`
      SELECT id, score, source, created_at
      FROM satisfaction_scores
      WHERE household_id = ${members[0].household_id}
      ORDER BY created_at DESC
      LIMIT 8
    `;

    return NextResponse.json({ scores });
  } catch (error) {
    console.error("Get satisfaction error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
