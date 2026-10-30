// Run the app without Docker: starts an embedded PostgreSQL (binaries come from npm),
// applies migrations, seeds on first run, then starts Next.js.
//   npm run local          -> database + app (Ctrl+C stops both)
//   npm run local:db       -> only the database (keep it open, run `npm run dev` elsewhere)
//   npm run local:reset    -> delete the local database folder and start fresh
import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
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

const pg = new EmbeddedPostgres({ databaseDir: dataDir, user, password, port, persistent: true, onLog: () => {} });

function run(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, { stdio: "inherit", shell: true });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${cmdArgs.join(" ")} exited with ${code}`))));
  });
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

const firstRun = !existsSync(path.join(dataDir, "PG_VERSION"));
try {
  if (firstRun) {
    console.log("First run: initialising local PostgreSQL in .pgdata …");
    await pg.initialise();
  }
  await pg.start();
  console.log(`PostgreSQL running on localhost:${port} (user ${user}, database ${database})`);
  if (firstRun) await pg.createDatabase(database);

  await run("npx", ["prisma", "migrate", "deploy"]);
  if (firstRun || args.has("--seed")) await run("npx", ["tsx", "prisma/seed.ts"]);

  if (args.has("--db-only")) {
    console.log("Database is ready. Press Ctrl+C to stop it.");
    await new Promise(() => {});
  } else {
    nextProc = spawn("npx", ["next", "dev"], { stdio: "inherit", shell: true, detached: process.platform !== "win32" });
    nextProc.on("exit", (code) => stop(code ?? 0));
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  if (String(e).includes("EADDRINUSE") || String(e).includes("port")) {
    console.error(`Port ${port} may be in use (another PostgreSQL or Docker?). Change the port in DATABASE_URL in .env.`);
  }
  await stop(1);
}
