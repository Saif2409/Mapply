"""Gulf-native boards: Bayt, GulfTalent, NaukriGulf.

All three sit behind bot protection that rejects plain HTTP clients, so we use
curl_cffi with a Chrome TLS fingerprint. Each scraper fails soft (yields nothing)
rather than breaking the whole scan.

Bayt      — listing page carries title, company, location and an AI summary.
            (Detail pages are Cloudflare-challenged, so we never fetch them.)
GulfTalent— listing gives JSON-LD urls+titles; detail pages carry full
            schema.org JobPosting (company, date, full description).
NaukriGulf— private JSON API ('Jobs' key, capitalised).
"""
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from html import unescape
from urllib.parse import quote

from curl_cffi import requests as cr

from jobs import new_job, parse_iso_date

TIMEOUT = 30
IMPERSONATE = "chrome"


def _txt(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", unescape(s)).strip()


def _get(url, **kw):
    try:
        r = cr.get(url, impersonate=IMPERSONATE, timeout=TIMEOUT, **kw)
        return r if r.status_code == 200 else None
    except Exception:
        return None


def _ld_blocks(html: str):
    for b in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S):
        try:
            yield json.loads(b.strip())
        except Exception:
            continue


def _relative_date(text: str) -> str | None:
    m = re.search(r"(\d+)\s*(minute|hour|day|week|month)s?\s*ago", text or "", re.I)
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2).lower()
    days = {"minute": 0, "hour": 0, "day": n, "week": n * 7, "month": n * 30}[unit]
    return (date.today() - timedelta(days=days)).isoformat()


# ---------------- Bayt ----------------

JOB_BLOCK = re.compile(
    r'<h2[^>]*>\s*<a[^>]+href="(?P<url>/[^"]+/jobs/[^"]+)"[^>]*title="(?P<title>[^"]*)"',
    re.S,
)


def bayt(search_term: str, limit: int = 120, pages: int = 4):
    slug = re.sub(r"[^a-z0-9]+", "-", search_term.lower()).strip("-")
    count = 0
    for page in range(1, pages + 1):
        url = f"https://www.bayt.com/en/uae/jobs/{slug}-jobs/"
        if page > 1:
            url += f"?page={page}"
        r = _get(url)
        if not r:
            return
        got = 0
        for job in _bayt_page(r.text):
            got += 1
            count += 1
            yield job
            if count >= limit:
                return
        if got == 0:
            return


def _bayt_page(html: str):
    matches = list(JOB_BLOCK.finditer(html))
    for idx, m in enumerate(matches):
        title = _txt(m.group("title"))
        path = m.group("url")
        if not title:
            continue
        # Bound the search to THIS card: stop at the next job's <h2>, otherwise
        # the company regex can pick up the following listing's employer and two
        # different companies end up attached to the same posting.
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(html)
        window = html[m.end(): min(end, m.end() + 2500)]

        # company sits inside this card's job-company-location-wrapper
        block = window.split("job-company-location-wrapper", 1)
        scope = block[1][:900] if len(block) > 1 else window
        cm = re.search(r'href="/en/company/[^"]*"[^>]*>([^<]{2,70})</a>', scope)
        if not cm:
            cm = re.search(r'class="t-default t-bold"[^>]*>([^<]{2,70})<', scope)
        company = _txt(cm.group(1)) if cm else "Unknown (Bayt)"

        lm = re.findall(r'class="t-mute"[^>]*>\s*<span>([^<]{2,40})</span>', window)
        location = ", ".join(_txt(x) for x in lm[:2]) or "UAE"

        dm = re.search(r'<div class="jb-descr[^"]*">(.*?)</div>', window, re.S)
        summary = _txt(dm.group(1)).replace("Summary:", "").strip() if dm else ""

        yield new_job(
            title=title,
            company=company,
            url=f"https://www.bayt.com{path}",
            source="bayt",
            location=location,
            posted_date=_relative_date(window),
            description=summary,
        )


# ---------------- GulfTalent ----------------

def _gulftalent_detail(url: str) -> dict | None:
    r = _get(url)
    if not r:
        return None
    for d in _ld_blocks(r.text):
        if isinstance(d, dict) and d.get("@type") == "JobPosting":
            org = d.get("hiringOrganization") or {}
            loc = d.get("jobLocation") or {}
            if isinstance(loc, list):
                loc = loc[0] if loc else {}
            addr = (loc or {}).get("address") or {}
            city = ", ".join(
                x for x in [addr.get("addressLocality"), addr.get("addressRegion")] if x
            )
            return {
                "title": d.get("title"),
                "company": (org.get("name") if isinstance(org, dict) else org) or "Unknown",
                "posted": parse_iso_date(d.get("datePosted")),
                "location": city or "UAE",
                "description": _txt(str(d.get("description") or ""))[:20000],
            }
    return None


def gulftalent(search_term: str, limit: int = 60, pages: int = 3):
    slug = re.sub(r"[^a-z0-9]+", "-", search_term.lower()).strip("-")
    items = []
    for page in range(1, pages + 1):
        url = f"https://www.gulftalent.com/uae/jobs/title/{slug}"
        if page > 1:
            url += f"?page={page}"
        r = _get(url)
        if not r:
            break
        before = len(items)
        for d in _ld_blocks(r.text):
            if isinstance(d, dict) and d.get("@type") == "ItemList":
                for it in d.get("itemListElement", []):
                    if it.get("url"):
                        items.append((it["url"], it.get("name") or ""))
        if len(items) == before:
            break
    items = list(dict.fromkeys(items))[:limit]
    if not items:
        return

    with ThreadPoolExecutor(max_workers=5) as pool:
        details = list(pool.map(lambda t: (t, _gulftalent_detail(t[0])), items))

    for (url, name), det in details:
        if det:
            yield new_job(
                title=det["title"] or name,
                company=det["company"],
                url=url,
                source="gulftalent",
                location=det["location"],
                posted_date=det["posted"],
                description=det["description"],
            )
        elif name:  # detail fetch failed — still surface the listing
            yield new_job(
                title=name, company="Unknown (GulfTalent)", url=url,
                source="gulftalent", location="UAE", posted_date=None, description="",
            )


# ---------------- NaukriGulf ----------------

def naukrigulf(search_term: str, limit: int = 150):
    """Paginated: the API caps each response, so walk offsets until it runs dry."""
    page_size = 50
    for offset in range(0, limit, page_size):
        got = 0
        for job in _naukrigulf_page(search_term, page_size, offset):
            got += 1
            yield job
        if got < page_size:
            return


def _naukrigulf_page(search_term: str, page_size: int, offset: int):
    url = (
        "https://www.naukrigulf.com/spapi/jobapi/search"
        f"?Keywords={quote(search_term)}&Location=uae&Limit={page_size}&Offset={offset}"
    )
    r = _get(url, headers={"appid": "205", "systemid": "2323", "Accept": "application/json"})
    if not r:
        return
    try:
        data = r.json()
    except Exception:
        return
    for entry in (data.get("Jobs") or data.get("jobs") or []):
        # each entry is wrapped: {"Job": {...}} with PascalCase fields
        j = entry.get("Job") if isinstance(entry, dict) and "Job" in entry else entry
        if not isinstance(j, dict):
            continue
        title = j.get("Designation") or j.get("designation") or j.get("title")
        comp = j.get("Company") or j.get("company")
        company = comp.get("Name") if isinstance(comp, dict) else (comp or "Unknown")
        if not title:
            continue
        link = j.get("JdURL") or j.get("jdURL") or j.get("jobUrl") or ""
        if link.startswith("/"):
            link = f"https://www.naukrigulf.com{link}"
        loc = j.get("Location") or j.get("location") or "UAE"
        if isinstance(loc, list):
            loc = ", ".join(str(x) for x in loc[:2])
        posted = j.get("PostedDate") or j.get("latestPostedDate") or j.get("postedDate") or ""
        yield new_job(
            title=str(title),
            company=str(company),
            url=link,
            source="naukrigulf",
            location=str(loc),
            posted_date=parse_iso_date(posted) or _relative_date(str(posted)),
            description=_txt(j.get("jobInfo") or j.get("Description") or j.get("description") or ""),
        )
