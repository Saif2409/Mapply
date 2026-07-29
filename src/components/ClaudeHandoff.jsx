import { useState } from "react";
import { motion } from "framer-motion";

/**
 * Hands a task over to Claude Code. A sandboxed renderer can't launch a terminal
 * app, so instead of pretending to, this copies the exact command to paste —
 * the skills on the Claude side recognise these phrasings and run without
 * asking any follow-up questions.
 */
export default function ClaudeHandoff({ title, blurb, command, steps, onClose }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const defaultSteps = [
    <>Open Claude Code in this workspace (<code className="text-mist-dim">Desktop\claude</code>).</>,
    <>Paste the command below and send it.</>,
    <>Claude does the work and the app updates automatically.</>,
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="card p-7 max-w-lg w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-display font-bold">{title}</h3>
        {blurb && <p className="text-mist-dim text-sm mt-2">{blurb}</p>}

        <ol className="mt-5 space-y-2.5 text-sm text-mist">
          {(steps ?? defaultSteps).map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-royal-light font-bold">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>

        <div className="mt-5 surface-input rounded-xl px-4 py-3 font-mono text-[12.5px] break-words">
          {command}
        </div>

        <div className="flex gap-2 mt-5">
          <button className="btn-primary flex-1" onClick={copy}>
            {copied ? "Copied ✓" : "Copy command"}
          </button>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}
