/**
 * Creates (or resets the password of) the PLATFORM_ADMIN user. Not possible through the UI.
 * Usage: pnpm create-platform-admin <email> <password> [name]
 */
import { eq, sql } from "drizzle-orm";
import { getDb, disconnectDb } from "@/server/db";
import { users } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";

async function main() {
  const [rawEmail, password, ...nameParts] = process.argv.slice(2);
  if (!rawEmail || !password || password.length < 8) {
    console.error("Usage: pnpm create-platform-admin <email> <password(8+ chars)> [name]");
    process.exit(1);
  }
  const email = rawEmail.toLowerCase();
  const db = await getDb();
  const passwordHash = await hashPassword(password);
  const [existing] = await db.select({ role: users.role }).from(users).where(eq(users.email, email));
  if (existing && existing.role !== "PLATFORM_ADMIN") {
    console.error("That email belongs to a shop user. Use a different email.");
    await disconnectDb();
    process.exit(1);
  }
  const fields = { name: nameParts.join(" ") || "Platform admin", role: "PLATFORM_ADMIN" as const, tenantId: null, passwordHash, active: true, locationIds: [] };
  await db
    .insert(users)
    .values({ email, ...fields })
    // Resetting the password signs out every existing session of this admin.
    .onConflictDoUpdate({ target: users.email, set: { ...fields, sessionVersion: sql`${users.sessionVersion} + 1` } });
  console.log(`Platform admin ready: ${email}`);
  await disconnectDb();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDb();
  process.exit(1);
});
