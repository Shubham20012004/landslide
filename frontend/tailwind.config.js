/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "Consolas", "monospace"],
      },
      colors: {
        ink: { 950: "#070c17", 900: "#0b1220", 850: "#0e1729", 800: "#111b30", 750: "#152038", 700: "#1b2844", 600: "#25355a", 500: "#334670" },
        line: "#1f2d4a",
        accent: { DEFAULT: "#38bdf8", soft: "#0c4a6e" },
        safe: "#0ca30c",
        watch: "#fab219",
        warning: "#ec835a",
        critical: "#d03b3b",
        degraded: "#94a3b8",
      },
      boxShadow: { card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.6)" },
    },
  },
  plugins: [],
};
