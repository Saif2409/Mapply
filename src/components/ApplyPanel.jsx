import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { buildFillScript } from "../lib/autofill.js";

const KB = (n) => (n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

const KIND_LABEL = {
  resume: "Tailored CV",
  cover_letter: "Cover letter",
  outreach: "Outreach message",
  other: "File",
};

function Row({ label, value, onCopy }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      className="w-full text-left px-3 py-2 rounded-lg hover:bg-ink-800/70 transition-colors group"
      onClick={() => {
        onCopy(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title="Copy"
    >
      <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-dim)" }}>
        {label}
      </div>
      <div className="text-sm truncate flex items-center gap-2">
        <span className="truncate">{value}</span>
        <span
          className="text-[10px] opacity-0 group-hover:opacity-100 shrink-0"
          style={{ color: "var(--accent)" }}
        >
          {copied ? "copied" : "copy"}
        </span>
      </div>
    </button>
  );
}

/**
 * Sits beside the embedded browser while applying.
 *
 * Fills the form's factual fields on request, and puts the tailored CV and cover
 * letter within reach — draggable straight into an upload box, since a real OS
 * file drag works on sites that reject a scripted file input.
 *
 * It never submits. The last click is always the user's: an application can't be
 * unsent, and a mis-filled field is worth more than the two seconds saved.
 */
export default function ApplyPanel({ profile, job, webviewRef, onClose }) {
  const [fields, setFields] = useState(null);
  const [files, setFiles] = useState([]);
  const [folder, setFolder] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copiedFolder, setCopiedFolder] = useState(null);

  useEffect(() => {
    api.autofill(profile.id).then(setFields).catch(() => {});
  }, [profile.id]);

  useEffect(() => {
    if (!job?.id) return;
    api
      .jobFiles(profile.id, job.id)
      .then((r) => {
        setFiles(r.files || []);
        setFolder(r.folder || "");
      })
      .catch(() => {
        setFiles([]);
        setFolder("");
      });
  }, [profile.id, job?.id]);

  const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {});

  /* Dragging only works where the site exposes a drop zone. LinkedIn and most
     ATS forms just open the OS file dialog instead, and nothing can be dragged
     into that.

     What gets copied is the FOLDER, not the file. Pasting a full file path into
     the dialog acts on that file immediately, which is the wrong move on a form
     that wants a specific slot filled. Pasting the folder navigates there and
     leaves both documents listed, so the right one is a click away. */
  const copyFolder = () => {
    if (!folder) return;
    copy(folder);
    setCopiedFolder(folder);
    setTimeout(() => setCopiedFolder(null), 1600);
  };

  const fillForm = async () => {
    const w = webviewRef.current;
    if (!w || !fields) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await w.executeJavaScript(buildFillScript(fields));
      setResult(r);
    } catch (e) {
      setResult({ error: String(e).slice(0, 160) });
    }
    setBusy(false);
  };

  const docs = files.filter((f) => f.format === "PDF");

  return (
    <aside className="w-80 shrink-0 border-l border-ink-800 flex flex-col overflow-y-auto"
           style={{ backgroundColor: "var(--bg)" }}>
      <div className="px-4 py-3 border-b border-ink-800 flex items-center gap-2">
        <span className="font-semibold text-sm flex-1 truncate">Apply helper</span>
        <button className="text-xs" style={{ color: "var(--text-dim)" }} onClick={onClose}>
          hide
        </button>
      </div>

      <div className="p-3">
        <button className="btn-primary w-full" onClick={fillForm} disabled={busy || !fields}>
          {busy ? "Filling…" : "Fill my details"}
        </button>
        {result && (
          <div className="text-xs mt-2 px-1" style={{ color: "var(--text-mid)" }}>
            {result.error ? (
              <span className="text-bad">{result.error}</span>
            ) : result.count ? (
              <>
                Filled <span className="text-good font-medium">{result.count}</span> of{" "}
                {result.fieldsSeen} fields — check them before submitting.
              </>
            ) : (
              <>
                No matching fields found on this page. The site may fill from your account
                profile, or the form is on a later step.
              </>
            )}
          </div>
        )}
      </div>

      {/* documents for this job */}
      <div className="px-3 pb-3">
        <div className="text-[10px] uppercase tracking-wide px-1 mb-1"
             style={{ color: "var(--text-dim)" }}>
          Tailored documents
        </div>
        {docs.length === 0 ? (
          <div className="text-xs px-1" style={{ color: "var(--text-dim)" }}>
            {job?.id
              ? "Not tailored yet — type “tailor” in Claude to generate them."
              : "Open a job to see its documents."}
          </div>
        ) : (
          docs.map((f) => (
            <div
              key={f.name}
              draggable
              onDragStart={(e) => {
                e.preventDefault(); // hand off to Electron's native file drag
                window.mapply?.startFileDrag?.(f.path);
              }}
              className="card !rounded-lg px-3 py-2 mb-2 cursor-grab active:cursor-grabbing"
              title="Drag into the site's upload box"
            >
              <div className="text-xs font-medium truncate">{KIND_LABEL[f.kind] ?? f.name}</div>
              <div className="text-[10px] truncate" style={{ color: "var(--text-dim)" }}>
                {f.name}
              </div>
              <div className="text-[10px] flex items-center gap-2 mt-1"
                   style={{ color: "var(--text-dim)" }}>
                <span>{KB(f.size)}</span>
                <span className="ml-auto" style={{ color: "var(--accent)" }}>drag →</span>
              </div>
            </div>
          ))
        )}

        {/* One folder for both documents — paste it into a file dialog's
            filename box to jump straight there and pick the file yourself. */}
        {docs.length > 0 && folder && (
          <button
            className="card !rounded-lg px-3 py-2 mb-2 w-full text-left hover:border-royal/40 transition-colors"
            onClick={copyFolder}
            title="Paste into the file dialog to open this folder"
          >
            <div className="text-xs font-medium">Containing folder</div>
            <div className="text-[10px] break-all" style={{ color: "var(--text-dim)" }}>
              {folder}
            </div>
            <div className="text-[10px] flex items-center gap-2 mt-1"
                 style={{ color: "var(--text-dim)" }}>
              <span>{docs.length} document{docs.length > 1 ? "s" : ""}</span>
              <span className="ml-auto" style={{ color: "var(--accent)" }}>
                {copiedFolder === folder ? "copied ✓" : "copy →"}
              </span>
            </div>
          </button>
        )}
      </div>

      {/* copyable facts, for the fields autofill can't reach */}
      <div className="px-1 pb-4">
        <div className="text-[10px] uppercase tracking-wide px-4 mb-1"
             style={{ color: "var(--text-dim)" }}>
          Your details
        </div>
        {fields && (
          <>
            <Row label="Full name" value={fields.full_name} onCopy={copy} />
            <Row label="Email" value={fields.email} onCopy={copy} />
            <Row label="Phone" value={fields.phone} onCopy={copy} />
            <Row label="Location" value={fields.location} onCopy={copy} />
            <Row label="LinkedIn" value={fields.linkedin} onCopy={copy} />
            <Row label="GitHub" value={fields.github} onCopy={copy} />
            <Row label="University" value={fields.university} onCopy={copy} />
            <Row label="Degree" value={fields.degree} onCopy={copy} />
            <Row label="Visa" value={fields.visa_status} onCopy={copy} />
            <Row label="Languages" value={fields.languages} onCopy={copy} />
          </>
        )}
      </div>

      <div className="mt-auto px-4 py-3 border-t border-ink-800 text-[11px]"
           style={{ color: "var(--text-dim)" }}>
        Upload box on the page? Drag the document onto it. Opens a file dialog instead?
        Copy the folder, paste it into the dialog's filename box, then pick the file.
        <div className="mt-2">
          Mapply never submits an application — review the form and click apply yourself.
        </div>
      </div>
    </aside>
  );
}
