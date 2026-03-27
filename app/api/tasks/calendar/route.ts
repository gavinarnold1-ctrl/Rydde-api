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
      return NextResponse.json({ days: [] });
    }

    const { household_id } = members[0];

    // Get completed task counts per day for the last 90 days
    const days = await sql`
      SELECT
        TO_CHAR(s.completed_at, 'YYYY-MM-DD') as date,
        COUNT(*) as completed_count
      FROM tasks t
      JOIN sessions s ON t.session_id = s.id
      WHERE t.household_id = ${household_id}
        AND s.status = 'done'
        AND s.completed_at IS NOT NULL
        AND s.completed_at > NOW() - INTERVAL '90 days'
      GROUP BY TO_CHAR(s.completed_at, 'YYYY-MM-DD')
      ORDER BY date DESC
    `;

    return NextResponse.json({
      days: days.map((d: any) => ({
        date: d.date,
        completed_count: parseInt(d.completed_count, 10),
      })),
    });
  } catch (error) {
    console.error("Get task calendar error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
