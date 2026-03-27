import { NextRequest, NextResponse } from "next/server";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { getDb } from "@/lib/db";
import { signJwt } from "@/lib/auth";

const APPLE_JWKS_URL = new URL("https://appleid.apple.com/auth/keys");
const appleJWKS = createRemoteJWKSet(APPLE_JWKS_URL);

async function verifyAppleToken(identityToken: string) {
  const { payload } = await jwtVerify(identityToken, appleJWKS, {
    issuer: "https://appleid.apple.com",
    audience: process.env.APPLE_TEAM_ID,
  });
  return payload;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Accept both camelCase and snake_case field names (iOS client sends snake_case)
    const identityToken = body.identityToken ?? body.identity_token;
    const firstName = body.firstName ?? body.first_name;
    const lastName = body.lastName ?? body.last_name;
    const fullName = body.fullName ?? [firstName, lastName].filter(Boolean).join(" ") || null;

    if (!identityToken) {
      return NextResponse.json(
        { error: "identityToken is required" },
        { status: 400 }
      );
    }

    const applePayload = await verifyAppleToken(identityToken);
    const appleUserId = applePayload.sub;
    const email = applePayload.email as string | undefined;

    if (!appleUserId) {
      return NextResponse.json(
        { error: "Invalid Apple identity token" },
        { status: 401 }
      );
    }

    const sql = getDb();

    // Upsert user
    const users = await sql`
      INSERT INTO users (apple_user_id, email, full_name)
      VALUES (${appleUserId}, ${email ?? null}, ${fullName ?? null})
      ON CONFLICT (apple_user_id)
      DO UPDATE SET
        email = COALESCE(EXCLUDED.email, users.email),
        full_name = COALESCE(EXCLUDED.full_name, users.full_name),
        updated_at = NOW()
      RETURNING id, apple_user_id, email, full_name, household_id, created_at
    `;

    const user = users[0];

    const token = await signJwt({
      userId: user.id,
      email: user.email ?? "",
    });

    return NextResponse.json({ token, user });
  } catch (error) {
    console.error("Sign-in error:", error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 401 }
    );
  }
}
