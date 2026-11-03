import { DexterousHand } from "../scene/hand";

/** Mechanical stations reuse one pair. Only the active registered exhibit may animate it. */
let hands: Promise<{ left: DexterousHand; right: DexterousHand }> | undefined;
export function loadMuseumHands() {
  hands ??= Promise.allSettled([DexterousHand.load("left"), DexterousHand.load("right")]).then(results => {
    const [left, right] = results;
    if (left.status === "fulfilled" && right.status === "fulfilled") return { left: left.value, right: right.value };
    results.forEach(result => { if (result.status === "fulfilled") result.value.dispose(); });
    hands = undefined;
    throw left.status === "rejected" ? left.reason : right.status === "rejected" ? right.reason : new Error("手部资源加载失败");
  });
  return hands;
}
