import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const sql = getDb();

    const users = await sql`
      SELECT u.id, u.apple_user_id, u.email, u.full_name,
             u.household_id, u.created_at, u.updated_at
      FROM users u
      WHERE u.id = ${auth.userId}
    `;

    if (users.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const user = users[0];
    const nameParts = (user.full_name || "").split(" ");

    // Fetch household if user has one
    let household = null;
    if (user.household_id) {
      const households = await sql`
        SELECT id, name, invite_code, created_at, updated_at
        FROM households WHERE id = ${user.household_id}
      `;
      if (households.length > 0) {
        household = households[0];
      }
    }

    return NextResponse.json({
      user: {
        id: user.id,
        apple_user_id: user.apple_user_id,
        email: user.email,
        full_name: user.full_name,
        first_name: nameParts[0] || null,
        last_name: nameParts.slice(1).join(" ") || null,
        household_id: user.household_id,
        role: "owner",
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
      household,
    });
  } catch (error) {
    console.error("Get me error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const body = await request.json();
    const firstName = body.firstName ?? body.first_name;

    const sql = getDb();

    if (firstName !== undefined) {
      const current = await sql`
        SELECT full_name FROM users WHERE id = ${auth.userId}
      `;
      const currentParts = (current[0]?.full_name || "").split(" ");
      const lastName = currentParts.slice(1).join(" ");
      const fullName = lastName ? `${firstName} ${lastName}` : firstName;

      await sql`
        UPDATE users SET full_name = ${fullName}, updated_at = NOW()
        WHERE id = ${auth.userId}
      `;
    }

    if (firstName) {
      await sql`
        UPDATE members SET display_name = ${firstName}
        WHERE user_id = ${auth.userId}
      `;
    }

    const users = await sql`
      SELECT id, apple_user_id, email, full_name, household_id, created_at, updated_at
      FROM users WHERE id = ${auth.userId}
    `;

    return NextResponse.json(users[0]);
  } catch (error) {
    console.error("Update me error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
