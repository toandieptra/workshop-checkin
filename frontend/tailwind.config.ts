import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Diep Tra design system
        brand: {
          DEFAULT: "#00B7CC",
          primary: "#00B7CC",
          accent: "#00A5B5",
          teal: "#0D3B42",
          gold: "#C9A84C",
          "gold-dark": "#4A3508",
          "gold-soft": "rgba(201, 168, 76, 0.12)",
        },
        surface: "#FFFFFF",
        "surface-muted": "#E8F4F5",
        ink: "#0D3B42",
        muted: "#3A6B74",
        line: "#D0E5E8",
        "border-strong": "#7AA5A8",
        success: "#2E8B8F",
        "success-soft": "rgba(46, 139, 143, 0.10)",
        "success-border": "rgba(46, 139, 143, 0.32)",
        warning: "#B8861A",
        error: "#C0392B",
        // Design system text colors — dùng text-text-primary/secondary
        text: {
          primary: "#0D3B42",
          secondary: "#3A6B74",
          muted: "#3A6B74",
        },
        cyan: {
          soft: "#A8D8E0",
          pale: "#C5E4E8",
          bg: "#E8F4F5",
        },
      },
      fontFamily: {
        sans: ["Be Vietnam Pro", "Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        heading: ["Montserrat", "Manrope", "Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
      },
      borderRadius: { sm: "8px", md: "12px", lg: "16px" },
    },
  },
  plugins: [],
};
export default config;
