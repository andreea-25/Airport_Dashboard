// Run the app without Docker: starts an embedded PostgreSQL (binaries come from npm),
// applies migrations, seeds on first run, then starts Next.js.
//   npm run local          -> database + app (Ctrl+C stops both)
//   npm run local:db       -> only the database (keep it open, run `npm run dev` elsewhere)
//   npm run local:reset    -> delete the local database folder and start fresh
import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
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

const initialised = existsSync(path.join(dataDir, "PG_VERSION"));
const seededMarker = path.join(dataDir, ".seeded");
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
  console.log(`PostgreSQL running on localhost:${port} (user ${user}, database ${database})`);
  try {
    await pg.createDatabase(database);
  } catch {
    /* already exists */
  }

  await run("npx", ["prisma", "migrate", "deploy"]);
  if (!existsSync(seededMarker) || args.has("--seed")) {
    await run("npx", ["tsx", "prisma/seed.ts"]);
    writeFileSync(seededMarker, new Date().toISOString());
  }

  if (args.has("--db-only")) {
    console.log("Database is ready. Press Ctrl+C to stop it.");
    await new Promise(() => {});
  } else {
    nextProc = spawn("npx", ["next", "dev"], { stdio: "inherit", shell: true, detached: process.platform !== "win32" });
    nextProc.on("exit", (code) => stop(code ?? 0));
  }
} catch (e) {
  console.error("\n✖ " + (e instanceof Error ? e.message : String(e ?? "Eroare necunoscută")));
  if (pgLog.length) {
    console.error("\n--- Mesajele PostgreSQL ---");
    console.error(pgLog.join("").trim().split(/\r?\n/).slice(-25).join("\n"));
    console.error("---------------------------");
  }
  await stop(1);
}
