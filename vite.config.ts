/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // Relative asset URLs, so the same dist/ works at any path: a GitHub Pages
  // project site (/rc-racer/), a Netlify/Vercel root, or a zip opened locally.
  base: "./",
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
