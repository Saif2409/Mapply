import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, openExternal } from "../lib/api.js";
import SiteBrowser from "../components/SiteBrowser.jsx";
import { outreachTarget, parseOutreach } from "../lib/outreach.js";

const SOURCE_LABELS = {
  indeed: "Indeed", linkedin: "LinkedIn", bayt: "Bayt", google: "Google Jobs",
  naukrigulf: "NaukriGulf", gulftalent: "GulfTalent", greenhouse: "Greenhouse",
  lever: "Lever", ashby: "Ashby", recruitee: "Recruitee",
  smartrecruiters: "SmartRecruiters", amazon: "Amazon", sap: "SAP",
  microsoft: "Microsoft", remote: "Remote",
};

function Bar({ label, value }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 text-mist-dim shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-ink-700 overflow-hidden">
        <div
          className="h-full bg-royal-light"
          style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
        />
      </div>
      <span className="w-10 text-right">{Math.round(value ?? 0)}</span>
    </div>
  );
}

const KIND_LABEL = {
  resume: "Tailored CV",
  cover_letter: "Cover letter",
  outreach: "Outreach message",
  other: "File",
};

/* Holds the real page's shape — back link, header block, score card, description
   — so nothing jumps when the job lands. The old placeholder was one line of
   text in the corner, which read as a page that had failed to load. */
function DetailSkeleton({ from, onBack }) {
  return (
    <div className="p-10 max-w-4xl mx-auto animate-pulse">
      <button className="text-sm text-mist-dim hover:text-mist-bright mb-4" onClick={onBack}>
        {from === "/tracker" ? "← Back to tracker" : "← Back to jobs"}
      </button>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="h-6 w-2/3 rounded bg-ink-700/70" />
          <div className="h-3.5 w-1/2 rounded bg-ink-700/40 mt-3" />
          <div className="flex gap-2 mt-4">
            <div className="h-6 w-20 rounded-full bg-ink-700/50" />
            <div className="h-6 w-24 rounded-full bg-ink-700/40" />
          </div>
        </div>
        <div className="h-16 w-16 rounded-2xl bg-ink-700/50 shrink-0" />
      </div>

      <div className="card mt-6 p-6 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-2.5 w-28 rounded bg-ink-700/40 shrink-0" />
            <div className="h-2 flex-1 rounded-full bg-ink-700/60" />
          </div>
        ))}
      </div>

      <div className="card mt-6 p-6 space-y-2.5">
        {[92, 78, 85, 60, 88, 45].map((w, i) => (
          <div key={i} className="h-2.5 rounded bg-ink-700/40" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

export default function JobDetail({ profile }) {
  const { jid } = useParams();
  const navigate = useNavigate();
  /* A job reached from the Tracker has to go back to the Tracker. Hardcoding
     /jobs dumped the user on a list they were not using, having lost their
     place on the board. Deep links still fall back to the Jobs list. */
  const from = useLocation().state?.from === "/tracker" ? "/tracker" : "/jobs";
  const [job, setJob] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [manager, setManager] = useState(null);
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState([]);
  const [outreach, setOutreach] = useState(null);
  // The posting opens inside Mapply, where the site is already signed in.
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    setJob(null);
    setLoadError(null);
    api
      .job(profile.id, jid)
      .then((j) => {
        setJob(j);
        setNotes(j?.notes || "");
      })
      .catch((e) => setLoadError(e.message));
    api
      .jobFiles(profile.id, jid)
      .then((d) => setFiles(d.files || []))
      .catch(() => setFiles([]));
  }, [profile.id, jid]);

  if (loadError)
    return (
      <div className="p-10 max-w-4xl mx-auto">
        <button className="text-sm text-mist-dim hover:text-mist-bright mb-4" onClick={() => navigate(from)}>
          {from === "/tracker" ? "← Back to tracker" : "← Back to jobs"}
        </button>
        <div className="card p-8 text-center">
          <div className="text-bad font-medium">Couldn't open this job</div>
          <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{loadError}</div>
        </div>
      </div>
    );
  if (!job) return <DetailSkeleton from={from} onBack={() => navigate(from)} />;

  const s = job.score;
  const tailored = ["tailored", "applied", "replied", "interview", "offer"].includes(job.status);

  /* Something worth messaging: a named person, or a company inbox when the search only
     turned up an address. A bare profile_url is a saved search, not a contact. */
  const contact = job.hiring_manager || {};
  const contactable = Boolean(contact.name || contact.email);

  /* Only PDFs are shown. The .html source and the .md copy stay on disk — the
     renderer needs the HTML to rebuild a packet and the outreach draft is read
     from the .md below — but they are never what you attach to an application,
     so listing them just makes the real documents harder to pick out. */
  const docs = files.filter((f) => f.format === "PDF");

  const saveNotes = () => api.patchJob(profile.id, job.id, { notes }).catch(() => {});
  const setStatus = (status) =>
    api.patchJob(profile.id, job.id, { status }).then((j) => setJob(j)).catch(() => {});

  /* Email contact -> a Gmail draft already addressed and written.
     LinkedIn only -> their profile, with the note ready to paste. Either way the
     drafted message sits in the side panel and the user sends it themselves. */
  const messageContact = async () => {
    let draft = {};
    try {
      const { files: fs } = await api.jobFiles(profile.id, job.id);
      const f = (fs || []).find((x) => /outreach.*\.md$/i.test(x.name));
      if (f) draft = parseOutreach(await api.jobFileText(profile.id, job.id, f.name));
    } catch {}
    const target = outreachTarget(contact, draft);
    if (target) setOutreach({ url: target.url, contact });
  };

  return (
    <div className="p-10 max-w-4xl mx-auto">
      {outreach && (
        <SiteBrowser
          url={outreach.url}
          title={`Message ${outreach.contact?.name || "hiring manager"}`}
          profile={profile}
          job={job}
          panel="outreach"
          contact={outreach.contact}
          onClose={() => setOutreach(null)}
        />
      )}
      {browsing && !outreach && (
        <SiteBrowser
          url={job.url}
          title={`${job.title} at ${job.company}`}
          profile={profile}
          job={job}
          onClose={() => setBrowsing(false)}
        />
      )}
      <button className="text-sm text-mist-dim hover:text-mist-bright mb-4" onClick={() => navigate(from)}>
        {from === "/tracker" ? "← Back to tracker" : "← Back to jobs"}
      </button>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-display font-bold">{job.title}</h1>
            <div className="text-mist-dim mt-1">
              {job.company}
              {job.location ? ` · ${job.location}` : ""}
              {job.posted_date ? ` · posted ${job.posted_date}` : ""}
            </div>
            <div className="flex gap-2 mt-3">
              <span className="chip bg-ink-700 text-mist">{SOURCE_LABELS[job.source] ?? job.source}</span>
              <span className="chip bg-royal/15 text-royal-light">{job.status}</span>
              {job.salary && <span className="chip bg-good/15 text-good">{job.salary}</span>}
            </div>
          </div>
          {s?.total_100 != null && (
            <div className="text-center shrink-0">
              <div className="text-4xl font-bold font-display text-royal-light">
                {Math.round(s.total_100)}
              </div>
              <div className="text-xs text-mist-dim">chance /100</div>
            </div>
          )}
        </div>
      </motion.div>

      <div className="flex gap-2 mt-6">
        <button className="btn-primary" onClick={() => setBrowsing(true)}>
          Open posting ↗
        </button>
        {tailored ? (
          <button
            className="btn-ghost"
            title="Moves this job out of the Jobs list and into your Tracker"
            onClick={() => setStatus("applied")}
          >
            Mark applied
          </button>
        ) : (
          <button
            className="btn-ghost"
            onClick={() =>
              alert('Open Claude Code in this workspace and say "apply for jobs" — it tailors your CV and cover letter for the top-scored jobs.')
            }
          >
            Tailor with Claude
          </button>
        )}
        {/* Once Claude has saved a reachable contact there is nothing left to find —
            the same button becomes the way to message them. */}
        {contactable ? (
          <button
            className="btn-ghost"
            title={
              contact.email
                ? `Opens a pre-addressed Gmail draft to ${contact.email}`
                : `Opens ${contact.name}'s LinkedIn with your drafted note alongside`
            }
            onClick={messageContact}
          >
            Message hiring manager
          </button>
        ) : (
          <button
            className="btn-ghost"
            onClick={() => api.hiringManager(profile.id, job.id).then(setManager).catch(() => {})}
          >
            Find hiring manager
          </button>
        )}
      </div>

      {/* Tailored documents — named after the role and company so they're
          obvious in a file dialog; draggable straight into an application form. */}
      {docs.length > 0 && (
        <div className="card p-5 mt-5">
          <h3 className="font-semibold mb-3">Your application documents</h3>
          <div className="space-y-2">
            {docs.map((f) => (
              <div
                key={f.name}
                className="flex items-center gap-3 bg-ink-900/60 border border-ink-700/50 rounded-xl px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{KIND_LABEL[f.kind] ?? f.name}</div>
                  <div className="text-xs text-mist-dim truncate">
                    {f.name} · {f.format} · {(f.size / 1024).toFixed(0)} KB
                  </div>
                </div>
                <a
                  href={api.fileUrl(profile.id, jid, f.name)}
                  draggable
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost !py-1.5 text-xs"
                  title="Open — or drag this straight into an upload field"
                >
                  Open
                </a>
                <a
                  href={api.fileUrl(profile.id, jid, f.name, true)}
                  download={f.name}
                  className="btn-ghost !py-1.5 text-xs"
                >
                  Download
                </a>
              </div>
            ))}
          </div>
          <p className="text-xs text-mist-dim mt-3">
            Drag <span className="text-mist">Open</span> into a job application's upload box, or
            download and attach it manually.
          </p>
        </div>
      )}

      {/* Saved hiring-manager contact from Claude's outreach pass */}
      {contactable && (
        <div className="card p-5 mt-5">
          <h3 className="font-semibold mb-2">Hiring contact</h3>
          <div className="text-sm">
            <span className="font-medium">{contact.name || contact.email}</span>
            {contact.title ? ` — ${contact.title}` : ""}
          </div>
          {contact.name && contact.email && (
            <div className="text-xs text-mist-dim mt-1">{contact.email}</div>
          )}
          <div className="flex gap-2 mt-3">
            <button
              className="btn-primary !py-1.5 text-xs"
              title={
                contact.email
                  ? "Opens a pre-addressed Gmail draft with your message alongside"
                  : "Opens their LinkedIn profile with your drafted note alongside"
              }
              onClick={messageContact}
            >
              Message hiring manager
            </button>
            {contact.profile_url && (
              <button
                className="btn-ghost !py-1.5 text-xs"
                onClick={() => openExternal(contact.profile_url)}
              >
                Open externally ↗
              </button>
            )}
          </div>
        </div>
      )}

      {manager && (
        <div className="card p-5 mt-5">
          <h3 className="font-semibold mb-2">Who to contact at {manager.company}</h3>
          <div className="flex flex-wrap gap-2">
            {manager.searches?.map((x) => (
              <button
                key={x.label}
                className="chip bg-royal/15 text-royal-light hover:bg-royal/25"
                onClick={() => openExternal(x.url)}
              >
                {x.label} ↗
              </button>
            ))}
          </div>
          {manager.emails_in_posting?.length > 0 && (
            <p className="text-sm text-good mt-3">Email in posting: {manager.emails_in_posting.join(", ")}</p>
          )}
          {manager.named_contact && (
            <p className="text-sm text-good mt-1">Named contact: {manager.named_contact}</p>
          )}
        </div>
      )}

      {s && (
        <div className="card p-5 mt-5">
          <h3 className="font-semibold mb-3">Score breakdown</h3>
          <div className="space-y-2">
            <Bar label="Requirements" value={s.requirements_match} />
            <Bar label="Seniority" value={s.seniority_fit} />
            <Bar label="Freshness" value={s.freshness} />
            <Bar label="Location" value={s.location_fit} />
          </div>
          {s.reasoning && <p className="text-sm text-mist italic mt-4">"{s.reasoning}"</p>}
          <div className="text-xs text-mist-dim mt-2">
            {s.seniority_note && <>seniority: {s.seniority_note}. </>}
            {s.domain_note && <>domain: {s.domain_note}.</>}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-4">
            {s.matched_skills?.map((x) => (
              <span key={x} className="chip bg-good/15 text-good">{x}</span>
            ))}
            {s.missing_skills?.map((x) => (
              <span key={x} className="chip bg-bad/15 text-bad">missing: {x}</span>
            ))}
          </div>
        </div>
      )}

      <div className="card p-5 mt-5">
        <h3 className="font-semibold mb-2">Notes</h3>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          placeholder="Interview prep, referral contacts, follow-up dates…"
          className="w-full h-24 bg-ink-950 border border-ink-700 rounded-xl px-4 py-3 text-sm
            outline-none focus:border-royal resize-y"
        />
      </div>

      {job.description && (
        <div className="card p-5 mt-5">
          <h3 className="font-semibold mb-3">Job description</h3>
          <p className="text-sm text-mist whitespace-pre-wrap leading-relaxed">{job.description}</p>
        </div>
      )}
    </div>
  );
}
