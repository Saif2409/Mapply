/**
 * Turning a drafted outreach.md into something sendable.
 *
 * The find-hiring-managers skill writes one file per job containing both a short
 * LinkedIn connection note and a longer email. Splitting them here keeps that
 * skill free to write plain readable Markdown instead of a rigid format.
 */

const EMAIL_HEAD = /^#{1,4}\s*(email|inmail|e-?mail\s*\/\s*inmail|email\s*\/\s*inmail)/im;
const LINKEDIN_HEAD = /^#{1,4}\s*(linkedin|connection\s*note|linkedin\s*connection\s*note)/im;

/** Split outreach.md into its LinkedIn note and its email. */
export function parseOutreach(md = "") {
  const text = md.replace(/\r\n/g, "\n");
  const liAt = text.search(LINKEDIN_HEAD);
  const emAt = text.search(EMAIL_HEAD);

  const slice = (from, to) =>
    from < 0
      ? ""
      : text
          .slice(from, to < 0 || to < from ? undefined : to)
          // drop the heading line itself
          .replace(/^[^\n]*\n/, "")
          .trim();

  let linkedin = "";
  let email = "";
  if (liAt >= 0 && emAt >= 0) {
    linkedin = liAt < emAt ? slice(liAt, emAt) : slice(liAt);
    email = emAt < liAt ? slice(emAt, liAt) : slice(emAt);
  } else if (emAt >= 0) {
    email = slice(emAt);
  } else if (liAt >= 0) {
    linkedin = slice(liAt);
  } else {
    email = text.trim(); // no headings — treat the whole file as the message
  }

  // A "Subject:" line belongs in Gmail's subject box, not the body.
  let subject = "";
  const sm = email.match(/^\s*(?:\*\*)?subject(?:\*\*)?\s*:?\s*(.+)$/im);
  if (sm) {
    subject = sm[1].replace(/\*\*/g, "").trim();
    email = email.replace(sm[0], "").trim();
  }

  return { linkedin: stripMd(linkedin), email: stripMd(email), subject };
}

/** Markdown emphasis and bullets read as noise in an email body. */
function stripMd(s = "") {
  return s
    .replace(/^>\s?/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Gmail's compose deep link. Opening this in the signed-in browser gives a draft
 * already addressed, titled and written — the user still reads it and hits send,
 * so nothing is dispatched on their behalf.
 */
export function gmailComposeUrl({ to, subject, body }) {
  const p = new URLSearchParams({ view: "cm", fs: "1" });
  if (to) p.set("to", to);
  if (subject) p.set("su", subject);
  if (body) p.set("body", body);
  return `https://mail.google.com/mail/?${p.toString()}`;
}

/** Where "Message" should take you, given what was found about the contact. */
export function outreachTarget(contact = {}, draft = {}) {
  if (contact.email) {
    return {
      kind: "email",
      url: gmailComposeUrl({
        to: contact.email,
        subject: draft.subject || "",
        body: draft.email || "",
      }),
      label: `Gmail draft to ${contact.email}`,
    };
  }
  if (contact.profile_url) {
    return {
      kind: "linkedin",
      url: contact.profile_url,
      label: contact.name ? `${contact.name} on LinkedIn` : "LinkedIn profile",
    };
  }
  return null;
}
