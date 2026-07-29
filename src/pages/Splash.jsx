import { useEffect } from "react";
import { motion } from "framer-motion";
import { THEMES } from "../lib/theme.js";

const letters = ["M", "a", "p", "p", "l", "y"];

export default function Splash({ onDone, theme }) {
  const badge = (THEMES[theme]?.wordmark ?? "plain") === "badge";

  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <motion.div
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden"
      style={{ backgroundColor: "var(--bg)" }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* ambient glow — tinted by the active theme */}
      <motion.div
        className="absolute w-[720px] h-[720px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--accent) 22%, transparent) 0%, color-mix(in srgb, var(--accent) 6%, transparent) 45%, transparent 70%)",
        }}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.6, ease: [0.2, 0.8, 0.2, 1] }}
      />

      {/* wordmark — letters fly in, then the badge block fades in behind "apply" */}
      <div className="relative flex items-baseline font-display font-bold text-7xl tracking-tight">
        <motion.span
          style={{ color: "var(--accent)" }}
          initial={{ opacity: 0, y: 34, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ delay: 0.25, duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
        >
          M
        </motion.span>

        <motion.span
          className={badge ? "ml-[0.06em] px-[0.16em] pb-[0.02em] rounded-[0.16em] flex" : "flex"}
          initial={badge ? { backgroundColor: "rgba(0,0,0,0)" } : false}
          animate={badge ? { backgroundColor: "var(--accent)" } : false}
          transition={{ delay: 0.85, duration: 0.45 }}
        >
          {letters.slice(1).map((ch, i) => (
            <motion.span
              key={i}
              style={{ color: badge ? "#FFFFFF" : "var(--wordmark-rest)" }}
              initial={{ opacity: 0, y: 34, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{
                delay: 0.34 + i * 0.09,
                duration: 0.55,
                ease: [0.2, 0.8, 0.2, 1],
              }}
            >
              {ch}
            </motion.span>
          ))}
        </motion.span>
      </div>

      <motion.p
        className="relative mt-4 text-sm tracking-[0.35em] uppercase"
        style={{ color: "var(--text-dim)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.15, duration: 0.6 }}
      >
        Apply smarter
      </motion.p>

      {/* progress shimmer */}
      <motion.div
        className="relative mt-12 h-[3px] w-56 rounded-full overflow-hidden"
        style={{ backgroundColor: "var(--border)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.0 }}
      >
        <motion.div
          className="absolute inset-y-0 w-1/3 rounded-full"
          style={{ backgroundColor: "var(--accent)" }}
          initial={{ x: "-120%" }}
          animate={{ x: "320%" }}
          transition={{ delay: 1.05, duration: 1.1, ease: "easeInOut" }}
        />
      </motion.div>
    </motion.div>
  );
}
