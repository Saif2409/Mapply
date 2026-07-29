"""Profile management: list, create, read master profiles."""
import re
from pathlib import Path

import yaml

from paths import PROFILES_DIR, JOBS_FOUND, TAILORED, ensure_profile_dirs, profile_dir

MASTER_TEMPLATE = """\
# ============================================================
# MASTER PROFILE — {name}
# Single source of truth for Mapply. Fill this in with Claude:
# open Claude Code and say "set up my profile" — or edit by hand.
# Tailoring may only SELECT from this file, never invent.
# ============================================================

personal:
  name: {name}
  email: TODO
  phone: "TODO"
  location: TODO
  visa: TODO
  languages: []
  links:
    linkedin: TODO
    github: TODO

summary_base: >
  TODO — 3-4 sentence professional summary.

education: []

experience: []
  # - company: ...
  #   location: ...
  #   title: ...
  #   start: YYYY-MM
  #   end: YYYY-MM
  #   keywords: []
  #   bullets: []

projects: []
  # - name: ...
  #   tier: flagship | supporting
  #   context: ...
  #   repo: ...
  #   keywords: []
  #   bullets: []

publications: []
certifications: []
awards: []

skills: {{}}
  # category_name: [skill, skill, ...]
"""

CRITERIA_TEMPLATE = """\
# Target criteria — what Mapply scores every job against.
roles:
  primary: []
  secondary: []
seniority: [Graduate, Junior, Entry-level]
locations: []
salary_floor_aed_month: null
visa_status: TODO
dealbreakers: []
preferences: []
"""

WATCHLIST_TEMPLATE = """\
# Company watchlist — Mapply polls these companies' career sites directly.
companies: []
"""


def safe_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 _-]", "", name).strip()
    return cleaned[:40]


def profile_stats(p: Path) -> dict:
    jobs_found = len(list((p / JOBS_FOUND).glob("*.json"))) if (p / JOBS_FOUND).exists() else 0
    tailored_dir = p / TAILORED
    tailored = len([d for d in tailored_dir.iterdir() if d.is_dir()]) if tailored_dir.exists() else 0
    applied = 0
    if tailored_dir.exists():
        for d in tailored_dir.iterdir():
            jf = d / "job.json"
            if jf.exists():
                try:
                    import json
                    status = json.loads(jf.read_text(encoding="utf-8")).get("status", "")
                    if status in ("applied", "replied", "interview", "offer", "rejected"):
                        applied += 1
                except Exception:
                    pass
    return {"jobs_found": jobs_found, "tailored": tailored, "applied": applied}


def list_profiles() -> list[dict]:
    if not PROFILES_DIR.exists():
        return []
    out = []
    for p in sorted(PROFILES_DIR.iterdir()):
        if not p.is_dir():
            continue
        master = p / "master_profile.yaml"
        if not master.exists():
            continue
        display = p.name
        complete = True
        try:
            data = yaml.safe_load(master.read_text(encoding="utf-8")) or {}
            display = (data.get("personal") or {}).get("name") or p.name
            complete = (data.get("personal") or {}).get("email") not in (None, "TODO")
        except Exception:
            complete = False
        out.append({
            "id": p.name,
            "name": display,
            "complete": complete,
            "stats": profile_stats(p),
        })
    return out


def create_profile(name: str) -> dict:
    name = safe_name(name)
    if not name:
        raise ValueError("Invalid profile name")
    p = profile_dir(name)
    if p.exists():
        raise FileExistsError(f"Profile '{name}' already exists")
    ensure_profile_dirs(name)
    (p / "master_profile.yaml").write_text(MASTER_TEMPLATE.format(name=name), encoding="utf-8")
    (p / "target_criteria.yaml").write_text(CRITERIA_TEMPLATE, encoding="utf-8")
    (p / "watchlist.yaml").write_text(WATCHLIST_TEMPLATE, encoding="utf-8")
    return {"id": name, "name": name, "complete": False,
            "stats": {"jobs_found": 0, "tailored": 0, "applied": 0}}


def read_master(name: str) -> dict:
    master = profile_dir(name) / "master_profile.yaml"
    if not master.exists():
        raise FileNotFoundError(f"No master profile for '{name}'")
    return yaml.safe_load(master.read_text(encoding="utf-8")) or {}


def read_yaml(name: str, filename: str) -> dict:
    f = profile_dir(name) / filename
    if not f.exists():
        return {}
    return yaml.safe_load(f.read_text(encoding="utf-8")) or {}


def read_raw(name: str, filename: str) -> str:
    f = profile_dir(name) / filename
    if not f.exists():
        raise FileNotFoundError(f"{filename} not found for '{name}'")
    return f.read_text(encoding="utf-8")


def write_raw(name: str, filename: str, content: str) -> None:
    """Validate then write. Never persist YAML that won't parse."""
    try:
        yaml.safe_load(content)
    except yaml.YAMLError as e:
        # surface the line/column YAML reports so the editor can show it
        raise ValueError(str(e).replace("\n", " ")[:300]) from e
    (profile_dir(name) / filename).write_text(content, encoding="utf-8")
