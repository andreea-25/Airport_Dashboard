import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { llmHealth } from "@/lib/ai/llm";

export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  return NextResponse.json({ db, ai: await llmHealth() });
}
