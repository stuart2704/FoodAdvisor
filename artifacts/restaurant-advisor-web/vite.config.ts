import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
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