/**
 * Job sites you can sign into inside Mapply.
 *
 * Ordered by how many of the scraped jobs actually land there, so the ones worth
 * connecting first are at the top.
 *
 *   loginUrl      where Connect drops you when there's no session
 *   homeUrl       where Open drops you once connected. Not optional: LinkedIn
 *                 renders its sign-in form at /login even for a signed-in user,
 *                 which made a working session look logged out.
 *   sessionCookie the cookie that actually proves a sign-in. Read off a real
 *                 signed-in session in this app's own cookie store, so these are
 *                 observed rather than guessed. The httpOnly fallback below is
 *                 only used where no marker is known.
 *
 * Naming the real cookie matters in both directions. SAP sets NO httpOnly cookie
 * at all — its SuccessFactors session is `TAsessionID`, so the fallback could
 * never see it and a signed-in account read as logged out. SmartRecruiters is the
 * mirror image: its only httpOnly cookie is Cloudflare's `cf_clearance`, so
 * merely loading the page read as connected.
 *
 * No credentials are stored anywhere: you sign in inside the embedded browser
 * and the session lives in Chromium's own persistent partition.
 */
export const CONNECTORS = [
  {
    id: "naukrigulf",
    name: "NaukriGulf",
    domain: ".naukrigulf.com",
    loginUrl: "https://www.naukrigulf.com/login",
    homeUrl: "https://www.naukrigulf.com/mnj/userProfile/myHome?conmnj=1&source=",
    sessionCookie: ["isJsLoggedIn", "userId"],
    note: "Applies with the CV on your NaukriGulf profile",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    domain: ".linkedin.com",
    loginUrl: "https://www.linkedin.com/login",
    homeUrl: "https://www.linkedin.com/feed/",
    sessionCookie: ["li_at"],
    note: "Easy Apply pre-fills from your profile; you submit",
  },
  {
    id: "bayt",
    name: "Bayt",
    domain: ".bayt.com",
    loginUrl: "https://www.bayt.com/en/login/",
    homeUrl: "https://www.bayt.com/en/myworkspace-j/",
    sessionCookie: ["MSESID0"],
    note: "Applies with the CV on your Bayt profile",
  },
  {
    id: "indeed",
    name: "Indeed",
    domain: ".indeed.com",
    loginUrl: "https://secure.indeed.com/account/login",
    homeUrl: "https://myjobs.indeed.com/",
    sessionCookie: ["PPID", "rememberMe"],
    note: "Screening questions get auto-filled where possible",
  },
  {
    id: "gulftalent",
    name: "GulfTalent",
    domain: ".gulftalent.com",
    loginUrl: "https://www.gulftalent.com/account/login",
    homeUrl: "https://www.gulftalent.com/account",
    sessionCookie: ["remember_me"],
    note: "Regional board",
  },
  {
    id: "gmail",
    name: "Gmail",
    domain: ".google.com",
    loginUrl: "https://accounts.google.com/",
    homeUrl: "https://mail.google.com/",
    sessionCookie: ["SID", "__Secure-1PSID"],
    note: "Opens a pre-addressed draft when you message a hiring manager",
  },
  {
    id: "emirates",
    name: "Emirates Group",
    domain: ".emiratesgroupcareers.com",
    loginUrl: "https://www.emiratesgroupcareers.com/",
    homeUrl: "https://www.emiratesgroupcareers.com/",
    note: "Own careers platform — full autofill",
  },
  {
    id: "sap",
    name: "SAP Careers",
    domain: ".sap.com",
    loginUrl: "https://jobs.sap.com/",
    homeUrl: "https://jobs.sap.com/",
    // SAP sets no httpOnly cookie whatsoever; this is the SuccessFactors
    // career-site session, and without naming it a live session read as "no".
    sessionCookie: ["TAsessionID"],
    note: "SuccessFactors — full autofill",
  },
  {
    id: "amazon",
    name: "Amazon Jobs",
    domain: ".amazon.jobs",
    loginUrl: "https://www.amazon.jobs/en/login",
    homeUrl: "https://www.amazon.jobs/en/applicant",
    sessionCookie: ["amazon_jobs_session", "mons_auth"],
    note: "Own careers platform — full autofill",
  },
  {
    id: "oracle",
    name: "Oracle Recruiting",
    domain: ".oraclecloud.com",
    loginUrl: "https://ehjd.fa.em2.oraclecloud.com/",
    homeUrl: "https://ehjd.fa.em2.oraclecloud.com/",
    sessionCookie: ["ORA_CX_USERID"],
    note: "Used by FAB, Emirates NBD, Emaar, DP World",
  },
  {
    id: "greenhouse",
    name: "Greenhouse",
    domain: ".greenhouse.io",
    loginUrl: "https://boards.greenhouse.io/",
    homeUrl: "https://boards.greenhouse.io/",
    note: "Usually no login needed — file upload + full autofill",
    optional: true,
  },
  {
    id: "smartrecruiters",
    name: "SmartRecruiters",
    domain: ".smartrecruiters.com",
    loginUrl: "https://jobs.smartrecruiters.com/",
    homeUrl: "https://jobs.smartrecruiters.com/",
    note: "Etihad and others — file upload + full autofill",
    optional: true,
  },
  {
    id: "ashby",
    name: "Ashby",
    domain: ".ashbyhq.com",
    loginUrl: "https://jobs.ashbyhq.com/",
    homeUrl: "https://jobs.ashbyhq.com/",
    note: "File upload + full autofill",
    optional: true,
  },
];

export const byDomain = (host = "") =>
  CONNECTORS.find((c) => host.endsWith(c.domain.replace(/^\./, "")));
