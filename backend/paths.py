"""Central path resolution for Mapply.

The data layout lives OUTSIDE the app source so Claude Code and the app share it:

    <workspace>/
      Mapply/            <- app source (this file lives in Mapply/backend/)
      profiles/<Name>/   <- one folder per person
      templates/         <- CV + cover letter templates

Resolved from this file's own location, so renaming the app folder is safe.
MAPPLY_DATA_DIR overrides the workspace root if ever needed.
"""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
# SAPPLY_DATA_DIR is still honoured so an existing shell/env keeps working.
WORKSPACE = Path(
    os.environ.get("MAPPLY_DATA_DIR")
    or os.environ.get("SAPPLY_DATA_DIR")
    or BACKEND_DIR.parent.parent
)

PROFILES_DIR = WORKSPACE / "profiles"
TEMPLATES_DIR = WORKSPACE / "templates"

JOBS_FOUND = "jobs_found"
TAILORED = "tailored"


def profile_dir(name: str) -> Path:
    return PROFILES_DIR / name


def ensure_profile_dirs(name: str) -> Path:
    p = profile_dir(name)
    (p / JOBS_FOUND).mkdir(parents=True, exist_ok=True)
    (p / TAILORED).mkdir(parents=True, exist_ok=True)
    return p
