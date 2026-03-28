import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const body = await request.json();
    const token = body.token;
    const platform = body.platform ?? "ios";

    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { error: "token is required" },
        { status: 400 }
      );
    }

    const sql = getDb();

    // Look up member
    const members = await sql`
      SELECT m.id as member_id, m.household_id
      FROM members m WHERE m.user_id = ${auth.userId} LIMIT 1
    `;

    if (members.length === 0) {
      return NextResponse.json(
        { error: "No household" },
        { status: 400 }
      );
    }

    const { member_id } = members[0];

    // Upsert device token
    const rows = await sql`
      INSERT INTO device_tokens (member_id, token, platform)
      VALUES (${member_id}, ${token}, ${platform})
      ON CONFLICT (token) DO UPDATE SET
        member_id = ${member_id},
        platform = ${platform},
        updated_at = NOW()
      RETURNING id
    `;

    return NextResponse.json({ id: rows[0].id }, { status: 201 });
  } catch (error) {
    console.error("Device token error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
