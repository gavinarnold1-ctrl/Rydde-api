import { NextRequest, NextResponse } from "next/server";
import { verifyJwt } from "./auth";

export interface AuthenticatedUser {
  userId: string;
  email: string;
}

export async function authenticate(
  request: NextRequest
): Promise<AuthenticatedUser | NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing or invalid authorization header" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  try {
    const user = await verifyJwt(token);
    return user;
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }
}

export function isAuthError(
  result: AuthenticatedUser | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
