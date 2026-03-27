import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const sql = getDb();

    // Get user's household
    const users = await sql`
      SELECT household_id FROM users WHERE id = ${auth.userId}
    `;

    if (!users[0]?.household_id) {
      return NextResponse.json(
        { error: "No household found" },
        { status: 404 }
      );
    }

    // Generate new invite code
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    await sql`
      UPDATE households SET invite_code = ${code}, updated_at = NOW()
      WHERE id = ${users[0].household_id}
    `;

    return NextResponse.json({ code });
  } catch (error) {
    console.error("Generate invite code error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
