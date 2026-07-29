"""JobSpy-backed sources: Indeed UAE, LinkedIn, Bayt, Glassdoor, Google Jobs."""
import math

from jobs import new_job, parse_iso_date

# site name -> jobspy site key
SITES = {
    "indeed": "indeed",
    "linkedin": "linkedin",
    "bayt": "bayt",
    "glassdoor": "glassdoor",
    "google": "google",
}


def _clean(value):
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def scrape_site(site: str, search_term: str, location: str = "United Arab Emirates",
                results_wanted: int = 100, hours_old: int | None = 24 * 30,
                is_remote: bool = False):
    """Run one JobSpy site scrape and yield normalized job dicts."""
    from jobspy import scrape_jobs  # heavy import — keep inside the function

    kwargs = dict(
        site_name=[SITES[site]],
        search_term=search_term,
        results_wanted=results_wanted,
        description_format="markdown",
        verbose=0,
    )
    if is_remote:
        kwargs["is_remote"] = True

    if site == "indeed":
        kwargs["country_indeed"] = "United Arab Emirates"
        kwargs["location"] = "" if is_remote else location
        # Indeed: hours_old cannot combine with some filters; keep it alone.
        if hours_old:
            kwargs["hours_old"] = hours_old
    elif site == "google":
        where = "remote" if is_remote else "Dubai UAE"
        kwargs["google_search_term"] = f"{search_term} jobs in {where}"
    elif site == "bayt":
        pass  # search_term only
    else:
        kwargs["location"] = location
        if site == "linkedin":
            kwargs["linkedin_fetch_description"] = True
            # LinkedIn rate-limits hard; pull in bigger pages but stay reasonable
            kwargs["results_wanted"] = min(results_wanted, 75)

    df = scrape_jobs(**kwargs)
    if df is None or df.empty:
        return

    for _, row in df.iterrows():
        r = {k: _clean(v) for k, v in row.to_dict().items()}
        title = r.get("title")
        company = r.get("company")
        if not title or not company:
            continue
        city = r.get("location") or ""
        salary = None
        if r.get("min_amount") or r.get("max_amount"):
            lo, hi = r.get("min_amount"), r.get("max_amount")
            cur = r.get("currency") or ""
            salary = f"{lo or ''}-{hi or ''} {cur}".strip("- ")
        yield new_job(
            title=title,
            company=company,
            url=r.get("job_url") or r.get("job_url_direct") or "",
            source=site,
            location=city,
            posted_date=parse_iso_date(r.get("date_posted")),
            description=r.get("description") or "",
            salary=salary,
        )
