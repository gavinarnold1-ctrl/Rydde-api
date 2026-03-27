import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const body = await request.json();
    const inviteCode = body.code ?? body.inviteCode ?? body.invite_code;

    if (!inviteCode || typeof inviteCode !== "string") {
      return NextResponse.json(
        { error: "code is required" },
        { status: 400 }
      );
    }

    const sql = getDb();

    const households = await sql`
      SELECT id, name, invite_code, created_at
      FROM households
      WHERE invite_code = ${inviteCode.toUpperCase()}
    `;

    if (households.length === 0) {
      return NextResponse.json(
        { error: "Invalid invite code" },
        { status: 404 }
      );
    }

    const household = households[0];

    // Assign user to household
    await sql`
      UPDATE users SET household_id = ${household.id}, updated_at = NOW()
      WHERE id = ${auth.userId}
    `;

    // Create member record
    const users = await sql`
      SELECT full_name, email FROM users WHERE id = ${auth.userId}
    `;
    const displayName = users[0]?.full_name || users[0]?.email || "Member";

    await sql`
      INSERT INTO members (user_id, household_id, display_name, role)
      VALUES (${auth.userId}, ${household.id}, ${displayName}, 'member')
      ON CONFLICT (user_id, household_id) DO NOTHING
    `;

    return NextResponse.json({ household_id: household.id });
  } catch (error) {
    console.error("Join household error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
