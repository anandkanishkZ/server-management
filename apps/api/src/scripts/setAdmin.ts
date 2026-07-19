import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const [, , email, password] = process.argv;

if (!email || !password) {
  console.error("Usage: node dist/scripts/setAdmin.js <email> <password>");
  process.exit(1);
}

const prisma = new PrismaClient();

// Single-admin panel: replace whatever admin credentials exist rather than
// accumulating stale accounts. Cascades clear old refresh tokens too.
await prisma.user.deleteMany({});

const passwordHash = await argon2.hash(password);
const user = await prisma.user.create({
  data: { email, passwordHash, role: "ADMIN" },
});

console.log(`Admin credentials replaced: ${user.email} (${user.id})`);
await prisma.$disconnect();
