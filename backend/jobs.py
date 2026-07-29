"""Job file store — one JSON per job, files are the source of truth.

jobs_found/<id>__<company>__<title>.json          (statuses: found, scored)
tailored/<id>__<company>__<title>/job.json        (statuses: tailored .. rejected)
"""
import hashlib
import json
import os
import re
import unicodedata
from datetime import date, datetime
from pathlib import Path

from paths import JOBS_FOUND, TAILORED, profile_dir

STATUSES = ["found", "scored", "tailored", "applied", "replied", "interview", "offer",
            "rejected", "dismissed"]

# "dismissed" = the user removed this job as irrelevant to them. The file stays in
# jobs_found/ on purpose: existing_ids() still sees the id, so the next scan treats
# the posting as already-known and never re-adds it. It is also deliberately NOT in
# ACTED_ON, so a repost of a dismissed role is skipped as a duplicate rather than
# resurfacing. Dismissals are per-profile because everything lives under
# profiles/<Name>/.
DISMISSED = "dismissed"


def _slug(text: str, maxlen: int = 40) -> str:
    text = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    text = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()
    return text[:maxlen] or "x"


def job_id(company: str, title: str, location: str = "") -> str:
    """Stable dedupe key across sources.

    Location is deliberately excluded: the same posting appears on Indeed,
    LinkedIn, Bayt and NaukriGulf with different location strings
    ("Dubai" vs "Dubai, DU, AE" vs "Dubai - United Arab Emirates"), and this
    app only ever searches one country.
    """
    def norm(s: str) -> str:
        s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
        s = re.sub(r"\b(ltd|llc|inc|fz|fze|l\.l\.c|co|company|group|uae|dubai)\b", " ", s.lower())
        return re.sub(r"[^a-z0-9]+", "", s)

    return hashlib.sha1(f"{norm(company)}|{norm(title)}".encode()).hexdigest()[:10]


def revision(profile: str) -> dict:
    """Cheap fingerprint of the job store.

    Scoring and tailoring happen in Claude Code, outside this backend, so the app
    has no event to react to. Polling the full job list would move ~10MB every few
    seconds; this only stats the directories, so the UI can poll it and refetch
    the real list solely when something actually changed.
    """
    root = profile_dir(profile)
    count = 0
    newest = 0.0
    for path in (root / JOBS_FOUND, root / TAILORED):
        if not path.exists():
            continue
        # os.scandir, not iterdir + stat: on Windows the directory enumeration
        # already carries the metadata, so DirEntry.stat() costs nothing, while
        # Path.stat() is a fresh syscall per file. Over ~3.8k jobs that is the
        # difference between ~1.4s and a few milliseconds.
        with os.scandir(path) as entries:
            for entry in entries:
                try:
                    if entry.is_dir():
                        newest = max(newest, os.stat(os.path.join(entry.path, "job.json")).st_mtime)
                    else:
                        newest = max(newest, entry.stat().st_mtime)
                except OSError:
                    continue
                count += 1
    return {"count": count, "mtime": round(newest, 3)}


def job_filename(job: dict) -> str:
    return f"{job['id']}__{_slug(job['company'])}__{_slug(job['title'])}.json"


def new_job(*, title, company, url, source, location="", posted_date=None,
            description="", salary=None, seniority=None, extra=None) -> dict:
    jid = job_id(company, title, location)
    return {
        "id": jid,
        "title": (title or "").strip(),
        "company": (company or "").strip(),
        "location": (location or "").strip(),
        "url": url,
        "source": source,
        "posted_date": posted_date,          # ISO date string or None
        "scraped_date": date.today().isoformat(),
        "description": (description or "").strip(),
        "salary": salary,
        "seniority": seniority,
        "status": "found",
        "score": None,
        "hiring_manager": None,
        "files": {},
        "notes": "",
        **(extra or {}),
    }


def existing_ids(profile: str) -> set[str]:
    ids = set()
    p = profile_dir(profile)
    for f in (p / JOBS_FOUND).glob("*.json"):
        ids.add(f.name.split("__")[0])
    tail = p / TAILORED
    if tail.exists():
        for d in tail.iterdir():
            if d.is_dir():
                ids.add(d.name.split("__")[0])
    return ids


# statuses that mean "I already acted on this posting"
ACTED_ON = {"tailored", "applied", "replied", "interview", "offer", "rejected"}
REPOST_MIN_DAYS = 21


def existing_index(profile: str) -> dict[str, dict]:
    """id -> {status, posted_date} for every job already on disk."""
    index = {}
    for job in load_jobs(profile):
        index[job["id"]] = {
            "status": job.get("status", "found"),
            "posted_date": job.get("posted_date"),
        }
    return index


def is_genuine_repost(new_job: dict, existing: dict) -> bool:
    """True when a company has re-advertised a role the user already acted on.

    Companies repost when they want to hire another person, so this must not be
    silently swallowed as a duplicate. We only treat it as new if the user
    already did something with the old posting AND the new ad is meaningfully
    newer — otherwise it's the same ad seen on another board.
    """
    if existing.get("status") not in ACTED_ON:
        return False
    new_date, old_date = new_job.get("posted_date"), existing.get("posted_date")
    if not new_date or not old_date:
        return False
    try:
        delta = (date.fromisoformat(new_date[:10]) - date.fromisoformat(old_date[:10])).days
    except ValueError:
        return False
    return delta >= REPOST_MIN_DAYS


def repost_id(base_id: str, n: int = 2) -> str:
    return f"{base_id}r{n}"


def save_job(profile: str, job: dict) -> Path:
    f = profile_dir(profile) / JOBS_FOUND / job_filename(job)
    f.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    return f


def load_jobs(profile: str) -> list[dict]:
    """All jobs across jobs_found/ and tailored/."""
    out = []
    p = profile_dir(profile)
    for f in sorted((p / JOBS_FOUND).glob("*.json")):
        try:
            out.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            continue
    tail = p / TAILORED
    if tail.exists():
        for d in sorted(tail.iterdir()):
            jf = d / "job.json"
            if jf.exists():
                try:
                    job = json.loads(jf.read_text(encoding="utf-8"))
                    job["tailored_dir"] = d.name
                    out.append(job)
                except Exception:
                    continue
    return out


def find_job_file(profile: str, jid: str) -> Path | None:
    p = profile_dir(profile)
    for f in (p / JOBS_FOUND).glob(f"{jid}__*.json"):
        return f
    tail = p / TAILORED
    if tail.exists():
        for d in tail.iterdir():
            if d.is_dir() and d.name.startswith(f"{jid}__") and (d / "job.json").exists():
                return d / "job.json"
    return None


def update_job(profile: str, jid: str, patch: dict) -> dict:
    f = find_job_file(profile, jid)
    if not f:
        raise FileNotFoundError(f"Job {jid} not found")
    job = json.loads(f.read_text(encoding="utf-8"))
    job.update(patch)
    f.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    return job


def parse_iso_date(value) -> str | None:
    if not value:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()[:10]
    s = str(value)[:10]
    try:
        return date.fromisoformat(s).isoformat()
    except ValueError:
        return None
