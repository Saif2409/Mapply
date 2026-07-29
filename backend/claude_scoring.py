"""Claude-scored jobs — batch out, judgements back in.

The local 8B model was both slow (9.4h for one pass on a 6GB GPU) and unfair: it
claimed the candidate had no Java for a Java role that is literally in his skills
list. Claude judges instead, but reading 3,780 full postings would be wasteful, so
this module does the measurable work in code and ships Claude only what needs
judgement.

Per job Claude receives: title, company, the seniority/experience-bearing lines of
the posting, and the VERIFIED list of technologies the candidate has and lacks.
Claude returns a skills score and a seniority verdict; everything else
(freshness, location, dealbreakers, preferences) is computed here.

    python claude_scoring.py status  --profile Saif
    python claude_scoring.py batch   --profile Saif --limit 50 --out batch.json
    python claude_scoring.py apply   --profile Saif --in  judged.json
"""
import argparse
import json
import re
import sys
from pathlib import Path

import profiles as profiles_mod
import scoring as sc
from jobs import load_jobs, update_job

MODEL_LABEL = "claude"

# What actually decides the score: how much experience is demanded and which
# skills are required. Culture and benefits copy changes nothing, so STRONG lines
# claim the budget first and WEAK ones only fill what's left.
STRONG_RE = re.compile(
    r"(\d\s*\+?\s*(years|yrs)|years? of experience|require|must have|must be|"
    r"qualification|degree|bachelor|master|phd|proficien|expertise in|"
    r"hands[- ]on|essential|minimum|at least|entry.level|fresh graduate|"
    r"graduate program|junior|senior|lead role)",
    re.I,
)
WEAK_RE = re.compile(
    r"(experience|skill|knowledge of|familiar|responsib|stack|technolog|"
    r"you will|preferred|nice to have|we are looking)",
    re.I,
)

# Boilerplate that survives the filters but carries no decision value.
NOISE_RE = re.compile(
    r"(equal opportunit|we are proud|our mission is|join (us|our team)|"
    r"about (us|the company)|benefits (package|include)|apply now|"
    r"unicorn|customer-centric|own their dreams)",
    re.I,
)


def requirements_extract(job: dict, budget: int = 900) -> str:
    """The decision-bearing part of a posting, within a character budget."""
    desc = re.sub(r"<[^>]+>", " ", job.get("description") or "")
    desc = re.sub(r"&nbsp;|&amp;", " ", desc)
    desc = re.sub(r"\s+", " ", desc).strip()
    if not desc:
        return ""
    if len(desc) <= budget:
        return desc

    sentences = [s.strip() for s in re.split(r"(?<=[.!?;])\s+|\s*[*••\-–]\s+", desc)]
    sentences = [s for s in sentences if 12 <= len(s) <= 400 and not NOISE_RE.search(s)]

    picked, used, seen = [], 0, set()
    for rx in (STRONG_RE, WEAK_RE):
        for s in sentences:
            if s in seen or not rx.search(s):
                continue
            if used + len(s) > budget:
                continue
            seen.add(s)
            picked.append(s)
            used += len(s) + 1
    return " ".join(picked) if picked else desc[:budget]


def _pending(jobs: list[dict], vocab: set[str]) -> list[dict]:
    """Open jobs that still need a Claude score, best candidates first.

    Ranked by the deterministic signals only — never by a previous model's score,
    so a job the old scorer wrongly buried still gets a fair hearing. A run that
    stops early has then still covered the jobs that matter.
    """
    pend = [j for j in jobs if j.get("status") in ("found", "scored") and _needs(j)]

    def rank(j):
        cap, _ = sc.domain_cap(j, vocab)
        sen, _ = sc.seniority_score(j)
        return -(cap * 0.6 + sen * 0.3 + sc.freshness_score(j.get("posted_date")) * 0.1)

    return sorted(pend, key=rank)


def _needs(job: dict) -> bool:
    s = job.get("score")
    return not s or s.get("model") != MODEL_LABEL or \
        int(s.get("scorer_version") or 0) < sc.SCORER_VERSION


def _context(profile: str):
    master = profiles_mod.read_master(profile)
    criteria = profiles_mod.read_yaml(profile, "target_criteria.yaml") or {}
    return master, criteria, sc._vocab(master)


def cmd_status(profile: str) -> dict:
    _, _, vocab = _context(profile)
    jobs = load_jobs(profile)
    pend = _pending(jobs, vocab)
    done = [j for j in jobs if j.get("score") and j["score"].get("model") == MODEL_LABEL]
    return {
        "total_jobs": len(jobs),
        "open": sum(1 for j in jobs if j.get("status") in ("found", "scored")),
        "scored_by_claude": len(done),
        "pending": len(pend),
    }


def cmd_batch(profile: str, limit: int, out: Path) -> dict:
    master, criteria, vocab = _context(profile)
    jobs = load_jobs(profile)
    pend = _pending(jobs, vocab)

    # Jobs in a different profession, or blocked by a dealbreaker, are settled in
    # code — sending them to Claude would spend tokens to confirm a nurse is not a
    # data scientist.
    auto, forward = 0, []
    for j in pend:
        det = sc.deterministic_parts(j, criteria, vocab)
        if det["dealbreaker"] or det["cap"] <= 25.0:
            judged = {
                "requirements_match": int(det["cap"]),
                "matched_skills": [], "missing_skills": [],
                "reasoning": f"Not scored in detail — {det['cap_reason'] or 'dealbreaker'}.",
            }
            update_job(profile, j["id"], {
                "score": sc.compose_score(det, judged, MODEL_LABEL),
                "status": "scored" if j.get("status") == "found" else j.get("status"),
            })
            auto += 1
            continue
        forward.append((j, det))
        if len(forward) >= limit:
            break

    # The candidate digest is ~4.5k chars and identical every time, so it is
    # fetched once via the `candidate` command rather than repeated in all 20+
    # batch files.
    payload = {
        "profile": profile,
        "scale": {
            "requirements_match": "0-100, how well the candidate's evidenced skills "
                                  "meet what THIS posting asks for",
            "seniority_fit": "0-100, how realistically a candidate with ~1 year of "
                             "internship experience and a 2025 BSc could be hired at "
                             "this level. 100 = graduate/entry, 0 = executive. Judge "
                             "the posting's stated demands, not just the job title.",
        },
        "jobs": [
            {
                "id": j["id"],
                "title": j.get("title", ""),
                "company": j.get("company", ""),
                "posted": j.get("posted_date") or "unknown",
                "verified_has": det["has"],
                "verified_lacks": det["lacks"],
                "title_seniority_guess": det["seniority_fit"],
                "requirements": requirements_extract(j) or "(posting has no description)",
            }
            for j, det in forward
        ],
    }
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"batch_written": str(out), "jobs_in_batch": len(forward),
            "auto_scored_in_code": auto, "still_pending": len(pend) - len(forward) - auto}


def cmd_apply(profile: str, path: Path) -> dict:
    _, criteria, vocab = _context(profile)
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data.get("scores") if isinstance(data, dict) else data
    by_id = {j["id"]: j for j in load_jobs(profile)}

    applied, missing, errors = 0, [], []
    for row in rows or []:
        jid = row.get("id")
        job = by_id.get(jid)
        if not job:
            missing.append(jid)
            continue
        try:
            det = sc.deterministic_parts(job, criteria, vocab)
            score = sc.compose_score(det, row, MODEL_LABEL, trust_judge=True)
            update_job(profile, jid, {
                "score": score,
                "status": "scored" if job.get("status") == "found" else job.get("status"),
            })
            applied += 1
        except Exception as e:
            errors.append(f"{jid}: {e}")
    return {"applied": applied, "unknown_ids": missing, "errors": errors}


def main() -> None:
    # UAE listings carry Arabic titles; the default Windows console codepage
    # raises UnicodeEncodeError on them and would kill a run mid-batch.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("status", "candidate", "batch", "apply"):
        p = sub.add_parser(name)
        p.add_argument("--profile", default="Saif")
        if name == "batch":
            p.add_argument("--limit", type=int, default=50)
            p.add_argument("--out", required=True)
        if name == "apply":
            p.add_argument("--in", dest="infile", required=True)
    a = ap.parse_args()

    if a.cmd == "candidate":
        print(sc.profile_digest(profiles_mod.read_master(a.profile)))
        return
    if a.cmd == "status":
        result = cmd_status(a.profile)
    elif a.cmd == "batch":
        result = cmd_batch(a.profile, a.limit, Path(a.out))
    else:
        result = cmd_apply(a.profile, Path(a.infile))
    json.dump(result, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
