"""ATS watchers — poll watchlist companies' public career APIs directly.

Auto-detects which ATS a company uses (Greenhouse, Lever, Ashby) by probing
public endpoints with likely slugs, and caches the detection in
profiles/<name>/.ats_cache.json so later scans are instant.
"""
import json
import re
from html import unescape

import httpx

from jobs import new_job, parse_iso_date
from paths import profile_dir

TIMEOUT = 15.0
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sapply/0.1"}

# Verified mappings — probed and confirmed to return real UAE/Gulf postings.
# Format: company name (as in watchlist.yaml) -> (ats, slug)
KNOWN_ATS = {
    "Careem": ("greenhouse", "careem"),
    "Tamara": ("greenhouse", "tamara"),
    "Aldar": ("lever", "aldar"),
    "Ziina": ("ashby", "ziina"),
    "talabat": ("smartrecruiters", "DeliveryHero"),   # talabat is Delivery Hero group
    "Deliveroo": ("ashby", "deliveroo"),
    "Thoughtworks": ("greenhouse", "thoughtworks"),
    "Databricks": ("greenhouse", "databricks"),
    "Snowflake": ("ashby", "snowflake"),
    "MongoDB": ("greenhouse", "mongodb"),
    "Cloudflare": ("greenhouse", "cloudflare"),
    "Stripe": ("greenhouse", "stripe"),
    "OKX": ("greenhouse", "okx"),
    "Palantir": ("smartrecruiters", "palantir"),
    "BCG": ("greenhouse", "bcg"),
}

# Location filter. Saif is UAE-based and open to remote roles he can do from the UAE.
UAE_HINTS = (
    "uae", "united arab emirates", "u.a.e", "dubai", "abu dhabi", "sharjah",
    "ajman", "fujairah", "ras al khaimah", "umm al quwain", "emirates",
    "middle east", "mena", "gcc",
)
REMOTE_HINTS = ("remote", "anywhere", "work from home", "distributed", "global")


def location_ok(loc: str) -> bool:
    """Keep UAE jobs, remote jobs, and postings with no stated location."""
    l = (loc or "").lower().strip()
    if not l:
        return True
    if any(h in l for h in UAE_HINTS):
        return True
    if any(h in l for h in REMOTE_HINTS):
        # exclude region-locked remote roles that clearly exclude the UAE
        blocked = ("remote - us", "us only", "usa only", "uk only", "eu only",
                   "us/uk/eu", "united states only", "canada only", "india only")
        return not any(b in l for b in blocked)
    return False


def _slugs(company: str) -> list[str]:
    """Candidate slugs. The bare first word is deliberately excluded — it matches
    unrelated companies (greenhouse/'air' is a Pittsburgh startup, not Air Arabia)."""
    base = re.sub(r"\(.*?\)", "", company).strip().lower()
    base = re.sub(r"[^a-z0-9 &-]", "", base)
    words = base.replace("&", "and").split()
    cands = ["".join(words), "-".join(words)]
    return [c for c in dict.fromkeys(cands) if c and len(c) > 2]


def _strip_html(s: str) -> str:
    s = re.sub(r"<br\s*/?>|</p>|</li>", "\n", s or "", flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    return unescape(s).strip()


# ---------- per-ATS fetchers ----------

def greenhouse(slug: str, client: httpx.Client):
    r = client.get(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true")
    if r.status_code != 200:
        return None
    jobs = r.json().get("jobs", [])
    return [
        dict(
            title=j.get("title"),
            url=j.get("absolute_url"),
            location=(j.get("location") or {}).get("name", ""),
            posted=parse_iso_date(j.get("updated_at") or j.get("first_published")),
            description=_strip_html(j.get("content", ""))[:20000],
        )
        for j in jobs
    ]


def lever(slug: str, client: httpx.Client):
    r = client.get(f"https://api.lever.co/v0/postings/{slug}?mode=json")
    if r.status_code != 200:
        return None
    data = r.json()
    if not isinstance(data, list):
        return None
    out = []
    for j in data:
        ts = j.get("createdAt")
        posted = None
        if ts:
            from datetime import datetime, timezone
            posted = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).date().isoformat()
        out.append(dict(
            title=j.get("text"),
            url=j.get("hostedUrl"),
            location=(j.get("categories") or {}).get("location", ""),
            posted=posted,
            description=_strip_html(j.get("descriptionPlain") or j.get("description") or "")[:20000],
        ))
    return out


def ashby(slug: str, client: httpx.Client):
    r = client.get(f"https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true")
    if r.status_code != 200:
        return None
    jobs = r.json().get("jobs", [])
    return [
        dict(
            title=j.get("title"),
            url=j.get("jobUrl") or j.get("applyUrl"),
            location=j.get("location") or "",
            posted=parse_iso_date(j.get("publishedAt")),
            description=_strip_html(j.get("descriptionHtml") or "")[:20000],
        )
        for j in jobs
    ]


def smartrecruiters(slug: str, client: httpx.Client):
    """SmartRecruiters public postings API (paginated, 100/page)."""
    out = []
    offset = 0
    while offset < 400:  # cap: 4 pages is plenty after location filtering
        r = client.get(
            f"https://api.smartrecruiters.com/v1/companies/{slug}/postings",
            params={"limit": 100, "offset": offset},
        )
        if r.status_code != 200:
            return None if offset == 0 else out
        data = r.json()
        content = data.get("content") or []
        if not content:
            break
        for j in content:
            loc = j.get("location") or {}
            city = ", ".join(x for x in [loc.get("city"), loc.get("country")] if x)
            out.append(dict(
                title=j.get("name"),
                url=j.get("ref") and f"https://jobs.smartrecruiters.com/{slug}/{j.get('id')}",
                location=city,
                posted=parse_iso_date(j.get("releasedDate")),
                description="",  # detail endpoint per job is expensive; JD fetched on demand
            ))
        offset += 100
        if offset >= (data.get("totalFound") or 0):
            break
    # A valid company with zero postings is indistinguishable from a bad slug here,
    # so treat empty as "not detected".
    return out or None


def workday(spec: str, client: httpx.Client):
    """Workday CxS API. `spec` must be 'tenant/site' (no guessing — configure explicitly)."""
    if "/" not in spec:
        return None
    tenant, site = spec.split("/", 1)
    out = []
    for wd in ("wd3", "wd1", "wd5", "wd103"):
        url = f"https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs"
        try:
            r = client.post(url, json={"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": ""})
        except httpx.HTTPError:
            continue
        if r.status_code != 200:
            continue
        for j in r.json().get("jobPostings", []):
            path = j.get("externalPath") or ""
            out.append(dict(
                title=j.get("title"),
                url=f"https://{tenant}.{wd}.myworkdayjobs.com/en-US/{site}{path}",
                location=j.get("locationsText") or "",
                posted=None,
                description="",
            ))
        if out:
            return out
    return None


def recruitee(slug: str, client: httpx.Client):
    r = client.get(f"https://{slug}.recruitee.com/api/offers/")
    if r.status_code != 200:
        return None
    out = []
    for j in r.json().get("offers", []):
        city = ", ".join(x for x in [j.get("city"), j.get("country")] if x)
        out.append(dict(
            title=j.get("title"),
            url=j.get("careers_url") or j.get("careers_apply_url"),
            location=city or j.get("location") or "",
            posted=parse_iso_date(j.get("published_at")),
            description=_strip_html(j.get("description") or "")[:20000],
        ))
    return out or None


ATS_FETCHERS = {
    "greenhouse": greenhouse,
    "lever": lever,
    "ashby": ashby,
    "recruitee": recruitee,
    "smartrecruiters": smartrecruiters,
}
ALL_FETCHERS = {**ATS_FETCHERS, "workday": workday}


# ---------- detection + scan ----------

def _cache_path(profile: str):
    return profile_dir(profile) / ".ats_cache.json"


def _load_cache(profile: str) -> dict:
    p = _cache_path(profile)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_cache(profile: str, cache: dict):
    _cache_path(profile).write_text(json.dumps(cache, indent=2), encoding="utf-8")


def parse_entry(entry: str) -> tuple[str, str | None, str | None]:
    """A watchlist entry may pin its ATS: 'Company | greenhouse:slug' or 'Company | workday:tenant/site'."""
    if "|" in entry:
        name, spec = entry.split("|", 1)
        spec = spec.strip()
        if ":" in spec:
            ats, slug = spec.split(":", 1)
            return name.strip(), ats.strip().lower(), slug.strip()
        return name.strip(), None, None
    return entry.strip(), None, None


def detect(company: str, client: httpx.Client, cache: dict):
    """Return (ats, slug) or (None, None); uses/updates cache."""
    if company in KNOWN_ATS:
        return KNOWN_ATS[company]
    if company in cache:
        entry = cache[company]
        if entry is None:
            return None, None
        return entry["ats"], entry["slug"]
    for slug in _slugs(company):
        for ats, fetch in ATS_FETCHERS.items():
            try:
                res = fetch(slug, client)
            except httpx.HTTPError:
                continue
            # A slug only counts if the board actually carries UAE/remote roles.
            # This is what stops look-alike slugs (a German firm answering to
            # "property", a US startup answering to "air") from being cached.
            if res and any(location_ok(p.get("location", "")) for p in res):
                cache[company] = {"ats": ats, "slug": slug}
                return ats, slug
    cache[company] = None
    return None, None


def scrape_watchlist(profile: str, companies: list[str], role_keywords: list[str]):
    """Yield normalized jobs from all detectable watchlist companies."""
    cache = _load_cache(profile)
    kw = [k.lower() for k in role_keywords if k]
    with httpx.Client(timeout=TIMEOUT, headers=HEADERS, follow_redirects=True) as client:
        for entry in companies:
            company, pinned_ats, pinned_slug = parse_entry(entry)
            if pinned_ats:
                ats, slug = pinned_ats, pinned_slug
            else:
                ats, slug = detect(company, client, cache)
            if not ats or ats not in ALL_FETCHERS:
                continue
            try:
                postings = ALL_FETCHERS[ats](slug, client) or []
            except httpx.HTTPError:
                continue

            for p in postings:
                title = (p.get("title") or "")
                loc = (p.get("location") or "")
                if kw and not any(k in title.lower() for k in kw):
                    continue
                # every board is filtered — most of these companies hire globally
                if not location_ok(loc):
                    continue
                yield new_job(
                    title=title,
                    company=company,
                    url=p.get("url") or "",
                    source=ats,
                    location=loc,
                    posted_date=p.get("posted"),
                    description=p.get("description") or "",
                )
    _save_cache(profile, cache)
