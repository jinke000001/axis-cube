import { defineConfig } from "vite";
import { resolve } from "node:path";
import base from "./exhibition.vite.config.ts";

export default defineConfig({
  ...base,
  envDir: false,
  build: {
    ...base.build,
    outDir: process.env.AXIS_RELEASE_BUILD_DIR ?? "output/axis-netlify-u9-release-r1/build",
    sourcemap: false,
    copyPublicDir: false,
    rollupOptions: { input: { exhibition: resolve("exhibition-u9-r1/index.html") } },
  },
});
