// One-time setup after `git clone`:  npm run setup   (or double-click setup.cmd on Windows)
// 1. checks Node.js   2. creates .env (random secret, free port)   3. npm install
// 4. creates the local database, applies migrations, loads demo data   5. checks Ollama (optional)
// Uses only Node built-ins: it runs before the project's dependencies are installed.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import readline from "node:readline/promises";

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => console.log(`\x1b[33m!\x1b[0m ${m}`);
const step = (n, m) => console.log(`\n\x1b[1m[${n}/5] ${m}\x1b[0m`);
const fail = (m) => {
  console.error(`\n\x1b[31m✖ ${m}\x1b[0m`);
  process.exit(1);
};

function run(line) {
  return new Promise((resolve, reject) => {
    const p = spawn(line, { stdio: "inherit", shell: true });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`„${line}” s-a oprit cu codul ${code}`))));
  });
}

function portIsFree(p) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(p, "127.0.0.1");
  });
}

function readEnv() {
  const env = {};
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

console.log("\x1b[1mAeroport · Personal — instalare\x1b[0m");

// ---------------------------------------------------------------- 1. Node.js
step(1, "Verific Node.js");
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) fail(`Ai Node.js ${process.versions.node}. Este nevoie de versiunea 20 sau mai nouă: https://nodejs.org (varianta LTS).`);
ok(`Node.js ${process.versions.node}`);

// ---------------------------------------------------------------- 2. .env
step(2, "Fișierul de configurare .env");
if (existsSync(".env")) {
  ok(".env există deja (nu îl modific)");
} else {
  copyFileSync(".env.example", ".env");
  let text = readFileSync(".env", "utf8");
  text = text.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET="${randomBytes(32).toString("hex")}"`);
  // pick a free port for the local database
  const m = text.match(/localhost:(\d+)\//);
  let port = m ? Number(m[1]) : 5433;
  if (!(await portIsFree(port))) {
    const original = port;
    for (let p = port + 1; p < port + 20; p++) {
      if (await portIsFree(p)) {
        port = p;
        break;
      }
    }
    text = text.replace(`localhost:${original}/`, `localhost:${port}/`);
    warn(`Portul ${original} era ocupat; baza de date va folosi portul ${port}.`);
  }
  writeFileSync(".env", text);
  ok(`.env creat (secret generat, baza de date pe portul ${port})`);
}

// ---------------------------------------------------------------- 3. npm install
step(3, "Instalez dependențele (npm install) — câteva minute prima dată");
try {
  await run("npm install");
} catch (e) {
  fail(`${e.message}\nVerifică conexiunea la internet și rulează din nou: npm run setup`);
}
ok("Dependențe instalate");

// ---------------------------------------------------------------- 4. database
step(4, "Pregătesc baza de date locală (PostgreSQL încorporat, migrații, date demo)");
try {
  await run("node scripts/local.mjs --setup");
} catch (e) {
  fail(`${e.message}\nVezi mesajele de mai sus. Problemele frecvente sunt descrise în README, secțiunea „Probleme frecvente”.`);
}

// ---------------------------------------------------------------- 5. Ollama (optional)
step(5, "Verific Ollama (opțional, doar pentru asistentul AI)");
const env = readEnv();
const base = (env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");
const model = env.OLLAMA_MODEL || "qwen3:8b";
let models = null;
try {
  const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
  models = ((await r.json()).models ?? []).map((m) => m.name);
} catch {
  models = null;
}
if (models === null) {
  warn(`Ollama nu răspunde la ${base}. Aplicația merge și fără el (simularea folosește optimizatorul).`);
  console.log("  Pentru AI: instalează Ollama de pe https://ollama.com, apoi rulează din nou npm run setup.");
} else if (models.includes(model) || models.includes(`${model}:latest`)) {
  ok(`Ollama rulează și modelul ${model} este instalat`);
} else {
  warn(`Ollama rulează, dar modelul ${model} nu este descărcat (modele găsite: ${models.join(", ") || "niciunul"}).`);
  const hasCli = spawnSync("ollama", ["--version"], { shell: true, stdio: "ignore" }).status === 0;
  if (hasCli && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`  Îl descarc acum? (~5 GB) [d/N] `)).trim().toLowerCase();
    rl.close();
    if (answer === "d" || answer === "da" || answer === "y") {
      try {
        await run(`ollama pull ${model}`);
        ok(`Model ${model} descărcat`);
      } catch {
        warn(`Descărcarea a eșuat. O poți relua oricând cu: ollama pull ${model}`);
      }
    } else {
      console.log(`  Îl poți descărca oricând cu: ollama pull ${model}`);
    }
  } else {
    console.log(`  Descarcă-l cu: ollama pull ${model}`);
  }
}

console.log(`
\x1b[32m\x1b[1mGata!\x1b[0m Pornește aplicația cu:

  npm run local:prod     (rapid, recomandat pentru testare și demo — pe Windows: dublu-click pe start.cmd)
  npm run local          (pentru dezvoltare: modificările din cod apar imediat)

Apoi deschide http://localhost:3000 și intră cu admin@aeroport.demo / parola din SEED_DEMO_PASSWORD din .env (implicit Demo2026!).
`);
