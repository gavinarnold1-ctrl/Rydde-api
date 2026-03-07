import { NextRequest, NextResponse } from "next/server";
import { authenticate, isAuthError } from "@/lib/middleware";

// Phase 4: AI task engine — returns a mock task for now
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const { roomId, sessionId } = await request.json();

    if (!roomId || !sessionId) {
      return NextResponse.json(
        { error: "roomId and sessionId are required" },
        { status: 400 }
      );
    }

    // Mock task for testing
    const mockTask = {
      id: "mock-task-" + Date.now(),
      sessionId,
      roomId,
      title: "Wipe down kitchen counters",
      description:
        "Clear off countertops and wipe them down with a damp cloth and all-purpose cleaner. Pay special attention to areas around the stove and sink.",
      durationSeconds: 300,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({ task: mockTask });
  } catch (error) {
    console.error("Generate task error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
