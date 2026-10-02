import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: { port: 5173, strictPort: true, host: "0.0.0.0" },
  build: { target: "es2020" },
});
