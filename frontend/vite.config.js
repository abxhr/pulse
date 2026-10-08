import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.PULSE_API || "http://localhost:8080",
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
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("recharts")) return "recharts";
          if (id.includes("react-markdown") || id.includes("remark-gfm")) return "markdown-vendor";
          if (id.includes("framer-motion")) return "motion-vendor";
          if (/node_modules[\\/](react|react-dom)[\\/]/.test(id)) return "react-vendor";
        },
      },
    },
  },
});
