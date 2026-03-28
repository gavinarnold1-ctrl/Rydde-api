import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

const DAY_NAME_TO_INT: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};
const INT_TO_DAY_NAME: Record<number, string> = {
  0: "sun", 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat",
};

function formatAutomation(row: any) {
  const rawDays = Array.isArray(row.days_of_week) ? row.days_of_week : [];
  // Convert ints back to day names for iOS
  const days = rawDays.map((d: any) =>
    typeof d === "number" ? (INT_TO_DAY_NAME[d] ?? d) : d
  );
  return {
    id: row.id,
    is_enabled: row.active ?? true,
    config: {
      time_of_day: row.time_of_day,
      duration_minutes: row.duration_minutes,
      days: days,
    },
  };
}

// Convert day names to int array for Postgres: {1,2,3}
function daysToPgArray(arr: string[]): string {
  const ints = arr.map((d) => DAY_NAME_TO_INT[d] ?? d);
  return "{" + ints.join(",") + "}";
}

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
      return NextResponse.json({ automations: [] });
    }

    const { member_id, household_id } = members[0];

    const automations = await sql`
      SELECT id, member_id, household_id, duration_minutes,
             days_of_week, time_of_day, timezone, active, created_at
      FROM automations
      WHERE household_id = ${household_id} AND member_id = ${member_id}
      ORDER BY created_at DESC
    `;

    return NextResponse.json({
      automations: automations.map(formatAutomation),
    });
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
    const isEnabled = body.isEnabled ?? body.is_enabled ?? true;
    const config = body.config;

    if (!config) {
      return NextResponse.json(
        { error: "config is required" },
        { status: 400 }
      );
    }

    const timeOfDay = config.timeOfDay ?? config.time_of_day;
    const durationMinutes = config.durationMinutes ?? config.duration_minutes;
    const days = config.days;
    const timezone = config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

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
    const pgDays = daysToPgArray(days);

    const automations = await sql`
      INSERT INTO automations (member_id, household_id, duration_minutes, days_of_week, time_of_day, timezone, active)
      VALUES (${member_id}, ${household_id}, ${durationMinutes}, ${pgDays}, ${timeOfDay}, ${timezone}, ${isEnabled})
      RETURNING *
    `;

    return NextResponse.json(formatAutomation(automations[0]), { status: 201 });
  } catch (error) {
    console.error("Create automation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
