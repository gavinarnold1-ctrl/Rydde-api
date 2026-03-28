import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { SignJWT, importPKCS8 } from "jose";

// days_of_week is INT[] in DB: 0=Sun, 1=Mon, ..., 6=Sat

async function createApnsJwt(): Promise<string | null> {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const privateKey = process.env.APNS_PRIVATE_KEY;

  if (!keyId || !teamId || !privateKey) {
    return null;
  }

  // The private key may have literal \n — replace with actual newlines
  const formattedKey = privateKey.replace(/\\n/g, "\n");
  const key = await importPKCS8(formattedKey, "ES256");

  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(key);
}

async function sendApnsPush(
  deviceToken: string,
  title: string,
  body: string,
  url: string
): Promise<boolean> {
  const jwt = await createApnsJwt();
  if (!jwt) {
    console.warn("APNs not configured — skipping push delivery");
    return false;
  }

  // Use sandbox for TestFlight, production for App Store
  const isProduction = process.env.APNS_ENVIRONMENT === "production";
  const host = isProduction
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";

  const payload = {
    aps: {
      alert: { title, body },
      sound: "default",
      "thread-id": "rydde-reminder",
    },
    url,
  };

  try {
    const response = await fetch(`${host}/3/device/${deviceToken}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": "app.rydde.ios",
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": "0",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error(
        `APNs push failed for ${deviceToken.slice(0, 8)}...:`,
        response.status,
        error
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("APNs request error:", err);
    return false;
  }
}

// This route is triggered by a Vercel cron job every 10 minutes.
// It checks active automations, matches against current time/day,
// creates notification records, and sends push notifications via APNs.
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sql = getDb();

    // 1. Find all active automations with device tokens
    const automations = await sql`
      SELECT
        a.id as automation_id,
        a.member_id,
        a.household_id,
        a.duration_minutes,
        a.days_of_week,
        a.time_of_day,
        a.timezone,
        dt.token as device_token
      FROM automations a
      JOIN device_tokens dt ON dt.member_id = a.member_id
      WHERE a.active = true
    `;

    if (automations.length === 0) {
      return NextResponse.json({ processed: 0, reason: "no active automations" });
    }

    let sent = 0;
    let skipped = 0;

    for (const auto of automations) {
      // 2. Check if current time matches the automation's schedule
      const nowInTz = new Date(
        new Date().toLocaleString("en-US", { timeZone: auto.timezone || "America/New_York" })
      );
      const currentDayInt = nowInTz.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      const currentHour = nowInTz.getHours();
      const currentMinute = nowInTz.getMinutes();

      // Parse time_of_day (e.g., "16:00")
      const [targetHour, targetMinute] = (auto.time_of_day || "16:00")
        .split(":")
        .map(Number);

      // Check day match
      const days = Array.isArray(auto.days_of_week)
        ? auto.days_of_week
        : [];
      if (!days.includes(currentDayInt)) {
        skipped++;
        continue;
      }

      // Check time match within 10-minute window
      const currentTotalMinutes = currentHour * 60 + currentMinute;
      const targetTotalMinutes = targetHour * 60 + targetMinute;
      const diff = Math.abs(currentTotalMinutes - targetTotalMinutes);
      if (diff > 10) {
        skipped++;
        continue;
      }

      // 3. Check for duplicate — don't send if already sent today
      const today = nowInTz.toISOString().slice(0, 10); // YYYY-MM-DD
      const existing = await sql`
        SELECT id FROM notifications
        WHERE user_id = ${auto.member_id}
          AND title = 'Time to clean'
          AND DATE(scheduled_for AT TIME ZONE ${auto.timezone || "America/New_York"}) = ${today}
        LIMIT 1
      `;

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      // 4. Create notification record
      const notifTitle = "Time to clean";
      const notifBody = `You have ${auto.duration_minutes} minutes — let's make it count.`;
      const notifUrl = `rydde://home?duration=${auto.duration_minutes}`;

      await sql`
        INSERT INTO notifications (user_id, title, body, data, scheduled_for)
        VALUES (
          ${auto.member_id},
          ${notifTitle},
          ${notifBody},
          ${JSON.stringify({ url: notifUrl, duration_minutes: auto.duration_minutes })}::jsonb,
          NOW()
        )
      `;

      // 5. Send push notification
      const pushSent = await sendApnsPush(
        auto.device_token,
        notifTitle,
        notifBody,
        notifUrl
      );

      if (pushSent) {
        sent++;
      } else {
        // Still count as processed — notification record was created
        sent++;
      }
    }

    return NextResponse.json({
      processed: sent,
      skipped,
      total_automations: automations.length,
    });
  } catch (error) {
    console.error("Notification cron error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
