"""Large employers that don't expose a standard ATS board.

These companies (Amazon/AWS, Microsoft, SAP) run their own career platforms with
public search endpoints. They're worth hitting directly because they're major
UAE AI/ML employers whose postings are only partially mirrored on job boards.

Portals that require a login (Emirates Group's Avature, flydubai's iCIMS) are
deliberately NOT scraped — those need an account, so the job boards remain the
route for them.
"""
import json
import re
from html import unescape

from curl_cffi import requests as cr

from jobs import new_job, parse_iso_date

TIMEOUT = 25
IMPERSONATE = "chrome"


def _txt(s):
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _get(url, **kw):
    try:
        r = cr.get(url, impersonate=IMPERSONATE, timeout=TIMEOUT, **kw)
        return r if r.status_code == 200 else None
    except Exception:
        return None


# ---------------- Amazon / AWS ----------------

def amazon(search_term: str = "", limit: int = 100):
    """amazon.jobs public search API — covers AWS as well."""
    per_page = 50
    for offset in range(0, limit, per_page):
        r = _get(
            "https://www.amazon.jobs/en/search.json",
            params={
                "base_query": search_term,
                "loc_query": "United Arab Emirates",
                "country": "ARE",
                "result_limit": per_page,
                "offset": offset,
                "sort": "recent",
            },
        )
        if not r:
            return
        try:
            data = r.json()
        except Exception:
            return
        jobs = data.get("jobs") or []
        if not jobs:
            return
        for j in jobs:
            company = j.get("company_name") or "Amazon"
            path = j.get("job_path") or ""
            yield new_job(
                title=j.get("title") or "",
                company=company,
                url=f"https://www.amazon.jobs{path}" if path.startswith("/") else path,
                source="amazon",
                location=j.get("location") or ", ".join(
                    x for x in [j.get("city"), j.get("country_code")] if x
                ),
                posted_date=parse_iso_date(j.get("posted_date")) or _us_date(j.get("posted_date")),
                description=_txt(j.get("description") or j.get("description_short") or "")[:20000],
            )
        if len(jobs) < per_page:
            return


def _us_date(value):
    """amazon.jobs returns dates like 'July 28, 2026'."""
    if not value:
        return None
    try:
        from datetime import datetime
        return datetime.strptime(str(value).strip(), "%B %d, %Y").date().isoformat()
    except Exception:
        return None


# ---------------- SAP (SuccessFactors board) ----------------

SAP_ROW = re.compile(r'href="(/job/[^"]+)"[^>]*>\s*([^<]{4,120}?)\s*</a>', re.S)


def sap(search_term: str = "", limit: int = 75):
    """jobs.sap.com UAE listings (SAP runs SuccessFactors, no public JSON API)."""
    seen = set()
    for start in range(0, limit, 25):
        r = _get(
            "https://jobs.sap.com/search/",
            params={"q": search_term, "locationsearch": "United Arab Emirates", "startrow": start},
        )
        if not r:
            return
        # each row's link appears twice in the markup — dedupe within the page too
        rows = list(dict.fromkeys(SAP_ROW.findall(r.text)))
        new_rows = [(p, t) for p, t in rows if p not in seen]
        if not new_rows:
            return
        for path, title in new_rows:
            seen.add(path)
            # SAP encodes the city in the job path: /job/Dubai-AI-Product-Expert-...
            city = "Dubai"
            m = re.match(r"/job/([A-Za-z%20\-]+?)-[A-Z]", path)
            if m:
                city = unescape(m.group(1).replace("%20", " ").replace("-", " ")).strip() or "Dubai"
            yield new_job(
                title=_txt(title),
                company="SAP",
                url=f"https://jobs.sap.com{path}",
                source="sap",
                location=f"{city}, United Arab Emirates",
                posted_date=None,
                description="",
            )
        if len(seen) >= limit:
            return


# ---------------- Microsoft ----------------

def microsoft(search_term: str = "", limit: int = 60):
    """Microsoft careers search API."""
    per_page = 20
    for page in range(1, (limit // per_page) + 2):
        r = _get(
            "https://gcsservices.careers.microsoft.com/search/api/v1/search",
            params={"lc": "United Arab Emirates", "q": search_term, "pg": page,
                    "pgSz": per_page, "o": "Recent", "flt": "true"},
            headers={"Accept": "application/json"},
        )
        if not r:
            return
        try:
            res = (r.json().get("operationResult") or {}).get("result") or {}
        except Exception:
            return
        jobs = res.get("jobs") or []
        if not jobs:
            return
        for j in jobs:
            props = j.get("properties") or {}
            locs = props.get("locations") or []
            yield new_job(
                title=j.get("title") or "",
                company="Microsoft",
                url=f"https://jobs.careers.microsoft.com/global/en/job/{j.get('jobId')}",
                source="microsoft",
                location=locs[0] if locs else "United Arab Emirates",
                posted_date=parse_iso_date(j.get("postingDate")),
                description=_txt(props.get("description") or j.get("properties", {}).get("responsibilities") or "")[:20000],
            )
        if len(jobs) < per_page:
            return


# ---------------- Emirates Group (Emirates, dnata, SkyCargo, Engineering) ----------------

def emirates_group(search_term: str = "", limit: int = 300):
    """emiratesgroupcareers.com serves its whole live req list as JSON.

    Covers every Emirates Group brand: Emirates, Emirates Engineering,
    Emirates SkyCargo, Emirates Holidays, dnata, dnata Cargo, dnata Travel and
    the Flight Training Academy.
    """
    r = _get("https://www.emiratesgroupcareers.com/api/v1/jobs",
             headers={"Accept": "application/json"})
    if not r:
        return
    try:
        rows = r.json().get("data") or []
    except Exception:
        return
    for j in rows[:limit]:
        posted = None
        ts = j.get("postingdate")
        if isinstance(ts, (int, float)):
            from datetime import datetime, timezone
            posted = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).date().isoformat()
        city = ", ".join(x for x in [j.get("city"), j.get("country")] if x)
        req = j.get("reqid") or j.get("reqno") or ""
        yield new_job(
            title=j.get("title") or "",
            company=j.get("brand") or "Emirates Group",
            url=j.get("redirectionurl")
                or f"https://www.emiratesgroupcareers.com/search-and-apply/{req}",
            source="emirates",
            location=city or "Dubai, United Arab Emirates",
            posted_date=posted,
            description=_txt(j.get("jobdescription") or "")[:20000],
        )


# ---------------- flydubai ----------------

def flydubai(search_term: str = "", limit: int = 100):
    """careers.flydubai.com exposes a Jibe-style /api/jobs feed."""
    # The feed ignores offset/page params and always returns the same block,
    # so take one page and dedupe by requisition slug.
    r = _get("https://careers.flydubai.com/api/jobs",
             params={"size": limit},
             headers={"Accept": "application/json"})
    if not r:
        return
    try:
        rows = r.json().get("jobs") or []
    except Exception:
        return

    seen_slugs = set()
    for row in rows:
        slug = ((row.get("data") or row) or {}).get("slug")
        if slug in seen_slugs:
            continue
        seen_slugs.add(slug)
        j = row.get("data") or row
        loc = j.get("full_location") or j.get("city") or "Dubai"
        yield new_job(
            title=j.get("title") or "",
            company=j.get("hiring_organization") or "flydubai",
            url=j.get("apply_url") or f"https://careers.flydubai.com/job/{j.get('slug','')}",
            source="flydubai",
            location=f"{loc}, United Arab Emirates" if "arab" not in str(loc).lower() else str(loc),
            posted_date=parse_iso_date(j.get("posted_date") or j.get("create_date")),
            description=_txt(
                f"{j.get('description','')} {j.get('responsibilities','')} {j.get('qualifications','')}"
            )[:20000],
        )


# ---------------- Oracle Recruiting Cloud (UAE banks & conglomerates) ----------------
#
# Several large UAE employers run Oracle HCM. Their candidate-experience API is
# public and identical across tenants — only the host changes — so one fetcher
# covers all of them.
ORACLE_TENANTS = {
    "FAB": "ehjd.fa.em2.oraclecloud.com",
    "Emirates NBD": "fa-evlo-saasfaprod1.fa.ocs.oraclecloud.com",
    "Emaar": "emhm.fa.em2.oraclecloud.com",
    "DP World": "ehpv.fa.em2.oraclecloud.com",
}

_ORACLE_FINDER = (
    "findReqs;siteNumber={site},facetsList=LOCATIONS;WORK_LOCATIONS;TITLES;CATEGORIES,"
    "limit={limit},offset={offset},sortBy=POSTING_DATES_DESC"
)


def _oracle_company(company: str, host: str, limit: int = 200):
    for offset in range(0, limit, 25):
        r = _get(
            f"https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions",
            params={
                "onlyData": "true",
                "expand": "requisitionList",
                "finder": _ORACLE_FINDER.format(site="CX_1", limit=25, offset=offset),
            },
            headers={"Accept": "application/json"},
        )
        if not r:
            return
        try:
            item = (r.json().get("items") or [{}])[0]
        except Exception:
            return
        reqs = item.get("requisitionList") or []
        if not reqs:
            return
        for j in reqs:
            loc = j.get("PrimaryLocation") or ""
            req_id = j.get("Id") or j.get("RequisitionId") or ""
            yield new_job(
                title=j.get("Title") or "",
                company=company,
                url=f"https://{host}/hcmUI/CandidateExperience/en/sites/CX_1/job/{req_id}",
                source="oracle",
                location=loc,
                posted_date=parse_iso_date(j.get("PostedDate")),
                description=_txt(j.get("ShortDescriptionStr") or j.get("ExternalDescriptionStr") or "")[:20000],
            )
        if len(reqs) < 25:
            return


def oracle_detail(url: str) -> dict | None:
    """Full posting from an Oracle Recruiting job URL.

    The listing feed carries titles only, so a job from FAB, Emirates NBD, Emaar
    or DP World arrives with nothing to score on. The requisition-details
    resource returns the body text.
    """
    m = re.search(r"https://([^/]+)/.*?/job/(\d+)", url)
    if not m:
        return None
    host, rid = m.group(1), m.group(2)
    site = re.search(r"/sites/([^/]+)/", url)
    site_no = site.group(1) if site else "CX_1"
    api = (
        f"https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails"
        f'?expand=all&finder=ById;Id="{rid}",siteNumber={site_no}'
    )
    try:
        r = cr.get(api, impersonate="chrome", timeout=25, headers={"Accept": "application/json"})
        if r.status_code != 200:
            return None
        items = r.json().get("items") or []
        if not items:
            return None
        it = items[0]
    except Exception:
        return None

    body = " ".join(
        str(it.get(k) or "")
        for k in ("ExternalDescriptionStr", "ExternalResponsibilitiesStr", "ExternalQualificationsStr")
    )
    return {
        "title": it.get("Title"),
        "description": _clean_html(body)[:20000],
        "posted_date": (it.get("ExternalPostedStartDate") or "")[:10] or None,
    }


SAP_MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def sap_detail(url: str) -> dict | None:
    """SAP marks its postings up as schema.org microdata, not JSON-LD.

    Worth knowing because a JSON-LD parser finds nothing here and reports the
    page as empty even though the full ad is present as itemprop attributes.
    """
    try:
        # the stored URL can carry an HTML-escaped ampersand
        r = cr.get(url.replace("&amp;", "&"), impersonate="chrome", timeout=25)
        if r.status_code != 200:
            return None
    except Exception:
        return None
    t = r.text
    if "schema.org/JobPosting" not in t:
        return None

    dm = re.search(r'itemprop="description"[^>]*>(.*?)</div>', t, re.S)
    if not dm:
        return None
    title = re.search(r'itemprop="title"[^>]*>([^<]{2,200})<', t)

    # dates come as "Thu Jul 09 02:00:00 UTC 2026"
    posted = None
    pm = re.search(r'itemprop="datePosted"[^>]*>\s*\w{3}\s+(\w{3})\s+(\d{1,2})[^<]*?(\d{4})', t)
    if pm and pm.group(1) in SAP_MONTHS:
        posted = f"{pm.group(3)}-{SAP_MONTHS[pm.group(1)]:02d}-{int(pm.group(2)):02d}"

    return {
        "title": unescape(title.group(1).strip()) if title else None,
        "description": _clean_html(dm.group(1))[:20000],
        "posted_date": posted,
    }


def smartrecruiters_detail(url: str) -> dict | None:
    """SmartRecruiters publishes each posting through a documented API.

    Covers Etihad and every other employer hosted there. The ad is split across
    sections, so they're joined in the order a reader would meet them.
    """
    m = re.search(r"smartrecruiters\.com/([^/]+)/(\d+)", url)
    if not m:
        return None
    company, posting = m.group(1), m.group(2)
    try:
        r = cr.get(
            f"https://api.smartrecruiters.com/v1/companies/{company}/postings/{posting}",
            impersonate="chrome",
            timeout=25,
            headers={"Accept": "application/json"},
        )
        if r.status_code != 200:
            return None
        d = r.json()
    except Exception:
        return None

    sections = ((d.get("jobAd") or {}).get("sections") or {})
    order = ("jobDescription", "qualifications", "additionalInformation", "companyDescription")
    body = " ".join(
        str((sections.get(k) or {}).get("text") or "") for k in order
    )
    return {
        "title": d.get("name"),
        "company": (d.get("company") or {}).get("name"),
        "description": _clean_html(body)[:20000],
        "posted_date": (d.get("releasedDate") or "")[:10] or None,
    }


def _clean_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", unescape(s)).strip()


def oracle_employers(search_term: str = "", limit: int = 200):
    """All configured Oracle HCM tenants, UAE roles only."""
    for company, host in ORACLE_TENANTS.items():
        try:
            for job in _oracle_company(company, host, limit):
                loc = (job.get("location") or "").lower()
                if not loc or any(h in loc for h in
                                  ("uae", "united arab emirates", "dubai", "abu dhabi", "sharjah", "emirates")):
                    yield job
        except Exception:
            continue


# ---------------- Etihad Airways (SmartRecruiters) ----------------

def etihad(search_term: str = "", limit: int = 200):
    """Etihad's SmartRecruiters board (company id EtihadAirways5)."""
    for offset in range(0, limit, 100):
        r = _get(
            "https://api.smartrecruiters.com/v1/companies/EtihadAirways5/postings",
            params={"limit": 100, "offset": offset},
            headers={"Accept": "application/json"},
        )
        if not r:
            return
        try:
            data = r.json()
        except Exception:
            return
        content = data.get("content") or []
        if not content:
            return
        for j in content:
            loc = j.get("location") or {}
            city = ", ".join(x for x in [loc.get("city"), loc.get("country")] if x)
            if city and not any(h in city.lower() for h in
                                ("uae", "united arab emirates", "abu dhabi", "dubai", "ae")):
                continue
            yield new_job(
                title=j.get("name") or "",
                company="Etihad Airways",
                url=f"https://jobs.smartrecruiters.com/EtihadAirways5/{j.get('id')}",
                source="etihad",
                location=city or "Abu Dhabi, United Arab Emirates",
                posted_date=parse_iso_date(j.get("releasedDate")),
                description="",
            )
        if offset + 100 >= (data.get("totalFound") or 0):
            return


BIGCO_SOURCES = {
    "amazon": amazon,
    "sap": sap,
    "microsoft": microsoft,
    "emirates": emirates_group,
    "flydubai": flydubai,
    "etihad": etihad,
    "oracle": oracle_employers,
}
