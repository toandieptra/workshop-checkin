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
        "surface-muted": "#F4F1EC",
        ink: "#1A1A1A",
        muted: "#706B65",
        line: "#D0E5E8",
        success: "#5D8F5A",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
      },
      borderRadius: { sm: "8px", md: "12px", lg: "16px" },
    },
  },
  plugins: [],
};
export default config;
