"""Score Me — hybrid scoring of a job against a master profile.

Deterministic in code:   freshness (posting age), location fit, dealbreakers
Local LLM (Ollama):      requirements match, seniority fit, matched/missing skills

chance/100 = 0.50*requirements + 0.15*seniority + 0.15*freshness
           + 0.10*location + 0.10*preferences
"""
import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime

import httpx

import profiles as profiles_mod
from jobs import load_jobs, update_job

OLLAMA_URL = "http://localhost:11434"
# 8B fits fully in a 6GB GPU → ~10x faster than a 12B that spills to CPU.
# Change in Settings if a bigger model is worth the wait.
DEFAULT_MODEL = "llama3.1:8b"
FALLBACK_MODELS = ["llama3.1:8b", "gemma4:12b", "llama3.2:1b"]

# Prompt budget: job descriptions are the expensive part of prefill.
MAX_DESC_CHARS = 3500
MAX_DIGEST_CHARS = 3000

# Requirements match is a GATE, not just a weighted term: if you don't match what
# the job asks for, a fresh posting in Dubai doesn't make it a real chance.
#
#   chance = requirements * (BASE + (1-BASE) * modifiers)
#
# where modifiers is the weighted blend of seniority/freshness/location/preferences.
# So requirements sets the ceiling and everything else moves you within it.
# Bumped whenever the scoring logic changes in a way that invalidates old scores.
# Jobs carrying an older version count as unscored, so "Score Me" upgrades them
# and a run interrupted half-way (closing the app kills the backend) resumes
# instead of starting from zero.
SCORER_VERSION = 2

GATE_BASE = 0.55
MODIFIER_WEIGHTS = {
    "seniority": 0.30,
    "freshness": 0.30,
    "location": 0.20,
    "preferences": 0.20,
}

_lock = threading.Lock()
_runs: dict[str, dict] = {}  # profile -> {running, done, total, current, errors}


# ---------- deterministic parts ----------

def freshness_score(posted_date: str | None) -> float:
    """<=2 days = 100, decaying to 0 at 30 days.

    A missing date is common (LinkedIn and the Gulf boards often omit it) and is
    NOT evidence of staleness — we only scrape live listings — so it scores
    neutral-high rather than being penalised.
    """
    if not posted_date:
        return 70.0
    try:
        d = date.fromisoformat(posted_date[:10])
    except ValueError:
        return 55.0
    age = (date.today() - d).days
    if age <= 2:
        return 100.0
    if age >= 30:
        return 0.0
    return round(100.0 * (1 - (age - 2) / 28.0), 1)


# Seniority is judged in code, not by the LLM: small models reliably over-score it
# (they'll rate an "Engineering Manager" 90/100 for a new graduate).
SENIOR_MARKERS = [
    (r"\b(chief|cto|vp|vice president|head of|director)\b", 0, "executive role"),
    (r"\b(principal|staff|distinguished)\b", 5, "principal/staff level"),
    (r"\b(manager|lead|team lead|supervisor)\b", 12, "management/lead role"),
    (r"\b(senior|snr|sr\.?)\b", 35, "senior level"),
    (r"\b(mid[- ]level|specialist|ii|iii)\b", 70, "mid level"),
    (r"\b(junior|jr\.?|graduate|entry|trainee|intern|associate)\b", 100, "entry level"),
]
YEARS_RE = re.compile(r"(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs?)", re.I)


def seniority_score(job: dict, candidate_years: float = 1.0) -> tuple[float, str]:
    """Deterministic seniority fit for an early-career candidate.

    Returns (score, note). Title markers dominate; an explicit years requirement
    in the description can only lower the score further.
    """
    title = (job.get("title") or "").lower()
    score = 75.0  # untitled/neutral roles
    note = "no seniority marker in title"
    for pattern, value, label in SENIOR_MARKERS:
        if re.search(pattern, title):
            score, note = float(value), label
            break

    desc = (job.get("description") or "")[:4000]
    reqs = [int(m.group(1)) for m in YEARS_RE.finditer(desc) if int(m.group(1)) <= 20]
    if reqs:
        required = min(reqs)  # the least demanding stated requirement
        gap = required - candidate_years
        if gap <= 0:
            years_score = 100.0
        elif gap >= 7:
            years_score = 0.0
        else:
            years_score = max(0.0, 100.0 - gap * 15.0)
        score = min(score, years_score)
        note += f"; requires ~{required}y experience"

    return round(score, 1), note


# Small models won't score below ~50 even for a nursing job, so domain relevance
# is checked in code and used as a hard cap on the LLM's requirements score.
OFF_FIELD_TITLES = re.compile(
    r"\b(nurse|nursing|midwife|physician|doctor|dentist|pharmacist|radiograph\w*|"
    r"therapist|caregiver|receptionist|secretary|waiter|waitress|barista|chef|cook|"
    r"cashier|driver|chauffeur|courier|rider|salesman|salesperson|telesales|"
    r"real estate|realtor|broker agent|beautician|barber|tailor|welder|plumber|"
    r"electrician|carpenter|mason|hvac|foreman|surveyor|civil engineer|"
    r"mechanical engineer|electrical engineer|structural engineer|"
    r"interior design\w*|3d visualiz\w*|graphic design\w*|teacher|tutor|lecturer|"
    r"professor|accountant|auditor|bookkeep\w*|lawyer|paralegal|hr officer|"
    r"recruiter|housekeep\w*|security guard|storekeeper|warehouse|logistics coordinator|"
    # Added after a "Sales Executive - Auto Loans" ranked level with real tech
    # roles: postings with no description default to a neutral score, so the
    # title has to carry the filtering.
    r"sales\s+(executive|manager|associate|representative|consultant|coordinator)|"
    r"business development|relationship manager|account manager|"
    r"marketing (executive|manager|specialist|coordinator)|brand manager|"
    r"procurement|purchasing officer|admin(istrative)? assistant|office manager|"
    r"customer service|call cent(er|re)|telecall\w*|bank teller|cashier|"
    r"cabin crew|flight attendant|pilot|steward(ess)?|concierge|valet|"
    r"quantity surveyor|draft(s)?man|estimator|technician|mechanic|machinist|"
    r"content writer|copywriter|translator|photographer|videographer|"
    r"social media (executive|manager|specialist))\b",
    re.I,
)


def _clean_term(t: str) -> str:
    """'Go (basic)' -> 'go'. Parentheticals are proficiency notes, not part of
    the name, and they stop the term from ever matching a job description."""
    return re.sub(r"\s*\([^)]*\)", "", str(t)).strip().lower()


def _vocab(master: dict) -> set[str]:
    terms: set[str] = set()
    for items in (master.get("skills") or {}).values():
        if isinstance(items, list):
            terms.update(_clean_term(i) for i in items)
    for p in (master.get("projects") or []):
        terms.update(_clean_term(k) for k in (p.get("keywords") or []))
    for e in (master.get("experience") or []):
        terms.update(_clean_term(k) for k in (e.get("keywords") or []))
    # keep multi-word phrases and meaningful single words
    return {t for t in terms if len(t) > 2}


def _mentions(blob: str, term: str) -> bool:
    """Whole-term match. Substring matching turns 'go' into a hit on 'ongoing'
    and 'r' into a hit on everything."""
    return re.search(rf"(?<![a-z0-9+#]){re.escape(term)}(?![a-z0-9+#])", blob) is not None


# Technologies a job description can name. Used to work out what a posting
# actually asks for, so the candidate's coverage of it can be measured in code
# instead of taken on faith from an 8B model.
TECH_LEXICON = [
    # languages
    "python", "java", "javascript", "typescript", "c#", "c++", "golang", "go", "rust",
    "kotlin", "swift", "scala", "ruby", "php", "r", "matlab", "sql", "pl/sql", "t-sql",
    "bash", "powershell", "html", "css",
    # data / ml
    "pandas", "numpy", "scikit-learn", "sklearn", "tensorflow", "keras", "pytorch",
    "hugging face", "transformers", "nlp", "computer vision", "opencv", "llm",
    "machine learning", "deep learning", "data science", "rag", "langchain",
    "time series", "forecasting", "xgboost", "spark", "hadoop", "etl", "airflow",
    "power bi", "tableau", "looker", "dbt", "snowflake", "databricks",
    # web / backend
    "react", "angular", "vue", "next.js", "node", "node.js", "express", "django",
    "flask", "fastapi", "spring", "spring boot", ".net", "asp.net", "laravel",
    "rest", "graphql", "microservices", "api",
    # data stores
    "postgresql", "postgres", "mysql", "mongodb", "redis", "elasticsearch",
    "oracle", "sql server", "dynamodb", "cassandra",
    # cloud / devops
    "aws", "azure", "gcp", "google cloud", "docker", "kubernetes", "terraform",
    "jenkins", "ci/cd", "git", "github", "gitlab", "linux", "sagemaker", "lambda",
    "s3", "ec2", "bedrock",
    # other
    "sap", "salesforce", "excel", "jira", "agile", "scrum", "selenium", "pytest",
]


def jd_tech_terms(job: dict) -> set[str]:
    """Technologies this posting actually names."""
    blob = f"{job.get('title','')} {(job.get('description') or '')[:6000]}".lower()
    return {t for t in TECH_LEXICON if _mentions(blob, t)}


# Terms the candidate has that are spelled differently in job ads.
ALIASES = {
    "golang": "go", "sklearn": "scikit-learn", "postgres": "postgresql",
    "node.js": "node", "pl/sql": "sql", "t-sql": "sql", "sql server": "sql",
    "google cloud": "gcp", "transformers": "hugging face",
}


# Terms almost every office job mentions. Matching them says little, so they
# carry less weight — otherwise a marketing role that says "HTML, CSS" scores as
# a perfect technical match.
GENERIC_TECH = {
    "html", "css", "excel", "git", "github", "gitlab", "agile", "scrum", "jira",
    "api", "rest", "linux", "bash", "powershell", "sql",
}


def _term_weight(t: str) -> float:
    return 0.4 if t in GENERIC_TECH else 1.0


def skill_coverage(job: dict, vocab: set[str]) -> tuple[list[str], list[str], float | None, float]:
    """(has, lacks, coverage, evidence) for the technologies this job names.

    Deterministic, so it cannot hallucinate: a term is 'has' only when it is in
    the candidate's own profile. coverage is None when the posting names no
    recognisable technology at all — then there is nothing to measure.
    `evidence` is how much the posting actually specified, weighted so generic
    keywords count for less.
    """
    wanted = jd_tech_terms(job)
    if not wanted:
        return [], [], None, 0.0
    has, lacks = [], []
    for t in sorted(wanted):
        canon = ALIASES.get(t, t)
        if any(_mentions(v, t) or _mentions(v, canon) or v == canon for v in vocab):
            has.append(t)
        else:
            lacks.append(t)
    total = sum(_term_weight(t) for t in wanted)
    return has, lacks, sum(_term_weight(t) for t in has) / total, total


# "architect" alone is ambiguous — a Solutions/Data/Cloud Architect is a tech role,
# a building architect is not.
BUILDING_ARCHITECT = re.compile(r"\b(interior|landscape|building|design)\s+architect\b", re.I)
TECH_ARCHITECT = re.compile(
    r"\b(solutions?|data|cloud|software|enterprise|security|platform|systems?|ai|ml)\s+architect\b",
    re.I,
)


# A real tech role in the title outranks an off-field keyword ("IT Auditor &
# Data Analyst" is a job worth seeing), EXCEPT when the title is a sales or
# other-engineering post that merely names technology it sells or builds around.
CORE_TECH_TITLE = re.compile(
    r"\b(data (scientist|analyst|engineer)|data science|machine learning|"
    r"ml engineer|ai engineer|software (engineer|developer)|python developer|"
    r"back[- ]?end|front[- ]?end|full[- ]?stack|devops|mlops|cloud engineer)\b",
    re.I,
)
NEVER_RESCUE = re.compile(
    r"\b(sales|business development|account manager|mechanical|electrical|civil|"
    r"hvac|structural|marketing)\b",
    re.I,
)


def domain_cap(job: dict, vocab: set[str]) -> tuple[float, str]:
    """Return (max_allowed_requirements_score, reason)."""
    title = (job.get("title") or "")
    desc = (job.get("description") or "")[:4000]
    blob = f"{title} {desc}".lower()

    rescued = CORE_TECH_TITLE.search(title) and not NEVER_RESCUE.search(title)

    if not rescued and (
        OFF_FIELD_TITLES.search(title)
        or (BUILDING_ARCHITECT.search(title) and not TECH_ARCHITECT.search(title))
    ):
        return 20.0, "different profession"

    hits = sum(1 for t in vocab if _mentions(blob, t))

    # With little or no description text there isn't enough signal to judge on
    # keywords alone — stay neutral and let the model decide.
    if len(desc) < 200:
        return (100.0, f"title-only match ({hits} terms)") if hits else (70.0, "no description available")

    if hits == 0:
        return 25.0, "no overlap with profile skills"
    if hits <= 2:
        return 45.0, f"minimal skill overlap ({hits} terms)"
    if hits <= 5:
        return 70.0, f"partial skill overlap ({hits} terms)"
    return 100.0, f"strong skill overlap ({hits} terms)"


def location_score(job_location: str, criteria: dict) -> float:
    loc = (job_location or "").lower()
    if not loc:
        return 60.0
    targets = [t.lower() for t in (criteria.get("locations") or [])]
    if not targets:
        return 70.0
    for t in targets:
        city = t.split(",")[0].strip()
        if city and city in loc:
            return 100.0
    if "remote" in loc and any("remote" in t for t in targets):
        return 95.0
    if "uae" in loc or "united arab emirates" in loc or "emirates" in loc:
        return 85.0
    return 20.0


def preferences_score(job: dict, criteria: dict) -> float:
    prefs = [p.lower() for p in (criteria.get("preferences") or []) if isinstance(p, str)]
    if not prefs:
        return 70.0
    blob = f"{job.get('title','')} {job.get('company','')} {job.get('description','')}".lower()
    hits = sum(1 for p in prefs if any(w in blob for w in re.findall(r"[a-z]{4,}", p)))
    return min(100.0, 55.0 + hits * 15.0)


def dealbreaker_hit(job: dict, criteria: dict) -> str | None:
    for db in (criteria.get("dealbreakers") or []):
        if not isinstance(db, str) or not db.strip():
            continue
        if db.lower() in f"{job.get('title','')} {job.get('description','')}".lower():
            return db
    return None


# ---------- profile digest for the LLM ----------

def profile_digest(master: dict) -> str:
    p = master.get("personal", {})
    parts = [f"Candidate: {p.get('name','')} — {master.get('summary_base','')[:600]}"]

    # Skills come FIRST. The digest is truncated to fit the prompt budget, and
    # this section is the one the model is being asked about — with it last, the
    # tail of the list was silently cut and the model then "found" gaps that
    # weren't there.
    skills = master.get("skills") or {}
    flat = []
    for cat, items in skills.items():
        if isinstance(items, list):
            flat.extend(str(i) for i in items)
    if flat:
        parts.append("Skills: " + ", ".join(flat))

    edu = master.get("education") or []
    if edu:
        e = edu[0]
        parts.append(f"Education: {e.get('degree','')}, {e.get('institution','')}, {e.get('graduation','')}, {e.get('honours','')}")

    exps = []
    for e in (master.get("experience") or []):
        exps.append(f"- {e.get('title','')} at {e.get('company','')} ({e.get('start','')}–{e.get('end','')}): "
                    + "; ".join((e.get("keywords") or [])[:8]))
    if exps:
        parts.append("Experience:\n" + "\n".join(exps))

    projs = []
    for pr in (master.get("projects") or []):
        if pr.get("tier") == "flagship":
            projs.append(f"- {pr.get('name','')}: " + ", ".join((pr.get("keywords") or [])[:12]))
    if projs:
        parts.append("Key projects:\n" + "\n".join(projs))

    if p.get("visa"):
        parts.append(f"Work authorisation: {p['visa']}")
    return "\n\n".join(parts)


PROMPT = """You are an expert technical recruiter scoring how well a candidate matches a job.

=== CANDIDATE ===
{digest}

=== JOB ===
Title: {title}
Company: {company}
Location: {location}
Description:
{description}

=== VERIFIED FACTS (checked against the candidate's profile — treat as ground truth) ===
Technologies this job names that the candidate DOES have: {has}
Technologies this job names that the candidate does NOT have: {lacks}
You MUST NOT list anything from the "DOES have" line as missing, and you MUST NOT
claim the candidate lacks it. If that line covers everything the job names, this is
a strong match.

=== TASK ===
Judge ONLY on evidence in the candidate profile. Do not invent experience.
Judge the SKILLS ONLY — seniority and location are scored separately, so ignore them here.

Use the FULL 0-100 range. Most jobs are NOT a strong match. Anchor your score:
  90-100 = candidate demonstrably has essentially every core technical requirement
  70-89  = has most core requirements, missing one or two
  50-69  = same broad field, but half the stated requirements are unevidenced
  25-49  = adjacent field; some transferable skills, most requirements unmet
  0-24   = different discipline (e.g. mechanical, civil, sales, teaching, nursing,
           front-desk, driving) or requires a licence/domain the candidate lacks
A job in a different profession must score below 25 no matter how capable the candidate is.

Return STRICT JSON, no markdown, with exactly these keys:
{{
  "requirements_match": <0-100 int, using the anchors above>,
  "matched_skills": [<up to 8 specific skills the candidate genuinely has that the job asks for>],
  "missing_skills": [<up to 5 important requirements the candidate lacks>],
  "reasoning": "<one sentence, max 25 words>"
}}"""


def _tidy_skills(items: list[str]) -> list[str]:
    """Skill chips, not prose. Small models often paste whole requirement
    sentences into these lists, which then overflow the job card."""
    out, seen = [], set()
    for s in items:
        s = re.sub(r"\s+", " ", str(s)).strip(" .;,")
        if not s or len(s) > 40 or s.count(" ") > 4:
            continue
        k = s.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
    return out[:8]


def _extract_json(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def llm_judge(job: dict, digest: str, model: str, client: httpx.Client,
              has: list[str] | None = None, lacks: list[str] | None = None) -> dict:
    prompt = PROMPT.format(
        digest=digest[:MAX_DIGEST_CHARS],
        title=job.get("title", ""),
        company=job.get("company", ""),
        location=job.get("location", ""),
        description=(job.get("description") or "")[:MAX_DESC_CHARS] or "(no description available)",
        has=", ".join(has) if has else "(none identified)",
        lacks=", ".join(lacks) if lacks else "(none — the job names nothing the candidate lacks)",
    )
    r = client.post(
        f"{OLLAMA_URL}/api/generate",
        json={
            "model": model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            # Fixed seed + temperature 0: re-running a scan must not reshuffle the
            # ranking. Without this the same job scored 85 and then 48.
            "options": {"temperature": 0.0, "seed": 42, "num_predict": 400},
        },
        timeout=180.0,
    )
    r.raise_for_status()
    data = _extract_json(r.json().get("response", "")) or {}
    return {
        "requirements_match": max(0, min(100, int(data.get("requirements_match", 50) or 50))),
        "matched_skills": [str(s) for s in (data.get("matched_skills") or [])][:8],
        "missing_skills": [str(s) for s in (data.get("missing_skills") or [])][:5],
        "reasoning": str(data.get("reasoning", ""))[:220],
    }


def deterministic_parts(job: dict, criteria: dict, vocab: set[str] | None) -> dict:
    """Everything that can be measured rather than judged.

    Shared by both scorers so a Claude-scored job and an Ollama-scored job sit on
    exactly the same scale and can be ranked against each other.
    """
    cap, cap_reason = (100.0, "") if vocab is None else domain_cap(job, vocab)
    has, lacks, coverage, evidence = ([], [], None, 0.0) if vocab is None else skill_coverage(job, vocab)
    sen, sen_note = seniority_score(job)
    return {
        "dealbreaker": dealbreaker_hit(job, criteria),
        "freshness": freshness_score(job.get("posted_date")),
        "location_fit": location_score(job.get("location", ""), criteria),
        "preferences": preferences_score(job, criteria),
        "seniority_fit": sen,
        "seniority_note": sen_note,
        "cap": cap,
        "cap_reason": cap_reason,
        "has": has,
        "lacks": lacks,
        "coverage": coverage,
        "evidence": evidence,
    }


def compose_score(det: dict, judged: dict, model: str, trust_judge: bool = False) -> dict:
    """Turn a skills/seniority judgement into a final 0-100 chance.

    `trust_judge` is for a judge good enough to weigh a posting's real seniority
    demands (Claude). The local 8B model is not, so its seniority reading is
    discarded in favour of the deterministic one and its skills score is blended
    with measured coverage.
    """
    sen = float(det["seniority_fit"])
    sen_note = det["seniority_note"]
    if trust_judge and judged.get("seniority_fit") is not None:
        sen = max(0.0, min(100.0, float(judged["seniority_fit"])))
        if judged.get("seniority_note"):
            sen_note = str(judged["seniority_note"])[:160]

    if det["dealbreaker"]:
        return {
            "total_100": 0, "requirements_match": 0, "seniority_fit": sen,
            "freshness": det["freshness"], "location_fit": det["location_fit"],
            "preferences": det["preferences"], "matched_skills": [], "missing_skills": [],
            "reasoning": f"Dealbreaker matched: {det['dealbreaker']}",
            "model": model, "scorer_version": SCORER_VERSION,
            "scored_at": datetime.now().isoformat(timespec="seconds"),
        }

    # The judge is not trusted to report what the candidate HAS — that is measured.
    # Anything it calls missing but which is demonstrably in the profile is struck
    # out, and the verified matches are merged in.
    vocab_has = {t.lower() for t in det["has"]}
    missing = _tidy_skills([
        s for s in (judged.get("missing_skills") or [])
        if s.strip().lower() not in vocab_has
        and not any(_mentions(s.strip().lower(), t) for t in vocab_has)
    ])
    matched = _tidy_skills((judged.get("matched_skills") or []) + det["has"])

    req = float(judged.get("requirements_match", 50) or 50)
    if not trust_judge and det["coverage"] is not None:
        # Blend the small model's judgement with measured coverage of the stack the
        # posting names. It is volatile — the same job came back 85 then 48 on
        # consecutive runs — so concrete postings lean on the measured side.
        measured = 20.0 + 75.0 * det["coverage"]
        w = min(0.70, 0.70 * det["evidence"] / 4.0)
        req = w * measured + (1 - w) * req
    req = round(min(req, det["cap"]))

    modifiers = (
        MODIFIER_WEIGHTS["seniority"] * sen
        + MODIFIER_WEIGHTS["freshness"] * det["freshness"]
        + MODIFIER_WEIGHTS["location"] * det["location_fit"]
        + MODIFIER_WEIGHTS["preferences"] * det["preferences"]
    ) / 100.0
    total = req * (GATE_BASE + (1 - GATE_BASE) * modifiers)

    # Seniority is a second gate. Matching every technical requirement doesn't make
    # a Senior/Lead/Head role a realistic chance for a recent graduate, so the
    # achievable score is capped by how well the level fits.
    #   entry (100) -> 100 | senior (35) -> 61 | manager (12) -> 47 | head (0) -> 40
    total = min(total, 40.0 + 0.60 * sen)

    return {
        "total_100": round(total, 1),
        "requirements_match": req,
        "seniority_fit": round(sen, 1),
        "seniority_note": sen_note,
        "freshness": det["freshness"],
        "location_fit": det["location_fit"],
        "preferences": det["preferences"],
        "matched_skills": matched,
        "missing_skills": missing,
        "reasoning": str(judged.get("reasoning", ""))[:220],
        "domain_note": det["cap_reason"],
        "skill_coverage": None if det["coverage"] is None else round(det["coverage"] * 100),
        "model": model,
        "scorer_version": SCORER_VERSION,
        "scored_at": datetime.now().isoformat(timespec="seconds"),
    }


def score_job(job: dict, digest: str, criteria: dict, model: str, client: httpx.Client,
              vocab: set[str] | None = None) -> dict:
    det = deterministic_parts(job, criteria, vocab)
    if det["dealbreaker"]:
        return compose_score(det, {}, model)

    # When the job is clearly a different profession we skip the LLM entirely. On a
    # real UAE scrape that's most of the queue (nursing, sales, driving,
    # construction), so this is the difference between a 5-hour and a 1-hour run.
    if det["cap"] <= 25.0:
        judged = {
            "requirements_match": int(det["cap"]),
            "matched_skills": [], "missing_skills": [],
            "reasoning": f"Skipped detailed scoring — {det['cap_reason']}.",
        }
    else:
        judged = llm_judge(job, digest, model, client, det["has"], det["lacks"])
    return compose_score(det, judged, model)


# ---------- batch runner ----------

def get_state(profile: str) -> dict:
    with _lock:
        return _runs.get(profile) or {"running": False, "done": 0, "total": 0, "current": None, "errors": []}


SCORING_WORKERS = 3  # Ollama serves a few concurrent requests fine on one GPU


def _run(profile: str, job_ids: list[str], model: str):
    master = profiles_mod.read_master(profile)
    criteria = profiles_mod.read_yaml(profile, "target_criteria.yaml") or {}
    digest = profile_digest(master)
    vocab = _vocab(master)
    all_jobs = {j["id"]: j for j in load_jobs(profile)}

    # Score the most promising jobs first so the shortlist is usable within
    # minutes instead of after the whole queue drains.
    def priority(jid):
        job = all_jobs.get(jid) or {}
        cap, _ = domain_cap(job, vocab)
        return (-cap, job.get("posted_date") or "")

    ordered = sorted((j for j in job_ids if j in all_jobs), key=priority)
    write_lock = threading.Lock()

    def work(jid):
        job = all_jobs[jid]
        with _lock:
            _runs[profile]["current"] = f"{job.get('title','')} @ {job.get('company','')}"
        try:
            with httpx.Client() as client:
                sc = score_job(job, digest, criteria, model, client, vocab)
            with write_lock:
                update_job(profile, jid, {
                    "score": sc,
                    "status": "scored" if job.get("status") == "found" else job.get("status"),
                })
        except Exception as e:
            with _lock:
                _runs[profile]["errors"].append(f"{jid}: {str(e)[:150]}")
        finally:
            with _lock:
                _runs[profile]["done"] += 1

    with ThreadPoolExecutor(max_workers=SCORING_WORKERS) as pool:
        list(pool.map(work, ordered))

    with _lock:
        _runs[profile]["running"] = False
        _runs[profile]["current"] = None


# The bigger model judges skills noticeably better (it spots that a C#/.NET role
# matches this candidate where the 8B model does not) but is 3-5x slower. So the
# fast model scores everything, then the accurate model re-scores the shortlist —
# which is the only part where precision changes a decision.
DEEP_MODEL = "gemma4:12b"


def _needs_score(job: dict) -> bool:
    """Unscored, or scored by a superseded version of the scorer."""
    sc = job.get("score")
    return not sc or int(sc.get("scorer_version") or 0) < SCORER_VERSION


def start_scoring(profile: str, only_unscored: bool = True, model: str = DEFAULT_MODEL,
                  deep_top: int | None = None) -> dict:
    """
    only_unscored : score jobs that have no score yet
    deep_top      : instead, re-score the N highest-scoring jobs with `model`
                    (used for the accurate second pass)
    """
    with _lock:
        if _runs.get(profile, {}).get("running"):
            return _runs[profile]

    jobs = load_jobs(profile)

    if deep_top:
        # Rank candidates for the accurate pass by DETERMINISTIC signals — skill
        # overlap, seniority fit, freshness — not by the fast model's own score.
        # Otherwise a job the fast model wrongly rated low could never be rescued,
        # which is exactly the error the second pass exists to catch.
        master = profiles_mod.read_master(profile)
        vocab = _vocab(master)

        def candidate_rank(j):
            cap, _ = domain_cap(j, vocab)
            sen, _ = seniority_score(j)
            fresh = freshness_score(j.get("posted_date"))
            return -(cap * 0.6 + sen * 0.3 + fresh * 0.1)

        # Only jobs still in the open pool. Anything already tailored or applied to
        # has left the shortlist, so each deep rescore works on a fresh 200.
        open_pool = [
            j for j in jobs
            if j.get("score") and j.get("status") in ("found", "scored")
        ]
        ranked = sorted(open_pool, key=candidate_rank)
        targets = [j["id"] for j in ranked[:deep_top]]
    else:
        targets = [j["id"] for j in jobs if (not only_unscored or _needs_score(j))]

    with _lock:
        _runs[profile] = {"running": bool(targets), "done": 0, "total": len(targets),
                          "current": None, "errors": [], "model": model}
    if not targets:
        return get_state(profile)

    threading.Thread(target=_run, args=(profile, targets, model), daemon=True).start()
    return get_state(profile)


def available_models() -> list[str]:
    try:
        r = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=5.0)
        return [m["name"] for m in r.json().get("models", [])]
    except Exception:
        return []


def best_available_model() -> str:
    """Prefer a model that fits in VRAM; fall back to whatever is installed."""
    have = available_models()
    for m in FALLBACK_MODELS:
        if m in have:
            return m
    return have[0] if have else DEFAULT_MODEL
