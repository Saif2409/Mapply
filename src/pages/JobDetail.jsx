import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate, useParams } from "react-router-dom";
import { api, openExternal } from "../lib/api.js";

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

export default function JobDetail({ profile }) {
  const { jid } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [manager, setManager] = useState(null);
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState([]);

  useEffect(() => {
    api.jobs(profile.id).then((all) => {
      const j = all.find((x) => x.id === jid);
      setJob(j || null);
      setNotes(j?.notes || "");
    });
    api
      .jobFiles(profile.id, jid)
      .then((d) => setFiles(d.files || []))
      .catch(() => setFiles([]));
  }, [profile.id, jid]);

  if (!job) return <div className="p-10 text-mist-dim">Loading job…</div>;

  const s = job.score;
  const tailored = ["tailored", "applied", "replied", "interview", "offer"].includes(job.status);

  const saveNotes = () => api.patchJob(profile.id, job.id, { notes }).catch(() => {});
  const setStatus = (status) =>
    api.patchJob(profile.id, job.id, { status }).then((j) => setJob(j)).catch(() => {});

  return (
    <div className="p-10 max-w-4xl mx-auto">
      <button className="text-sm text-mist-dim hover:text-mist-bright mb-4" onClick={() => navigate("/jobs")}>
        ← Back to jobs
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
        <button className="btn-primary" onClick={() => openExternal(job.url)}>
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
        <button
          className="btn-ghost"
          onClick={() => api.hiringManager(profile.id, job.id).then(setManager).catch(() => {})}
        >
          Find hiring manager
        </button>
      </div>

      {/* Tailored documents — named after the role and company so they're
          obvious in a file dialog; draggable straight into an application form. */}
      {files.length > 0 && (
        <div className="card p-5 mt-5">
          <h3 className="font-semibold mb-3">Your application documents</h3>
          <div className="space-y-2">
            {files.map((f) => (
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
      {job.hiring_manager?.name && (
        <div className="card p-5 mt-5">
          <h3 className="font-semibold mb-2">Hiring contact</h3>
          <div className="text-sm">
            <span className="font-medium">{job.hiring_manager.name}</span>
            {job.hiring_manager.title ? ` — ${job.hiring_manager.title}` : ""}
          </div>
          <div className="flex gap-2 mt-3">
            {job.hiring_manager.profile_url && (
              <button
                className="btn-ghost !py-1.5 text-xs"
                onClick={() => openExternal(job.hiring_manager.profile_url)}
              >
                Open LinkedIn ↗
              </button>
            )}
            {job.hiring_manager.email && (
              <button
                className="btn-ghost !py-1.5 text-xs"
                onClick={() =>
                  openExternal(
                    `mailto:${job.hiring_manager.email}?subject=${encodeURIComponent(
                      `Application — ${job.title}`
                    )}`
                  )
                }
              >
                Email ↗
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
