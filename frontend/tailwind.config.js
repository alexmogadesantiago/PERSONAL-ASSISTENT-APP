/** @type {import('tailwindcss').Config} */
const rgb = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const shadow = (y, blur, a) => `0 ${y}px ${blur}px -${Math.round(blur / 3)}px rgb(var(--shadow-color) / calc(var(--shadow-strength) * ${a}))`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: rgb("bg"),
        surface: rgb("surface"),
        "surface-2": rgb("surface-2"),
        "surface-3": rgb("surface-3"),
        border: rgb("border"),
        "border-strong": rgb("border-strong"),
        muted: rgb("muted"),
        subtle: rgb("subtle"),
        fg: rgb("fg"),
        brand: { DEFAULT: rgb("brand"), fg: rgb("brand-fg") },
        accent: rgb("accent"),
        ok: rgb("ok"),
        warn: rgb("warn"),
        danger: rgb("danger"),
        info: rgb("info"),
      },
      fontFamily: {
        sans: ["Inter", "InterVariable", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", "14px"],
      },
      boxShadow: {
        "elev-1": shadow(1, 3, 0.6),
        "elev-2": `${shadow(4, 14, 0.7)}, ${shadow(1, 3, 0.4)}`,
        "elev-3": `${shadow(16, 40, 0.9)}, ${shadow(2, 6, 0.4)}`,
        glow: "0 0 0 1px rgb(var(--c-brand) / 0.35), 0 8px 30px -8px rgb(var(--c-brand) / 0.45)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
      },
      transitionDuration: {
        fast: "var(--motion-fast)",
        base: "var(--motion-base)",
        slow: "var(--motion-slow)",
      },
      zIndex: {
        header: "var(--z-header)",
        tabbar: "var(--z-tabbar)",
        overlay: "var(--z-overlay)",
        palette: "var(--z-palette)",
        toast: "var(--z-toast)",
      },
    },
  },
  plugins: [],
};
