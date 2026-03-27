import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const { name } = await request.json();

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    const sql = getDb();
    const inviteCode = generateInviteCode();

    const households = await sql`
      INSERT INTO households (name, invite_code, created_by)
      VALUES (${name}, ${inviteCode}, ${auth.userId})
      RETURNING id, name, invite_code, created_at, updated_at
    `;

    const household = households[0];

    // Assign the user to the new household
    await sql`
      UPDATE users SET household_id = ${household.id}, updated_at = NOW()
      WHERE id = ${auth.userId}
    `;

    return NextResponse.json(household, { status: 201 });
  } catch (error) {
    console.error("Create household error:", error);
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

    const households = await sql`
      SELECT h.id, h.name, h.invite_code, h.created_at, h.updated_at, h.created_by
      FROM households h
      JOIN users u ON u.household_id = h.id
      WHERE u.id = ${auth.userId}
    `;

    if (households.length === 0) {
      return NextResponse.json(
        { error: "No household found" },
        { status: 404 }
      );
    }

    const household = households[0];

    // Get household members
    const members = await sql`
      SELECT id, email, full_name, created_at
      FROM users
      WHERE household_id = ${household.id}
    `;

    return NextResponse.json({ household, members });
  } catch (error) {
    console.error("Get household error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
