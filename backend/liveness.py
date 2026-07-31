"""Is this posting still open?

Tailoring a CV for a job that closed two weeks ago costs a real packet's worth
of work and produces something that can never be sent, so the shortlist gets
checked before any of it starts.

The rule throughout is **only remove on positive evidence**. A board that blocks
the request, rate-limits, times out or hides the posting behind a login wall
tells us nothing about whether the job is open — those come back `unknown` and
are left alone. Three things count as proof it is closed:

  * `closes` (the schema.org validThrough deadline) is in the past — no network
    call needed;
  * the URL answers 404 or 410;
  * the page loads but says so in words ("no longer accepting applications").

Indeed and LinkedIn both sit behind bot protection, so expect a good share of
`unknown` from them. That is the safe direction to be wrong in.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from urllib.parse import urlsplit

from curl_cffi import requests as cr

TIMEOUT = 20
IMPERSONATE = "chrome"

# Phrases that only appear once a posting is closed. Kept narrow and specific on
# purpose: a marker that also shows up on a live page would silently throw away
# good jobs, which is far worse than missing a dead one.
DEAD_MARKERS = (
    "no longer accepting applications",
    "no longer accepting application",
    "this job is no longer available",
    "this job posting is no longer available",
    "this job has expired",
    "this job ad has expired",
    "job posting has expired",
    "this posting has expired",
    "the position has been filled",
    "this position is no longer open",
    "this position has been closed",
    "this vacancy is closed",
    "applications for this job are closed",
    "job is not available anymore",
    "sorry, this job is no longer",
    "لم تعد هذه الوظيفة متاحة",
)

# A live posting always has a deep path. Landing on the site root or its generic
# search page after redirects means the posting was taken down and the board
# bounced us to a listing.
BOUNCE_PATHS = ("", "/", "/jobs", "/jobs/", "/search", "/jobs/search")


def _final_path(response) -> str:
    url = getattr(response, "url", "") or ""
    return urlsplit(str(url)).path.rstrip() or "/"


def check_url(url: str) -> tuple[str, str]:
    """-> (state, reason) where state is live | expired | unknown."""
    if not url:
        return "unknown", "no url"
    try:
        r = cr.get(url, impersonate=IMPERSONATE, timeout=TIMEOUT, allow_redirects=True)
    except Exception as e:
        return "unknown", f"fetch failed: {type(e).__name__}"

    if r.status_code in (404, 410):
        return "expired", f"HTTP {r.status_code}"
    if r.status_code != 200:
        # 403/429 is the board refusing us, not the employer closing the role
        return "unknown", f"HTTP {r.status_code}"

    started_deep = len(urlsplit(url).path.strip("/").split("/")) > 1
    if started_deep and _final_path(r).lower() in BOUNCE_PATHS:
        return "expired", "redirected off the posting"

    body = (r.text or "").lower()
    for marker in DEAD_MARKERS:
        if marker in body:
            return "expired", f'page says "{marker}"'

    if not body.strip():
        return "unknown", "empty response"
    return "live", f"HTTP 200, {len(body)} bytes"


def check_job(job: dict) -> dict:
    """Liveness of one job dict. Cheap checks first — a passed deadline is
    certain and free, so it never reaches the network."""
    closes = job.get("closes")
    if closes:
        try:
            if date.fromisoformat(str(closes)[:10]) < date.today():
                return {"id": job.get("id"), "state": "expired",
                        "reason": f"deadline passed ({closes})",
                        "title": job.get("title"), "company": job.get("company")}
        except ValueError:
            pass

    state, reason = check_url(job.get("url") or "")
    return {"id": job.get("id"), "state": state, "reason": reason,
            "title": job.get("title"), "company": job.get("company")}


def check_jobs(jobs: list[dict], workers: int = 6) -> list[dict]:
    """One request per job, in parallel. Order matches the input."""
    if not jobs:
        return []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(check_job, jobs))
