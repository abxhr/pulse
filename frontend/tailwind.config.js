/** @type {import('tailwindcss').Config} */
// Domain colours are theme-aware channel triplets (see index.css) so text in
// light mode is legible while `bg-cardio/10`-style alpha modifiers still work.
const c = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    // Role-based radii: inputs/chips square-ish, surfaces a touch softer, pills only for status dots.
    borderRadius: {
      none: "0", sm: "3px", DEFAULT: "4px", md: "4px", lg: "6px", xl: "10px", "2xl": "12px", "3xl": "16px", full: "9999px",
    },
    extend: {
      colors: {
        ink: "var(--color-ink)",
        panel: "var(--color-panel)",
        panel2: "var(--color-panel2)",
        line: "var(--color-line)",
        txt: "var(--color-txt)",
        muted: "var(--color-muted)",
        faint: "var(--color-faint)",
        recovery: c("recovery"), // recovery / good
        effort: c("effort"),     // effort / heart / strain
        sleep: c("sleep"),
        cardio: c("cardio"),     // running / cardio
        strength: c("strength"), // strength / hevy
        nutrition: c("nutrition"),
      },
      fontFamily: {
        // Barlow Condensed = numerals and titles (timing-board signage); Instrument Sans = everything else.
        display: ["'Barlow Condensed'", "'Arial Narrow'", "system-ui", "sans-serif"],
        num: ["'Barlow Condensed'", "'Arial Narrow'", "system-ui", "sans-serif"],
        body: ["'Instrument Sans'", "system-ui", "sans-serif"],
        mono: ["'Instrument Sans'", "system-ui", "sans-serif"], // legacy class: small data text, tabular via CSS
      },
      boxShadow: {
        panel: "none",
        glow: "0 0 40px -8px var(--tw-shadow-color)",
      },
    },
  },
  plugins: [],
};
