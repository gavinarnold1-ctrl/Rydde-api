import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// This route is designed to be triggered by a Vercel cron job.
// It checks for pending notifications and sends push notifications.
// For now, it marks notifications as sent without actually sending pushes.
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sql = getDb();

    // Find pending notifications
    const pending = await sql`
      SELECT id, user_id, title, body, data
      FROM notifications
      WHERE sent_at IS NULL AND scheduled_for <= NOW()
      ORDER BY scheduled_for ASC
      LIMIT 100
    `;

    if (pending.length === 0) {
      return NextResponse.json({ processed: 0 });
    }

    // Mark as sent (actual push delivery to be implemented)
    const ids = pending.map((n) => n.id);
    await sql`
      UPDATE notifications SET sent_at = NOW()
      WHERE id = ANY(${ids})
    `;

    return NextResponse.json({
      processed: pending.length,
      notifications: pending,
    });
  } catch (error) {
    console.error("Notification cron error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
