# Aeroport · Personal - dashboard pentru personalul aeroportului

Proiect de hackathon (48h, 4 persoane). Planificarea turelor, zona angajatului, zona adminului,
**modul de simulare (sandbox)** și un **asistent AI local (Ollama)** cu tool calling.

Stack: **Next.js 15 (App Router) + TypeScript + Prisma 7 + PostgreSQL + Tailwind + Recharts**.
Interfața este în română (texte în `src/lib/i18n/ro.ts`).

## Cerințe

| Ce | Versiune | Obligatoriu? | De unde |
|---|---|---|---|
| **Node.js** | 20 sau mai nou (recomandat 22 LTS) | Da | https://nodejs.org → „LTS” |
| **Git** | orice versiune recentă | Da | https://git-scm.com |
| Ollama | ultima versiune | Nu (doar pentru AI) | https://ollama.com |
| Docker Desktop | — | Nu (doar pentru varianta B) | https://www.docker.com |

Nu trebuie instalat PostgreSQL: vine ca pachet npm (`embedded-postgres`) la `npm install`.
Toate dependențele proiectului (echivalentul unui `requirements.txt`) sunt în **`package.json`**, cu versiuni exacte în `package-lock.json`; `npm install` le instalează pe toate.

Verifică în terminal:

```bash
node -v      # trebuie să afișeze v20.x sau mai mare
npm -v
git --version
```

## Instalare (prima dată)

Pașii sunt pentru Windows (PowerShell). Pe macOS/Linux folosește `cp` în loc de `copy`.

**1. Clonează proiectul** (adresa o iei de pe GitHub, butonul verde „Code”):

```bash
git clone https://github.com/<organizatie>/<repo>.git
cd <repo>
```

**2. Creează fișierul de configurare `.env`:**

```bash
copy .env.example .env
```

`.env` nu se urcă pe GitHub (e în `.gitignore`); fiecare își face copia lui.

**3. (De obicei nu e nevoie) Portul bazei de date.** Implicit, baza de date folosește portul **5433**
(`DATABASE_URL` din `.env`), ca să nu se lovească de un PostgreSQL deja instalat pe 5432.
Schimbă-l doar dacă primești mesajul că portul 5433 e ocupat (de ex. în `localhost:5434`).

**4. Instalează dependențele** (durează câteva minute prima dată; descarcă și PostgreSQL):

```bash
npm install
```

**5. Pornește tot:**

```bash
npm run local
```

Prima pornire creează baza de date în folderul `.pgdata`, aplică migrațiile și încarcă datele demo.
Este gata când vezi `Seed complete.` și apoi `✓ Ready`. Deschide **http://localhost:3000**
și intră cu `admin@aeroport.demo` / `Demo2026!` (vezi [Conturi demo](#conturi-demo)).

Lasă terminalul deschis cât lucrezi. `Ctrl+C` oprește aplicația și baza de date.

## Pornire zilnică

```bash
git pull           # ia modificările colegilor
npm install        # doar dacă s-a schimbat package.json
npm run local
```

Dacă un coleg a adăugat o migrație nouă, `npm run local` o aplică automat la pornire.

## Comenzi utile

| Comandă | Ce face |
|---|---|
| `npm run local` | pornește baza de date + aplicația (un singur terminal) |
| `npm run local:db` | pornește doar baza de date (apoi `npm run dev` în alt terminal) |
| `npm run local:reset` | șterge baza locală (`.pgdata`) și o reface de la zero, cu datele demo |
| `npm run db:seed` | regenerează datele demo (cu baza pornită) |
| `npm run db:migrate` | creează o migrație nouă după ce ai modificat `prisma/schema.prisma` (cu baza pornită) |
| `npm run typecheck` | verifică tipurile TypeScript |
| `npm run build` | build de producție (verificare înainte de demo) |
| `npm run mock:ollama` | server AI simulat pe portul 11434, pentru test fără GPU |
| `http://localhost:3000/api/health` | arată dacă baza de date și Ollama răspund |

Datele demo sunt generate relativ la ziua în care rulezi seed-ul (2 săptămâni în urmă → 2 săptămâni înainte).
Rulează `npm run db:seed` sau `npm run local:reset` înainte de prezentare.

## AI cu Ollama (opțional)

Pe calculatorul cu GPU (8 GB VRAM):

```bash
ollama pull qwen3:8b
```

În `.env` setează `OLLAMA_MODEL` (implicit `qwen3:8b`; alternative: `llama3.1:8b`, `qwen2.5:7b`, `gemma3:4b`) și repornește `npm run local`.
Dacă Ollama rulează pe alt calculator din rețea, pune adresa lui în `OLLAMA_BASE_URL`.

Fără Ollama aplicația funcționează normal: chatul angajatului spune că asistentul nu e disponibil,
iar „Cere sugestii AI” din simulare folosește sugestii generate prin reguli (marcate „Reguli”).

## Varianta B: cu Docker în loc de PostgreSQL încorporat

```bash
copy .env.example .env
docker compose up -d            # PostgreSQL pe portul 5433, la fel ca varianta A
npm install
npm run db:deploy
npm run db:seed
npm run dev
```

Nu rula `npm run local` și Docker în același timp pe același port.

## Probleme frecvente

| Mesaj | Cauză | Soluție |
|---|---|---|
| `Portul 5433 este deja folosit` | rulează deja `npm run local` în alt terminal, Docker sau alt program pe acel port | închide celălalt terminal / `docker compose down`, sau schimbă portul în `.env` (ex. `5434`) |
| `... in encoding "UTF8" has no equivalent in encoding "WIN1252"` | baza a fost creată cu o versiune veche a scriptului | `npm run local:reset` |
| `database system was not properly shut down` | baza nu a fost oprită curat data trecută | nimic, se repară singură |
| `DeprecationWarning: Passing args to a child process...` | avertisment Node | poate fi ignorat |
| `prisma migrate dev` raportează „drift” | migrația inițială a fost scrisă manual | `npm run local:reset` (șterge doar datele demo) |
| `'node' is not recognized` | Node.js nu e instalat sau terminalul e deschis dinainte | instalează Node.js și redeschide terminalul |
| Pagina se încarcă greu prima dată | Next.js compilează pagina la prima accesare | normal în modul dev |

## Lucrul în echipă pe GitHub

- Nu urcați `.env`, `.pgdata`, `node_modules`, `.next` (sunt deja în `.gitignore`).
- Fiecare lucrează pe un branch: `git checkout -b nume/funcționalitate`, apoi Pull Request către `main`.
- Modificări de schemă (`prisma/schema.prisma`): rulați `npm run db:migrate -- --name descriere` și urcați și folderul nou din `prisma/migrations/`.
- Texte noi în interfață: adăugați-le în `src/lib/i18n/ro.ts`, nu direct în componente.
- Înainte de push: `npm run typecheck`.

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

- Prisma 7 folosește clientul fără Rust (`@prisma/adapter-pg`), generat în `src/generated/prisma` la `npm install` (nu se comite).
- Baza încorporată se creează cu `--encoding=UTF8 --locale=C` (`scripts/local.mjs`), ca diacriticele să funcționeze pe Windows.
- Datele sunt stocate în UTC și afișate în `Europe/Bucharest` (`src/lib/time.ts`).
