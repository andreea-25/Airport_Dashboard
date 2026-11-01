# AeroShift - dashboard pentru personalul aeroportului

Proiect de hackathon (48h, 4 persoane). Planificarea turelor, zona angajatului, zona adminului,
**modul de simulare (sandbox)** și un **asistent AI** cu tool calling: în cloud cu **Gemini** (Google, cheie gratuită).

Stack: **Next.js 15 (App Router) + TypeScript + Prisma 7 + PostgreSQL + Tailwind + Recharts**.
Interfața este în română (texte în `src/lib/i18n/ro.ts`).

Link către dashboard: https://neighborhood-prairie-shirts-cast.trycloudflare.com/login

## Cerințe

| Ce | Versiune | Obligatoriu? | De unde |
|---|---|---|---|
| **Node.js** | 20 sau mai nou (recomandat 22 LTS) | Da | https://nodejs.org → „LTS” |
| **Git** | orice versiune recentă | Da | https://git-scm.com |
| Cheie Gemini | — | Nu (doar pentru AI în cloud) | https://aistudio.google.com/apikey |
| Ollama | ultima versiune | Nu (doar pentru AI local) | https://ollama.com |
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

Ai nevoie doar de **Node.js 20+** și **Git** (vezi [Cerințe](#cerințe)).

**1. Clonează proiectul** (GitHub Desktop → *File → Clone repository*, sau în terminal):

```bash
git clone https://github.com/<organizatie>/<repo>.git
cd <repo>
```

**2. Rulează instalarea — o singură comandă:**

```bash
npm run setup
```

Pe Windows poți face și **dublu-click pe `setup.cmd`** din folderul proiectului.

Instalarea face singură, pe rând:
1. verifică versiunea de Node.js;
2. creează `.env` din `.env.example`, cu un secret generat și un port liber pentru baza de date;
3. rulează `npm install` (câteva minute prima dată; descarcă și PostgreSQL încorporat);
4. creează baza de date locală (folderul `.pgdata`), aplică migrațiile și încarcă datele demo;
5. verifică Ollama și, dacă modelul AI lipsește, te întreabă dacă vrei să-l descarci (opțional).

**3. Pornește aplicația:**

```bash
npm run local:prod
```

sau **dublu-click pe `start.cmd`**. Prima pornire construiește aplicația (~1 minut). Când vezi `✓ Ready`,
deschide **http://localhost:3000** și intră cu `admin@aeroport.demo` / `Demo2026!` (vezi [Conturi demo](#conturi-demo)).
`Ctrl+C` sau închiderea ferestrei oprește aplicația și baza de date.

<details>
<summary>Instalare manuală (dacă vrei să faci pașii de mână)</summary>

```bash
copy .env.example .env       # macOS/Linux: cp .env.example .env
npm install
npm run local                # creează baza de date, aplică migrațiile, încarcă datele demo, pornește aplicația
```

</details>

## Pornire zilnică

```bash
git pull           # ia modificările colegilor (sau „Fetch / Pull” în GitHub Desktop)
npm install        # doar dacă s-a schimbat package.json
npm run local:prod # sau start.cmd
```

La fiecare pornire, `npm run local` / `local:prod` aplică automat migrațiile noi ale colegilor,
regenerează clientul Prisma dacă s-a schimbat `prisma/schema.prisma` și reconstruiește aplicația dacă s-a schimbat codul.

## Comenzi utile

| Comandă | Ce face |
|---|---|
| `npm run setup` | instalarea completă după clone (sau `setup.cmd`); se poate rula din nou fără riscuri |
| `npm run local` | pornește baza de date + aplicația în modul dezvoltare (un singur terminal) |
| `npm run local:prod` | la fel, dar în **modul optimizat** (pagini ~10× mai rapide); recomandat pentru testare și demo |
| `npm run local:db` | pornește doar baza de date (apoi `npm run dev` în alt terminal) |
| `npm run local:reset` | șterge baza locală (`.pgdata`) și o reface de la zero, cu datele demo |
| `npm run db:seed` | regenerează datele demo (cu baza pornită) |
| `npm run db:seed-extra` | adaugă datele demo noi (candidați din Craiova, proiecte, foști angajați) fără să șteargă nimic; `npm run local` îl rulează automat o dată |
| `npm run db:migrate` | creează o migrație nouă după ce ai modificat `prisma/schema.prisma` (cu baza pornită) |
| `npm run typecheck` | verifică tipurile TypeScript |
| `npm run build` | build de producție (verificare înainte de demo) |
| `npm run mock:ollama` | server AI simulat pe portul 11434, pentru test fără GPU |
| `npx tsx scripts/ai-ping.ts` | verifică viteza Gemini cu promptul și uneltele reale (listează și modelele disponibile pentru cheie) |
| `scripts\ai-ping.cmd` | același test, dar cu `curl` (fără Node), ca să vezi dacă problema e rețeaua sau modelul |
| `http://localhost:3000/api/health` | arată dacă baza de date și AI-ul (Ollama sau Gemini) răspund |

Datele demo sunt generate relativ la ziua în care rulezi seed-ul (2 săptămâni în urmă → 2 săptămâni înainte).
Rulează `npm run db:seed` sau `npm run local:reset` înainte de prezentare.

## Viteză: dezvoltare vs. optimizat

- **`npm run local`** (modul dezvoltare) compilează fiecare pagină la prima vizitare, așa că prima deschidere a unei pagini durează 1–5 secunde; după aceea merge mai repede. Modificările din cod apar imediat în browser. Folosește-l când scrii cod.
- **`npm run local:prod`** construiește întâi aplicația optimizată (aproximativ 1 minut, doar când s-a schimbat codul), apoi paginile se schimbă în ~0,1 secunde. Folosește-l când doar testezi aplicația sau la prezentare. Modificările din cod apar abia la următoarea pornire.
- Pe Windows, antivirusul (Microsoft Defender) poate încetini mult modul dezvoltare. Opțional: Setări Windows → Securitate Windows → Protecție împotriva virușilor → Excluderi → adaugă folderul proiectului.

## AI cu Gemini (Google, opțional)

Alternativă la Ollama, fără GPU, dar cu internet. Ia o cheie gratuită din https://aistudio.google.com/apikey și pune în `.env`:

```bash
AI_PROVIDER="gemini"
GEMINI_API_KEY="cheia-ta"
GEMINI_MODEL="gemini-flash-lite-latest"          # rapid (~1 s); 500 cereri/zi pe varianta gratuită
GEMINI_FALLBACK_MODELS="gemini-3.5-flash-lite"   # încercate pe rând dacă primul e supraîncărcat (503), fără cotă (429) sau nu răspunde
AI_FALLBACK="none"                               # "ollama" = dacă Gemini nu merge deloc, încearcă Ollama local (poate bloca un laptop slab)
```

Repornește aplicația. `http://localhost:3000/api/health` arată ce furnizor și ce model sunt folosite și dacă răspund.

De știut (verificat pe 01.11.2026, se poate schimba):
- Aplicația folosește API-ul nativ Gemini (`generateContent`), cu cheia în header-ul `x-goog-api-key`; merge și cu cheile noi din AI Studio, care încep cu `AQ.`.
- `gemini-flash-lite-latest` răspunde în ~1 s. Modelele Flash „mari” (`gemini-3.8-flash`, `gemini-flash-latest`) au fost foarte lente sau supraîncărcate pe varianta gratuită (30–150 s, 503) și au doar ~20 de cereri/zi.
- `gemini-2.5-flash` și `gemini-2.5-flash-lite` nu mai sunt disponibile pentru conturi noi.
- O întrebare în Simulare face 2–6 cereri (câte una pentru fiecare pas al agentului). Limita e pe cheie, nu pe utilizator: dacă toată echipa testează pe aceeași cheie, se termină repede. Fiecare coleg să-și facă propria cheie.
- O cerere așteaptă maximum 45 s (`GEMINI_TIMEOUT_MS`), apoi trece la modelul de rezervă.
- Pe varianta gratuită, Google poate folosi conversațiile pentru a-și îmbunătăți modelele. Nu pune cheia în Git (`.env` e ignorat).

## AI cu Ollama (opțional)

Pe calculatorul cu GPU (8 GB VRAM):

```bash
ollama pull qwen3:8b
```

În `.env` setează `OLLAMA_MODEL` (implicit `qwen3:8b`; alternative: `llama3.1:8b`, `qwen2.5:7b`, `gemma3:4b`) și repornește `npm run local`.
Dacă Ollama rulează pe alt calculator din rețea, pune adresa lui în `OLLAMA_BASE_URL`.

Ollama poate „bloca” un laptop dacă modelul nu încape în memoria plăcii video. Verifică cu `ollama ps` **în timp ce chatul răspunde**:
coloana PROCESSOR ar trebui să arate `100% GPU`; altfel folosește un model mai mic (ex. `qwen3:4b`). Ajută și variabilele Windows
`OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0` (jumătate din memoria contextului) și `OLLAMA_KEEP_ALIVE=30m`.

Ca să încapă în contextul mic al modelelor locale (`OLLAMA_NUM_CTX`, implicit 8192), agentul trimite din întrebările anterioare
doar întrebarea și răspunsul final (ultimele 4), nu și rezultatele uneltelor; dacă tot nu încape, scurtează rezultatele. Promptul de sistem
și întrebarea curentă nu se taie niciodată (`src/lib/ai/agent.ts`, `fitToBudget`).

Fără AI (niciun furnizor disponibil) aplicația funcționează normal: chatul angajatului spune că asistentul nu e disponibil,
iar chatul din Simulare salvează în locul răspunsului cele mai bune variante ale optimizatorului (în tab-ul Optimizator) și scrie motivul.

### Antrenarea și evaluarea AI-ului

Ghid complet, pas cu pas: **[docs/AI-TRAINING.md](docs/AI-TRAINING.md)**. Pe scurt (cu baza de date pornită):

```bash
npm run ai:generate   # date de antrenare + set de test, generate din baza de date (fără Ollama)
npm run ai:eval       # notează modelul din .env pe setul de test → raport în data/ai/reports/
```

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
| `Type error: ... 'settings' does not exist` (sau alt câmp nou) la build | clientul Prisma e vechi față de `schema.prisma` | rulează `npx prisma generate` (pornirea cu `npm run local` o face acum automat) |
| `prisma migrate dev` raportează „drift” | migrația inițială a fost scrisă manual | `npm run local:reset` (șterge doar datele demo) |
| `'node' is not recognized` | Node.js nu e instalat sau terminalul e deschis dinainte | instalează Node.js și redeschide terminalul |
| Paginile se încarcă greu | modul dezvoltare compilează fiecare pagină la prima accesare | folosește `npm run local:prod` (vezi „Viteză”) |
| `Foreign key constraint violated ... AiConversation_userId_fkey` | după `db:seed` / `local:reset` utilizatorii au ID-uri noi, iar cookie-ul de login e vechi | delogare + logare; versiunea actuală te trimite singură la login |
| `A tree hydrated but some attributes ... data-gr-ext-installed` | extensia Grammarly modifică pagina | nimic (avertismentul e ignorat acum în `layout.tsx`) |
| `Gemini nu răspunde ... aborted due to timeout` | modelul ales e supraîncărcat pe varianta gratuită | `GEMINI_MODEL="gemini-flash-lite-latest"`; verifică cu `npx tsx scripts/ai-ping.ts` |
| `This model ... is no longer available to new users` (404) | model retras pentru conturi noi | schimbă `GEMINI_MODEL` cu unul din lista afișată de `scripts/ai-ping.ts` |
| Laptopul / VS Code se blochează când întrebi AI-ul | se încarcă Ollama (direct sau ca rezervă) și umple memoria | `AI_FALLBACK="none"`, închide Ollama din bara de sistem sau folosește un model mai mic |

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
La ture: un singur lider desemnat pe tură (bifarea unui lider nou îl scoate pe cel vechi), iar calendarul săptămânii arată
★ numele liderului sau „Tura nu are lider desemnat”, plus „Niciun Senior în tură” când lipsește cineva de nivel Senior+.

**Simulare** (pagina unui scenariu are 6 tab-uri):
- *Panou*: indicatori față de programul real, **scorul scenariului (0–100)**, grafice, încălcări, modificări manuale (ore, schimb de echipe, mutare, promovare), skill gap, istoric + undo.
- *Calendar*: echipe × zile, cu **drag & drop**: muți oameni între ture, tragi din lista „Personal” ca să adaugi, × scoate, ★ face lider. Fiecare tură arată oameni/necesar și avertismente.
- *Optimizator*: **optimizatorul** (cod, fără AI) încearcă sute de mutări mici și arată cele mai bune 10 cu impactul calculat; „Optimizare automată” face 5 pași și salvează rezultatul ca sugestie. Dedesubt, **sugestiile salvate de optimizator** (Aplică / Ignoră / 🗑 Șterge).
- *Asistent AI*: **chat cu AI-ul** despre scenariu. Conversația se salvează în baza de date, câte una pentru fiecare admin și scenariu, și reapare când redeschizi scenariul (cu ora și uneltele folosite). „↺ Conversație nouă” o șterge definitiv (cu confirmare); sugestiile deja salvate rămân. Lângă chat, **sugestiile AI** (Aplică / Ignoră / 🗑 Șterge) și butonul **„Sugerează-mi un scenariu”**: pornește o conversație nouă în care AI-ul întreabă întâi ce departament, ce obiectiv, ce perioadă și pe cine să nu mute, apoi salvează sugestiile. Chatul rămâne deschis când schimbi tab-ul.
- *Ce-ar fi dacă*: concediu medical (N oameni într-o zi), creștere de trafic (+X% necesar într-un interval), expirarea unei certificări, **reguli configurabile** pe scenariu (repaus, maxim/normă săptămânală, nivel minim lider).
- *Echitate*: nopți, weekenduri și ore pe om și pe departament.
- **Aplică în programul real** (cu confirmare prin numele scenariului, notificări pentru angajații afectați și jurnal).

**Echipa** (`/admin/team`, doar admin): semafor pentru fiecare angajat pe 30/60/90 de zile — *verde* (fără impedimente),
*portocaliu* (concediu/curs în perioadă, certificare de reînnoit, plecare imediat după), *roșu* (pleacă în perioadă: demisie
sau final de contract, lipsește cel puțin jumătate din perioadă, certificare obligatorie expirată / expiră în 14 zile).
Adminul poate schimba manual culoarea, cu motiv obligatoriu. Fără date medicale și fără „ghicit” riscuri: doar ce introduce adminul
(indisponibilități în fișa angajatului, data de final de contract, cereri de concediu aprobate).
- Echilibrul pe departamente: oameni disponibili față de necesar (din profilul de acoperire), competențe critice, echipe fără șef de tură.
- **Propune soluții** pentru cine e pe roșu/portocaliu: mutare internă (și în lanț, cu înlocuitor pentru cel mutat), prelungire
  30 de zile + pregătirea unui coleg (cu calculul zilelor de pregătire), candidat extern; fiecare variantă poate fi
  **testată în simulare** (se creează un scenariu cu modificările).
- **Ce-ar fi dacă…**: simulezi o demisie / un concediu lung fără să salvezi nimic.
- **Candidați** (`/admin/candidates`), trei tab-uri:
  - *Candidați*: baza de talente (studenți și absolvenți din Craiova — Universitatea din Craiova, UMF, licee tehnologice — plus
    școli de aviație pentru ATC/meteo), cu acord GDPR, competențe, status (nou → contactat → interviu → ofertă), proiectul la care
    i-am cunoscut, „Unde s-ar potrivi” și **Angajează**.
  - *Foști angajați*: cei dezactivați (la dezactivare se cer ultima zi, motivul, „eligibil pentru reangajare” și o notă), cu filtre
    eligibil / neeligibil / departament. **Simulează reangajarea**: aplicația propune departamentul și echipa unde ar ajuta cel mai
    mult, arată reînnoirile necesare și efectul pe semafor (marja departamentului înainte → după), apoi creează un scenariu în Simulare.
  - *Proiecte propuse*: cursuri, prezentări, competiții, hackathoane, stagii, zile porți deschise, webinare cu facultățile, cu
    statistici (candidați, în discuții, angajați, rată de conversie) și **sugestii automate** pentru departamentele cu lipsă de
    oameni sau competențe critice care nu au deja un proiect în curs.
- Cod: `src/lib/team/readiness.ts` (semafor + echilibru), `src/lib/team/replacement.ts` (propuneri), `src/app/actions/team.ts`.
- AI (în chatul din simulare): `get_team_readiness`, `propose_replacements` (acceptă și ipoteze: `what_if: "demisie"`).

Scorul: acoperire 45% + încălcări 25% + ore suplimentare 15% + certificări 15% (`src/lib/sim/evaluate.ts`, `computeScore`).

**AI:** un serviciu, două moduri (`src/lib/ai`). Angajat: `get_my_shifts`, `get_shift_colleagues`, `get_my_profile`,
`get_my_career_gap`, `get_my_requests`, `create_request`. Admin: `find_improvements` (rulează optimizatorul și dă variantele C1, C2…), `get_scenario_summary`, `evaluate_scenario`,
`list_shifts`, `list_employees`, `get_employee_skill_gap`, `preview_change`, `propose_changes` (acceptă `candidate_ids`),
`get_team_readiness` (semaforul și echilibrul pe departamente), `propose_replacements` (soluții când pleacă / lipsește cineva; acceptă ipoteze cu `what_if`).
AI-ul e „analistul”: alege și combină variantele optimizatorului și explică în română; poate exclude oameni la cerere („nu-l muta pe X”).
Furnizorul se alege din `.env` (`AI_PROVIDER`): `src/lib/ai/llm.ts` trimite cererea la `gemini.ts` sau `ollama.ts`; restul (agent, unelte, istoric) e comun.

## Reguli de siguranță (unde sunt aplicate)

- Permisiuni verificate **pe server** la fiecare pagină, server action și rută API (`src/lib/auth.ts`: `requireAdminPage`, `assertAdmin`, `assertSession`); `middleware.ts` e doar prima barieră.
- Sesiunea din cookie e verificată în baza de date la fiecare cerere (`getSession`): dacă utilizatorul nu mai există (ex. după seed), ești delogat; rolul se citește din bază, nu din cookie.
- Cheia Gemini stă doar pe server (`.env`); apelurile către Google pleacă din rutele API, nu din browser.
- Angajatul vede doar turele lui și ale echipei (`src/lib/services/employee.ts` → `canViewShift`); colegii apar doar cu nume, nivel, post.
- Uneltele AI primesc identitatea din sesiune (`ToolContext`), nu din chat. Scenariul pentru admin e fixat de server.
- AI-ul nu scrie în tabelele reale: `create_request` doar pregătește o ciornă; cererea se creează **numai** când angajatul apasă „Confirmă” (`/api/ai/confirm`). `propose_changes` salvează un `ScenarioSuggestion`; aplicarea trece prin motorul de simulare.
- Cifrele sunt calculate de motorul determinist (`src/lib/sim/evaluate.ts`), nu de model.
- Toate mesajele și apelurile de unelte sunt salvate în `AiMessage`; acțiunile de modificare scriu în `AuditLog` (inclusiv ștergerea unei conversații sau a unei sugestii).
- Mesajele de sistem din chat (ex. „AI-ul nu e disponibil…”) sunt salvate cu rolul `notice` și nu sunt trimise modelului.
- Semaforul (pagina Echipa), indisponibilitățile și candidații sunt vizibile **doar adminului**. Semaforul folosește numai date introduse de admin
  (tipul absenței, fără diagnostic/date medicale); schimbarea manuală a culorii cere un motiv și rămâne în istoric.
- Candidații se salvează doar cu acordul lor (GDPR, `consentAt`); pot fi șterși oricând din baza de talente.
- „Testează în simulare” și „Ce-ar fi dacă…” nu modifică programul real; propunerile se recalculează pe server, nu se iau din browser.

## Structura

```
prisma/schema.prisma, migrations/, seed.ts, seed-team.ts (indisponibilități, contracte, candidați, proiecte, foști angajați demo)
src/lib/sim/        motorul de simulare: evaluate.ts (indicatori + scor), changes.ts, scenario.ts (create/apply/undo/preview/compare/skillGap),
                    optimize.ts (optimizatorul), calendar.ts, suggestions.ts
src/lib/ai/         llm.ts (alege furnizorul), gemini.ts, ollama.ts, tools.ts, agent.ts (agent + istoric/context)
src/lib/team/       readiness.ts (semafor + echilibru pe departamente), replacement.ts (propuneri de soluții, potrivire candidați),
                    rehire.ts (foști angajați, analiza reangajării), projects.ts (proiecte de recrutare, statistici, sugestii)
src/components/sim/ SimWorkspace (tab-urile), SimChat (chatul AI salvat), OptimizerPanel, ScenarioCalendar, WhatIfPanel, FairnessPanel
src/components/team/ ReadinessPanel, WhatIfForm, ApplySolutionButton, CandidateForm/Skills/Status, HireForm,
                    ProjectForm, SuggestProjectButton, RehireForm
src/lib/services/   acces la date filtrat pe sesiune (angajat)
src/app/actions/    server actions (auth, admin, comments, requests, simulation, team)
src/app/api/        ai/chat, ai/confirm, admin/sim/suggest, health
src/app/(app)/      paginile (angajat + admin)
scripts/mock-ollama.mjs, scripts/ai-ping.ts + ai-ping.cmd (diagnostic Gemini)
```


## Note tehnice

- Prisma 7 folosește clientul fără Rust (`@prisma/adapter-pg`), generat în `src/generated/prisma` la `npm install` (nu se comite).
- Baza încorporată se creează cu `--encoding=UTF8 --locale=C` (`scripts/local.mjs`), ca diacriticele să funcționeze pe Windows.
- Datele sunt stocate în UTC și afișate în `Europe/Bucharest` (`src/lib/time.ts`).
- Gemini: mesajele interne (format Ollama) sunt convertite în `contents`/`functionCall`/`functionResponse`; semnăturile de gândire (`thoughtSignature`) sunt păstrate și trimise înapoi la apelurile de unelte. Uneltele sunt trimise ca `parametersJsonSchema`.
