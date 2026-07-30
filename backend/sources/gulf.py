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


# Tanqeeb renders dates in Arabic ("منذ 6 ساعة" = 6 hours ago), and the digits may
# be Arabic-Indic. Without this every Tanqeeb job would look undated.
_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
_AR_UNITS = [
    (r"دقيق", 0),        # minute
    (r"ساع", 0),         # hour
    (r"يوم|أيام", 1),     # day
    (r"أسبوع|اسبوع", 7),  # week
    (r"شهر|أشهر", 30),    # month
    (r"سنة|عام", 365),
]


_AR_MONTHS = {
    "يناير": 1, "فبراير": 2, "مارس": 3, "أبريل": 4, "ابريل": 4, "مايو": 5,
    "يونيو": 6, "يوليو": 7, "أغسطس": 8, "اغسطس": 8, "سبتمبر": 9,
    "أكتوبر": 10, "اكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12,
}


def _date_ar(text: str) -> str | None:
    """Tanqeeb prints either a relative age ("منذ 6 ساعة") or an absolute date
    ("١٩ يوليو ٢٠٢٦") in Arabic-Indic digits. Handle both, or every listing from
    that board looks undated and gets the neutral freshness score."""
    t = (text or "").translate(_AR_DIGITS).strip()
    if not t:
        return None

    # absolute: <day> <month name> <year>
    for name, month in _AR_MONTHS.items():
        if name in t:
            nums = re.findall(r"\d+", t)
            if len(nums) >= 2:
                day, year = int(nums[0]), int(nums[-1])
                try:
                    return date(year, month, min(day, 28) if day > 31 else day).isoformat()
                except ValueError:
                    return None
            return None

    # relative: "منذ N <unit>"
    num = re.search(r"(\d+)", t)
    n = int(num.group(1)) if num else 1
    for pattern, per in _AR_UNITS:
        if re.search(pattern, t):
            return (date.today() - timedelta(days=n * per)).isoformat()
    return _relative_date(t)


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


# ---------------- Tanqeeb ----------------
#
# ~26k live UAE postings. Two traps found while wiring it up:
#   * the search param is `keywords` (plural). `keyword` is silently ignored and
#     returns an unfiltered list, so "data scientist" and "nurse" come back
#     identical — which looks like a working scraper returning junk.
#   * only the /ar/ route serves search; /en/jobs/search 404s. The listings
#     themselves are ~78% English, so the Arabic path is not a problem.

TANQEEB_CARD = re.compile(r'<article id="JOB-[^"]+" data-id="(?P<id>\d+)"(?P<rest>.*?)</article>', re.S)


def tanqeeb_detail(url: str) -> dict | None:
    """Full posting from a Tanqeeb job page.

    The search cards carry no description at all, which leaves nothing to score
    on. The detail page embeds a complete schema.org JobPosting — real employer
    (the card often shows the recruiter), exact date, the description, and
    validThrough, which is the application deadline.
    """
    r = _get(url)
    if not r:
        return None
    for d in _ld_blocks(r.text):
        if not (isinstance(d, dict) and d.get("@type") == "JobPosting"):
            continue
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
            "company": (org.get("name") if isinstance(org, dict) else org) or None,
            "posted_date": parse_iso_date(d.get("datePosted")),
            "closes": parse_iso_date(d.get("validThrough")),
            "location": city or None,
            "description": _txt(str(d.get("description") or ""))[:20000],
            "employment_type": d.get("employmentType"),
        }
    return None


def tanqeeb(search_term: str, limit: int = 120, pages: int = 4):
    seen_urls = set()
    count = 0
    for page in range(1, pages + 1):
        url = (
            "https://uae.tanqeeb.com/ar/jobs/search"
            f"?keywords={quote(search_term)}&page_no={page}"
        )
        r = _get(url)
        if not r:
            return
        cards = [j for j in _tanqeeb_page(r.text) if j["url"] not in seen_urls]
        for j in cards:
            seen_urls.add(j["url"])
        if not cards:
            return

        # Cards have no description, so each detail page is fetched. Done in
        # parallel because it is one request per job.
        with ThreadPoolExecutor(max_workers=6) as pool:
            details = list(pool.map(lambda j: tanqeeb_detail(j["url"]), cards))

        for job, det in zip(cards, details):
            if det:
                job["description"] = det["description"] or ""
                job["title"] = det["title"] or job["title"]
                # the card usually names the recruiter; the posting names the employer
                if det["company"]:
                    job["company"] = det["company"]
                if det["posted_date"]:
                    job["posted_date"] = det["posted_date"]
                if det["closes"]:
                    job["closes"] = det["closes"]
            count += 1
            yield job
            if count >= limit:
                return


def _tanqeeb_page(html: str):
    for m in TANQEEB_CARD.finditer(html):
        card = m.group("rest")

        tm = re.search(r"<h5[^>]*>(.*?)</h5>", card, re.S)
        title = _txt(tm.group(1)) if tm else ""
        if not title:
            continue

        pm = re.search(r'href="(/ar/jobs-in-uae/[^"]+\.html)"', card)
        path = pm.group(1) if pm else f"/ar/jobs-in-uae/all/jobs/0{m.group('id')}.html"

        cm = re.search(r'class="search-job-company-name"[^>]*>(.*?)</span>', card, re.S)
        company = _txt(cm.group(1)) if cm else "Unknown (Tanqeeb)"

        lm = re.search(r'class="search-job-location-text"[^>]*>(.*?)</', card, re.S)
        location = _txt(lm.group(1)) if lm else "UAE"

        dm = re.search(r'class="search-job-date"[^>]*>(.*?)</', card, re.S)
        posted = _date_ar(_txt(dm.group(1))) if dm else None

        wm = re.search(r'class="search-job-workplace"[^>]*>(.*?)</', card, re.S)
        workplace = _txt(wm.group(1)) if wm else ""
        # The remote marker is Arabic — "(عن بُعد)" — and the title often says so
        # in English too. Either counts: remote-from-UAE roles are wanted.
        blob = f"{workplace} {title}".lower()
        if "عن بعد" in workplace.replace("ُ", "") or "remote" in blob:
            location = f"{location} · Remote"

        yield new_job(
            title=title,
            company=company,
            url=f"https://uae.tanqeeb.com{path}",
            source="tanqeeb",
            location=location,
            posted_date=posted,
            description="",
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
