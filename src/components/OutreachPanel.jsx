import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { parseOutreach } from "../lib/outreach.js";

function Block({ label, text, hint }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <div className="px-3 pb-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-dim)" }}>
          {label}
        </span>
        {hint && (
          <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
            · {hint}
          </span>
        )}
        <button
          className="ml-auto text-[10px]"
          style={{ color: "var(--accent)" }}
          onClick={() => {
            navigator.clipboard?.writeText(text).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <div
        className="card !rounded-lg px-3 py-2 text-xs whitespace-pre-wrap max-h-72 overflow-y-auto"
        style={{ color: "var(--text-mid)" }}
      >
        {text}
      </div>
    </div>
  );
}

/**
 * Sits beside the browser when messaging a hiring manager.
 *
 * For an email contact the browser is already showing a pre-addressed Gmail
 * draft, so this is the reference copy plus the LinkedIn variant. For a LinkedIn
 * contact the browser shows their profile and the note is here to paste into the
 * connection request — LinkedIn's own compose box can't be deep-linked, and
 * scripting it is exactly the kind of automation that gets accounts restricted.
 */
export default function OutreachPanel({ profile, job, contact, onClose }) {
  const [draft, setDraft] = useState(null);
  const [state, setState] = useState("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { files } = await api.jobFiles(profile.id, job.id);
        const f = (files || []).find((x) => /outreach/i.test(x.name) && /md/i.test(x.format));
        if (!f) {
          if (alive) setState("none");
          return;
        }
        const md = await api.jobFileText(profile.id, job.id, f.name);
        if (alive) {
          setDraft(parseOutreach(md));
          setState("ready");
        }
      } catch {
        if (alive) setState("none");
      }
    })();
    return () => {
      alive = false;
    };
  }, [profile.id, job.id]);

  return (
    <aside
      className="w-80 shrink-0 border-l border-ink-800 flex flex-col overflow-y-auto"
      style={{ backgroundColor: "var(--bg)" }}
    >
      <div className="px-4 py-3 border-b border-ink-800 flex items-center gap-2">
        <span className="font-semibold text-sm flex-1 truncate">Your message</span>
        <button className="text-xs" style={{ color: "var(--text-dim)" }} onClick={onClose}>
          hide
        </button>
      </div>

      <div className="px-4 py-3 border-b border-ink-800">
        <div className="text-sm font-medium truncate">{contact?.name || "Contact"}</div>
        {contact?.title && (
          <div className="text-xs truncate" style={{ color: "var(--text-mid)" }}>
            {contact.title}
          </div>
        )}
        <div className="text-xs truncate mt-0.5" style={{ color: "var(--text-dim)" }}>
          {contact?.email || contact?.profile_url || "no contact saved"}
        </div>
        <div className="text-[11px] mt-2 truncate" style={{ color: "var(--text-dim)" }}>
          {job.title} · {job.company}
        </div>
      </div>

      {state === "loading" && (
        <div className="p-4 text-xs" style={{ color: "var(--text-dim)" }}>
          Loading your draft…
        </div>
      )}

      {state === "none" && (
        <div className="p-4 text-xs" style={{ color: "var(--text-mid)" }}>
          No draft written for this job yet. Type{" "}
          <span style={{ color: "var(--accent)" }}>find hiring managers</span> in Claude and it
          will research the contact and write the message.
        </div>
      )}

      {state === "ready" && draft && (
        <div className="pt-3">
          {draft.subject && <Block label="Subject" text={draft.subject} />}
          <Block label="Email" text={draft.email} hint="already in the Gmail draft" />
          <Block label="LinkedIn note" text={draft.linkedin} hint="paste into the request" />
        </div>
      )}

      <div
        className="mt-auto px-4 py-3 border-t border-ink-800 text-[11px]"
        style={{ color: "var(--text-dim)" }}
      >
        Mapply never sends a message — read it over and send it yourself.
      </div>
    </aside>
  );
}
