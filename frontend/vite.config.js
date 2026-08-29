import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    // Retain older hashed bundles so a tab that was already open during a
    // deployment can finish loading instead of going blank mid-refresh.
    emptyOutDir: false,
    rollupOptions: {
      output: {
        // Split the big, rarely-changing vendor libs into their own chunks so
        // a code change doesn't force re-downloading recharts/framer-motion,
        // and so the very first paint doesn't wait on charting code at all.
        manualChunks: {
          recharts: ["recharts"],
          "react-vendor": ["react", "react-dom"],
          "markdown-vendor": ["react-markdown", "remark-gfm"],
          "motion-vendor": ["framer-motion"],
        },
      },
    },
  },
});
