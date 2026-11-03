# Fixed OpenCV.js image geometry runtime

The application uses the official OpenCV **4.13.0** JavaScript/WASM release, served from the application's own origin at `/vendor/opencv/opencv-4.13.0.js`. It is loaded on first automatic photo analysis inside the existing module worker. No image, pixel, or calibration data is sent to OpenCV or any external service. This is a self-hosted runtime, not a promise that a first visit without network access will work.

The official [usage guide](https://docs.opencv.org/4.x/d0/d84/tutorial_js_usage.html) describes the docs-release archive and manual `Mat.delete()` resource management. The [build guide](https://docs.opencv.org/4.x/d4/da1/tutorial_js_setup.html) describes the default single-file embedded WASM build. This runtime is 10,962,269 bytes (3,541,918 bytes with gzip), so it is deliberately excluded from the main bundle. Both matrix storage and source/downsampled images are released after each analysis.

## Reproducible source and strict CSP adapter

Exact archive URL, archive/file/WASM SHA-256 hashes, byte sizes, documentation and license sources are in [source.json](source.json). The upstream file is `js/bin/opencv.js` inside `opencv-4.13.0-docs.zip`. Downloading the individual file from docs.opencv.org returned HTTP 403 in this environment; the official GitHub release archive was used instead.

Recreate the shipped bytes from the **unmodified** archive file:

```sh
node vendor/opencv/prepare.mjs /path/to/extracted/js/bin/opencv.js
```

The script first verifies the exact upstream SHA-256. It makes these narrowly scoped changes, leaving the embedded WASM bytes unchanged:

1. Replace the UMD wrapper's top-level `this` with `globalThis`, and declare its local `Module`. Module workers execute JavaScript in strict module scope, where top-level `this` is undefined and assigning undeclared variables fails.
2. Replace `createNamedFunction` and `makeDynCaller` dynamic `Function` construction with ordinary closures. The legal function name is retained with `Object.defineProperty`.
3. Replace `craftInvokerFunction` and `__emval_get_method_caller`, which indirectly use `new_(Function, ...)`, with equivalent static argument conversion, destructor handling, method dispatch, and return conversion. The native invoker's expected arity is retained.

These are **four** dynamic generation paths, not two; disabling string code generation in a VM exposed the two indirect paths after the initial source inspection. `prepare.mjs` rejects remaining direct/indirect patterns. Tests run the actual shipped file in `node:vm` with `strings: false, wasm: true`; runtime initialization and the image operations pass. Runtime callbacks are also adapted in the loader: upstream's `then` is a self-resolving callback API, so it must be removed after readiness before returning through a native Promise.

The loader forms an absolute same-origin URL from Vite's `BASE_URL` and the current origin. Vite 8 adds `?import` to root-relative dynamic import variables, causing a dev-server 500 for public assets; the absolute same-origin URL avoids that rewriting while preserving the deploy base.

The site's CSP needs `script-src 'self' 'wasm-unsafe-eval'`; it must **not** enable `unsafe-eval`. A real browser test of the production CSP is a separate integration check. Future OpenCV updates require reviewing the adapter and rerunning these checks; this script intentionally refuses different upstream bytes.

## Detector and sampling contract

`analyzeFace(image: ImageData, quad?: Quad): Promise<FaceAnalysis>` is implemented in `src/core/vision-image.ts`, with no DOM dependency. Detection downsamples only its working image to a 640-pixel long edge; dense sampling uses the original supplied pixels. Input/output corners share the same coordinate system, in clockwise top-left, top-right, bottom-right, bottom-left order. Explicit corners skip OpenCV and trigger manual sampling.

Automatic detection collects candidates from edges, multiple grayscale and channel-brightness thresholds, and chroma segmentation. It evaluates repeated 3 × 3 geometry using at least eight observed facelets, fits a projective map to all their centers, compares candidate residuals/scale consistency, and refuses a similarly plausible separate grid. A compact, closed circular center contour can anchor the grid, while surrounding candidates must remain quadrilaterals; a missing center or a grid made only of circles is refused. It does not select the largest quadrilateral or contain fixture-specific bounds. On no confident grid, it returns `quad: null`, no cells, and a user-facing explanation. Invalid inputs or unusable manual regions raise a descriptive error for the caller to show.

Successful analysis returns exactly nine finite colors. Each facelet is sampled across a 32 × 32 interior lattice, then excludes dark seams/logos and trims illumination extremes. White is preserved: bright neutral pixels are removed as glare only when a substantial colored population is also present. `coverage` and `glare` are fractions from 0 to 1. `spread` is the median Euclidean Lab distance from the retained pixels to the principal color. Up to four `alternatives` come from supported spatial quadrants, each requiring at least 14% of all interior samples; rare noise does not become an alternative.

## Verification and limits

`src/core/vision-image.test.ts` currently has 12 passing tests covering all six original 1920 × 1080 fixtures (6/6 located and 54 finite color samples), three synthetic perspective/offset cases, a real photograph scaled and rotated 13 degrees, thin neutral seams on a synthetic stickerless face, a plain white face, a center logo, localized glare covering over half a sticker's sampling region, irrelevant real machinery, a single quadrilateral, incomplete grids, and invalid/unusable manual regions. Real-photo sample values are compared with previously recorded independent annotations, rather than deriving expectations from detector output. The same six detected/area-sampled faces are also passed to joint classification, which must be ready and match all 54 independently annotated colors. Additional regression cases cover observed circular centers, missing centers, grids of circles, and isolated circles among unrelated squares. A second private six-JPEG research set initially failed at localization, exposed the circular-center gap, and passed after repair; it is now development evidence rather than an unseen accuracy set. These limited fixtures do not establish general real-world color accuracy.

[verification.json](verification.json) records one measured run on macOS arm64, Node 24.14.0: local runtime initialization about 118 ms; six analyses about 48–82 ms each after initialization, excluding PNG decode. It is not an iPhone/Safari or network performance measurement. The original six-image set is one cube under one camera/lighting condition, and cannot establish a population-level near-100% success rate.

Known boundaries: severe occlusion/blur or several merged facelets can leave fewer than eight geometric candidates; strong perspective beyond the tested range, cropped faces, or multiple equally plausible grids may require manual corners. Fully clipped color values contain no recoverable color information. A generic 3 × 3 array resembling cube facelets is geometrically ambiguous, so geometry alone cannot prove that an arbitrary grid is a physical cube. Quality metadata and later six-face consistency checks remain necessary.

OpenCV's Apache-2.0 license is shipped in `public/licenses/opencv.txt`; notices for its reported zlib, protobuf, flatbuffers dependencies, FLANN source, and Emscripten runtime are in `public/licenses/opencv-third-party/`. The exact Emscripten SDK version is not supplied by the binary's build information; the runtime license notice is included without claiming an SDK version.
