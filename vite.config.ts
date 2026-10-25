import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/._*"],
    // Geometry suites each load the measured paths and execute many FK checks.
    // Bound concurrency instead of weakening per-test timeouts under contention.
    maxWorkers: 2,
  },
  server: { watch: { ignored: ["**/._*"] } },
  optimizeDeps: { include: ["cubejs"] },
  build: { commonjsOptions: { include: [/vendor\/cubejs/, /node_modules/] } },
});
