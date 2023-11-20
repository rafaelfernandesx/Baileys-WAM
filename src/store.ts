import { PrismaClient } from "@prisma/client";
import { setLogger, setPrisma } from "./shared";

import pino from "pino";

export function initStore() {
  const prisma = new PrismaClient();
  const logger = pino({ level: process.env.LOG_LEVEL || "debug" });

  setPrisma(prisma);
  setLogger(logger);
}
