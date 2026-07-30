import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, openExternal } from "../lib/api.js";
import TailorModal from "../components/TailorModal.jsx";
import ClaudeHandoff from "../components/ClaudeHandoff.jsx";
import { useJobsSync } from "../lib/useJobsSync.js";
import SiteBrowser from "../components/SiteBrowser.jsx";

const SOURCE_LABELS = {
  indeed: "Indeed", linkedin: "LinkedIn", bayt: "Bayt", glassdoor: "Glassdoor",
  google: "Google Jobs", watchlist: "Watchlist ATS", naukrigulf: "NaukriGulf",
  gulftalent: "GulfTalent", tanqeeb: "Tanqeeb",
  greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby",
  recruitee: "Recruitee", smartrecruiters: "SmartRecruiters", workday: "Workday",
  remote: "Remote", bigco: "Big employers", amazon: "Amazon", sap: "SAP",
  microsoft: "Microsoft",
};

function daysAgo(iso) {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "1d ago" : `${d}d ago`;
}

function ScoreBadge({ score }) {
  if (!score?.total_100 && score?.total_100 !== 0)
    return <span className="chip bg-ink-700 text-mist-dim">unscored</span>;
  const v = Math.round(score.total_100);
  const cls = v >= 70 ? "bg-good/15 text-good" : v >= 45 ? "bg-warn/15 text-warn" : "bg-bad/15 text-bad";
  return <span className={`chip ${cls} font-bold`}>{v}/100</span>;
}

function ScanPanel({ scan }) {
  const entries = Object.entries(scan.sources ?? {});
  if (!entries.length) return null;
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      className="card p-5 mb-6 overflow-hidden"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">
          {scan.running ? (
            <span className="text-royal-light">Scanning the UAE job market…</span>
          ) : (
            <span className="text-good">Scan complete</span>
          )}
        </h3>
        <div className="text-sm text-mist-dim">
          {scan.totals?.new ?? 0} new · {scan.totals?.duplicates ?? 0} duplicates
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {entries.map(([src, st]) => (
          <div key={src} className="bg-ink-900/70 rounded-lg px-3 py-2 border border-ink-700/50 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{SOURCE_LABELS[src] ?? src}</span>
              <span>
                {st.status === "pending" && (
                  <span className="inline-block w-2 h-2 rounded-full bg-mist-dim/50 animate-pulse" />
                )}
                {st.status === "running" && (
                  <span className="inline-block w-3 h-3 rounded-full border-2 border-royal border-t-transparent animate-spin" />
                )}
                {st.status === "done" && <span className="text-good">✓</span>}
                {st.status === "error" && <span className="text-bad" title={st.error}>✕</span>}
              </span>
            </div>
            {/* Counts stay at zero for the first several seconds while a source
                opens its connection, which read as "nothing is happening". Say
                what it's doing instead. */}
            <div className="text-[11px] text-mist-dim mt-0.5">
              {st.status === "pending"
                ? "queued…"
                : st.status === "error"
                ? "failed"
                : st.found || st.new
                ? `${st.new} new${st.found ? ` / ${st.found} found` : ""}`
                : st.status === "running"
                ? "searching…"
                : "nothing new"}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function ScorePanel({ score }) {
  if (!score || (!score.running && !score.total)) return null;
  const pct = score.total ? Math.round((score.done / score.total) * 100) : 0;
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      className="card p-5 mb-6 overflow-hidden"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">
          {score.running ? (
            <span className="text-royal-light">Scoring you against each job…</span>
          ) : (
            <span className="text-good">Scoring complete</span>
          )}
        </h3>
        <div className="text-sm text-mist-dim">
          {score.done}/{score.total}
          {score.model ? ` · ${score.model}` : ""}
        </div>
      </div>
      <div className="h-2 rounded-full bg-ink-700 overflow-hidden">
        <motion.div className="h-full bg-royal" animate={{ width: `${pct}%` }} />
      </div>
      {score.current && (
        <div className="text-xs text-mist-dim mt-2 truncate">{score.current}</div>
      )}
      {score.errors?.length > 0 && (
        <div className="text-xs text-bad mt-2">{score.errors.length} errors (see logs)</div>
      )}
    </motion.div>
  );
}

function ScoreDetail({ score }) {
  if (!score) return null;
  const bars = [
    ["Requirements", score.requirements_match],
    ["Seniority", score.seniority_fit],
    ["Freshness", score.freshness],
    ["Location", score.location_fit],
  ];
  return (
    <div className="mt-3 pt-3 border-t border-ink-700/60 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
      <div className="space-y-1.5">
        {bars.map(([label, v]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-24 text-mist-dim">{label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-ink-700 overflow-hidden">
              <div
                className="h-full bg-royal-light"
                style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%` }}
              />
            </div>
            <span className="w-8 text-right text-mist">{Math.round(v ?? 0)}</span>
          </div>
        ))}
      </div>
      <div>
        {score.reasoning && <p className="text-mist italic mb-2">"{score.reasoning}"</p>}
        {score.seniority_note && (
          <p className="text-mist-dim mb-2">Level: {score.seniority_note}</p>
        )}
        {score.matched_skills?.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {score.matched_skills.map((s) => (
              <span key={s} className="chip bg-good/15 text-good !text-[10px]">{s}</span>
            ))}
          </div>
        )}
        {score.missing_skills?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {score.missing_skills.map((s) => (
              <span key={s} className="chip bg-bad/15 text-bad !text-[10px]">missing: {s}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One job card, memoised.
 *
 * The list runs to thousands of rows, and without this every keystroke or
 * checkbox tick re-rendered all of them — a single toggle in select mode locked
 * the UI for over 30 seconds. Memoised, only the row that actually changed
 * re-renders. Callbacks are passed as stable references (useCallback in the
 * parent) and take the job/id as an argument, so the props stay equal.
 */
const JobRow = memo(function JobRow({
  job: j, selectMode, isSelected, isExpanded, manager,
  onToggleSelect, onToggleExpand, onTailor, onApply,
  onFindManager, onManagerHandoff, onOpenDetail, onBrowse,
}) {
  return (
    <div
      className="card !rounded-xl px-5 py-4 hover:border-royal/40 transition-colors"
      style={
        selectMode && isSelected
          ? { borderColor: "var(--accent)", backgroundColor: "var(--accent-soft)" }
          : undefined
      }
    >
      <div className="flex items-center gap-4">
        {selectMode && (
          <input
            type="checkbox"
            className="w-4 h-4 shrink-0 cursor-pointer"
            style={{ accentColor: "var(--accent)" }}
            checked={isSelected}
            onChange={() => onToggleSelect(j.id)}
            aria-label={`Select ${j.title}`}
          />
        )}
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() =>
            selectMode ? onToggleSelect(j.id) : onToggleExpand(isExpanded ? null : j.id)
          }
          data-job-title={j.title}
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{j.title}</span>
            <span className="chip bg-ink-700 text-mist-dim shrink-0">
              {SOURCE_LABELS[j.source] ?? j.source}
            </span>
          </div>
          <div className="text-sm text-mist-dim truncate mt-0.5">
            {j.company}
            {j.location ? ` · ${j.location}` : ""}
            {j.posted_date ? ` · ${daysAgo(j.posted_date)}` : ""}
            {j.salary ? ` · ${j.salary}` : ""}
          </div>
        </button>
        <ScoreBadge score={j.score} />
        {!selectMode &&
          (j.status === "tailored" ? (
            <button
              className="btn-primary !py-2 text-sm"
              title="Opens the posting and moves this job to your Tracker"
              onClick={() => onApply(j)}
            >
              Apply ↗
            </button>
          ) : (
            <button
              className="btn-ghost !py-2 text-sm"
              title="Tailor this CV with Claude"
              onClick={() => onTailor(j)}
            >
              Tailor
            </button>
          ))}
      </div>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <ScoreDetail score={j.score} />
            {j.description && (
              <p className="mt-3 text-xs text-mist-dim line-clamp-6 whitespace-pre-wrap">
                {j.description.slice(0, 700)}…
              </p>
            )}
            <div className="flex items-center gap-4 mt-3">
              <button
                className="text-xs text-royal-light hover:underline"
                title="Opens inside Mapply, signed in to the site"
                onClick={() => onBrowse(j)}
              >
                View original posting
              </button>
              <button
                className="text-xs text-royal-light hover:underline"
                onClick={() => onFindManager(j)}
              >
                Search LinkedIn
              </button>
              <button
                className="text-xs text-royal-light hover:underline"
                title="Claude finds the person and drafts the message"
                onClick={() => onManagerHandoff(j)}
              >
                Find hiring manager
              </button>
              <button
                className="text-xs text-royal-light hover:underline"
                onClick={() => onOpenDetail(`/jobs/${j.id}`)}
              >
                Full details →
              </button>
            </div>
            {manager && (
              <div className="mt-3 bg-ink-900/70 rounded-lg p-3 border border-ink-700/50">
                <div className="text-xs text-mist-dim mb-2">{manager.note}</div>
                <div className="flex flex-wrap gap-2">
                  {manager.searches?.map((s) => (
                    <button
                      key={s.label}
                      className="chip bg-royal/15 text-royal-light hover:bg-royal/25"
                      onClick={() => openExternal(s.url)}
                    >
                      {s.label} ↗
                    </button>
                  ))}
                </div>
                {manager.emails_in_posting?.length > 0 && (
                  <div className="text-xs text-good mt-2">
                    Email in posting: {manager.emails_in_posting.join(", ")}
                  </div>
                )}
                {manager.named_contact && (
                  <div className="text-xs text-good mt-1">
                    Named contact: {manager.named_contact}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// Rows rendered per page. The full list is thousands of jobs; putting them all in
// the DOM at once is what made the page sluggish before the cap.
const PAGE = 100;

/**
 * Where the user was on the Jobs page, kept outside React.
 *
 * Opening a job unmounts this page, so without this you come back to the top of
 * an unfiltered first page — losing your scroll, your filter, and every "Show
 * more" you clicked. Module scope rather than state: it has to survive the
 * unmount, and it should reset when the app restarts.
 */
const view = {
  profile: null,
  scrollTop: 0,
  limit: PAGE,
  filter: "",
  sort: "score",
  onlyScored: false,
};

export default function Jobs({ profile }) {
  const [jobs, setJobs] = useState([]);
  const [scan, setScan] = useState(null);
  const [score, setScore] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [managers, setManagers] = useState({});
  const [tailorJob, setTailorJob] = useState(null);
  const [managerHandoff, setManagerHandoff] = useState(null);
  const [scoreHandoff, setScoreHandoff] = useState(false);
  const [tailorBatch, setTailorBatch] = useState(false);
  // Restore what the user was looking at, but only for the same profile.
  const restore = view.profile === profile.id;
  const [sort, setSort] = useState(restore ? view.sort : "score");
  const [filter, setFilter] = useState(restore ? view.filter : "");
  const [onlyScored, setOnlyScored] = useState(restore ? view.onlyScored : false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [lastRemoved, setLastRemoved] = useState(null);
  const [limit, setLimit] = useState(restore ? view.limit : PAGE);
  const [browseTarget, setBrowseTarget] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const pollRef = useRef(null);
  const scorePollRef = useRef(null);

  // A swallowed failure here is what made the page look like it had no jobs at
  // all, so the error is kept and shown.
  const loadJobs = useCallback(
    () =>
      api
        .jobs(profile.id, { summary: true })
        .then((j) => {
          setJobs(j);
          setLoadError(null);
        })
        .catch((e) => setLoadError(e.message || "Couldn't load jobs"))
        .finally(() => setLoading(false)),
    [profile.id]
  );

  useJobsSync(profile.id, loadJobs, jobs.length === 0);

  const pollScan = useCallback(async () => {
    try {
      const s = await api.scanStatus(profile.id);
      setScan(s);
      if (s.running) {
        loadJobs();
        pollRef.current = setTimeout(pollScan, 2500);
      } else {
        loadJobs();
      }
    } catch {}
  }, [profile.id, loadJobs]);

  const startScan = useCallback(async () => {
    await api.startScan(profile.id).catch(() => {});
    pollScan();
  }, [profile.id, pollScan]);

  const pollScore = useCallback(async () => {
    try {
      const s = await api.scoreStatus(profile.id);
      setScore(s);
      if (s.running) {
        loadJobs();
        scorePollRef.current = setTimeout(pollScore, 2000);
      } else {
        loadJobs();
      }
    } catch {}
  }, [profile.id, loadJobs]);

  const findManager = useCallback(
    async (job) => {
      if (managers[job.id]) return;
      try {
        const data = await api.hiringManager(profile.id, job.id);
        setManagers((m) => ({ ...m, [job.id]: data }));
      } catch (e) {
        alert(e.message);
      }
    },
    [profile.id, managers]
  );

  const startScoring = useCallback(async () => {
    try {
      await api.startScoring(profile.id, { only_unscored: true });
      pollScore();
    } catch (e) {
      alert(e.message);
    }
  }, [profile.id, pollScore]);

  const toggleSelected = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  const enterSelectMode = useCallback(() => {
    setExpanded(null); // a card left open would swallow clicks meant for selecting
    setSelectMode(true);
  }, []);

  // Removing marks the jobs dismissed for THIS profile only. Nothing is deleted —
  // the id stays on disk so the next scan recognises the posting and doesn't
  // re-add it, and Undo simply flips the status back.
  const removeSelected = useCallback(async () => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      await api.dismissJobs(profile.id, ids);
      setLastRemoved(ids);
      exitSelectMode();
      loadJobs();
    } catch (e) {
      alert(e.message);
    }
  }, [profile.id, selected, exitSelectMode, loadJobs]);

  const undoRemove = useCallback(async () => {
    if (!lastRemoved) return;
    try {
      await api.dismissJobs(profile.id, lastRemoved, true);
      setLastRemoved(null);
      loadJobs();
    } catch (e) {
      alert(e.message);
    }
  }, [profile.id, lastRemoved, loadJobs]);

  // Open a posting in the in-app browser, where the site is already signed in.
  const browseJob = useCallback((job) => setBrowseTarget(job), []);

  // Applying opens the posting in the in-app browser and moves the job out of the
  // open pool into the Tracker, so the next top 50 is a different set of jobs.
  const applyToJob = useCallback(
    async (job) => {
      setBrowseTarget(job);
      try {
        await api.patchJob(profile.id, job.id, { status: "applied" });
        loadJobs();
      } catch {}
    },
    [profile.id, loadJobs]
  );

  useEffect(() => {
    loadJobs();
    pollScan();
    pollScore();
    if (params.get("scan") === "1") {
      setParams({}, { replace: true });
      startScan();
    }
    return () => {
      clearTimeout(pollRef.current);
      clearTimeout(scorePollRef.current);
    };
  }, [profile.id]); // eslint-disable-line

  // Once a job is tailored it belongs to the Tracker, not this list — so the
  // next top 50 works on a completely different set of jobs.
  const OPEN = new Set(["found", "scored"]);
  const openJobs = jobs.filter((j) => OPEN.has(j.status));
  // Counted separately: a dismissed job is neither open nor in the tracker, so
  // folding it into this number would inflate the tracker link.
  const removedCount = jobs.filter((j) => j.status === "dismissed").length;
  const movedOut = jobs.length - openJobs.length - removedCount;

  const rankedAll = [...openJobs].sort(
    (a, b) => (b.score?.total_100 ?? -1) - (a.score?.total_100 ?? -1)
  );
  const top50Ids = new Set(rankedAll.slice(0, 50).map((j) => j.id));

  // "Scored" means judged by Claude. Leftover scores from the local model are
  // not comparable — mixing the two would put badly-scored jobs into the top 50
  // that goes off for tailoring.
  const isScored = (j) => j.score?.model === "claude";
  const scoredCount = openJobs.filter(isScored).length;

  // Memoised so ticking a checkbox doesn't re-filter and re-sort thousands of jobs.
  const shown = useMemo(
    () =>
      openJobs
        .filter((j) => (sort === "top50" ? top50Ids.has(j.id) : true))
        .filter((j) => (onlyScored ? isScored(j) : true))
        .filter((j) => {
          if (!filter) return true;
          const q = filter.toLowerCase();
          return (
            j.title?.toLowerCase().includes(q) ||
            j.company?.toLowerCase().includes(q) ||
            j.location?.toLowerCase().includes(q) ||
            j.source?.toLowerCase().includes(q)
          );
        })
        .sort((a, b) => {
          if (sort === "score" || sort === "top50")
            return (b.score?.total_100 ?? -1) - (a.score?.total_100 ?? -1);
          if (sort === "date") return (b.posted_date ?? "").localeCompare(a.posted_date ?? "");
          return (a.company ?? "").localeCompare(b.company ?? "");
        }),
    [jobs, sort, filter, onlyScored] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Only a page of rows goes into the DOM; the rest is one click away.
  const visible = useMemo(() => shown.slice(0, limit), [shown, limit]);

  // Changing what's listed should start from the top again — but not on mount,
  // which would throw away a restored position. Compare the actual values
  // rather than tracking "is this the first run": StrictMode invokes effects
  // twice on mount, so a first-run flag is already false on the second pass and
  // the reset fires anyway.
  const prevQuery = useRef({ sort, filter, onlyScored });
  useEffect(() => {
    const p = prevQuery.current;
    if (p.sort === sort && p.filter === filter && p.onlyScored === onlyScored) return;
    prevQuery.current = { sort, filter, onlyScored };
    setLimit(PAGE);
    const el = document.querySelector("main");
    if (el) el.scrollTop = 0;
  }, [sort, filter, onlyScored]);

  // Record the position as it changes rather than on unmount. Saving in a
  // cleanup looked right but failed twice over: StrictMode mounts, unmounts and
  // remounts in development, so the cleanup overwrote the saved position with
  // zeros the moment the page opened; and in production a passive cleanup can
  // run after the rows are already detached, by which point the browser has
  // clamped scrollTop to 0.
  useEffect(() => {
    view.profile = profile.id;
    view.limit = limit;
    view.filter = filter;
    view.sort = sort;
    view.onlyScored = onlyScored;
  }, [profile.id, limit, filter, sort, onlyScored]);

  useEffect(() => {
    const el = document.querySelector("main");
    if (!el) return;
    const onScroll = () => {
      // Navigating away removes the rows, the container collapses, and the
      // browser clamps scrollTop to 0 — firing one last scroll event that would
      // otherwise overwrite the position we're trying to keep. Ignore readings
      // taken once the list is no longer long enough to scroll.
      if (el.scrollHeight <= el.clientHeight * 1.5) return;
      view.profile = profile.id;
      view.scrollTop = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [profile.id]);

  // Put the scroll back once the rows that were under it actually exist.
  // useLayoutEffect so it lands before paint instead of visibly jumping.
  const restored = useRef(!restore);
  useLayoutEffect(() => {
    if (restored.current || loading || visible.length === 0) return;
    const el = document.querySelector("main");
    if (!el || !view.scrollTop) return;
    // The list may still be growing; only settle once it can hold the offset.
    if (el.scrollHeight < view.scrollTop + el.clientHeight) return;
    el.scrollTop = view.scrollTop;
    restored.current = true;
  }, [loading, visible.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-10 max-w-6xl mx-auto">
      {browseTarget && (
        <SiteBrowser
          url={browseTarget.url}
          title={`${browseTarget.title} at ${browseTarget.company}`}
          profile={profile}
          job={browseTarget}
          onClose={() => setBrowseTarget(null)}
        />
      )}
      {tailorJob && (
        <TailorModal job={tailorJob} profile={profile} onClose={() => setTailorJob(null)} />
      )}
      {tailorBatch && (
        <TailorModal job={null} profile={profile} onClose={() => setTailorBatch(false)} />
      )}
      {scoreHandoff && (
        <ClaudeHandoff
          title="Score with Claude"
          blurb={`Claude reads each posting's real requirements and seniority demands and scores your actual chance. ${
            openJobs.filter((j) => !j.score).length
          } jobs still need scoring — it resumes where it left off if interrupted.`}
          command={`score jobs — profile ${profile.id}, 1000`}
          onClose={() => setScoreHandoff(false)}
        />
      )}
      {managerHandoff && (
        <ClaudeHandoff
          title="Find hiring manager"
          blurb={`Claude will identify who to contact at ${managerHandoff.company} and draft a personalised message.`}
          command={`find hiring managers — profile ${profile.id}, job ${managerHandoff.id} (${managerHandoff.title} at ${managerHandoff.company})`}
          onClose={() => setManagerHandoff(null)}
        />
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold">Jobs</h1>
          <p className="text-mist-dim text-sm mt-1">
            {openJobs.length} open
            {movedOut > 0 && (
              <>
                {" · "}
                <button className="hover:underline text-royal-light" onClick={() => navigate("/tracker")}>
                  {movedOut} in tracker →
                </button>
              </>
            )}
            {removedCount > 0 && ` · ${removedCount} removed`}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            className="btn-ghost"
            title="Score with the local Ollama model instead. Much slower (~9h for a full pass on this GPU) and less accurate — kept as an offline fallback."
            onClick={startScoring}
            disabled={score?.running || jobs.length === 0}
          >
            {score?.running ? "Scoring…" : "Score locally"}
          </button>
          <button
            className="btn-ghost"
            title="Claude scores each job on skills, seniority, requirements and recency"
            onClick={() => setScoreHandoff(true)}
            disabled={jobs.length === 0}
          >
            Score with Claude
          </button>
          <button
            className="btn-ghost"
            title="Claude tailors a CV and cover letter for your 50 best-scoring jobs, then moves them to the Tracker"
            onClick={() => setTailorBatch(true)}
            disabled={scoredCount === 0}
          >
            Tailor top 50
          </button>
          <button className="btn-primary" onClick={startScan} disabled={scan?.running}>
            {scan?.running ? "Scanning…" : "Find Jobs"}
          </button>
        </div>
      </div>

      <div className="mt-6">
        <AnimatePresence>{scan && (scan.running || scan.finished) && <ScanPanel scan={scan} />}</AnimatePresence>
        <AnimatePresence>{score && <ScorePanel score={score} />}</AnimatePresence>

        {/* controls */}
        <div className="flex items-center gap-3 mb-4">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by title, company, source…"
            className="flex-1 bg-ink-900 border border-ink-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-royal"
          />
          <button
            onClick={() => setOnlyScored((v) => !v)}
            title="Show only jobs Claude has scored. Scores left over from the local model aren't counted — they're on a different scale."
            className="rounded-xl px-4 py-2.5 text-sm border transition-colors whitespace-nowrap"
            style={{
              borderColor: onlyScored ? "var(--accent)" : "var(--border)",
              backgroundColor: onlyScored ? "var(--accent-soft)" : "transparent",
              color: onlyScored ? "var(--accent)" : "var(--text-mid)",
            }}
          >
            {onlyScored ? "✓ " : ""}Scored ({scoredCount})
          </button>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="bg-ink-900 border border-ink-700 rounded-xl px-3 py-2.5 text-sm outline-none"
          >
            <option value="score">Sort: score</option>
            <option value="top50">Show: top 50</option>
            <option value="date">Sort: newest</option>
            <option value="company">Sort: company</option>
          </select>
          <button
            onClick={() => (selectMode ? exitSelectMode() : enterSelectMode())}
            title="Pick jobs that aren't relevant to you and remove them. They won't come back on the next scan."
            className="rounded-xl px-4 py-2.5 text-sm border transition-colors whitespace-nowrap"
            style={{
              borderColor: selectMode ? "var(--accent)" : "var(--border)",
              backgroundColor: selectMode ? "var(--accent-soft)" : "transparent",
              color: selectMode ? "var(--accent)" : "var(--text-mid)",
            }}
          >
            {selectMode ? "Cancel" : "Remove jobs"}
          </button>
        </div>

        {/* selection bar — only while picking */}
        {selectMode && (
          <div
            className="flex items-center gap-3 mb-4 rounded-xl px-4 py-3 border"
            style={{ borderColor: "var(--accent)", backgroundColor: "var(--accent-soft)" }}
          >
            <span className="text-sm font-medium" style={{ color: "var(--accent)" }}>
              {selected.size} selected
            </span>
            <span className="text-xs" style={{ color: "var(--text-mid)" }}>
              Click a job to select it. Removing only affects {profile.id}'s list.
            </span>
            <div className="ml-auto flex gap-2">
              <button
                className="btn-ghost !py-1.5 text-sm"
                title="Selects every job matching the current filter, not just the ones on screen"
                onClick={() => setSelected(new Set(shown.map((j) => j.id)))}
                disabled={shown.length === 0}
              >
                Select all matching ({shown.length})
              </button>
              <button
                className="btn-primary !py-1.5 text-sm"
                onClick={removeSelected}
                disabled={selected.size === 0}
              >
                Remove {selected.size || ""}
              </button>
            </div>
          </div>
        )}

        {/* undo — removal is reversible, so say so */}
        {lastRemoved && !selectMode && (
          <div className="flex items-center gap-3 mb-4 rounded-xl px-4 py-3 border border-ink-700 bg-ink-900/70">
            <span className="text-sm" style={{ color: "var(--text-mid)" }}>
              Removed {lastRemoved.length} job{lastRemoved.length === 1 ? "" : "s"} from your
              list. They won't be added back by future scans.
            </span>
            <div className="ml-auto flex gap-2">
              <button className="btn-ghost !py-1.5 text-sm" onClick={undoRemove}>
                Undo
              </button>
              <button
                className="text-xs px-2"
                style={{ color: "var(--text-dim)" }}
                onClick={() => setLastRemoved(null)}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* list */}
        {loading ? (
          /* Skeleton rows rather than a spinner: the list keeps its shape, so the
             page doesn't jump when the real jobs arrive. */
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="card !rounded-xl px-5 py-4 animate-pulse"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="h-3.5 rounded bg-ink-700/70" style={{ width: `${45 + ((i * 7) % 30)}%` }} />
                    <div className="h-2.5 rounded bg-ink-700/40 mt-2" style={{ width: `${30 + ((i * 11) % 25)}%` }} />
                  </div>
                  <div className="h-6 w-16 rounded-full bg-ink-700/60 shrink-0" />
                  <div className="h-8 w-20 rounded-lg bg-ink-700/40 shrink-0" />
                </div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="card p-8 text-center">
            <div className="text-bad font-medium">Couldn't load your jobs</div>
            <div className="text-sm mt-1" style={{ color: "var(--text-mid)" }}>
              The backend may still be starting — this retries on its own.
            </div>
            <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{loadError}</div>
            <button className="btn-ghost mt-4" onClick={loadJobs}>
              Retry now
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div className="card p-12 text-center text-mist-dim">
            <div className="text-4xl mb-3">▤</div>
            No jobs yet — hit <span className="text-royal-light font-medium">Find Jobs</span> to scan
            every UAE source.
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {visible.map((j) => (
                <JobRow
                  key={j.id}
                  job={j}
                  selectMode={selectMode}
                  isSelected={selected.has(j.id)}
                  isExpanded={expanded === j.id}
                  manager={managers[j.id]}
                  onToggleSelect={toggleSelected}
                  onToggleExpand={setExpanded}
                  onTailor={setTailorJob}
                  onApply={applyToJob}
                  onFindManager={findManager}
                  onManagerHandoff={setManagerHandoff}
                  onOpenDetail={navigate}
                  onBrowse={browseJob}
                />
              ))}
            </div>
            {visible.length < shown.length && (
              <button
                className="btn-ghost w-full mt-3"
                onClick={() => setLimit((n) => n + PAGE)}
              >
                Show more — {shown.length - visible.length} remaining
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
