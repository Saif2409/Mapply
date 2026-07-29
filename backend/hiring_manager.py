"""Hiring-manager finder.

Deliberately does NOT scrape LinkedIn (account-ban risk). Instead it:
  1. reads any recruiter/contact info the ATS itself exposes in the job data, and
  2. builds ranked LinkedIn people-search URLs the user can open in one click.

Claude drafts the actual outreach message during tailoring.
"""
import re
from urllib.parse import quote

TITLE_HINTS = [
    "Talent Acquisition",
    "Technical Recruiter",
    "Recruiter",
    "Head of Talent",
    "Hiring Manager",
]

# role-family → the manager title most likely to own the req
ROLE_FAMILIES = [
    (r"\b(machine learning|ml engineer|ai engineer|deep learning)\b", "Head of Machine Learning"),
    (r"\b(data scien(ce|tist))\b", "Head of Data Science"),
    (r"\b(data analyst|business intelligence|bi )\b", "Head of Analytics"),
    (r"\b(data engineer|etl|pipeline)\b", "Head of Data Engineering"),
    (r"\b(mlops|platform)\b", "Head of ML Platform"),
    (r"\b(software|backend|full[- ]?stack)\b", "Engineering Manager"),
]


def _people_search(company: str, keywords: str) -> str:
    q = quote(f'{company} {keywords}')
    return f"https://www.linkedin.com/search/results/people/?keywords={q}"


def suggest(job: dict) -> dict:
    """Return contact hints + ranked LinkedIn search URLs for a job."""
    company = (job.get("company") or "").strip()
    title = (job.get("title") or "").lower()
    desc = job.get("description") or ""

    searches = []
    if company:
        # 1) the manager who most likely owns this specific role
        for pattern, mgr_title in ROLE_FAMILIES:
            if re.search(pattern, title):
                searches.append({"label": mgr_title, "url": _people_search(company, mgr_title)})
                break
        # 2) recruiters / talent acquisition at that company
        for hint in TITLE_HINTS[:3]:
            searches.append({"label": hint, "url": _people_search(company, hint)})

    # emails that appear in the posting itself (some ATS/JDs include them)
    emails = sorted(set(re.findall(r"[\w.+-]+@[\w-]+\.[\w.]{2,}", desc)))
    emails = [e for e in emails if not e.lower().endswith((".png", ".jpg"))][:3]

    # a named contact mentioned in the description
    named = None
    m = re.search(
        r"(?:contact|reach out to|report(?:ing)? to)\s+([A-Z][a-z]+ [A-Z][a-z]+)", desc
    )
    if m:
        named = m.group(1)

    return {
        "company": company,
        "searches": searches,
        "emails_in_posting": emails,
        "named_contact": named,
        "note": "Open a search, find the person, then save their name — Claude drafts the message during tailoring.",
    }
