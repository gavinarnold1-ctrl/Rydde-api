import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const sql = getDb();

    const members = await sql`
      SELECT m.household_id
      FROM members m WHERE m.user_id = ${auth.userId} LIMIT 1
    `;

    if (members.length === 0) {
      return NextResponse.json({ supplies: [] });
    }

    const { household_id } = members[0];

    const supplies = await sql`
      SELECT id, name, category, is_custom, active
      FROM supplies
      WHERE household_id = ${household_id}
      ORDER BY category, name
    `;

    return NextResponse.json({ supplies });
  } catch (error) {
    console.error("Get supplies error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const body = await request.json();
    const suppliesInput = body.supplies;

    if (!Array.isArray(suppliesInput) || suppliesInput.length === 0) {
      return NextResponse.json(
        { error: "supplies array is required" },
        { status: 400 }
      );
    }

    const sql = getDb();

    const members = await sql`
      SELECT m.household_id
      FROM members m WHERE m.user_id = ${auth.userId} LIMIT 1
    `;

    if (members.length === 0) {
      return NextResponse.json(
        { error: "No household found" },
        { status: 400 }
      );
    }

    const { household_id } = members[0];

    // Upsert each supply
    for (const item of suppliesInput) {
      const { name, category, active, is_custom } = item;
      if (!name || !category) continue;

      await sql`
        INSERT INTO supplies (household_id, name, category, is_custom, active)
        VALUES (${household_id}, ${name}, ${category}, ${is_custom ?? false}, ${active ?? true})
        ON CONFLICT (household_id, name) DO UPDATE SET
          active = ${active ?? true},
          category = ${category}
      `;
    }

    // Return full list after upsert
    const supplies = await sql`
      SELECT id, name, category, is_custom, active
      FROM supplies
      WHERE household_id = ${household_id}
      ORDER BY category, name
    `;

    return NextResponse.json({ supplies });
  } catch (error) {
    console.error("Upsert supplies error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
