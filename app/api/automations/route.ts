import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

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
        { error: "User is not in a household" },
        { status: 400 }
      );
    }

    const automations = await sql`
      SELECT id, household_id, name, cron_expression, room_id, duration_minutes,
        enabled, created_by, created_at, updated_at
      FROM automations
      WHERE household_id = ${users[0].household_id}
      ORDER BY created_at DESC
    `;

    return NextResponse.json({ automations });
  } catch (error) {
    console.error("Get automations error:", error);
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
    const { name, cronExpression, roomId, durationMinutes } =
      await request.json();

    if (!name || !cronExpression || !roomId || !durationMinutes) {
      return NextResponse.json(
        {
          error:
            "name, cronExpression, roomId, and durationMinutes are required",
        },
        { status: 400 }
      );
    }

    const sql = getDb();

    const users = await sql`
      SELECT household_id FROM users WHERE id = ${auth.userId}
    `;

    if (!users[0]?.household_id) {
      return NextResponse.json(
        { error: "User is not in a household" },
        { status: 400 }
      );
    }

    const automations = await sql`
      INSERT INTO automations (household_id, name, cron_expression, room_id, duration_minutes, created_by)
      VALUES (${users[0].household_id}, ${name}, ${cronExpression}, ${roomId}, ${durationMinutes}, ${auth.userId})
      RETURNING id, household_id, name, cron_expression, room_id, duration_minutes,
        enabled, created_by, created_at
    `;

    return NextResponse.json({ automation: automations[0] }, { status: 201 });
  } catch (error) {
    console.error("Create automation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const { id, name, cronExpression, roomId, durationMinutes, enabled } =
      await request.json();

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const sql = getDb();

    const users = await sql`
      SELECT household_id FROM users WHERE id = ${auth.userId}
    `;

    // Build update dynamically but safely with parameterized queries
    const automations = await sql`
      UPDATE automations SET
        name = COALESCE(${name ?? null}, name),
        cron_expression = COALESCE(${cronExpression ?? null}, cron_expression),
        room_id = COALESCE(${roomId ?? null}, room_id),
        duration_minutes = COALESCE(${durationMinutes ?? null}, duration_minutes),
        enabled = COALESCE(${enabled ?? null}, enabled),
        updated_at = NOW()
      WHERE id = ${id} AND household_id = ${users[0]?.household_id}
      RETURNING id, household_id, name, cron_expression, room_id, duration_minutes,
        enabled, created_by, created_at, updated_at
    `;

    if (automations.length === 0) {
      return NextResponse.json(
        { error: "Automation not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ automation: automations[0] });
  } catch (error) {
    console.error("Update automation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const sql = getDb();

    const users = await sql`
      SELECT household_id FROM users WHERE id = ${auth.userId}
    `;

    const result = await sql`
      DELETE FROM automations
      WHERE id = ${id} AND household_id = ${users[0]?.household_id}
      RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Automation not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Delete automation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
