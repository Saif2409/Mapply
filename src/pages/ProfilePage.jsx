import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api, openExternal } from "../lib/api.js";

function Section({ title, children }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-6"
    >
      <h3 className="font-semibold text-lg mb-4">{title}</h3>
      {children}
    </motion.section>
  );
}

export default function ProfilePage({ profile }) {
  const [master, setMaster] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.master(profile.id).then(setMaster).catch((e) => setError(e.message));
  }, [profile.id]);

  if (error)
    return <div className="p-10 text-bad">Couldn't load master profile: {error}</div>;
  if (!master)
    return <div className="p-10 text-mist-dim animate-pulse">Loading profile…</div>;

  const personal = master.personal ?? {};
  const skills = master.skills ?? {};
  const flagship = (master.projects ?? []).filter((p) => p.tier === "flagship");
  const supporting = (master.projects ?? []).filter((p) => p.tier !== "flagship");

  return (
    <div className="p-10 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 rounded-2xl bg-royal flex items-center justify-center text-3xl font-bold text-white">
            {personal.name?.[0] ?? "?"}
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold">{personal.name}</h1>
            <div className="text-mist-dim text-sm mt-1">
              {personal.location} · {personal.email} · {personal.phone}
            </div>
            <div className="flex gap-2 mt-2">
              {personal.visa && <span className="chip bg-good/15 text-good">{personal.visa}</span>}
              {(personal.languages ?? []).map((l) => (
                <span key={l} className="chip bg-ink-700 text-mist">{l}</span>
              ))}
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            {personal.links?.github && (
              <button className="btn-ghost text-sm" onClick={() => openExternal(personal.links.github)}>
                GitHub
              </button>
            )}
            {personal.links?.linkedin && (
              <button className="btn-ghost text-sm" onClick={() => openExternal(personal.links.linkedin)}>
                LinkedIn
              </button>
            )}
          </div>
        </div>
        <p className="text-mist mt-5 leading-relaxed max-w-3xl">{master.summary_base}</p>
      </motion.div>

      {/* Experience */}
      <Section title="Experience">
        <div className="space-y-5">
          {(master.experience ?? []).map((e) => (
            <div key={`${e.company}-${e.start}`} className="border-l-2 border-royal/40 pl-4">
              <div className="flex items-baseline justify-between">
                <div className="font-semibold">
                  {e.company} <span className="text-mist-dim font-normal">— {e.title}</span>
                </div>
                <div className="text-xs text-mist-dim">{e.start} → {e.end}</div>
              </div>
              <ul className="mt-2 space-y-1 text-sm text-mist list-disc list-inside marker:text-royal/60">
                {(e.bullets ?? []).map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {/* Projects */}
      <Section title={`Flagship projects (${flagship.length})`}>
        <div className="space-y-4">
          {flagship.map((p) => (
            <details key={p.name} className="bg-ink-900/60 rounded-xl border border-ink-700/50 p-4 group">
              <summary className="cursor-pointer font-medium flex items-center justify-between list-none">
                <span>
                  {p.name}
                  {p.status === "in_development" && (
                    <span className="chip bg-warn/15 text-warn ml-2">in development</span>
                  )}
                </span>
                <span className="text-mist-dim text-xs group-open:rotate-180 transition-transform">▾</span>
              </summary>
              <div className="text-xs text-mist-dim mt-2">{p.context}</div>
              <ul className="mt-3 space-y-1.5 text-sm text-mist list-disc list-inside marker:text-royal/60">
                {(p.bullets ?? []).map((b, i) => <li key={i}>{b}</li>)}
              </ul>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {(p.keywords ?? []).slice(0, 10).map((k) => (
                  <span key={k} className="chip bg-ink-800 text-mist-dim !text-[10px]">{k}</span>
                ))}
              </div>
            </details>
          ))}
        </div>
        {supporting.length > 0 && (
          <div className="mt-4 text-xs text-mist-dim">
            + {supporting.length} supporting projects ({supporting.map((p) => p.name).join(", ")})
          </div>
        )}
      </Section>

      {/* Skills */}
      <Section title="Skills">
        <div className="space-y-3">
          {Object.entries(skills).map(([cat, list]) => (
            <div key={cat} className="flex gap-3">
              <div className="w-36 shrink-0 text-xs uppercase tracking-wider text-mist-dim pt-1">
                {cat.replace(/_/g, " ")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(list ?? []).map((s) => (
                  <span key={s} className="chip bg-ink-700 text-mist">{s}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Education + publications */}
      <Section title="Education & publications">
        {(master.education ?? []).map((ed) => (
          <div key={ed.institution}>
            <div className="font-medium">{ed.degree}</div>
            <div className="text-sm text-mist-dim">
              {ed.institution}, {ed.location} — {ed.graduation} · {ed.honours} ({ed.gpa})
            </div>
          </div>
        ))}
        {(master.publications ?? []).map((pub, i) => (
          <p key={i} className="text-sm text-mist mt-3 italic">{pub.citation}</p>
        ))}
      </Section>

      <p className="text-center text-xs text-mist-dim pb-6">
        This is your master profile — the arsenal Claude tailors every CV from. To edit it,
        ask Claude or open <code className="text-mist">profiles/{profile.id}/master_profile.yaml</code>.
      </p>
    </div>
  );
}
