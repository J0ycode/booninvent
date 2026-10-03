/**
 * Creates (or resets the password of) the PLATFORM_ADMIN user. Not possible through the UI.
 * Usage: pnpm create-platform-admin <email> <password> [name]
 */
import { connectDb, disconnectDb } from "@/server/db";
import { User } from "@/server/models/core";
import { hashPassword } from "@/server/auth/password";

async function main() {
  const [email, password, ...nameParts] = process.argv.slice(2);
  if (!email || !password || password.length < 8) {
    console.error("Usage: pnpm create-platform-admin <email> <password(8+ chars)> [name]");
    process.exit(1);
  }
  await connectDb();
  const passwordHash = await hashPassword(password);
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing && existing.role !== "PLATFORM_ADMIN") {
    console.error("That email belongs to a shop user. Use a different email.");
    process.exit(1);
  }
  await User.updateOne(
    { email: email.toLowerCase() },
    {
      $set: { name: nameParts.join(" ") || "Platform admin", role: "PLATFORM_ADMIN", tenantId: null, passwordHash, active: true, locationIds: [] },
      $inc: { sessionVersion: 1 },
    },
    { upsert: true },
  );
  console.log(`Platform admin ready: ${email.toLowerCase()}`);
  await disconnectDb();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDb();
  process.exit(1);
});
