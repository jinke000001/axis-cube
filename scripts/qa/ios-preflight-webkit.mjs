import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { webkit } = require("../../../03-宣传影片/node_modules/playwright");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".txt": "text/plain; charset=utf-8",
};

function startStaticServer(rootDir) {
  const server = http.createServer((req, res) => {
    const urlPath = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    let filePath = path.join(rootDir, urlPath === "/" ? "index.html" : urlPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // SPA fallback for /library/* and /solve
      if (urlPath === "/solve" || urlPath.startsWith("/library")) {
        filePath = path.join(rootDir, "index.html");
      } else {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
    }
    const ext = path.extname(filePath);
    res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
    res.end(fs.readFileSync(filePath));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, origin: `http://127.0.0.1:${addr.port}` });
    });
  });
}

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1";

const PROFILES = [
  { name: "iPhone 16 Pro Portrait", width: 393, height: 852 },
  { name: "iPhone 16 Pro Landscape", width: 852, height: 393 },
  { name: "iPhone SE Portrait", width: 375, height: 667 },
  { name: "iPhone SE Landscape", width: 667, height: 375 },
  { name: "Compact 320 Portrait", width: 320, height: 568 },
];

async function run() {
  const argv = process.argv.slice(2);
  const siteArg = argv.includes("--site") ? argv[argv.indexOf("--site") + 1] : null;
  const defaultSite = fs.existsSync(path.resolve("output/axis-netlify-u10-release-r1/site/index.html"))
    ? "output/axis-netlify-u10-release-r1/site"
    : "output/axis-netlify-u9-release-r1/site";
  const siteDir = path.resolve(siteArg ?? defaultSite);
  if (!fs.existsSync(path.join(siteDir, "index.html"))) {
    throw new Error(`Site directory not found: ${siteDir}`);
  }

  const { server, origin } = await startStaticServer(siteDir);
  const browser = await webkit.launch({ headless: true });
  const results = [];

  try {
    for (const profile of PROFILES) {
      const context = await browser.newContext({
        userAgent: IPHONE_UA,
        viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      });

      await context.addInitScript(() => {
        window.__qaCameraMode = "synthetic";
        navigator.mediaDevices = navigator.mediaDevices || {};
        navigator.mediaDevices.getUserMedia = async () => {
          if (window.__qaCameraMode === "deny") {
            throw new DOMException("Permission denied", "NotAllowedError");
          }
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const ctx = canvas.getContext("2d");
          let frame = 0;
          const draw = () => {
            frame++;
            ctx.fillStyle = "#18222c";
            ctx.fillRect(0, 0, 640, 480);
            const colors = ["#ffffff", "#d9383a", "#268945", "#f2c629", "#e87025", "#2458b8"];
            for (let r = 0; r < 3; r++) {
              for (let c = 0; c < 3; c++) {
                ctx.fillStyle = colors[(r * 3 + c) % 6];
                ctx.fillRect(180 + c * 90, 100 + r * 90, 82, 82);
              }
            }
          };
          draw();
          const timer = setInterval(draw, 60);
          const stream = canvas.captureStream(15);
          const [track] = stream.getVideoTracks();
          const origStop = track.stop.bind(track);
          track.stop = () => {
            clearInterval(timer);
            origStop();
          };
          window.__qaActiveTrack = track;
          return stream;
        };
      });

      const page = await context.newPage();
      const consoleErrors = [];
      page.on("pageerror", (err) => consoleErrors.push(String(err)));

      // 1. Test CFOP Formula Demonstrator (/library/cfop/gan-f2l-40)
      await page.goto(`${origin}/library/cfop/gan-f2l-40`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => {
          const s = document.querySelector(".cfop-teaching-stage");
          return s?.dataset.availability === "available" && Number(s?.dataset.renderCount) >= 1;
        },
        null,
        { timeout: 15000 },
      );

      const cfopCheck = await page.evaluate(() => {
        const viewportMeta = document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "";
        const stage = document.querySelector(".cfop-teaching-stage");
        const playBtn = document.querySelector(".cd-play");
        const playRect = playBtn?.getBoundingClientRect();
        const scrubber = document.querySelector(".cd-scrubber .cd-timeline-range");
        const orientationPill = document.querySelector(".cd-orientation-pill");
        const viewTools = document.querySelectorAll(".cd-view-tools .cd-tool");
        return {
          viewportFitCover: viewportMeta.includes("viewport-fit=cover"),
          noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
          singleWebGLContext: stage?.dataset.contexts === "1",
          stageReady: stage?.dataset.availability === "available" && Number(stage?.dataset.renderCount) >= 1,
          scrubberPresent: Boolean(scrubber),
          orientationPillPresent: Boolean(orientationPill?.textContent?.includes("持方")),
          viewToolsPresent: viewTools.length >= 4,
          playVisible:
            Boolean(playRect) &&
            playRect.top >= 0 &&
            playRect.bottom <= window.innerHeight &&
            playRect.width >= 44 &&
            playRect.height >= 38,
        };
      });

      // 2. Test /solve Capture Entry & iOS Photo Library Branch + Live Synthetic Camera
      await page.goto(`${origin}/solve`, { waitUntil: "domcontentloaded" });
      await page.locator(".solve-empty .cd-play").click();
      await page.locator(".capture-workspace[open]").waitFor({ timeout: 5000 });

      const entryCheck = await page.evaluate(() => {
        const iosHelp = document.querySelector(".capture-import-help");
        const openCam = document.querySelector(".capture-entry-actions .primary-button");
        const importBtn = document.querySelector(".capture-entry-actions .secondary-button");
        const camRect = openCam?.getBoundingClientRect();
        const impRect = importBtn?.getBoundingClientRect();
        return {
          iosBranchActive: Boolean(iosHelp),
          openCamReachable:
            Boolean(camRect) && camRect.top >= 0 && camRect.bottom <= window.innerHeight,
          importReachable:
            Boolean(impRect) && impRect.top >= 0 && impRect.bottom <= window.innerHeight,
        };
      });

      // Open synthetic live camera and verify shutter is reachable
      await page.locator(".capture-entry-actions .primary-button").click();
      await page.locator(".capture-shutter").waitFor({ timeout: 5000 });

      const cameraCheck = await page.evaluate(() => {
        const shutter = document.querySelector(".capture-shutter");
        const rect = shutter?.getBoundingClientRect();
        const hit = rect
          ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          : null;
        const turnBadge = document.querySelector(".capture-turn-badge");
        return {
          shutterInViewport:
            Boolean(rect) &&
            rect.top >= 0 &&
            rect.bottom <= window.innerHeight &&
            rect.width >= 44 &&
            rect.height >= 44,
          shutterUnoccluded: Boolean(shutter && hit && (shutter === hit || shutter.contains(hit))),
          turnBadgePresent: Boolean(turnBadge),
        };
      });

      // Test camera permission denial recovery + manual fill palette counters on first profile
      let denialRecovered = true;
      let manualFillVerified = true;
      if (profile === PROFILES[0]) {
        await page.goto(`${origin}/solve`, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => {
          window.__qaCameraMode = "deny";
        });
        await page.locator(".solve-empty .cd-play").click();
        await page.locator(".capture-entry-actions .primary-button").click();
        await page.waitForSelector(".capture-feedback", { timeout: 5000 });
        denialRecovered = await page.evaluate(() => {
          const fb = document.querySelector(".capture-feedback");
          return Boolean(fb && fb.textContent.includes("相机"));
        });
        await page.locator('button[aria-label="更多录入操作"]').click();
        await page.locator(".capture-sheet button", { hasText: "直接手动填色" }).click();
        await page.waitForSelector(".cube-net.editable", { timeout: 5000 });
        manualFillVerified = await page.evaluate(() => {
          const counts = document.querySelectorAll(".color-palette .palette-count");
          const neighbors = document.querySelectorAll(".cube-net.editable .net-neighbors");
          return counts.length === 6 && neighbors.length === 6;
        });
      }

      const passed =
        cfopCheck.viewportFitCover &&
        cfopCheck.noHorizontalOverflow &&
        cfopCheck.singleWebGLContext &&
        cfopCheck.stageReady &&
        cfopCheck.scrubberPresent &&
        cfopCheck.orientationPillPresent &&
        cfopCheck.viewToolsPresent &&
        cfopCheck.playVisible &&
        entryCheck.iosBranchActive &&
        entryCheck.openCamReachable &&
        entryCheck.importReachable &&
        cameraCheck.shutterInViewport &&
        cameraCheck.shutterUnoccluded &&
        cameraCheck.turnBadgePresent &&
        denialRecovered &&
        manualFillVerified &&
        consoleErrors.length === 0;

      results.push({
        profile: profile.name,
        viewport: `${profile.width}x${profile.height}`,
        passed,
        cfopCheck,
        entryCheck,
        cameraCheck,
        denialRecovered,
        consoleErrors,
      });

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  const allPassed = results.every((r) => r.passed);
  console.log(JSON.stringify({ allPassed, siteDir, results }, null, 2));
  if (!allPassed) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
