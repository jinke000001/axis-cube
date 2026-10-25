// Offline, reproducible build of the pinned source and pinned dependencies.
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const licenses = await Promise.all(
  [
    "upstream/LICENSE",
    "dependencies/gl-vec3/LICENSE.md",
    "dependencies/array-element-combiner/LICENSE",
  ].map((file) => readFile(resolve(root, file), "utf8")),
);
await build({
  absWorkingDir: root,
  entryPoints: ["upstream/src/index.js"],
  outfile: "index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "inline",
  alias: {
    "gl-vec3": resolve(root, "dependencies/gl-vec3"),
    "array-element-combiner": resolve(
      root,
      "dependencies/array-element-combiner",
    ),
    chalk: resolve(root, "debug-colors.js"),
  },
  banner: {
    js: `/*! Pinned CFOP vendor bundle. See README.md and provenance.json.\n${licenses.join("\n\n")}\n*/`,
  },
});
