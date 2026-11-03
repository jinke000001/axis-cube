import { describe, expect, it } from "vitest";
import {
  decodePreferences,
  DEFAULT_PREFERENCES,
  DEMO_PREFERENCE_KEY,
} from "./preferences";
describe("isolated demonstrator preferences", () => {
  it("does not reuse any of the legacy storage namespaces", () => {
    expect(DEMO_PREFERENCE_KEY).toBe("axis.cfop-demonstrator.v1");
  });
  it("keeps malformed, unknown and future data read-only", () => {
    for (const raw of [
      "{",
      "null",
      "[]",
      '{"version":2,"speed":1,"ghostHands":true}',
      '{"version":1,"speed":-1,"ghostHands":false}',
      '{"version":1,"speed":1,"ghostHands":"true"}',
    ]) {
      expect(decodePreferences(raw)).toBeNull();
    }
  });
  it("accepts only supported playback settings and handles a new install", () => {
    expect(decodePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(
      decodePreferences('{"version":1,"speed":0.35,"ghostHands":true}'),
    ).toEqual({ version: 1, speed: 0.35, ghostHands: true });
  });
});
