import { useEffect, useRef, useState } from "react";
import { openExternal } from "../lib/api.js";
import ApplyPanel from "./ApplyPanel.jsx";

/**
 * A real browser inside Mapply.
 *
 * Uses Electron's <webview> pointed at a persistent session partition, so a site
 * you sign into stays signed in across restarts — the same way a browser profile
 * works. Mapply never sees your password: you type it into this view, and only
 * Chromium's own cookie jar holds the session.
 *
 * Falls back to a message in the dev browser, where <webview> doesn't exist.
 */
export default function SiteBrowser({ url, title, onClose, profile, job }) {
  const ref = useRef(null);
  const [current, setCurrent] = useState(url);
  const [loading, setLoading] = useState(true);
  const [canGo, setCanGo] = useState({ back: false, forward: false });
  // The helper is only meaningful when we know whose details to fill.
  const [showPanel, setShowPanel] = useState(!!profile);
  const partition = window.mapply?.browserPartition ?? "persist:mapply-jobsites";
  const embedded = !!window.mapply?.isElectron;

  useEffect(() => {
    const w = ref.current;
    if (!w || !embedded) return;
    const start = () => setLoading(true);
    const stop = () => {
      setLoading(false);
      try {
        setCurrent(w.getURL());
        setCanGo({ back: w.canGoBack(), forward: w.canGoForward() });
      } catch {}
    };
    w.addEventListener("did-start-loading", start);
    w.addEventListener("did-stop-loading", stop);
    w.addEventListener("did-navigate", stop);
    w.addEventListener("did-navigate-in-page", stop);
    return () => {
      w.removeEventListener("did-start-loading", start);
      w.removeEventListener("did-stop-loading", stop);
      w.removeEventListener("did-navigate", stop);
      w.removeEventListener("did-navigate-in-page", stop);
    };
  }, [embedded]);

  const act = (fn) => () => {
    try {
      fn(ref.current);
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: "var(--bg)" }}>
      {/* chrome */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-800 shrink-0">
        <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={onClose} title="Back to Mapply">
          ← Done
        </button>
        <button
          className="btn-ghost !py-1.5 !px-3 text-sm disabled:opacity-40"
          disabled={!canGo.back}
          onClick={act((w) => w.goBack())}
        >
          ‹
        </button>
        <button
          className="btn-ghost !py-1.5 !px-3 text-sm disabled:opacity-40"
          disabled={!canGo.forward}
          onClick={act((w) => w.goForward())}
        >
          ›
        </button>
        <button className="btn-ghost !py-1.5 !px-3 text-sm" onClick={act((w) => w.reload())}>
          ⟳
        </button>
        <div
          className="flex-1 min-w-0 text-xs truncate px-3 py-1.5 rounded-lg border border-ink-700 bg-ink-900"
          style={{ color: "var(--text-mid)" }}
          title={current}
        >
          {loading ? "Loading…" : current}
        </div>
        {profile && embedded && (
          <button
            className="btn-ghost !py-1.5 !px-3 text-sm"
            onClick={() => setShowPanel((v) => !v)}
            title="Fill your details and reach your tailored documents"
          >
            {showPanel ? "Hide helper" : "Apply helper"}
          </button>
        )}
        <button
          className="btn-ghost !py-1.5 !px-3 text-sm"
          onClick={() => openExternal(current)}
          title="Open this page in your normal browser instead"
        >
          Open externally ↗
        </button>
      </div>

      {/* the page */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 bg-white">
        {embedded ? (
          <webview
            ref={ref}
            src={url}
            partition={partition}
            allowpopups="true"
            style={{ width: "100%", height: "100%", display: "inline-flex" }}
          />
        ) : (
          <div className="h-full flex items-center justify-center p-10 text-center">
            <div style={{ color: "var(--text-mid)" }}>
              <p className="mb-2 font-medium">The in-app browser only runs in the desktop app.</p>
              <p className="text-sm">
                You're viewing Mapply in a dev browser, which has no embedded Chromium.
              </p>
              <button className="btn-ghost mt-4" onClick={() => openExternal(url)}>
                Open {title || "this page"} externally ↗
              </button>
            </div>
          </div>
        )}
        </div>

        {profile && embedded && showPanel && (
          <ApplyPanel
            profile={profile}
            job={job}
            webviewRef={ref}
            onClose={() => setShowPanel(false)}
          />
        )}
      </div>
    </div>
  );
}
