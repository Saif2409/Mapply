import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { api, openExternal } from "../lib/api.js";
import ClaudeHandoff from "../components/ClaudeHandoff.jsx";
import { useJobsSync } from "../lib/useJobsSync.js";

const COLUMNS = [
  { key: "tailored", label: "Tailored", hint: "CV + letter ready to send" },
  { key: "applied", label: "Applied", hint: "submitted" },
  { key: "replied", label: "Replied", hint: "they responded" },
  { key: "interview", label: "Interview", hint: "in process" },
  { key: "offer", label: "Offer", hint: "🎉" },
];

const NEXT = {
  tailored: "applied",
  applied: "replied",
  replied: "interview",
  interview: "offer",
};

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default function Tracker({ profile }) {
  const [jobs, setJobs] = useState([]);
  const [handoff, setHandoff] = useState(null);
  const navigate = useNavigate();

  const load = useCallback(
    () => api.jobs(profile.id).then(setJobs).catch(() => {}),
    [profile.id]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Packets Claude tailors land straight in this board.
  useJobsSync(profile.id, load);

  const move = async (job, status) => {
    await api.patchJob(profile.id, job.id, { status }).catch(() => {});
    load();
  };

  const inPipeline = jobs.filter((j) => j.status !== "found" && j.status !== "scored");
  const byStatus = (s) => inPipeline.filter((j) => j.status === s);

  const needsFollowUp = jobs.filter(
    (j) => j.status === "applied" && (daysSince(j.applied_date ?? j.scraped_date) ?? 0) >= 5
  );
  const rejected = jobs.filter((j) => j.status === "rejected");
  const tailoredCount = byStatus("tailored").length;

  return (
    <div className="p-10 max-w-[1400px] mx-auto">
      {handoff && (
        <ClaudeHandoff
          {...handoff}
          profile={profile}
          onClose={() => setHandoff(null)}
        />
      )}

      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold">Tracker</h1>
          <p className="text-mist-dim text-sm mt-1">
            {inPipeline.length} in pipeline · {byStatus("applied").length} applied ·{" "}
            {byStatus("interview").length} interviewing
          </p>
        </div>
        {tailoredCount > 0 && (
          <button
            className="btn-ghost text-sm"
            onClick={() =>
              setHandoff({
                title: "Find hiring managers",
                blurb: `Claude will find the hiring manager or recruiter for your top jobs and draft a personalised message for each.`,
                command: `find hiring managers — profile ${profile.id}, top 50`,
              })
            }
          >
            Find hiring managers
          </button>
        )}
      </div>

      {needsFollowUp.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="card mt-6 p-4 border-warn/40"
        >
          <div className="font-semibold text-warn mb-1">
            {needsFollowUp.length} application{needsFollowUp.length > 1 ? "s" : ""} ready for follow-up
          </div>
          <div className="text-sm text-mist-dim">
            {needsFollowUp.slice(0, 6).map((j) => `${j.title} @ ${j.company}`).join(" · ")}
          </div>
          <button
            className="text-xs text-royal-light mt-2 hover:underline"
            onClick={() =>
              setHandoff({
                title: "Draft follow-ups",
                blurb: "Claude will write a short follow-up note for each application still waiting on a reply.",
                command: `draft follow-ups — profile ${profile.id}`,
              })
            }
          >
            Draft follow-ups with Claude →
          </button>
        </motion.div>
      )}

      <div className="grid grid-cols-5 gap-3 mt-6">
        {COLUMNS.map((col) => {
          const items = byStatus(col.key);
          return (
            <div key={col.key} className="min-w-0">
              <div className="flex items-baseline justify-between px-1 mb-2">
                <span className="font-semibold text-sm">{col.label}</span>
                <span className="text-xs text-mist-dim">{items.length}</span>
              </div>
              <div className="space-y-2 min-h-[120px]">
                {items.map((j) => (
                  <motion.div
                    key={j.id}
                    layout
                    className="card !rounded-xl p-3 text-sm hover:border-royal/40 transition-colors"
                  >
                    <button
                      className="text-left w-full"
                      onClick={() => navigate(`/jobs/${j.id}`)}
                      title="Open job details, resume and cover letter"
                    >
                      <div className="font-medium leading-tight line-clamp-2">{j.title}</div>
                      <div className="text-xs text-mist-dim mt-1 truncate">{j.company}</div>
                      {j.score?.total_100 != null && (
                        <div className="text-[11px] text-royal-light mt-1">
                          {Math.round(j.score.total_100)}/100
                        </div>
                      )}
                    </button>

                    {col.key === "tailored" && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        <span className="chip bg-good/15 text-good !text-[10px]">CV ready</span>
                        <button
                          className="text-[10px] px-2 py-0.5 rounded-md bg-ink-700 text-mist-dim hover:text-mist-bright"
                          onClick={() => navigate(`/jobs/${j.id}`)}
                        >
                          open files
                        </button>
                      </div>
                    )}

                    <div className="flex gap-1 mt-2">
                      {NEXT[j.status] && (
                        <button
                          className="text-[11px] px-2 py-1 rounded-lg bg-royal/15 text-royal-light hover:bg-royal/25"
                          onClick={() => move(j, NEXT[j.status])}
                        >
                          → {COLUMNS.find((c) => c.key === NEXT[j.status])?.label ?? NEXT[j.status]}
                        </button>
                      )}
                      {j.url && (
                        <button
                          className="text-[11px] px-2 py-1 rounded-lg bg-ink-700 text-mist-dim hover:text-mist-bright"
                          title="Open the job posting"
                          onClick={() => openExternal(j.url)}
                        >
                          ↗
                        </button>
                      )}
                      <button
                        className="text-[11px] px-2 py-1 rounded-lg bg-ink-700 text-mist-dim hover:text-bad ml-auto"
                        title="Mark rejected"
                        onClick={() => move(j, "rejected")}
                      >
                        ✕
                      </button>
                    </div>
                  </motion.div>
                ))}
                {items.length === 0 && (
                  <div className="text-xs text-mist-dim/60 px-1 py-6 text-center border border-dashed border-ink-700/60 rounded-xl">
                    {col.hint}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {rejected.length > 0 && (
        <div className="mt-8 text-sm text-mist-dim">
          <span className="font-medium">Closed ({rejected.length}):</span>{" "}
          {rejected.slice(0, 8).map((j) => j.company).join(", ")}
          {rejected.length > 8 ? "…" : ""}
        </div>
      )}
    </div>
  );
}
