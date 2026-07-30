"""Mapply backend — FastAPI service shared by the Electron app and Claude Code.

Run:  .venv/Scripts/python.exe -m uvicorn main:app --port 8710
"""
import json
from datetime import date

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import profiles as profiles_mod
from paths import PROFILES_DIR, ensure_profile_dirs

app = FastAPI(title="Mapply API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True, "profiles_dir": str(PROFILES_DIR)}


# ---------- Profiles ----------

class NewProfile(BaseModel):
    name: str


@app.get("/api/profiles")
def get_profiles():
    return profiles_mod.list_profiles()


@app.post("/api/profiles")
def post_profile(body: NewProfile):
    try:
        return profiles_mod.create_profile(body.name)
    except FileExistsError as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/profiles/{name}/master")
def get_master(name: str):
    try:
        return profiles_mod.read_master(name)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@app.get("/api/profiles/{name}/criteria")
def get_criteria(name: str):
    ensure_profile_dirs(name)
    return profiles_mod.read_yaml(name, "target_criteria.yaml")


@app.get("/api/profiles/{name}/watchlist")
def get_watchlist(name: str):
    return profiles_mod.read_yaml(name, "watchlist.yaml")


class YamlBody(BaseModel):
    content: str


@app.get("/api/profiles/{name}/file/{filename}")
def get_profile_file(name: str, filename: str):
    if filename not in ("target_criteria.yaml", "watchlist.yaml", "master_profile.yaml"):
        raise HTTPException(400, "Not an editable profile file")
    try:
        return {"content": profiles_mod.read_raw(name, filename)}
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@app.put("/api/profiles/{name}/file/{filename}")
def put_profile_file(name: str, filename: str, body: YamlBody):
    # master_profile is intentionally not editable from the app — Claude owns it
    if filename not in ("target_criteria.yaml", "watchlist.yaml"):
        raise HTTPException(400, "Only target_criteria.yaml and watchlist.yaml are editable here")
    try:
        profiles_mod.write_raw(name, filename, body.content)
    except ValueError as e:
        raise HTTPException(400, f"Invalid YAML: {e}")
    return {"ok": True}


# ---------- Jobs & scanning ----------

import jobs as jobs_mod
import scan as scan_mod


# The jobs list is thousands of records and descriptions are ~80% of the bytes,
# while the list only ever renders the first few hundred characters of one. The
# full text stays available from the job detail endpoint.
SUMMARY_DESC_CHARS = 600

# Serving the list means reading every job file (~1s for 4.6k). The page reloads
# on navigation and whenever the watcher sees a change, so the same bytes get
# rebuilt constantly. Cache the rendered JSON against the store's fingerprint —
# the same cheap stat the UI polls — and rebuild only when something moves.
_summary_cache: dict[str, tuple] = {}


@app.get("/api/profiles/{name}/jobs")
def get_jobs(name: str, summary: bool = False):
    if not summary:
        return jobs_mod.load_jobs(name)

    rev = jobs_mod.revision(name)
    key = (rev["count"], rev["mtime"])
    hit = _summary_cache.get(name)
    if hit and hit[0] == key:
        return Response(content=hit[1], media_type="application/json")

    # Build new dicts rather than truncating in place: the loaded rows must stay
    # intact for every other caller.
    rows = [
        {**j, "description": (j.get("description") or "")[:SUMMARY_DESC_CHARS]}
        for j in jobs_mod.load_jobs(name)
    ]
    body = json.dumps(rows, ensure_ascii=False)
    _summary_cache[name] = (key, body)
    return Response(content=body, media_type="application/json")


@app.get("/api/profiles/{name}/jobs/revision")
def get_jobs_revision(name: str):
    """Changes whenever Claude scores or tailors something. The UI polls this
    instead of refetching the whole job list."""
    return jobs_mod.revision(name)


class JobPatch(BaseModel):
    status: str | None = None
    notes: str | None = None
    applied_date: str | None = None


@app.patch("/api/profiles/{name}/jobs/{jid}")
def patch_job(name: str, jid: str, body: JobPatch):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if "status" in patch and patch["status"] not in jobs_mod.STATUSES:
        raise HTTPException(400, f"Invalid status {patch['status']}")
    # stamp the date the moment a job is marked applied — the tracker's
    # follow-up reminders are counted from it
    if patch.get("status") == "applied":
        patch.setdefault("applied_date", date.today().isoformat())
    try:
        return jobs_mod.update_job(name, jid, patch)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@app.get("/api/profiles/{name}/autofill")
def get_autofill(name: str):
    """Flat field map for filling application forms.

    Only the facts a form asks for and the user would type identically every
    time. Judgement answers — salary expectations, "why this company", notice
    period — are deliberately absent: guessing those into a real application is
    worse than leaving them blank.
    """
    try:
        master = profiles_mod.read_master(name)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))

    p = master.get("personal", {}) or {}
    links = p.get("links", {}) or {}
    edu = (master.get("education") or [{}])[0]
    full = (p.get("name") or "").strip()
    first, _, last = full.partition(" ")
    city, _, country = (p.get("location") or "").partition(",")

    return {
        "full_name": full,
        "first_name": first,
        "last_name": last.strip(),
        "email": p.get("email", ""),
        "phone": p.get("phone", ""),
        "location": p.get("location", ""),
        "city": city.strip(),
        "country": country.strip(),
        "linkedin": links.get("linkedin", ""),
        "github": links.get("github", ""),
        "portfolio": links.get("portfolio", "") or links.get("github", ""),
        "university": edu.get("institution", ""),
        "degree": edu.get("degree", ""),
        "graduation_year": str(edu.get("graduation", "")),
        "visa_status": p.get("visa", ""),
        "work_authorised": "Yes" if p.get("visa") else "",
        "needs_sponsorship": "No" if p.get("visa") else "",
        "languages": ", ".join(p.get("languages") or []),
        "driving_license": p.get("driving_license", ""),
    }


class DismissBody(BaseModel):
    ids: list[str]
    restore: bool = False


@app.post("/api/profiles/{name}/jobs/dismiss")
def dismiss_jobs(name: str, body: DismissBody):
    """Remove jobs from this profile's pool (or put them back).

    Nothing is deleted — the job is marked so the next scan recognises it and
    doesn't re-add it. Only ever touches profiles/<name>/, so removing a job as
    Saif leaves Mais's copy untouched.
    """
    # loaded once: the job store is ~3.8k files, so looking each id up inside the
    # loop would re-read all of them per selected job
    by_id = {j["id"]: j for j in jobs_mod.load_jobs(name)}
    changed, skipped = 0, []
    for jid in body.ids:
        job = by_id.get(jid)
        if job is None:
            skipped.append(jid)
            continue
        if body.restore:
            if job.get("status") != jobs_mod.DISMISSED:
                skipped.append(jid)
                continue
            # a restored job goes back to scored if it still has a score, else found
            new_status = "scored" if job.get("score") else "found"
        else:
            # only the open pool can be dismissed; tailored/applied jobs belong to
            # the tracker and are not silently thrown away
            if job.get("status") not in ("found", "scored"):
                skipped.append(jid)
                continue
            new_status = jobs_mod.DISMISSED
        jobs_mod.update_job(name, jid, {"status": new_status})
        changed += 1
    return {"changed": changed, "skipped": skipped,
            "action": "restored" if body.restore else "dismissed"}


@app.post("/api/profiles/{name}/scan")
def post_scan(name: str):
    ensure_profile_dirs(name)
    return scan_mod.start_scan(name)


@app.get("/api/profiles/{name}/scan")
def get_scan(name: str):
    return scan_mod.get_state(name)


# ---------- Scoring ----------

import scoring as scoring_mod


class ScoreRequest(BaseModel):
    only_unscored: bool = True
    model: str | None = None
    deep_top: int | None = None   # re-score the N best jobs with the accurate model


@app.post("/api/profiles/{name}/score")
def post_score(name: str, body: ScoreRequest):
    available = scoring_mod.available_models()
    if not available:
        raise HTTPException(503, "Ollama isn't running — start it, then try Score Me again.")

    if body.deep_top:
        model = body.model or scoring_mod.DEEP_MODEL
        if model not in available:
            model = scoring_mod.best_available_model()
    else:
        model = body.model or scoring_mod.best_available_model()

    if model not in available:
        raise HTTPException(400, f"Model '{model}' not in Ollama. Available: {', '.join(available)}")
    return scoring_mod.start_scoring(
        name, only_unscored=body.only_unscored, model=model, deep_top=body.deep_top
    )


@app.get("/api/profiles/{name}/score")
def get_score(name: str):
    return scoring_mod.get_state(name)


@app.get("/api/models")
def get_models():
    return {"models": scoring_mod.available_models(), "default": scoring_mod.DEFAULT_MODEL}


# ---------- Tailored documents ----------

from fastapi.responses import FileResponse
from paths import TAILORED, profile_dir


@app.get("/api/profiles/{name}/jobs/{jid}/files")
def list_job_files(name: str, jid: str):
    """Everything Claude produced for this job, with display names."""
    folder = None
    tail = profile_dir(name) / TAILORED
    if tail.exists():
        for d in tail.iterdir():
            if d.is_dir() and d.name.startswith(f"{jid}__"):
                folder = d
                break
    if not folder:
        return {"files": []}

    label = {
        ".pdf": "PDF",
        ".md": "Markdown",
        ".html": "HTML",
    }
    out = []
    for f in sorted(folder.iterdir()):
        if f.name == "job.json" or f.is_dir():
            continue
        out.append({
            "name": f.name,
            "kind": ("resume" if "resume" in f.name.lower()
                     else "cover_letter" if "cover" in f.name.lower()
                     else "outreach" if "outreach" in f.name.lower()
                     else "other"),
            "format": label.get(f.suffix.lower(), f.suffix.lstrip(".").upper()),
            "size": f.stat().st_size,
            "path": str(f),
            "url": f"/api/profiles/{name}/jobs/{jid}/files/{f.name}",
        })
    return {"files": out, "folder": str(folder)}


@app.get("/api/profiles/{name}/jobs/{jid}/files/{filename}")
def get_job_file(name: str, jid: str, filename: str, download: bool = False):
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Invalid filename")
    tail = profile_dir(name) / TAILORED
    for d in (tail.iterdir() if tail.exists() else []):
        if d.is_dir() and d.name.startswith(f"{jid}__"):
            f = d / filename
            if f.exists():
                return FileResponse(
                    f,
                    filename=filename if download else None,
                    media_type=None if download else (
                        "application/pdf" if f.suffix.lower() == ".pdf" else "text/plain"
                    ),
                )
    raise HTTPException(404, "File not found")


# ---------- Hiring manager ----------

import hiring_manager as hm_mod


@app.get("/api/profiles/{name}/jobs/{jid}/hiring-manager")
def get_hiring_manager(name: str, jid: str):
    job = next((j for j in jobs_mod.load_jobs(name) if j["id"] == jid), None)
    if not job:
        raise HTTPException(404, "Job not found")
    return hm_mod.suggest(job)


class ContactPatch(BaseModel):
    name: str | None = None
    title: str | None = None
    profile_url: str | None = None
    email: str | None = None


@app.post("/api/profiles/{name}/jobs/{jid}/hiring-manager")
def save_hiring_manager(name: str, jid: str, body: ContactPatch):
    try:
        return jobs_mod.update_job(name, jid, {"hiring_manager": body.model_dump(exclude_none=True)})
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
