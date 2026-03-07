import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const { inviteCode } = await request.json();

    if (!inviteCode || typeof inviteCode !== "string") {
      return NextResponse.json(
        { error: "inviteCode is required" },
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

    await sql`
      UPDATE users SET household_id = ${household.id}, updated_at = NOW()
      WHERE id = ${auth.userId}
    `;

    return NextResponse.json({ household });
  } catch (error) {
    console.error("Join household error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
