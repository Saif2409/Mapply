# Mapply

A desktop application that finds every software and AI job in the UAE market, scores how
realistic each one actually is, and generates a tailored CV, cover letter and outreach
message for the best matches.

Electron + React front end, Python/FastAPI back end, and an AI coding agent wired in as
the reasoning engine over a shared filesystem.

---

## What it does

1. **Find Jobs** — scrapes every source concurrently and writes one JSON file per unique posting.
2. **Score** — judges each posting against a structured profile of the candidate.
3. **Tailor** — builds an ATS-safe CV and cover letter for the top-ranked jobs.
4. **Apply** — opens the posting inside the app, already signed in, with the documents and
   answers beside it.
5. **Track** — tailored jobs leave the job pool and move through a kanban tracker.

## Sources

| Kind | Sources |
|---|---|
| Aggregators | Indeed, LinkedIn |
| Gulf-native boards | Bayt, GulfTalent, NaukriGulf |
| ATS platforms | Greenhouse, Lever, Ashby, Recruitee, SmartRecruiters, Workday, Oracle Recruiting Cloud |
| Direct career APIs | Amazon, SAP, Microsoft, Emirates, flydubai, Etihad, and Oracle-hosted UAE employers |

Sources are removed as readily as they're added. Google Jobs was dropped after repeatedly
returning nothing Indeed and LinkedIn hadn't already surfaced, and Tanqeeb after most of
its postings turned out to be re-listings of LinkedIn ads that had since closed — a board
that mostly forwards you elsewhere is a board whose results you already have.

A working store here holds ~4,600 unique postings.

## Applying

The last mile is where job hunting actually costs time, so it happens inside the app.

- **Sign in once.** An embedded browser keeps a session per board, so postings open already
  authenticated. Whether a site is genuinely signed in is decided by its real session
  cookie rather than by the presence of any httpOnly cookie — CDN and bot-protection
  cookies are httpOnly too, and reading those as "connected" reported sites as logged in
  that had only ever been browsed.
- **Handoffs stay inside.** Boards bounce constantly to an employer's ATS, and Apply
  buttons open popups. Those are kept in the same embedded view, so the apply panel and the
  session travel with them instead of being stranded in a detached window.
- **Documents at hand.** The tailored CV and cover letter sit beside the form. Where a page
  has a drop zone they can be dragged straight onto it; where it opens an OS file dialog
  instead — which nothing can be dragged into — the containing folder is copied for pasting
  into the dialog's filename box.
- **Autofill** covers the facts a form asks for verbatim. Judgement answers — salary
  expectations, "why this company", notice period — are deliberately left blank.
- **Mapply never submits anything.** It fills and opens; the human reviews and clicks.

## Expired postings

A packet tailored for a posting that closed last week can never be sent. Before any
tailoring runs, the shortlist is verified: a passed `validThrough` deadline, a 404, or a
page that says "no longer accepting applications" removes the job. Anything else — a board
that blocked the request, rate-limited, or timed out — is left alone, because a scraper
being refused says nothing about whether an employer is still hiring. Removal is the same
reversible state as the Remove button: the record stays on disk so scans don't re-add it.

---

## Engineering notes

The interesting problems here weren't the CRUD.

**Bot protection.** Bayt, GulfTalent and NaukriGulf reject standard HTTP clients with 403.
They're reachable using `curl_cffi` with a Chrome TLS fingerprint, so the handshake matches
a real browser rather than a Python client.

**Login-walled employers.** Several large UAE employers have no public job feed. Tracing
their front-end JavaScript to the underlying JSON endpoints exposed undocumented APIs that
serve the same data the site renders.

**Deduplication that doesn't over-merge.** The same role appears across four boards with
different location strings, so job identity is a hash of normalised company + title with
location deliberately excluded. But a company genuinely re-advertising a role weeks later
is *not* a duplicate — reposts are detected by age and preserved under a distinct id.

**Scoring that has to be fair.** This is where most of the work went.

The first version used a local 8B model for the whole judgement. It scored a Java role
44/100 with the reasoning *"candidate has no Java experience"* — while Java was in the
skills list it had been given. Two causes: the profile was being truncated mid-list, and
nothing checked the model's claims.

The fix was to stop asking a language model to do arithmetic and start grounding it:

- **Measured in code:** posting freshness, location fit, seniority demands, domain
  relevance, and which of the technologies a posting names actually appear in the profile.
- **Judged by the model:** only the semantic question of skills fit, and how realistic the
  role's stated seniority is.
- **Verified after:** any "missing skill" the model reports that contradicts the profile is
  struck out programmatically, and its score is blended with measured coverage — weighted
  by how concretely the posting specifies its stack, since a job listing only "HTML, CSS"
  is weak evidence of a strong match.

Seniority is judged from what a posting *demands*, not its title. A role called "Senior"
that asks for two years is scored on the two years.

**Local vs hosted inference.** A full local scoring pass took 9.4 hours on a 6GB GPU
(the model only partly fits in VRAM) and was still unfair. Scoring moved to a batched
agent interface; the local path remains as an offline fallback.

**Agent skills as an interface.** Scoring, tailoring and hiring-manager research are
exposed as skills an AI coding agent invokes against the same files the app reads. The app
owns scraping, ranking, storage and tracking; the agent supplies judgement and writing.
Neither calls the other's API — the filesystem is the contract.

**Performance.** Cold start was 90 seconds because the portable executable re-extracted
78MB to a temp directory on every launch; switching packaging strategy took it to ~3s. The
UI stays in step with files an external agent is changing by polling a directory
fingerprint rather than the dataset — optimised from 1.4s to 29ms per check by replacing
per-file `stat` calls with a single cached directory scan. That same fingerprint keys the
caches for the job list and the profile counters, so pages that need to read every record
pay for it once per actual change. Opening a posting used to fetch the entire store to find
one job; it now reads that one file.

---

## Architecture

```
Mapply/
  electron/          main process, backend supervision, window management
  src/               React UI (jobs, tracker, job detail, profile, settings)
  backend/
    main.py          FastAPI
    scan.py          concurrent scrape orchestration
    scoring.py       deterministic signals + LLM judgement + composition
    claude_scoring.py batch interface for agent-driven scoring
    jobs.py          file-backed job store, identity, repost detection
    dedupe.py        cross-folder duplicate resolution
    liveness.py      is this posting still open?
    sources/         one module per source family
    tools/           maintenance scripts (verify postings, retire a source, logos)
```

Data lives outside the app source so the app and the agent share it:

```
profiles/<Name>/
  master_profile.yaml     every project, skill and bullet — the tailoring pool
  target_criteria.yaml    roles, locations, dealbreakers
  watchlist.yaml          companies to poll directly
  jobs_found/<id>.json    open pool
  tailored/<id>/          generated CV, cover letter, outreach
```

There is no database. One JSON file per job is the source of truth, which is what lets an
external agent participate without an integration layer.

**Tailoring selects, it never invents.** The CV generator may only draw from bullets that
already exist in the master profile, and enforces a hard two-page budget by trimming
bullet counts until the rendered PDF fits.

---

## Running it

Requires Node 18+, Python 3.11+, and [Ollama](https://ollama.com) only if you want the
offline scoring fallback.

```bash
# back end
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt

# front end
npm install
npm run dev
```

Build a distributable Windows app with `npm run dist`.

The app expects a `profiles/` and `templates/` directory alongside it — see the layout
above. Set `MAPPLY_DATA_DIR` to point elsewhere.

---

## Status

Built as a personal project in 2026. The scrapers, scoring pipeline, tailoring routine and
packaging all work end to end against the live UAE job market.
