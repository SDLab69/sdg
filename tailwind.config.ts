import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: "#FAF7F2",
        "cream-2": "#EDE5D8",
        "cream-3": "#DDD0BC",
        border: "#A89880",
        ink: "#1A1410",
        "ink-2": "#3A2E26",
        "ink-3": "#6B5D52",
        terra: "#8B3220",
        "terra-pale": "#F5DDD8",
        sage: "#2D5E32",
        "sage-pale": "#D6EAD8",
        amber: "#B87A28",
        "amber-pale": "#FAE8C8",
        indigo: "#3A5A9B",
        "indigo-pale": "#E8EDF5",
        "indigo-text": "#1A3A6B",
        white: "#FFFFFF",
      },
    },
  },
  plugins: [],
};
export default config;
