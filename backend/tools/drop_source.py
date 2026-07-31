"""Retire a job board: dismiss everything still open from that source.

Used when a board is removed from the scanner. Dismissing rather than deleting
is deliberate — the file stays in jobs_found/, so `existing_ids()` still knows
the posting and nothing re-adds it if the same role turns up elsewhere under a
different id scheme later.

    .venv\\Scripts\\python.exe tools\\drop_source.py --source tanqeeb --dry-run
    .venv\\Scripts\\python.exe tools\\drop_source.py --source tanqeeb

Only `found` and `scored` jobs are touched. Anything already tailored or applied
belongs to the Tracker and is left exactly where it is — the board going away
says nothing about an application already in flight.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import jobs as jobs_mod                                    # noqa: E402
from paths import JOBS_FOUND, PROFILES_DIR, profile_dir    # noqa: E402

OPEN = ("found", "scored")


def drop_source(profile: str, source: str, dry_run: bool = False) -> dict:
    folder = profile_dir(profile) / JOBS_FOUND
    if not folder.exists():
        return {"profile": profile, "error": "no jobs_found folder"}

    dismissed, kept = 0, 0
    for f in folder.glob("*.json"):
        try:
            job = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        if job.get("source") != source:
            continue
        if job.get("status") not in OPEN:
            kept += 1
            continue
        if not dry_run:
            job["status"] = jobs_mod.DISMISSED
            job["notes"] = (job.get("notes") or "") + (
                f"\nRemoved with the {source} source." if job.get("notes")
                else f"Removed with the {source} source."
            )
            f.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
        dismissed += 1

    return {"profile": profile, "source": source,
            "dismissed": dismissed, "left_alone": kept, "dry_run": dry_run}


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", required=True)
    ap.add_argument("--profile", help="default: every profile")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    profiles = [a.profile] if a.profile else sorted(
        d.name for d in PROFILES_DIR.iterdir() if d.is_dir()
    )
    for p in profiles:
        json.dump(drop_source(p, a.source, a.dry_run), sys.stdout, indent=1)
        print()


if __name__ == "__main__":
    main()
