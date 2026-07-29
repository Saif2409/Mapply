import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../lib/api.js";

const FILES = [
  {
    key: "target_criteria.yaml",
    label: "Target criteria",
    hint: "Roles searched on every source, locations, salary floor and dealbreakers.",
  },
  {
    key: "watchlist.yaml",
    label: "Company watchlist",
    hint: "Companies whose career sites are polled directly. Pin an ATS with  Name | greenhouse:slug",
  },
];

function Editor({ profile, file }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(() => {
    api
      .profileFile(profile.id, file.key)
      .then((d) => {
        setText(d.content);
        setDirty(false);
      })
      .catch((e) => setError(e.message));
  }, [profile.id, file.key]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setError(null);
    try {
      await api.saveProfileFile(profile.id, file.key, text);
      setSaved(Date.now());
      setDirty(false);
      setTimeout(() => setSaved(null), 2500);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="font-semibold">{file.label}</h3>
          <p className="text-xs text-mist-dim mt-0.5">{file.hint}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {saved && <span className="chip bg-good/15 text-good">saved</span>}
          {dirty && !saved && <span className="chip bg-warn/15 text-warn">unsaved</span>}
          <button className="btn-ghost !py-1.5 text-sm" onClick={load}>
            Revert
          </button>
          <button className="btn-primary !py-1.5 text-sm" onClick={save} disabled={!dirty}>
            Save
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-2 text-sm text-bad bg-bad/10 border border-bad/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <textarea
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        className="w-full h-72 bg-ink-950 border border-ink-700 rounded-xl px-4 py-3
          font-mono text-[12.5px] leading-relaxed outline-none focus:border-royal resize-y"
      />
    </div>
  );
}

export default function Settings({ profile }) {
  const [criteria, setCriteria] = useState(null);
  const [models, setModels] = useState(null);

  useEffect(() => {
    api.criteria(profile.id).then(setCriteria).catch(() => setCriteria({}));
    api.models().then(setModels).catch(() => setModels({ models: [] }));
  }, [profile.id]);

  const roles = [
    ...(criteria?.roles?.primary ?? []),
    ...(criteria?.roles?.secondary ?? []),
  ];

  return (
    <div className="p-10 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-3xl font-display font-bold">Settings</h1>
        <p className="text-mist-dim text-sm mt-1">
          Edit these and hit Find Jobs again — changes take effect on the next scan.
        </p>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card p-5">
        <h3 className="font-semibold mb-3">Current search terms</h3>
        <div className="flex flex-wrap gap-2">
          {roles.length ? (
            roles.map((r) => (
              <span key={r} className="chip bg-royal/15 text-royal-light">{r}</span>
            ))
          ) : (
            <span className="text-mist-dim text-sm">none configured</span>
          )}
        </div>
        <p className="text-xs text-mist-dim mt-3">
          Every term above is searched on Indeed, LinkedIn, Bayt, GulfTalent and NaukriGulf,
          plus a separate remote-jobs pass.
        </p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card p-5">
        <h3 className="font-semibold mb-2">Scoring model</h3>
        <div className="flex flex-wrap gap-2">
          {(models?.models ?? []).map((m) => (
            <span
              key={m}
              className={`chip ${m === models?.default ? "bg-good/15 text-good" : "bg-ink-700 text-mist"}`}
            >
              {m}
              {m === models?.default ? " (in use)" : ""}
            </span>
          ))}
          {models && models.models.length === 0 && (
            <span className="text-bad text-sm">Ollama isn't running — Score Me will fail.</span>
          )}
        </div>
        <p className="text-xs text-mist-dim mt-3">
          Seniority and domain relevance are computed in code; the model only judges skills match.
        </p>
      </motion.div>

      {FILES.map((f) => (
        <motion.div key={f.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Editor profile={profile} file={f} />
        </motion.div>
      ))}

      <p className="text-center text-xs text-mist-dim pb-6">
        Your master profile is edited by Claude, not here — ask it to add a project or skill.
      </p>
    </div>
  );
}
