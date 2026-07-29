/**
 * Job sites you can sign into inside Mapply.
 *
 * Ordered by how many of the scraped jobs actually land there, so the ones worth
 * connecting first are at the top. `domain` is what the cookie check uses;
 * `loginUrl` is where Connect drops you.
 *
 * No credentials are stored anywhere — you sign in inside the embedded browser
 * and the session cookie lives in Chromium's own persistent partition.
 */
export const CONNECTORS = [
  {
    id: "naukrigulf",
    name: "NaukriGulf",
    domain: ".naukrigulf.com",
    loginUrl: "https://www.naukrigulf.com/login",
    note: "Applies with the CV on your NaukriGulf profile",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    domain: ".linkedin.com",
    loginUrl: "https://www.linkedin.com/login",
    note: "Easy Apply pre-fills from your profile; you submit",
  },
  {
    id: "bayt",
    name: "Bayt",
    domain: ".bayt.com",
    loginUrl: "https://www.bayt.com/en/login/",
    note: "Applies with the CV on your Bayt profile",
  },
  {
    id: "indeed",
    name: "Indeed",
    domain: ".indeed.com",
    loginUrl: "https://secure.indeed.com/account/login",
    note: "Screening questions get auto-filled where possible",
  },
  {
    id: "gulftalent",
    name: "GulfTalent",
    domain: ".gulftalent.com",
    loginUrl: "https://www.gulftalent.com/account/login",
    note: "Regional board",
  },
  {
    id: "tanqeeb",
    name: "Tanqeeb",
    domain: ".tanqeeb.com",
    loginUrl: "https://uae.tanqeeb.com/ar/login",
    note: "~26k UAE listings, many remote",
  },
  {
    id: "glassdoor",
    name: "Glassdoor",
    domain: ".glassdoor.com",
    loginUrl: "https://www.glassdoor.com/member/login",
    note: "Blocks plain scrapers — sign in so jobs can be read in-app",
  },
  {
    id: "emirates",
    name: "Emirates Group",
    domain: ".emiratesgroupcareers.com",
    loginUrl: "https://www.emiratesgroupcareers.com/",
    note: "Own careers platform — full autofill",
  },
  {
    id: "sap",
    name: "SAP Careers",
    domain: ".sap.com",
    loginUrl: "https://jobs.sap.com/",
    note: "SuccessFactors — full autofill",
  },
  {
    id: "amazon",
    name: "Amazon Jobs",
    domain: ".amazon.jobs",
    loginUrl: "https://www.amazon.jobs/en/login",
    note: "Own careers platform — full autofill",
  },
  {
    id: "oracle",
    name: "Oracle Recruiting",
    domain: ".oraclecloud.com",
    loginUrl: "https://ehjd.fa.em2.oraclecloud.com/",
    note: "Used by FAB, Emirates NBD, Emaar, DP World",
  },
  {
    id: "greenhouse",
    name: "Greenhouse",
    domain: ".greenhouse.io",
    loginUrl: "https://boards.greenhouse.io/",
    note: "Usually no login needed — file upload + full autofill",
    optional: true,
  },
  {
    id: "smartrecruiters",
    name: "SmartRecruiters",
    domain: ".smartrecruiters.com",
    loginUrl: "https://jobs.smartrecruiters.com/",
    note: "Etihad and others — file upload + full autofill",
    optional: true,
  },
  {
    id: "ashby",
    name: "Ashby",
    domain: ".ashbyhq.com",
    loginUrl: "https://jobs.ashbyhq.com/",
    note: "File upload + full autofill",
    optional: true,
  },
];

export const byDomain = (host = "") =>
  CONNECTORS.find((c) => host.endsWith(c.domain.replace(/^\./, "")));
