import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const sql = getDb();

    const users = await sql`
      SELECT
        u.id, u.apple_user_id, u.email, u.full_name,
        u.household_id, u.created_at, u.updated_at,
        h.name AS household_name, h.invite_code AS household_invite_code
      FROM users u
      LEFT JOIN households h ON h.id = u.household_id
      WHERE u.id = ${auth.userId}
    `;

    if (users.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const user = users[0];
    return NextResponse.json({
      user: {
        id: user.id,
        appleUserId: user.apple_user_id,
        email: user.email,
        fullName: user.full_name,
        householdId: user.household_id,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
      household: user.household_id
        ? {
            id: user.household_id,
            name: user.household_name,
            inviteCode: user.household_invite_code,
          }
        : null,
    });
  } catch (error) {
    console.error("Get me error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
