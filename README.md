# Aeroport · Personal — dashboard pentru personalul aeroportului

Proiect de hackathon (48h, 4 persoane). Planificarea turelor, zona angajatului, zona adminului,
**modul de simulare (sandbox)** și un **asistent AI local (Ollama)** cu tool calling.

Stack: **Next.js 15 (App Router) + TypeScript + Prisma 7 + PostgreSQL + Tailwind + Recharts**.
Interfața este în română (texte în `src/lib/i18n/ro.ts`), codul în engleză.

## Pornire rapidă

Cerințe: Node.js 20+ (recomandat 22). Docker **nu** e necesar. Ollama e opțional.

### Varianta A — fără Docker (recomandat pentru laptopurile echipei)

PostgreSQL rulează „încorporat”, din pachetul npm `embedded-postgres` (binarele se descarcă la `npm install`,
datele stau în folderul `.pgdata` din proiect).

```bash
cp .env.example .env            # pe Windows: copy .env.example .env
npm install
npm run local                   # pornește PostgreSQL + aplică migrațiile + (prima dată) seed + Next.js
```

Deschide http://localhost:3000. `Ctrl+C` oprește și aplicația, și baza de date.

| Comandă | Ce face |
|---|---|
| `npm run local` | baza de date + aplicația, într-un singur terminal |
| `npm run local:db` | doar baza de date (apoi `npm run dev` în alt terminal) |
| `npm run local:reset` | șterge `.pgdata` și o ia de la zero (migrații + seed) |
| `npm run db:seed` | regenerează datele demo (cu baza pornită) |

Dacă portul 5432 e ocupat (ai deja un PostgreSQL instalat), schimbă portul în `DATABASE_URL` din `.env`, de ex. `localhost:5433`.

### Varianta B — cu Docker

```bash
cp .env.example .env
docker compose up -d            # PostgreSQL 16 pe portul 5432
npm install
npm run db:deploy               # aplică migrațiile
npm run db:seed
npm run dev
```

Nu rula ambele variante în același timp (folosesc același port).

AI (pe mașina cu GPU de 8 GB):

```bash
ollama pull qwen3:8b            # sau llama3.1:8b / qwen2.5:7b / gemma3:4b
# setează OLLAMA_MODEL în .env, apoi repornește `npm run dev`
```

Fără Ollama, aplicația merge normal: chatul angajatului afișează „asistentul nu e disponibil”,
iar „Cere sugestii AI” din simulare cade pe **sugestii prin reguli deterministe** (sursa „Reguli”).
Pentru a testa fluxul complet de tool calling fără GPU: `npm run mock:ollama` (un server scriptat pe :11434, nu un model real).

Verificare: `http://localhost:3000/api/health` arată dacă baza de date și Ollama răspund și ce modele sunt instalate.

## Conturi demo

Parola tuturor conturilor este valoarea `SEED_DEMO_PASSWORD` din `.env` (implicit în `.env.example`: `Demo2026!`).

| Cont | Rol |
|---|---|
| `admin@aeroport.demo` | Administrator |
| `angajat.securitate@aeroport.demo` | Agent II, Securitate (povestea „Ce îmi lipsește ca să ajung Senior?”) |
| `angajat.handling@aeroport.demo` | Agent II, Handling rampă |
| `angajat.checkin@aeroport.demo` | Agent I, Check-in |
| `angajat.prm@aeroport.demo` | Senior, Asistență PRM |

Toți ceilalți angajați au cont cu emailul `prenume.nume@aeroport.demo` și aceeași parolă.
Seed-ul generează turele relativ la data rulării (2 săptămâni în urmă → 2 săptămâni înainte), deci rulează-l din nou înainte de demo.

## Ce e implementat

**Angajat:** calendar săptămână/lună (turele mele / ale echipei), detaliu tură cu colegii și liderul,
comentarii (ștergere doar în primele 10 minute, nu modifică tura), profil cu skill-uri și expirări,
parcursul către nivelul următor, cereri cu status și răspuns, asistent AI, notificări.

**Admin:** „Azi în aeroport” (ture pe departamente, oameni vs. necesar, harta pe ore, certificări care expiră),
CRUD angajați (dezactivare, fără ștergere fizică) + skill-uri, echipe și departamente, ture (creare, editare ore,
asignare/scoatere, post, lider, copiere săptămână), inbox cereri cu filtre, comentarii, jurnal de modificări.

**Simulare:** scenariu creat din programul real al unei perioade (copie în tabelele `Scenario*`), modificări:
schimbare ore (inclusiv ture de 12h / tură decalată 05:00), schimbarea echipelor între ele, mutare angajat în altă
echipă/departament, promovare simulată; previzualizare impact, istoric + undo, duplicare, comparare A vs B sau vs real,
analiză skill gap. Indicatori: acoperire pe departament și oră, ore și ore suplimentare, încălcări (repaus 12h,
48h/săptămână, certificare lipsă/expirată pe post, tură fără lider ≥ Senior, suprapuneri), posturi fără skill, certificări care expiră.

**AI:** un serviciu, două moduri (`src/lib/ai`). Angajat: `get_my_shifts`, `get_shift_colleagues`, `get_my_profile`,
`get_my_career_gap`, `get_my_requests`, `create_request`. Admin: `get_scenario_summary`, `evaluate_scenario`,
`list_shifts`, `list_employees`, `get_employee_skill_gap`, `preview_change`, `propose_changes`.

## Reguli de siguranță (unde sunt aplicate)

- Permisiuni verificate **pe server** la fiecare pagină, server action și rută API (`src/lib/auth.ts`: `requireAdminPage`, `assertAdmin`, `assertSession`); `middleware.ts` e doar prima barieră.
- Angajatul vede doar turele lui și ale echipei (`src/lib/services/employee.ts` → `canViewShift`); colegii apar doar cu nume, nivel, post.
- Uneltele AI primesc identitatea din sesiune (`ToolContext`), nu din chat. Scenariul pentru admin e fixat de server.
- AI-ul nu scrie în tabelele reale: `create_request` doar pregătește o ciornă; cererea se creează **numai** când angajatul apasă „Confirmă” (`/api/ai/confirm`). `propose_changes` salvează un `ScenarioSuggestion`; aplicarea trece prin motorul de simulare.
- Cifrele sunt calculate de motorul determinist (`src/lib/sim/evaluate.ts`), nu de model.
- Toate mesajele și apelurile de unelte sunt salvate în `AiMessage`; acțiunile de modificare scriu în `AuditLog`.

## Structura

```
prisma/schema.prisma, migrations/, seed.ts
src/lib/sim/        motorul de simulare: evaluate.ts, changes.ts, scenario.ts (create/apply/undo/preview/compare/skillGap)
src/lib/ai/         ollama.ts, tools.ts, agent.ts, rules.ts (fallback fără AI)
src/lib/services/   acces la date filtrat pe sesiune (angajat)
src/app/actions/    server actions (auth, admin, comments, requests, simulation)
src/app/api/        ai/chat, ai/confirm, admin/sim/suggest, health
src/app/(app)/      paginile (angajat + admin)
scripts/mock-ollama.mjs
```

## Decizii luate (de revizuit cu echipa)

- Angajații văd doar turele echipei lor. Schimburile de tură le aprobă doar adminul.
- Scenariile sunt doar pentru vizualizare (aplicarea peste programul real = stretch goal).
- Comentariile pot fi șterse de autor în primele 10 minute. Adminul răspunde pe fir.
- Necesarul de personal are granularitate de 1h (`StaffingRequirement.startHour/endHour`).
- Notificări doar în aplicație (fără email).
- Limba engleză e un skill cu nivel 1 = A2, 2 = B1, 3 = B2/C1.
- „Tură fără lider” = nicio persoană de nivel ≥ Senior în tură.

## Note tehnice

- Prisma 7 folosește clientul fără Rust (`@prisma/adapter-pg`), generat în `src/generated/prisma` (nu se comite).
- Migrația inițială a fost scrisă manual (SQL) pentru că mediul de dezvoltare nu putea descărca engine-ul Prisma.
  Dacă `npx prisma migrate dev` raportează „drift” la prima rulare, rulează `npm run db:reset` (șterge datele de dev și refă seed-ul).
- Datele sunt stocate în UTC și afișate în `Europe/Bucharest` (`src/lib/time.ts`).
