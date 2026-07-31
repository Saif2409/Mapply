import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Wordmark from "../brand/Wordmark.jsx";
import { api } from "../lib/api.js";

// first profile uses the theme accent; the rest keep distinct, theme-neutral hues
const AVATAR_COLORS = [null, "#7C3AED", "#0E9F6E", "#D97706"];

export default function ProfileSelect({ onSelect, theme }) {
  const [profiles, setProfiles] = useState(null);
  const [error, setError] = useState(null);
  const [slow, setSlow] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .profiles()
      .then(setProfiles)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    const t = setTimeout(() => setSlow(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const create = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const p = await api.createProfile(newName.trim());
      setCreating(false);
      setNewName("");
      await load();
      onSelect(p);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex flex-col items-center justify-center relative overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(1000px 500px at 50% -10%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 60%)",
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative flex flex-col items-center"
      >
        <Wordmark theme={theme} size="text-4xl" />
        <p className="mt-2 text-mist-dim">Who's applying today?</p>

        {error && (
          <div className="mt-6 card px-4 py-3 text-sm max-w-md text-center">
            <div className="text-bad font-medium">Can't reach the Mapply backend</div>
            <div className="mt-1" style={{ color: "var(--text-mid)" }}>
              {window.mapply?.isElectron
                ? "It normally starts with the app. See %APPDATA%\\Mapply\\backend.log, then reopen Mapply."
                : "You're viewing Mapply in a browser, which can't start the backend — open the desktop app instead."}
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>{error}</div>
          </div>
        )}

        <div className="mt-10 flex flex-wrap items-stretch justify-center gap-5 max-w-3xl">
          {profiles === null && !error && (
            // Reads are retried for ~12s while Python boots. Without saying so, a
            // slow first start looks identical to the app being broken.
            <div className="text-mist-dim animate-pulse">
              {slow ? "Waiting for the backend to start…" : "Loading profiles…"}
            </div>
          )}

          {profiles?.map((p, i) => (
            <motion.button
              key={p.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.07 }}
              whileHover={{ y: -4, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelect(p)}
              className="card w-52 px-6 py-7 flex flex-col items-center gap-4 cursor-pointer
                hover:border-royal/60 hover:shadow-glowblue transition-[border,box-shadow]"
            >
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white"
                style={{
                  backgroundColor:
                    AVATAR_COLORS[i % AVATAR_COLORS.length] ?? "var(--accent)",
                }}
              >
                {p.name?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="text-center">
                <div className="font-semibold text-lg">{p.name}</div>
                <div className="text-xs text-mist-dim mt-1">
                  {p.stats.jobs_found} open · {p.stats.tailored} tailored ·{" "}
                  {p.stats.applied} applied
                </div>
                {!p.complete && (
                  <span className="chip bg-warn/15 text-warn mt-2">profile incomplete</span>
                )}
              </div>
            </motion.button>
          ))}

          {/* New profile card */}
          {!creating ? (
            <motion.button
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + (profiles?.length ?? 0) * 0.07 }}
              whileHover={{ y: -4 }}
              onClick={() => setCreating(true)}
              className="card w-52 px-6 py-7 flex flex-col items-center justify-center gap-3
                border-dashed cursor-pointer text-mist-dim hover:text-mist-bright
                hover:border-royal/60 transition-colors"
            >
              <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-ink-600
                flex items-center justify-center text-3xl">
                +
              </div>
              <div className="font-medium">New Profile</div>
            </motion.button>
          ) : (
            <div className="card w-52 px-5 py-7 flex flex-col items-center gap-4">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
                placeholder="Name"
                className="w-full bg-ink-900 border border-ink-600 rounded-lg px-3 py-2
                  text-center outline-none focus:border-royal"
              />
              <div className="flex gap-2 w-full">
                <button className="btn-ghost flex-1 !px-2 text-sm" onClick={() => setCreating(false)}>
                  Cancel
                </button>
                <button className="btn-primary flex-1 !px-2 text-sm" disabled={busy} onClick={create}>
                  Create
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
