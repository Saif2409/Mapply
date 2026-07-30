"""Enrich jobs that were saved without a description — one source at a time.

A full scan takes ~30 minutes because LinkedIn rate-limits every description
fetch. This touches only the jobs that are actually missing data, so fixing
Tanqeeb costs a couple of minutes instead of rescanning nine sources.

    .venv\\Scripts\\python.exe backfill.py --profile Saif --source tanqeeb
    .venv\\Scripts\\python.exe backfill.py --profile Saif --source tanqeeb --dry-run

Why it matters: a job with no description can't be scored honestly. The
deterministic side has nothing to measure and the judge has nothing to read, so
it lands on a neutral score regardless of whether it's a perfect fit.
"""
import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor

from paths import JOBS_FOUND, profile_dir

# source -> callable(url) returning a dict of fields to merge, or None
FETCHERS = {}


def _load_fetchers():
    from sources import gulf

    FETCHERS["tanqeeb"] = gulf.tanqeeb_detail
    FETCHERS["gulftalent"] = gulf._gulftalent_detail


def needs_backfill(job: dict) -> bool:
    return not (job.get("description") or "").strip()


def backfill(profile: str, source: str, limit: int | None = None,
             dry_run: bool = False, workers: int = 6) -> dict:
    _load_fetchers()
    fetch = FETCHERS.get(source)
    if not fetch:
        return {"error": f"no detail fetcher for '{source}'. Have: {sorted(FETCHERS)}"}

    folder = profile_dir(profile) / JOBS_FOUND
    targets = []
    for f in folder.glob("*.json"):
        try:
            job = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        if job.get("source") == source and needs_backfill(job) and job.get("url"):
            targets.append((f, job))
    if limit:
        targets = targets[:limit]

    if dry_run:
        return {"source": source, "would_fetch": len(targets)}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        details = list(pool.map(lambda t: fetch(t[1]["url"]), targets))

    updated = failed = 0
    for (path, job), det in zip(targets, details):
        if not det or not (det.get("description") or "").strip():
            failed += 1
            continue
        job["description"] = det["description"]
        # The listing card usually credits the recruitment agency; the posting
        # itself names the actual employer, which is what should be on the CV.
        if det.get("company"):
            job["company"] = det["company"]
        if det.get("title"):
            job["title"] = det["title"]
        if det.get("posted_date"):
            job["posted_date"] = det["posted_date"]
        if det.get("closes"):
            job["closes"] = det["closes"]
        path.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
        updated += 1

    return {"source": source, "checked": len(targets), "updated": updated, "no_detail": failed}


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--profile", default="Saif")
    ap.add_argument("--source", required=True)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    json.dump(backfill(a.profile, a.source, a.limit, a.dry_run), sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
