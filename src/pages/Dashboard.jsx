import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";

function Stat({ label, value, accent }) {
  return (
    <div className="card px-5 py-4 flex-1 min-w-[140px]">
      <div className={`text-3xl font-bold font-display ${accent ?? ""}`}>{value}</div>
      <div className="text-xs text-mist-dim mt-1 uppercase tracking-wider">{label}</div>
    </div>
  );
}

export default function Dashboard({ profile }) {
  const [stats, setStats] = useState(profile.stats);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .profiles()
      .then((all) => {
        const me = all.find((p) => p.id === profile.id);
        if (me) setStats(me.stats);
      })
      .catch(() => {});
  }, [profile.id]);

  return (
    <div className="p-10 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-display font-bold">
          Welcome back, <span className="text-royal-light">{profile.name}</span>
        </h1>
        <p className="text-mist-dim mt-1">Let's find your next role.</p>
      </motion.div>

      {/* Find Jobs hero */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="card mt-8 p-8 flex items-center justify-between gap-6 relative overflow-hidden"
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(600px 200px at 15% 0%, rgba(36,86,230,0.15), transparent 60%)",
          }}
        />
        <div className="relative">
          <h2 className="text-xl font-semibold">Scan the UAE job market</h2>
          <p className="text-mist-dim text-sm mt-1 max-w-md">
            Searches Indeed, LinkedIn, Bayt, GulfTalent, NaukriGulf, Tanqeeb, Google Jobs and your
            watchlist companies — new postings land in your Jobs list.
          </p>
        </div>
        <button
          className="btn-primary relative text-lg px-8 py-3 shadow-glowblue"
          onClick={() => navigate("/jobs?scan=1")}
        >
          Find Jobs
        </button>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16 }}
        className="flex gap-4 mt-6 flex-wrap"
      >
        <Stat label="Jobs found" value={stats.jobs_found} />
        <Stat label="Tailored" value={stats.tailored} accent="text-royal-light" />
        <Stat label="Applied" value={stats.applied} accent="text-good" />
      </motion.div>

      {/* How it works */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.24 }}
        className="card mt-6 p-6"
      >
        <h3 className="font-semibold mb-4">Your pipeline</h3>
        <ol className="grid grid-cols-4 gap-4 text-sm">
          {[
            ["1. Find", "Scrape every UAE source in one click."],
            ["2. Score", "Claude rates your real chance /100 per job."],
            ["3. Tailor", "Claude picks your best bullets & builds the CV."],
            ["4. Apply", "Opens signed in, details filled, files ready to drag."],
          ].map(([t, d]) => (
            <li key={t} className="bg-ink-900/60 rounded-xl p-4 border border-ink-700/50">
              <div className="font-semibold text-royal-light">{t}</div>
              <div className="text-mist-dim mt-1">{d}</div>
            </li>
          ))}
        </ol>
      </motion.div>
    </div>
  );
}
