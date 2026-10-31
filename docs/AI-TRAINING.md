# Ghid: cum antrenăm și măsurăm asistentul AI

Ghidul e scris ca să înveți pe parcurs. Fiecare pas spune **ce face**, **de ce** și **cum îți dai seama dacă a ajutat**.
Pașii 1–3 merg pe calculatorul tău, cu Ollama. Pasul 4 (antrenarea propriu-zisă) se face pe Google Colab, cu GPU gratuit.

---

## 0. Concepte (5 minute de citit)

**Modelul** (ex. `qwen3:8b`) e o rețea neuronală deja antrenată de alții pe foarte mult text. Știe română, știe să raționeze și să apeleze unelte, dar **nu știe nimic despre aplicația noastră**.

**Promptul de sistem** (`src/lib/ai/agent.ts`, funcția `systemPrompt`) e textul pe care îl primește modelul înainte de fiecare conversație: cine e utilizatorul, ce reguli are, ce unelte să folosească. Schimbarea lui nu „antrenează” modelul; doar îi dă instrucțiuni mai bune. E ieftină și se vede imediat.

**Uneltele** (`src/lib/ai/tools.ts`) sunt funcțiile pe care modelul le poate apela: `get_my_shifts`, `find_improvements` etc. Modelul alege unealta și argumentele; **codul** execută și întoarce date reale. Așa modelul nu inventează date.

**Fine-tuning (antrenare)** = continui antrenarea modelului pe exemple ale noastre, ca să învețe *comportamentul* dorit: ce unealtă alege la ce întrebare, ce argumente dă, cum formulează răspunsul. Nu îl învață datele (turele se schimbă zilnic; pe acelea le ia din unelte).

**LoRA** = în loc să modificăm toți cei ~8 miliarde de parametri, antrenăm câteva milioane de parametri „adăugați” peste model. E de sute de ori mai ieftin și încape pe un GPU gratuit.

**Set de antrenare / set de test.** Antrenăm pe un set și măsurăm pe **altul**, cu oameni și formulări pe care modelul nu le-a văzut. Altfel modelul poate doar să memoreze și pare mai bun decât e (*overfitting*).

**Evaluare** = un script care pune aceleași întrebări de test modelului și verifică automat răspunsurile. E „cântarul”: fără el nu știi dacă o schimbare a ajutat sau a stricat ceva.

---

## Ce avem în proiect

| Fișier | Ce e |
|---|---|
| `scripts/ai-data/intents.ts` | **Catalogul de intenții**: tipurile de întrebări (ture, avansare, cereri, sugestii de simulare…), cu formulările lor și răspunsul corect |
| `scripts/ai-data/generate.ts` | Generatorul: produce exemple din baza de date reală (comanda `npm run ai:generate`) |
| `scripts/ai-data/eval.ts` | Evaluarea: întreabă modelul și dă note (comanda `npm run ai:eval`) |
| `data/ai/train.jsonl` | Setul de **antrenare** (generat) |
| `data/ai/eval.jsonl` | Setul de **test** generat (alți oameni, alt scenariu decât la antrenare) |
| `data/ai/eval-manual.jsonl` | Cazuri de test **scrise de mână**, cu formulări diferite: verifică dacă modelul generalizează |
| `data/ai/tools.json` | Definițiile uneltelor (trebuie la antrenare) |
| `data/ai/reports/` | Rapoartele de evaluare (`.md` de citit, `.json` cu detalii) |

Toate comenzile se rulează din folderul proiectului, **cu baza de date pornită**: ține deschis `npm run local` (sau `npm run local:db`) într-un terminal și rulează comenzile în altul.

---

## Pasul 1 — Măsoară cum merge acum (punctul de plecare)

```bash
npm run ai:generate     # creează setul de test (și pe cel de antrenare), ~2 minute, nu are nevoie de Ollama
npm run ai:eval         # întreabă modelul din .env pe toate cazurile de test
```

`ai:eval` durează câteva minute (depinde de GPU). La final vezi:

```
## Rezultat: 41/85 cazuri trecute (48%)
| Categorie   | Trecute |      ← unde e bun și unde e slab (ture, avansare, cereri, siguranță, sugestii…)
| Verificare  | Reușită |      ← ce greșește concret (unealta greșită, interval de date greșit, răspuns fără datele cheie…)
```

Raportul complet e în `data/ai/reports/<data>-<model>.md`. La final are lista **cazurilor picate**, cu ce unealtă a apelat modelul și ce a răspuns.

**Merită?** Da, întotdeauna. Durează puțin și îți dă cifra cu care compari tot ce urmează. Notează-ți procentul.

Opțiuni utile:

```bash
npm run ai:eval -- --limit 10              # test rapid pe 10 cazuri
npm run ai:eval -- --only manual           # doar cazurile scrise de mână
npm run ai:eval -- --mode EMPLOYEE         # doar asistentul angajatului (sau ADMIN_SIM)
npm run ai:eval -- --model qwen2.5:7b      # alt model (trebuie descărcat: ollama pull qwen2.5:7b)
```

### Ce verifică fiecare caz

- a apelat **unealta corectă** (ex. pentru „lucrez mâine?” → `get_my_shifts`) și nu una interzisă (ex. să nu creeze o cerere când doar întrebi);
- **argumentele** sunt corecte (intervalul de date acoperă „weekendul ăsta”, departamentul e `SEC` etc.);
- uneltele au mers **fără erori**;
- răspunsul e **în română** și conține **datele cheie** (ora turei, skill-ul care lipsește, butonul „Confirmă”…);
- la siguranță: **refuză** să dea datele altor angajați;
- la simulare: sugestia salvată **crește scorul** și nu mută persoana pe care adminul a exclus-o.

---

## Pasul 2 — Îmbunătățiri ieftine (fără antrenare)

Întâi încearcă aceste trei lucruri. Sunt rapide, iar câștigul e adesea mare.

1. **Compară modelele.** Rulează `ai:eval` cu 2–3 modele și păstrează-l pe cel mai bun în `.env` (`OLLAMA_MODEL`).
   ```bash
   ollama pull qwen2.5:7b
   npm run ai:eval -- --model qwen2.5:7b
   npm run ai:eval -- --model llama3.1:8b
   ```
2. **Ajustează promptul** (`systemPrompt` în `src/lib/ai/agent.ts`). Uită-te la cazurile picate: dacă modelul calculează greșit „weekendul ăsta”, adaugă o regulă clară; dacă uită de butonul „Confirmă”, insistă pe asta. Rulează din nou `ai:eval` și compară.
3. **Descrierile uneltelor** (`src/lib/ai/tools.ts`): modelul alege unealta după descriere. O descriere mai clară („Folosește-o ORI DE CÂTE ORI…”) ajută.

4. **Mută calculele din model în cod.** Modelele mici greșesc la aritmetică: „weekendul ăsta” devenea 29–31.10. Soluția nu e un prompt mai lung, ci o unealtă mai bună: `get_my_shifts` primește acum `period: "weekend"`, iar **serverul** calculează datele (`periodRange` în `src/lib/time.ts`). Promptul conține și un mini-calendar gata calculat. La fel, `get_employee_skill_gap` acceptă numele angajatului, nu doar un ID pe care modelul îl inventa.
   Regula: dacă modelul greșește constant la ceva ce codul poate face sigur (date, ID-uri, calcule), schimbă unealta, nu promptul.

**Regula de aur:** schimbi un singur lucru, rulezi `ai:eval` și compari procentul. Dacă a scăzut, revii.

### Istoric (completează-l pe măsură ce lucrezi)

| Data | Model | Schimbare | Rezultat (`--limit 15`) |
|---|---|---|---|
| 31.10 | qwen3:8b | punctul de plecare (model parțial pe CPU, 3 timeout-uri) | 3/15 (20%) |
| 31.10 | qwen3:8b | `period` în get_my_shifts, calendar în prompt, reguli noi, nume la skill gap, evaluare reparată | ? |

**Merită?** Da. Este cel mai bun raport câștig/efort. Pentru un hackathon poate fi suficient.

---

## Pasul 3 — Generează datele de antrenare

```bash
npm run ai:generate                              # 600 de exemple de antrenare + 60 de test
npm run ai:generate -- --train 1500 --eval 80    # mai multe (pentru antrenare reală, 1000–2000 e o țintă bună)
```

Ce face generatorul, pentru fiecare exemplu:
1. alege un angajat (sau adminul, pe un scenariu temporar cu o situație: concedii, trafic crescut, AVSEC expirat, ture de 12h);
2. alege o intenție și o formulare (uneori fără diacritice sau cu litere mici, cum scriu oamenii);
3. **apelează uneltele pe date reale**, exact cum ar trebui să facă un asistent bun;
4. scrie răspunsul corect în română, din datele primite;
5. salvează conversația completă în `data/ai/train.jsonl`.

Angajații din setul de test (conturile demo + încă 6) **nu apar** în setul de antrenare, iar testul de admin rulează pe un scenariu separat.

Deschide `data/ai/train.jsonl` și citește câteva exemple. Fiecare linie e o conversație: `system` → `user` → `assistant` (apel unealtă) → `tool` (rezultat) → `assistant` (răspuns).

### Cum înveți asistentul ceva nou

În `scripts/ai-data/intents.ts`:
- **formulări noi** pentru o intenție existentă: adaugi texte în lista `phrasings` / `c.r.pick([...])`;
- **o intenție nouă**: copiezi una existentă (ex. `profile_certs`) și schimbi întrebările, unealta și răspunsul.

Apoi rulezi `npm run ai:generate`. Dacă vrei să o și testezi, adaugi 2–3 cazuri în `data/ai/eval-manual.jsonl`.

**Merită?** Da, dacă urmează Pasul 4. Fără antrenare, datele nu schimbă nimic la model, dar setul de test e util oricum.

---

## Pasul 4 — Antrenarea (fine-tuning cu LoRA) pe Google Colab

> Pentru pasul acesta recomand **o conversație separată cu Claude**: dă-i acest fișier și `data/ai/train.jsonl`, iar el te ghidează live prin notebook, inclusiv prin erorile de versiuni de pachete, care se schimbă des.

### De ce Colab
Antrenarea unui model de 8B cere un GPU cu ~16 GB. Placa de 8 GB e la limită. Colab gratuit oferă un GPU **T4 (16 GB)**. Alternativă: un model mai mic (ex. Qwen 4B), care se antrenează și local.

### Pași

1. **colab.research.google.com** → New notebook → *Runtime → Change runtime type → T4 GPU*.
2. Încarcă `data/ai/train.jsonl` (iconița de folder din stânga → upload).
3. Rulează celulele de mai jos. Folosim [Unsloth](https://github.com/unslothai/unsloth), o bibliotecă care face LoRA rapid și economic. **Verifică numele exacte ale modelelor și parametrii în notebook-urile oficiale Unsloth pentru Qwen3**, pentru că se actualizează des.

```python
# 1. instalare
!pip install -q unsloth

# 2. modelul de bază, încărcat comprimat (4-bit) ca să încapă pe T4
from unsloth import FastLanguageModel
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen3-8B",   # același model ca în Ollama (qwen3:8b)
    max_seq_length=4096,
    load_in_4bit=True,
)

# 3. LoRA: antrenăm doar parametri „adăugați”
model = FastLanguageModel.get_peft_model(
    model, r=16, lora_alpha=16, lora_dropout=0,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth",
)

# 4. datele: fiecare conversație + definițiile uneltelor → textul în formatul modelului
import json
from datasets import Dataset
rows = [json.loads(l) for l in open("train.jsonl", encoding="utf-8") if l.strip()]
texts = [tokenizer.apply_chat_template(r["messages"], tools=r["tools"], tokenize=False) for r in rows]
print(texts[0][:2000])            # uită-te cum arată un exemplu în formatul intern
ds = Dataset.from_dict({"text": texts})

# 5. antrenarea
from trl import SFTTrainer, SFTConfig
trainer = SFTTrainer(
    model=model, tokenizer=tokenizer, train_dataset=ds,
    args=SFTConfig(
        dataset_text_field="text", max_seq_length=4096,
        per_device_train_batch_size=1, gradient_accumulation_steps=8,
        num_train_epochs=2, learning_rate=2e-4, warmup_steps=10,
        logging_steps=10, output_dir="out", report_to="none",
    ),
)
trainer.train()                   # urmărește „loss”: trebuie să scadă

# 6. export în formatul pe care îl citește Ollama (GGUF, comprimat q4_k_m ~5 GB)
model.save_pretrained_gguf("airport-qwen3", tokenizer, quantization_method="q4_k_m")
```

4. Descarcă fișierul `.gguf` din folderul `airport-qwen3` (poate dura, are câțiva GB; e mai rapid prin Google Drive).

### Cum îl pui în Ollama

Modelul antrenat trebuie să aibă același „șablon de chat” ca originalul, ca să știe să apeleze unelte. Îl copiem din modelul de bază:

```bash
ollama show qwen3:8b --modelfile > Modelfile
```

Deschide `Modelfile` și înlocuiește linia care începe cu `FROM` cu calea către fișierul descărcat:

```
FROM ./airport-qwen3/unsloth.Q4_K_M.gguf
```

Apoi:

```bash
ollama create airport-qwen3 -f Modelfile
npm run ai:eval -- --model airport-qwen3        # compară cu procentul de la Pasul 1!
```

Dacă e mai bun, pune `OLLAMA_MODEL="airport-qwen3"` în `.env`.

### Parametri de antrenare, pe scurt

| Parametru | Ce face | Dacă… |
|---|---|---|
| `num_train_epochs` | de câte ori vede modelul fiecare exemplu | modelul repetă exact frazele din exemple → scade la 1; nu învață → crește la 3 |
| `learning_rate` | cât de mult se schimbă la fiecare pas | „loss” sare haotic → scade la 1e-4 |
| `r` (LoRA) | câtă „capacitate” nouă primește | 16 e suficient aici |
| număr de exemple | variația pe care o vede | 600 = test, 1000–2000 = bun |

### Cum îți dai seama că a mers

- **Loss** scade în timpul antrenării (de ex. de la ~1.5 la ~0.3). Dacă ajunge aproape de 0, probabil memorează.
- **`ai:eval`** dă un procent mai mare decât modelul de bază, **mai ales pe `--only manual`** (formulări pe care nu le-a văzut).
- Dacă procentul crește pe `generated`, dar **scade pe `manual`**, modelul a memorat tiparele generatorului: adaugă formulări mai variate sau antrenează mai puțin (1 epocă).

---

## Merită antrenarea? (răspuns sincer)

| | Prompt + modele (Pasul 2) | Fine-tuning (Pasul 4) |
|---|---|---|
| Timp | ore | ~1 zi (prima dată), din care antrenarea ~30–90 min pe T4 |
| Ce îmbunătățește | instrucțiuni, reguli | consecvența: alege unealta corectă, argumente corecte, stil uniform, mai puțin „uită” regulile |
| Ce NU îmbunătățește | — | cunoștințe noi despre date (pe acelea le dau uneltele) |
| Risc | mic | memorare; un model antrenat greșit poate fi mai slab; trebuie re-exportat la schimbări mari |

**Recomandare pentru hackathon:** Pașii 1–2 sigur, 3 da (îți dă și setul de test), 4 dacă vă rămân ~6–8 ore și cineva din echipă vrea să-l preia.
Pentru juriu, cel mai convingător e un **înainte/după măsurat**: „qwen3:8b: 58% → după prompt: 71% → după fine-tuning pe 1.500 de exemple generate din motorul de simulare: 86%, inclusiv pe formulări nevăzute”.

---

## Probleme frecvente

| Problemă | Soluție |
|---|---|
| `Ollama nu răspunde` la `ai:eval` | pornește Ollama (iconița cu lama) |
| `Modelul … nu e instalat` | `ollama pull <model>` sau `--model` cu un nume din `ollama list` |
| `User was denied access` / erori de bază de date | pornește baza: `npm run local:db` în alt terminal |
| `ai:eval` e foarte lent | prima întrebare încarcă modelul (~30 s); restul ar trebui să fie de câteva secunde. Folosește `--limit 10` pentru teste rapide |
| după `npm run db:seed` testele cu date picate | rulează din nou `npm run ai:generate` |
| în Colab: „CUDA out of memory” | `max_seq_length=2048` sau `per_device_train_batch_size=1`, `gradient_accumulation_steps=8` |
| modelul antrenat nu mai apelează unelte în Ollama | lipsește șablonul de chat: refă pasul cu `ollama show … --modelfile` |
