"""Scan orchestrator — runs all sources concurrently with per-source status.

One scan at a time per profile. The frontend polls GET /api/profiles/{name}/scan.
"""
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import profiles as profiles_mod
from jobs import existing_ids, existing_index, is_genuine_repost, repost_id, save_job

_lock = threading.Lock()
_scans: dict[str, dict] = {}  # profile -> state


def _blank_state():
    return {"running": False, "started": None, "finished": None, "sources": {}, "totals": {"found": 0, "new": 0, "duplicates": 0}}


def get_state(profile: str) -> dict:
    with _lock:
        return _scans.get(profile) or _blank_state()


def _mark(profile, source, **patch):
    with _lock:
        st = _scans[profile]["sources"].setdefault(
            source, {"status": "pending", "found": 0, "new": 0, "duplicates": 0, "error": None}
        )
        st.update(patch)


def _consume(profile: str, source: str, jobs_iter, seen: set, seen_lock: threading.Lock,
             index: dict | None = None):
    found = new = dup = 0
    index = index if index is not None else {}
    try:
        _mark(profile, source, status="running")
        for job in jobs_iter:
            found += 1
            with seen_lock:
                if job["id"] in seen:
                    # Same role seen again. If the user already acted on it and the
                    # company has re-advertised weeks later, that's a real new
                    # opening — keep it under a repost id instead of dropping it.
                    prior = index.get(job["id"])
                    if prior and is_genuine_repost(job, prior):
                        job["id"] = repost_id(job["id"])
                        job["notes"] = "Re-advertised by the company after a previous application."
                        if job["id"] in seen:
                            dup += 1
                            continue
                        seen.add(job["id"])
                    else:
                        dup += 1
                        continue
                else:
                    seen.add(job["id"])
            save_job(profile, job)
            new += 1
            if found % 5 == 0:
                _mark(profile, source, found=found, new=new, duplicates=dup)
        _mark(profile, source, status="done", found=found, new=new, duplicates=dup)
    except Exception as e:
        traceback.print_exc()
        _mark(profile, source, status="error", error=str(e)[:300], found=found, new=new, duplicates=dup)
    return found, new, dup


# Sources whose search results carry a title and a link but little or no
# description — the detail has to be fetched per posting (or, for NaukriGulf,
# by replaying the search and matching on URL). Their fetchers live in
# backfill.py; running them at the end of every scan is what makes a fresh scan
# complete on its own. A job with no description cannot be scored honestly: the
# deterministic side has nothing to measure and the judge nothing to read.
ENRICH_SOURCES = ["gulftalent", "oracle", "sap", "etihad",
                  "smartrecruiters", "naukrigulf"]


def _enrich(profile: str) -> None:
    """Fill in missing descriptions in place, one source at a time.

    Only touches jobs that are actually missing text, so the cost is
    proportional to what the scan just added rather than to the whole store.
    Never allowed to fail the scan — a source that errors here leaves its jobs
    thin, which is the old behaviour, not a broken run.
    """
    from backfill import backfill

    updated = 0
    _mark(profile, "enrich", status="running")
    for src in ENRICH_SOURCES:
        try:
            res = backfill(profile, src)
            updated += int(res.get("updated") or 0)
            _mark(profile, "enrich", found=updated, new=updated)
        except Exception:
            traceback.print_exc()
    _mark(profile, "enrich", status="done", found=updated, new=updated)


def _run_scan(profile: str, search_terms: list[str]):
    from sources import ats, bigco, gulf, jobspy_source

    # Self-heal before every scan: normalise any non-canonical ids and merge
    # duplicates across jobs_found/ and tailored/. Without this, a job saved
    # under an older id scheme is invisible to `existing_ids` and gets
    # re-added as a "new" job on the next scan.
    try:
        from dedupe import dedupe_profile
        dedupe_profile(profile, apply=True)
    except Exception:
        traceback.print_exc()

    seen = existing_ids(profile)
    index = existing_index(profile)
    seen_lock = threading.Lock()
    # search_terms already covers primary + secondary roles (see start_scan)

    watchlist = profiles_mod.read_yaml(profile, "watchlist.yaml") or {}
    companies = [c for v in watchlist.values() if isinstance(v, list) for c in v if isinstance(c, str)]
    criteria = profiles_mod.read_yaml(profile, "target_criteria.yaml") or {}
    role_kw = []
    for r in (criteria.get("roles", {}).get("primary", []) or []) + (criteria.get("roles", {}).get("secondary", []) or []):
        role_kw.extend(r.replace("/", " ").split())
    role_kw = list({k.lower() for k in role_kw if len(k) > 2})

    tasks = {}
    with ThreadPoolExecutor(max_workers=9) as pool:
        # JobSpy sites. Glassdoor has no UAE coverage; Google Jobs was dropped
        # after repeatedly returning 0 new — everything it surfaced was already
        # coming from Indeed or LinkedIn.
        #
        # LinkedIn used to be capped at the 8 highest-signal terms because it
        # fetches each description in its own request and rate-limits hard. That
        # cap is gone with Tanqeeb: Tanqeeb was mostly re-listing LinkedIn
        # postings, so the terms it covered have to be searched on LinkedIn
        # itself or they are lost. Terms run primary-first, so if LinkedIn does
        # start throttling late in the list the roles that matter most are
        # already in.
        for site in ["indeed", "linkedin"]:
            def make(site=site):
                def run():
                    for term in search_terms:
                        yield from jobspy_source.scrape_site(site, term)
                return run()
            tasks[pool.submit(_consume, profile, site, make(), seen, seen_lock, index)] = site

        # Remote roles doable from the UAE — searched separately so they aren't
        # crowded out by the location-filtered pass.
        def remote_run():
            for term in search_terms[:4]:
                for site in ("indeed", "linkedin"):
                    yield from jobspy_source.scrape_site(site, term, is_remote=True)
        tasks[pool.submit(_consume, profile, "remote", remote_run(), seen, seen_lock, index)] = "remote"

        # Watchlist ATS
        tasks[pool.submit(
            _consume, profile, "watchlist",
            ats.scrape_watchlist(profile, companies, role_kw), seen, seen_lock, index,
        )] = "watchlist"

        # Large employers with their own career platforms (Amazon/AWS, SAP, Microsoft)
        def bigco_run():
            for name, fn in bigco.BIGCO_SOURCES.items():
                try:
                    yield from fn("")          # everything they have in the UAE
                except Exception:
                    continue
        tasks[pool.submit(_consume, profile, "bigco", bigco_run(), seen, seen_lock, index)] = "bigco"

        # Gulf-native boards — search every role term
        for name, fn in (("bayt", gulf.bayt), ("gulftalent", gulf.gulftalent),
                         ("naukrigulf", gulf.naukrigulf)):
            def make_gulf(fn=fn):
                def run():
                    for term in search_terms:
                        yield from fn(term)
                return run()
            tasks[pool.submit(_consume, profile, name, make_gulf(), seen, seen_lock, index)] = name

        for fut in as_completed(tasks):
            f, n, d = fut.result()
            with _lock:
                t = _scans[profile]["totals"]
                t["found"] += f
                t["new"] += n
                t["duplicates"] += d

    # Descriptions last: everything is on disk by now, so this only has to look
    # at what is genuinely thin.
    try:
        _enrich(profile)
    except Exception:
        traceback.print_exc()
        _mark(profile, "enrich", status="error")

    with _lock:
        _scans[profile]["running"] = False
        _scans[profile]["finished"] = datetime.now().isoformat(timespec="seconds")


def start_scan(profile: str) -> dict:
    with _lock:
        if _scans.get(profile, {}).get("running"):
            return _scans[profile]
        criteria = profiles_mod.read_yaml(profile, "target_criteria.yaml") or {}
        roles_cfg = criteria.get("roles") or {}
        # search every configured role, primary first, deduped
        roles = list(dict.fromkeys(
            (roles_cfg.get("primary") or []) + (roles_cfg.get("secondary") or [])
        )) or ["data scientist"]
        state = _blank_state()
        state["running"] = True
        state["started"] = datetime.now().isoformat(timespec="seconds")
        # "enrich" is the description backfill that runs after every source
        # finishes; it is listed here so the scan page shows it as a real phase
        # rather than appearing to stall at the end.
        sources = ["indeed", "linkedin", "remote", "watchlist", "bigco",
                   "bayt", "gulftalent", "naukrigulf", "enrich"]
        state["sources"] = {s: {"status": "pending", "found": 0, "new": 0, "duplicates": 0, "error": None} for s in sources}
        _scans[profile] = state

    t = threading.Thread(target=_run_scan, args=(profile, roles), daemon=True)
    t.start()
    return get_state(profile)
