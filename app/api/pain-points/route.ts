import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const body = await request.json();
    const householdId = body.householdId ?? body.household_id;
    const descriptions: string[] = body.descriptions ?? [];

    if (!householdId) {
      return NextResponse.json(
        { error: "household_id is required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(descriptions) || descriptions.length === 0) {
      return NextResponse.json(
        { error: "descriptions array is required" },
        { status: 400 }
      );
    }

    const sql = getDb();

    // Insert each pain point
    const painPoints = [];
    for (const description of descriptions) {
      const rows = await sql`
        INSERT INTO pain_points (household_id, description)
        VALUES (${householdId}, ${description})
        RETURNING id, household_id, description, created_at, NOW() as updated_at
      `;
      painPoints.push(rows[0]);
    }

    return NextResponse.json({ pain_points: painPoints }, { status: 201 });
  } catch (error) {
    console.error("Create pain points error:", error);
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

    const users = await sql`
      SELECT household_id FROM users WHERE id = ${auth.userId}
    `;

    if (!users[0]?.household_id) {
      return NextResponse.json(
        { error: "No household found" },
        { status: 404 }
      );
    }

    const painPoints = await sql`
      SELECT id, household_id, description, created_at, created_at as updated_at
      FROM pain_points
      WHERE household_id = ${users[0].household_id}
      ORDER BY created_at
    `;

    return NextResponse.json({ pain_points: painPoints });
  } catch (error) {
    console.error("Get pain points error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
