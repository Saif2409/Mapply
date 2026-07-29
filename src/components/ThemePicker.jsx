import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { THEMES } from "../lib/theme.js";

/**
 * Fixed "Themes" button in the bottom-right corner. Clicking it pops the theme
 * list open with each theme's name and colour swatch.
 */
export default function ThemePicker({ theme, setTheme }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="fixed bottom-5 right-5 z-40">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.16 }}
            className="card absolute bottom-full mb-2 right-0 p-2 w-48"
          >
            {Object.entries(THEMES).map(([key, t]) => {
              const active = key === theme;
              return (
                <button
                  key={key}
                  onClick={() => {
                    setTheme(key);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left"
                  style={{
                    backgroundColor: active ? "var(--accent-soft)" : "transparent",
                    color: active ? "var(--accent)" : "var(--text-mid)",
                  }}
                >
                  <span className="flex shrink-0">
                    <span
                      className="block w-3.5 h-3.5 rounded-full"
                      style={{ backgroundColor: t.swatch[0] }}
                    />
                    <span
                      className="block w-3.5 h-3.5 rounded-full -ml-1"
                      style={{
                        backgroundColor: t.swatch[1],
                        border: "1px solid rgba(128,128,128,0.4)",
                      }}
                    />
                  </span>
                  <span className="text-sm font-medium">{t.label}</span>
                  {active && <span className="ml-auto text-xs">✓</span>}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setOpen((o) => !o)}
        className="card px-4 py-2.5 flex items-center gap-2.5 text-sm font-medium
          hover:border-royal/50 transition-colors"
        style={{ color: "var(--text-mid)" }}
        title="Change theme"
      >
        <span className="flex shrink-0">
          <span
            className="block w-3.5 h-3.5 rounded-full"
            style={{ backgroundColor: THEMES[theme]?.swatch[0] }}
          />
          <span
            className="block w-3.5 h-3.5 rounded-full -ml-1"
            style={{
              backgroundColor: THEMES[theme]?.swatch[1],
              border: "1px solid rgba(128,128,128,0.4)",
            }}
          />
        </span>
        Themes
      </button>
    </div>
  );
}
