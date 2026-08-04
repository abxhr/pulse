/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--color-ink)",
        panel: "var(--color-panel)",
        panel2: "var(--color-panel2)",
        line: "var(--color-line)",
        txt: "var(--color-txt)",
        muted: "var(--color-muted)",
        faint: "var(--color-faint)",
        recovery: "#3DD68C", // recovery / good
        effort: "#FF5C7A",   // effort / heart / strain
        sleep: "#7C83FF",    // sleep
        cardio: "#38BDF8",   // running / cardio
        strength: "#F5A623", // strength / hevy
        nutrition: "#2DD4BF", // nutrition / macros
      },
      fontFamily: {
        display: ["'Space Grotesk'", "system-ui", "sans-serif"],
        body: ["'Inter'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 32px -12px rgba(0,0,0,0.6)",
        glow: "0 0 40px -8px var(--tw-shadow-color)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: 0, transform: "translateY(8px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
      },
      animation: { rise: "rise 0.5s cubic-bezier(0.22,1,0.36,1) both" },
    },
  },
  plugins: [],
};
