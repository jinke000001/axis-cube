import { describe, expect, it } from "vitest";
import { FORMULAS } from "./catalog";
import { formulaHref, resolveFormulaRoute } from "./routes";
describe("CFOP links and retired tools", () => {
  it("round trips all 121 variants including original case deep links", () => {
    for (const record of FORMULAS) {
      const route = formulaHref(record.case.id, record.variant);
      expect(resolveFormulaRoute(route).formula.id).toBe(record.id);
    }
  });
  it("routes retired tools to selection rather than mounting old write flows", () => {
    for (const route of [
      "/learn",
      "/learn/white-daisy",
      "/solve",
      "/studio",
      "/studio/play",
      "/library/formulas/white-daisy/example",
      "/library/fingers/u",
      "/help",
    ]) {
      expect(resolveFormulaRoute(route).retired).toBe(true);
      expect(resolveFormulaRoute(route).formula).toBe(FORMULAS[0]);
    }
  });
  it("keeps the existing catalogue entry and catches unknown cases", () => {
    expect(resolveFormulaRoute("/library").retired).toBe(false);
    expect(resolveFormulaRoute("/library/cfop/gan-f2l-90").missing).toBe(true);
    expect(
      resolveFormulaRoute("/library/cfop/gan-oll-01?variant=1").missing,
    ).toBe(true);
  });
});
