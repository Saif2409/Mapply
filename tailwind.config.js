/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Mapply brand
        royal: {
          DEFAULT: "#2456E6", // royal blue (the S)
          light: "#4F7DFF",
          dark: "#1A3FAE",
          glow: "#2456E655",
        },
        ink: {
          950: "#070B14", // app background
          900: "#0B1020",
          850: "#0F1628",
          800: "#141C33",
          700: "#1C2742",
          600: "#2A3757",
        },
        mist: {
          DEFAULT: "#AAB6D3",
          dim: "#6B7794",
          bright: "#E8EDFA",
        },
        good: "#2FBF71",
        warn: "#E8B341",
        bad: "#E05252",
      },
      fontFamily: {
        display: ["Segoe UI Variable Display", "Segoe UI", "Inter", "system-ui", "sans-serif"],
        body: ["Segoe UI Variable Text", "Segoe UI", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 10px 30px -12px rgba(0,0,0,0.6)",
        glowblue: "0 0 40px -8px #2456E680",
      },
      animation: {
        "fade-up": "fadeUp .5s cubic-bezier(.2,.8,.2,1) both",
      },
      keyframes: {
        fadeUp: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
