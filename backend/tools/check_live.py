"""Check that jobs are still open, and optionally remove the ones that aren't.

Run this on a shortlist before tailoring — a packet built for a closed posting
is wasted work.

    .venv\\Scripts\\python.exe tools\\check_live.py --profile Saif --top 20
    .venv\\Scripts\\python.exe tools\\check_live.py --profile Saif --ids a1b2c3 d4e5f6 --remove
    .venv\\Scripts\\python.exe tools\\check_live.py --profile Saif --all --remove

Prints JSON: a per-job verdict plus a summary. Without --remove nothing is
touched. With it, jobs proved closed are marked dismissed — the same reversible
state the Remove button uses, so they leave the list, never come back on a scan,
and can still be restored.

Only `expired` is ever removed. `unknown` (blocked, rate-limited, timed out)
means the board wouldn't tell us, so the job stays. See liveness.py.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import jobs as jobs_mod       # noqa: E402
import liveness               # noqa: E402

OPEN = ("found", "scored")


def run(profile: str, ids: list[str] | None = None, top: int | None = None,
        check_all: bool = False, remove: bool = False, workers: int = 6) -> dict:
    pool = [j for j in jobs_mod.load_jobs(profile) if j.get("status") in OPEN]

    if ids:
        wanted = set(ids)
        targets = [j for j in pool if j.get("id") in wanted]
        missing = sorted(wanted - {j.get("id") for j in targets})
    else:
        missing = []
        targets = sorted(pool, key=lambda j: -((j.get("score") or {}).get("total_100") or -1))
        if not check_all:
            targets = targets[: (top or 20)]

    results = liveness.check_jobs(targets, workers=workers)

    removed = []
    if remove:
        for r in results:
            if r["state"] != "expired":
                continue
            try:
                jobs_mod.update_job(profile, r["id"], {
                    "status": jobs_mod.DISMISSED,
                    "notes": f"Removed automatically — posting is closed ({r['reason']}).",
                })
                removed.append(r["id"])
            except FileNotFoundError:
                r["reason"] += " (file vanished before removal)"

    counts = {"live": 0, "expired": 0, "unknown": 0}
    for r in results:
        counts[r["state"]] += 1

    return {
        "profile": profile,
        "checked": len(results),
        "counts": counts,
        "removed": removed,
        "not_found": missing,
        "jobs": results,
    }


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--profile", default="Saif")
    ap.add_argument("--ids", nargs="*", help="specific job ids to check")
    ap.add_argument("--top", type=int, help="check the N best-scoring open jobs (default 20)")
    ap.add_argument("--all", action="store_true", dest="check_all",
                    help="check every open job — slow, one request each")
    ap.add_argument("--remove", action="store_true",
                    help="dismiss the jobs proved closed")
    ap.add_argument("--workers", type=int, default=6)
    a = ap.parse_args()

    json.dump(run(a.profile, a.ids, a.top, a.check_all, a.remove, a.workers),
              sys.stdout, indent=1, ensure_ascii=False)
    print()


if __name__ == "__main__":
    main()
