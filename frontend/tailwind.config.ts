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
        },
        surface: "#FFFFFF",
        "surface-muted": "#E8F4F5",
        ink: "#0D3B42",
        muted: "#5A8A92",
        line: "#D0E5E8",
        success: "#2E8B8F",
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
