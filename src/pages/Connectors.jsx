import { useCallback, useEffect, useState } from "react";
import { CONNECTORS } from "../lib/connectors.js";
import SiteBrowser from "../components/SiteBrowser.jsx";

/**
 * Sign in to the job sites once, inside Mapply, so applying doesn't bounce you
 * out to an external browser and ask you to log in again.
 *
 * Deliberately credential-free: Connect opens the site's own login page in the
 * embedded browser and you type your details there. Mapply only ever asks
 * Chromium "does this domain have a session cookie?" — it never reads the value,
 * and there is nowhere for it to store a password.
 */
export default function Connectors() {
  const [status, setStatus] = useState({});
  const [browsing, setBrowsing] = useState(null);
  const [checking, setChecking] = useState(false);
  const embedded = !!window.mapply?.isElectron;

  const refresh = useCallback(async () => {
    if (!window.mapply?.connectorStatus) return;
    setChecking(true);
    try {
      setStatus(await window.mapply.connectorStatus(CONNECTORS.map((c) => c.domain)));
    } catch {}
    setChecking(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Coming back from the browser is exactly when a new login would have happened.
  const closeBrowser = () => {
    setBrowsing(null);
    refresh();
  };

  const disconnect = async (c) => {
    if (!window.mapply?.connectorDisconnect) return;
    await window.mapply.connectorDisconnect(c.domain);
    refresh();
  };

  const connectedCount = CONNECTORS.filter((c) => status[c.domain]?.connected).length;

  return (
    <div className="p-10 max-w-6xl mx-auto">
      {browsing && (
        <SiteBrowser url={browsing.loginUrl} title={browsing.name} onClose={closeBrowser} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold">Connectors</h1>
          <p className="text-mist-dim text-sm mt-1">
            {connectedCount} of {CONNECTORS.length} connected · sign in once, stay signed in
          </p>
        </div>
        <button className="btn-ghost" onClick={refresh} disabled={checking}>
          {checking ? "Checking…" : "Refresh status"}
        </button>
      </div>

      <div className="card p-4 mt-6 text-sm" style={{ color: "var(--text-mid)" }}>
        Your password is never stored or seen by Mapply — you type it into the site's own
        login page inside the app, and only the browser session is kept. Disconnect clears
        that site's cookies.
      </div>

      {!embedded && (
        <div className="card p-4 mt-3 text-sm border-warn/40" style={{ color: "var(--text-mid)" }}>
          The embedded browser only runs in the desktop app — connecting from a dev browser
          won't persist a session.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mt-6">
        {CONNECTORS.map((c) => {
          const st = status[c.domain] ?? {};
          return (
            <div key={c.id} className="card !rounded-xl px-5 py-4 flex items-center gap-4">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center font-bold shrink-0 text-white"
                style={{ backgroundColor: st.connected ? "var(--accent)" : "var(--border)" }}
              >
                {c.name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold truncate">{c.name}</span>
                  {st.connected ? (
                    <span className="chip bg-good/15 text-good">✓ connected</span>
                  ) : c.optional ? (
                    <span className="chip bg-ink-700 text-mist-dim">no login needed</span>
                  ) : (
                    <span className="chip bg-ink-700 text-mist-dim">not connected</span>
                  )}
                </div>
                <div className="text-xs text-mist-dim truncate mt-0.5">{c.note}</div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button className="btn-ghost !py-2 text-sm" onClick={() => setBrowsing(c)}>
                  {st.connected ? "Open" : "Connect"}
                </button>
                {st.connected && (
                  <button
                    className="btn-ghost !py-2 text-sm"
                    title="Clear this site's cookies"
                    onClick={() => disconnect(c)}
                  >
                    Sign out
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
