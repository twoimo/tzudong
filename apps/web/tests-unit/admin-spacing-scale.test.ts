import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";

const sheet = postcss.parse(readFileSync(resolve(import.meta.dir, "../styles/admin-ui.css"), "utf8"));
const spacingProperty = /^(?:padding|margin)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?$|^(?:gap|row-gap|column-gap)$/;

describe("administrator spacing scale", () => {
  test("all explicit shared margins, padding and gaps follow a four-pixel grid", () => {
    const offGrid: string[] = [];
    let checked = 0;
    sheet.walkDecls(declaration => {
      if (!spacingProperty.test(declaration.prop)) return;
      for (const match of declaration.value.matchAll(/(-?\d*\.?\d+)(rem|px)\b/g)) {
        const pixels = Number(match[1]) * (match[2] === "rem" ? 16 : 1);
        checked++;
        if (Math.abs(pixels % 4) > 0.001) offGrid.push(`${declaration.source?.start?.line}: ${declaration.prop}: ${declaration.value}`);
      }
    });
    expect(checked).toBeGreaterThan(50);
    expect(offGrid).toEqual([]);
  });

  test("admin space tokens themselves are coherent, not an unrelated token list", () => {
    const tokens = new Map<string, string>();
    sheet.walkDecls(/^--admin-space-/, declaration => { tokens.set(declaration.prop, declaration.value); });
    expect(tokens.size).toBe(7);
    for (const [name, value] of tokens) {
      const step = Number(name.split("-").at(-1));
      expect(value).toBe(`${step * 4}px`);
    }
    const uses = new Set<string>();
    sheet.walkDecls(declaration => {
      for (const match of declaration.value.matchAll(/var\((--admin-space-\d+)\)/g)) uses.add(match[1]);
    });
    expect(uses.has("--admin-space-2")).toBe(true);
    expect(uses.has("--admin-space-3")).toBe(true);
    expect(uses.has("--admin-space-5")).toBe(true);
  });
});
