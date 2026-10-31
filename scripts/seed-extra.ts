/* eslint-disable no-console */
/*
 * Adds the newer demo data (Craiova candidates, recruiting projects, former employees) to an EXISTING database,
 * without deleting anything (your scenarios, requests and edits stay). Safe to run more than once.
 *   npm run db:seed-extra
 * `npm run local` runs it automatically once (marker .pgdata/.seeded-recruiting).
 */
import "dotenv/config"; // must be first: the database client reads DATABASE_URL when it is imported
import { prisma } from "../src/lib/db";
import { seedRecruiting } from "../prisma/seed-team";

let state = 20261101;
const rand = () => {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
};

async function main() {
  const skills = await prisma.skill.findMany();
  if (!skills.length) {
    console.log("Baza e goală: rulează întâi npm run db:seed.");
    process.exitCode = 2;
    return;
  }
  const skillId = Object.fromEntries(skills.map((s) => [s.code, s.id]));
  const needed = ["ATC_LIC", "MET_OBS", "APRON", "RADIO"];
  if (needed.some((c) => !skillId[c])) {
    console.log("Datele demo sunt dintr-o versiune veche (lipsesc departamentele ATC/MET/APR). Oprește aplicația și rulează npm run local:reset.");
    process.exitCode = 2;
    return;
  }
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  const usedIds = new Set<string>();
  await seedRecruiting({
    now: new Date(),
    admin: admin?.id ?? null,
    skillId,
    rand,
    pickHired: async (code) => {
      const e = await prisma.employee.findFirst({
        where: {
          active: true,
          department: { code },
          level: { rank: 1 },
          hiredFrom: null,
          contractEndDate: null,
          availability: { none: {} },
          id: { notIn: [...usedIds] },
        },
        orderBy: { lastName: "asc" },
      });
      if (!e) return null;
      usedIds.add(e.id);
      return e.id;
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
