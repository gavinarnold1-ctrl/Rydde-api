// Applies pending SQL migrations during the Vercel build (npm run build).
// Tracks applied files in a _migrations table so each runs exactly once.
import { neon } from "@neondatabase/serverless";
import { readdir, readFile } from "node:fs/promises";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("migrate: DATABASE_URL not set, skipping");
  process.exit(0);
}

const sql = neon(url);

await sql.query(`CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
)`);

const applied = new Set(
  (await sql.query("SELECT name FROM _migrations")).map((r) => r.name)
);

const files = (await readdir("migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  if (applied.has(file)) continue;

  const text = await readFile(`migrations/${file}`, "utf8");
  // Strip comment lines, then split into individual statements —
  // the Neon HTTP driver runs one statement per query.
  const statements = text
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`migrate: applying ${file} (${statements.length} statements)`);
  for (const statement of statements) {
    await sql.query(statement);
  }
  await sql.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
}

console.log("migrate: up to date");
