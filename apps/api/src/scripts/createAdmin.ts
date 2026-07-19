import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const [, , email, password] = process.argv;

if (!email || !password) {
  console.error("Usage: tsx src/scripts/createAdmin.ts <email> <password>");
  process.exit(1);
}

const prisma = new PrismaClient();

const passwordHash = await argon2.hash(password);
const user = await prisma.user.upsert({
  where: { email },
  update: { passwordHash },
  create: { email, passwordHash, role: "ADMIN" },
});

console.log(`Admin user ready: ${user.email} (${user.id})`);
await prisma.$disconnect();
