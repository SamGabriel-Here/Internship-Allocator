import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds into ../static, which Flask serves. In dev, /api is proxied to Flask.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../static", emptyOutDir: true },
  server: { proxy: { "/api": `http://127.0.0.1:${process.env.API_PORT ?? 7860}` } },
});
