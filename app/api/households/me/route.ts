import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function GET(request: NextRequest) {
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

    const householdId = users[0].household_id;

    // Fetch household, members, rooms, pain points in parallel
    const [households, members, rooms, painPoints] = await Promise.all([
      sql`SELECT id, name, invite_code, created_at FROM households WHERE id = ${householdId}`,
      sql`SELECT id, display_name, joined_at FROM members WHERE household_id = ${householdId}`,
      sql`
        SELECT r.id, r.name, r.type, r.space_id, r.updated_at as created_at, r.updated_at
        FROM rooms r
        JOIN spaces s ON r.space_id = s.id
        WHERE s.household_id = ${householdId}
        ORDER BY r.sort_order
      `,
      sql`SELECT id, household_id, description, created_at, created_at as updated_at FROM pain_points WHERE household_id = ${householdId}`,
    ]);

    const household = households[0];
    if (!household) {
      return NextResponse.json(
        { error: "Household not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      household: {
        id: household.id,
        name: household.name,
        invite_code: household.invite_code,
      },
      members,
      rooms,
      pain_points: painPoints,
    });
  } catch (error) {
    console.error("Get household detail error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
