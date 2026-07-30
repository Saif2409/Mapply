"""One-time cleanup: recompute job ids and merge duplicates.

Duplicates exist because the id scheme changed during development (it used to
include the location string, which differs per source for the same posting).

Merge rule: keep the richest copy — a scored one beats an unscored one, a longer
description beats a shorter one, an earlier scrape date wins ties.
"""
import json
import re
import sys
from pathlib import Path

from jobs import JOBS_FOUND, job_filename, job_id
from paths import JOBS_FOUND as _JF, TAILORED, profile_dir


def richness(job: dict) -> tuple:
    return (
        1 if job.get("score") else 0,
        len(job.get("description") or ""),
        1 if job.get("posted_date") else 0,
        -len(job.get("scraped_date") or "9999"),
    )


def dedupe_profile(profile: str, apply: bool = False) -> dict:
    """Normalise ids across BOTH folders and drop duplicates.

    Tailored jobs must be included: one created under an older id scheme keeps a
    stale id, so `existing_ids()` never matches a fresh scrape of the same role
    and the job reappears in the open pool.
    """
    root = profile_dir(profile)
    folder = root / JOBS_FOUND
    tailored_root = root / TAILORED

    groups: dict[str, list[tuple[Path, dict, bool]]] = {}   # (path, job, is_tailored)

    for f in folder.glob("*.json"):
        try:
            job = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        canonical = job_id(job.get("company", ""), job.get("title", ""))
        groups.setdefault(canonical, []).append((f, job, False))

    if tailored_root.exists():
        for d in tailored_root.iterdir():
            jf = d / "job.json"
            if not d.is_dir() or not jf.exists():
                continue
            try:
                job = json.loads(jf.read_text(encoding="utf-8"))
            except Exception:
                continue
            canonical = job_id(job.get("company", ""), job.get("title", ""))
            groups.setdefault(canonical, []).append((jf, job, True))

    removed = renamed = retagged = 0
    for canonical, entries in groups.items():
        # a tailored copy always wins — it has real work attached to it
        entries.sort(key=lambda e: (e[2], richness(e[1])), reverse=True)
        keep_path, keep_job, keep_tailored = entries[0]

        for path, _, is_tailored in entries[1:]:
            if apply:
                if is_tailored:
                    continue           # never delete a tailored packet
                path.unlink(missing_ok=True)
            removed += 1

        if keep_job.get("id") != canonical:
            retagged += 1
        keep_job["id"] = canonical

        if keep_tailored:
            # rewrite job.json; leave the folder name alone (paths are resolved
            # by id prefix, and the app links to files inside it)
            if apply:
                keep_path.write_text(
                    json.dumps(keep_job, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                folder_dir = keep_path.parent
                want = f"{canonical}__" + folder_dir.name.split("__", 1)[1]
                if folder_dir.name != want:
                    target_dir = folder_dir.parent / want
                    if not target_dir.exists():
                        folder_dir.rename(target_dir)
                        renamed += 1
            continue

        target = folder / job_filename(keep_job)
        if apply:
            keep_path.write_text(json.dumps(keep_job, ensure_ascii=False, indent=2), encoding="utf-8")
            if keep_path.name != target.name:
                if target.exists() and target != keep_path:
                    target.unlink()
                keep_path.rename(target)
        if keep_path.name != target.name:
            renamed += 1

    removed += _dedupe_by_url(folder, tailored_root, apply)

    return {"groups": len(groups), "removed": removed,
            "renamed": renamed, "id_retagged": retagged}


def _norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (t or "").lower())


def _dedupe_by_url(folder: Path, tailored_root: Path, apply: bool) -> int:
    """Second pass: same apply link AND same title means the same job.

    The company+title key can't catch these. Bayt lists a role twice — once under
    the recruitment agency and once under the direct employer — so the company
    differs while the posting is identical. Verified against the source page: the
    parser reads both correctly, the two attributions are Bayt's own.

    The title must match too. Emirates and Oracle put genuinely different
    vacancies behind one generic application URL, and collapsing those would lose
    real jobs.
    """
    groups: dict[tuple, list[tuple[Path, dict, bool]]] = {}

    for f in folder.glob("*.json"):
        try:
            job = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        url = (job.get("url") or "").strip().rstrip("/")
        if url:
            groups.setdefault((url, _norm_title(job.get("title"))), []).append((f, job, False))

    if tailored_root.exists():
        for d in tailored_root.iterdir():
            jf = d / "job.json"
            if not (d.is_dir() and jf.exists()):
                continue
            try:
                job = json.loads(jf.read_text(encoding="utf-8"))
            except Exception:
                continue
            url = (job.get("url") or "").strip().rstrip("/")
            if url:
                groups.setdefault((url, _norm_title(job.get("title"))), []).append((jf, job, True))

    removed = 0
    for entries in groups.values():
        if len(entries) < 2:
            continue
        entries.sort(key=lambda e: (e[2], richness(e[1])), reverse=True)
        for path, _, is_tailored in entries[1:]:
            if is_tailored:
                continue                      # never delete a tailored packet
            if apply:
                path.unlink(missing_ok=True)
            removed += 1
    return removed


if __name__ == "__main__":
    prof = sys.argv[1] if len(sys.argv) > 1 else "Saif"
    apply = "--apply" in sys.argv
    stats = dedupe_profile(prof, apply=apply)
    print(f"{'APPLIED' if apply else 'DRY RUN'}: {stats}")
