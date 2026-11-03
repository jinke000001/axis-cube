import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { FORMULAS } from "./catalog";
import { SourceAlgorithm } from "./SourceAlgorithm";

describe("printed source formula in the player", () => {
  it("keeps a calibrating formula readable without actionable steps or a false active move", () => {
    const formula=FORMULAS.find(item=>item.id==='gan-f2l-03')!;
    const {document}=parseHTML(renderToStaticMarkup(createElement(SourceAlgorithm, {
      formula, active:0, completed:0, loopGroup:null, playable:false, onSeek:()=>{},
    })));
    expect(document.querySelectorAll('button:not([disabled])')).toHaveLength(0);
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
    expect(document.querySelector('.cd-formula')!.textContent!.replaceAll('′',"'").replace(/\s/g,''))
      .toBe(formula.algorithm.replace(/\s/g,''));
  });
  it("preserves the exact letters, brackets, repeats and directions for all 121 formulas", () => {
    for (const formula of FORMULAS) {
      const html = renderToStaticMarkup(
        createElement(SourceAlgorithm, {
          formula,
          active: 0,
          completed: 0,
          loopGroup: null,
          onSeek: () => {},
        }),
      );
      const { document } = parseHTML(html);
      const text = document
        .querySelector(".cd-formula")!
        .textContent!.replaceAll("′", "'")
        .replace(/\s/g, "");
      expect(text, formula.id).toBe(formula.algorithm.replace(/\s/g, ""));
      expect(document.querySelectorAll("button").length, formula.id).toBe(
        new Set(formula.steps.map((step) => step.printedIndex)).size,
      );
    }
  });
  it("highlights the same printed letter on the second pass through a repeated group", () => {
    const formula = FORMULAS.find((record) => record.id === "gan-f2l-12")!;
    const html = renderToStaticMarkup(
      createElement(SourceAlgorithm, {
        formula,
        active: 4,
        completed: 4,
        loopGroup: 1,
        onSeek: () => {},
      }),
    );
    const { document } = parseHTML(html);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(
      document
        .querySelector('[aria-current="step"]')!
        .getAttribute("aria-label"),
    ).toContain("第 1 个动作 R");
  });
});
