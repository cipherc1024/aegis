import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        base: "var(--bg-base)",
        sidebar: "var(--bg-sidebar)",
        card: "var(--bg-card)",
        input: "var(--bg-input)",
        hover: "var(--bg-hover)",
        "border-base": "var(--border-base)",
        "border-subtle": "var(--border-subtle)",
        "border-hover": "var(--border-hover)",
        primary: "var(--text-primary)",
        secondary: "var(--text-secondary)",
        tertiary: "var(--text-tertiary)",
        muted: "var(--text-muted)",
        cyan: "var(--accent-cyan)",
        green: "var(--accent-green)",
        amber: "var(--accent-amber)",
        red: "var(--accent-red)",
        purple: "var(--accent-purple)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
