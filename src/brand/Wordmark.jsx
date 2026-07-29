import { THEMES } from "../lib/theme.js";

/**
 * Two treatments, chosen by the active theme:
 *  - "badge": LinkedIn-style — accent "M", then "apply" reversed out of an
 *    accent block. Used by the light themes.
 *  - "plain": accent "M" + plain "apply". Used by the dark themes.
 */
export default function Wordmark({ theme, size = "text-3xl", className = "" }) {
  const style = THEMES[theme]?.wordmark ?? "plain";

  if (style === "badge") {
    return (
      <span
        className={`inline-flex items-baseline font-display font-bold tracking-tight select-none ${size} ${className}`}
      >
        <span style={{ color: "var(--accent)" }}>M</span>
        {/* colour is set inline, not via `text-white`: the light-theme utility
            remap in styles.css rewrites that class and would darken it */}
        <span
          className="ml-[0.06em] px-[0.16em] pb-[0.02em] rounded-[0.16em]"
          style={{ backgroundColor: "var(--accent)", color: "#FFFFFF" }}
        >
          apply
        </span>
      </span>
    );
  }

  return (
    <span className={`font-display font-bold tracking-tight select-none ${size} ${className}`}>
      <span style={{ color: "var(--accent)" }}>M</span>
      <span style={{ color: "var(--wordmark-rest)" }}>apply</span>
    </span>
  );
}
