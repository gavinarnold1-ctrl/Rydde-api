import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const sql = getDb();

    const members = await sql`
      SELECT m.id as member_id, m.household_id
      FROM members m WHERE m.user_id = ${auth.userId} LIMIT 1
    `;

    if (members.length === 0) {
      return NextResponse.json(
        { error: "No household found" },
        { status: 404 }
      );
    }

    const { member_id, household_id } = members[0];

    const automations = await sql`
      SELECT id, member_id, household_id, duration_minutes,
             days_of_week, time_of_day, timezone, active, created_at
      FROM automations
      WHERE household_id = ${household_id} AND member_id = ${member_id}
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
    const body = await request.json();
    const durationMinutes = body.durationMinutes ?? body.duration_minutes;
    const daysOfWeek = body.daysOfWeek ?? body.days_of_week;
    const timeOfDay = body.timeOfDay ?? body.time_of_day;
    const timezone = body.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (!durationMinutes || !daysOfWeek || !timeOfDay) {
      return NextResponse.json(
        { error: "duration_minutes, days_of_week, and time_of_day are required" },
        { status: 400 }
      );
    }

    const sql = getDb();

    const members = await sql`
      SELECT m.id as member_id, m.household_id
      FROM members m WHERE m.user_id = ${auth.userId} LIMIT 1
    `;

    if (members.length === 0) {
      return NextResponse.json(
        { error: "No household found" },
        { status: 400 }
      );
    }

    const { member_id, household_id } = members[0];

    const automations = await sql`
      INSERT INTO automations (member_id, household_id, duration_minutes, days_of_week, time_of_day, timezone)
      VALUES (${member_id}, ${household_id}, ${durationMinutes}, ${daysOfWeek}, ${timeOfDay}, ${timezone})
      RETURNING id, member_id, household_id, duration_minutes, days_of_week, time_of_day, timezone, active, created_at
    `;

    return NextResponse.json(automations[0], { status: 201 });
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
    const body = await request.json();
    const id = body.id;
    const durationMinutes = body.durationMinutes ?? body.duration_minutes;
    const daysOfWeek = body.daysOfWeek ?? body.days_of_week;
    const timeOfDay = body.timeOfDay ?? body.time_of_day;
    const timezone = body.timezone;
    const active = body.active;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const sql = getDb();

    const automations = await sql`
      UPDATE automations
      SET duration_minutes = COALESCE(${durationMinutes ?? null}, duration_minutes),
          days_of_week = COALESCE(${daysOfWeek ?? null}, days_of_week),
          time_of_day = COALESCE(${timeOfDay ?? null}, time_of_day),
          timezone = COALESCE(${timezone ?? null}, timezone),
          active = COALESCE(${active ?? null}, active)
      WHERE id = ${id}
      RETURNING id, member_id, household_id, duration_minutes, days_of_week, time_of_day, timezone, active, created_at
    `;

    if (automations.length === 0) {
      return NextResponse.json(
        { error: "Automation not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(automations[0]);
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

    const result = await sql`
      DELETE FROM automations WHERE id = ${id}
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
