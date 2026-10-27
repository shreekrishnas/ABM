import { PrismaClient } from "@prisma/client";

// One client per process; reused across hot reloads in dev. Unscoped: only the client
// scope itself and code that must see every client (sign-in, team) use it directly.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const baseDb = globalForPrisma.prisma ?? new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = baseDb;
