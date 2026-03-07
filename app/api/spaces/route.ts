import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { authenticate, isAuthError } from "@/lib/middleware";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (isAuthError(auth)) return auth;

  try {
    const sql = getDb();

    // Get user's household_id
    const users = await sql`
      SELECT household_id FROM users WHERE id = ${auth.userId}
    `;

    if (!users[0]?.household_id) {
      return NextResponse.json(
        { error: "User is not in a household" },
        { status: 400 }
      );
    }

    const householdId = users[0].household_id;

    const spaces = await sql`
      SELECT s.id, s.name, s.household_id, s.created_at,
        COALESCE(
          json_agg(
            json_build_object('id', r.id, 'name', r.name, 'createdAt', r.created_at)
          ) FILTER (WHERE r.id IS NOT NULL),
          '[]'
        ) AS rooms
      FROM spaces s
      LEFT JOIN rooms r ON r.space_id = s.id
      WHERE s.household_id = ${householdId}
      GROUP BY s.id
      ORDER BY s.created_at
    `;

    return NextResponse.json({ spaces });
  } catch (error) {
    console.error("Get spaces error:", error);
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
    const { name, rooms } = await request.json();

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "name is required" },
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

    const householdId = users[0].household_id;

    const spaces = await sql`
      INSERT INTO spaces (name, household_id)
      VALUES (${name}, ${householdId})
      RETURNING id, name, household_id, created_at
    `;

    const space = spaces[0];

    // Create rooms if provided
    const createdRooms = [];
    if (Array.isArray(rooms)) {
      for (const roomName of rooms) {
        if (typeof roomName === "string" && roomName.trim()) {
          const newRooms = await sql`
            INSERT INTO rooms (name, space_id)
            VALUES (${roomName.trim()}, ${space.id})
            RETURNING id, name, created_at
          `;
          createdRooms.push(newRooms[0]);
        }
      }
    }

    return NextResponse.json(
      { space: { ...space, rooms: createdRooms } },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create space error:", error);
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
    const { id, name, rooms } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const sql = getDb();

    // Verify the space belongs to user's household
    const users = await sql`
      SELECT household_id FROM users WHERE id = ${auth.userId}
    `;

    const existing = await sql`
      SELECT id FROM spaces
      WHERE id = ${id} AND household_id = ${users[0]?.household_id}
    `;

    if (existing.length === 0) {
      return NextResponse.json(
        { error: "Space not found" },
        { status: 404 }
      );
    }

    if (name) {
      await sql`
        UPDATE spaces SET name = ${name}, updated_at = NOW() WHERE id = ${id}
      `;
    }

    // Update rooms if provided: delete existing and re-create
    if (Array.isArray(rooms)) {
      await sql`DELETE FROM rooms WHERE space_id = ${id}`;
      for (const roomName of rooms) {
        if (typeof roomName === "string" && roomName.trim()) {
          await sql`
            INSERT INTO rooms (name, space_id) VALUES (${roomName.trim()}, ${id})
          `;
        }
      }
    }

    const spaces = await sql`
      SELECT s.id, s.name, s.household_id, s.created_at,
        COALESCE(
          json_agg(
            json_build_object('id', r.id, 'name', r.name, 'createdAt', r.created_at)
          ) FILTER (WHERE r.id IS NOT NULL),
          '[]'
        ) AS rooms
      FROM spaces s
      LEFT JOIN rooms r ON r.space_id = s.id
      WHERE s.id = ${id}
      GROUP BY s.id
    `;

    return NextResponse.json({ space: spaces[0] });
  } catch (error) {
    console.error("Update space error:", error);
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
      DELETE FROM spaces
      WHERE id = ${id} AND household_id = ${users[0]?.household_id}
      RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Space not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Delete space error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
