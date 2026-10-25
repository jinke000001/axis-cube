# Pinned CFOP solver

This directory contains Scott McKenzie's **rubiks-cube-solver**, version 1.2.0,
from commit `7c4f292bf56bebd11bc498d0c33b25b94a9dc054` (2021-05-15):
<https://github.com/slammayjammay/rubiks-cube-solver/tree/7c4f292bf56bebd11bc498d0c33b25b94a9dc054>.
It implements separate cross, F2L pair, OLL and PLL solvers. It is **not** the
project's cubejs / Kociemba solver.

`upstream/` is the unchanged source snapshot. The two pinned dependencies are
also stored as source, so this application does not fetch algorithms or install
packages at runtime. Archive checksums and npm integrity hashes are recorded in
`provenance.json`; the npm archives were verified before extraction.

| Component              | Version             | License / source                                                                                              |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| rubiks-cube-solver     | 1.2.0, commit above | MIT, `upstream/LICENSE`                                                                                       |
| gl-vec3                | 1.0.3               | zlib, `dependencies/gl-vec3/LICENSE.md`; <https://github.com/stackgl/gl-vec3>                                 |
| array-element-combiner | 1.0.0               | MIT, `dependencies/array-element-combiner/LICENSE`; <https://github.com/slammayjammay/array-element-combiner> |

`index.js` is an unminified browser ESM bundle, with all license notices retained
in its banner. Rebuild offline from the project root with:

```sh
node vendor/rubiks-cube-solver/build.mjs
```

The existing development dependency esbuild performs bundling only. The checked
TypeScript boundary is `index.d.ts`. Application-specific adaptation, candidate
selection and independent 54-facelet verification live in `src/core/cfop.ts`.
That adapter changes the upstream U-cross frame to a D-cross frame and removes
virtual rotations when expressing wide / slice algorithms as six-face turns.
The returned stage boundaries remain boundaries of actual CFOP work.

The combiner's optional, undeclared `chalk` debug import is mapped at build time
to the project's no-color `debug-colors.js` adapter. The solver does not enable
that terminal debugging path. No upstream source file is changed.

The upstream algorithm table uses its own pattern identifiers, not official OLL
or PLL case numbers. The application must not display those identifiers as GAN
or WCA numbering. Four horizontal frame choices provide a bounded set of legal
alternatives; this does not claim a globally fastest human or robot solution.
