import { useEffect } from "react";
import { api } from "./api.js";

/**
 * Keep a page in step with job files that Claude changed.
 *
 * Scoring, tailoring and outreach all happen in Claude Code rather than in this
 * app, so there is no event for the UI to listen to. Refetching the whole job
 * list on a timer would move ~10MB every few seconds, so this polls a cheap
 * directory fingerprint (file count + newest mtime) and calls `reload` only when
 * it actually moves.
 *
 * The effect of that: jobs Claude scores show up on their own, and jobs it
 * tailors disappear from the Jobs page into the Tracker — without restarting.
 */
/**
 * @param needsData pass true when the page currently has nothing to show. The
 *   fingerprint alone can't recover a failed first load: it never changes, so a
 *   page whose initial fetch lost the race with a slow backend start would stay
 *   empty until you navigated away and back.
 */
export function useJobsSync(profileId, reload, needsData = false, intervalMs = 4000) {
  useEffect(() => {
    let stopped = false;
    let timer = null;
    let last = null;

    const tick = async () => {
      try {
        const rev = await api.jobsRevision(profileId);
        const key = `${rev.count}:${rev.mtime}`;
        // Reload when something changed, or when we have nothing yet but the
        // store says there is something to show.
        const recovering = needsData && rev.count > 0;
        // Skip the first reading otherwise: it establishes the baseline, and
        // reloading on it would just repeat the fetch the page did on mount.
        if (recovering || (last !== null && key !== last)) await reload();
        last = key;
      } catch {}
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };

    timer = setTimeout(tick, intervalMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [profileId, reload, needsData, intervalMs]);
}
