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

function daysToPgArray(arr: string[]): string {
  const ints = arr.map((d) => DAY_NAME_TO_INT[d] ?? d);
  return "{" + ints.join(",") + "}";
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const { id } = await params;
    const body = await request.json();
    const isEnabled = body.isEnabled ?? body.is_enabled;
    const config = body.config;

    const sql = getDb();

    const updates: Record<string, any> = {};
    if (isEnabled !== undefined) updates.active = isEnabled;
    if (config) {
      const timeOfDay = config.timeOfDay ?? config.time_of_day;
      const durationMinutes = config.durationMinutes ?? config.duration_minutes;
      const days = config.days;
      if (timeOfDay !== undefined) updates.time_of_day = timeOfDay;
      if (durationMinutes !== undefined) updates.duration_minutes = durationMinutes;
      if (days !== undefined) updates.days_of_week = daysToPgArray(days);
    }

    const automations = await sql`
      UPDATE automations
      SET active = COALESCE(${updates.active ?? null}, active),
          time_of_day = COALESCE(${updates.time_of_day ?? null}, time_of_day),
          duration_minutes = COALESCE(${updates.duration_minutes ?? null}, duration_minutes),
          days_of_week = COALESCE(${updates.days_of_week ?? null}, days_of_week)
      WHERE id = ${id}
      RETURNING *
    `;

    if (automations.length === 0) {
      return NextResponse.json(
        { error: "Automation not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(formatAutomation(automations[0]));
  } catch (error) {
    console.error("Update automation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
