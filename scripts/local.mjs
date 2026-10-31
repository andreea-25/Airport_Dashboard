// Run the app without Docker: starts an embedded PostgreSQL (binaries come from npm),
// applies migrations, seeds on first run, then starts Next.js.
//   npm run local          -> database + app (Ctrl+C stops both)
//   npm run local:db       -> only the database (keep it open, run `npm run dev` elsewhere)
//   npm run local:reset    -> delete the local database folder and start fresh
//   npm run local:prod     -> database + optimised production build (fast pages; rebuilds only when code changed)
//   node scripts/local.mjs --setup -> prepare everything (database, migrations, demo data) and exit (used by npm run setup)
import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const args = new Set(process.argv.slice(2));
const dataDir = path.resolve(".pgdata");

if (args.has("--reset")) {
  rmSync(dataDir, { recursive: true, force: true });
  console.log("Local database folder deleted (.pgdata).");
}

const url = new URL(process.env.DATABASE_URL ?? "postgresql://airport:airport@localhost:5432/airport");
const user = decodeURIComponent(url.username || "airport");
const password = decodeURIComponent(url.password || "airport");
const port = Number(url.port || 5432);
const database = url.pathname.replace(/^\//, "") || "airport";

// keep PostgreSQL's own output so we can show it if something fails
const pgLog = [];
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: (m) => pgLog.push(String(m)),
  onError: (m) => pgLog.push(String(m instanceof Error ? m.message : m)),
});

function portIsFree(p) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(p, "127.0.0.1");
  });
}

function run(cmd, cmdArgs) {
  const line = [cmd, ...cmdArgs].join(" ");
  return new Promise((resolve, reject) => {
    const p = spawn(line, { stdio: "inherit", shell: true });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${line} exited with ${code}`))));
  });
}

/** The Prisma client is generated code: regenerate it when schema.prisma is newer (e.g. after git pull). */
function clientIsStale() {
  const client = path.resolve("src", "generated", "prisma", "client.ts");
  if (!existsSync(client)) return true;
  return statSync(path.resolve("prisma", "schema.prisma")).mtimeMs > statSync(client).mtimeMs;
}

/** Newest modification time of the source files that affect the production build. */
function newestSourceMtime() {
  let newest = 0;
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "generated" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  walk(path.resolve("src"));
  for (const f of ["package.json", "next.config.mjs", "tailwind.config.ts", ".env", "prisma/schema.prisma"]) if (existsSync(f)) newest = Math.max(newest, statSync(f).mtimeMs);
  return newest;
}

function needsBuild() {
  const buildId = path.resolve(".next", "BUILD_ID");
  if (!existsSync(buildId)) return true;
  return newestSourceMtime() > statSync(buildId).mtimeMs;
}

let stopping = false;
let nextProc = null;
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM"); // whole process group (npx -> next)
  } catch {
    child.kill("SIGTERM");
  }
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  killTree(nextProc);
  console.log("\nStopping local PostgreSQL…");
  try {
    await pg.stop();
  } catch {
    /* already stopped */
  }
  process.exit(code);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

const initialised = existsSync(path.join(dataDir, "PG_VERSION"));
const seededMarker = path.join(dataDir, ".seeded");
let pgStarted = false;
try {
  if (!(await portIsFree(port))) {
    throw new Error(
      `Portul ${port} este deja folosit (probabil un PostgreSQL instalat pe calculator sau Docker).\n` +
        `Soluție: în .env schimbă portul din DATABASE_URL, de ex. localhost:5433, apoi rulează din nou npm run local.`,
    );
  }
  if (!initialised) {
    console.log("First run: initialising local PostgreSQL in .pgdata …");
    await pg.initialise();
  }
  try {
    await pg.start();
  } catch (e) {
    throw new Error(`PostgreSQL nu a pornit.${e?.message ? " " + e.message : ""}`);
  }
  pgStarted = true;
  console.log(`PostgreSQL running on localhost:${port} (user ${user}, database ${database})`);
  try {
    await pg.createDatabase(database);
  } catch {
    /* already exists */
  }

  if (clientIsStale()) {
    console.log("Regenerating the Prisma client (schema changed)…");
    await run("npx", ["prisma", "generate"]);
  }
  await run("npx", ["prisma", "migrate", "deploy"]);
  if (!existsSync(seededMarker) || args.has("--seed")) {
    await run("npx", ["tsx", "prisma/seed.ts"]);
    writeFileSync(seededMarker, new Date().toISOString());
  }

  if (args.has("--setup")) {
    console.log("\n✓ Baza de date este pregătită (migrații + date demo).");
    await stop(0);
  } else if (args.has("--db-only")) {
    console.log("Database is ready. Press Ctrl+C to stop it.");
    await new Promise(() => {});
  } else {
    const prod = args.has("--prod");
    if (prod && needsBuild()) {
      console.log("Building the optimised version (about 1 minute, only when the code changed)…");
      await run("npx", ["next", "build"]);
    }
    // dev: Turbopack compiles pages much faster than webpack; prod: precompiled, fastest navigation
    const nextArgs = prod ? ["next", "start"] : ["next", "dev", "--turbopack"];
    nextProc = spawn("npx", nextArgs, { stdio: "inherit", shell: true, detached: process.platform !== "win32" });
    nextProc.on("exit", (code) => stop(code ?? 0));
  }
} catch (e) {
  console.error("\n✖ " + (e instanceof Error ? e.message : String(e ?? "Eroare necunoscută")));
  if (!pgStarted && pgLog.length) {
    console.error("\n--- Mesajele PostgreSQL ---");
    console.error(pgLog.join("").trim().split(/\r?\n/).slice(-25).join("\n"));
    console.error("---------------------------");
  }
  await stop(1);
}
