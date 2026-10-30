import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ollamaConfig, ollamaHealth } from "@/lib/ai/ollama";

export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  const ollama = await ollamaHealth();
  return NextResponse.json({ db, ollama: { ...ollama, configuredModel: ollamaConfig().model } });
}
