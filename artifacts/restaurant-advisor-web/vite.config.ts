import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    host: true,
    allowedHosts: true
  },
  preview: {
    host: true,
    allowedHosts: [
      "the-food-advisor-frontend.onrender.com",
      "www.thefoodadvisor.co.uk",
      "thefoodadvisor.co.uk"
    ]
  },
  build: {
    outDir: "dist"
  }
});