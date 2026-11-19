import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { buildAuthModalFocusFixture } from "./fixtures/auth-modal-focus-fixture";

const source = ts.createSourceFile("AuthModal.tsx", readFileSync(
  new URL("../components/auth/AuthModal.tsx", import.meta.url), "utf8",
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Execute the actual dialog callbacks with synthetic DOM boundaries only.
function callback(name: string, bindings: Record<string, unknown>) {
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (!expression && ts.isJsxAttribute(node) && node.name.getText(source) === name
      && node.initializer && ts.isJsxExpression(node.initializer)
      && node.initializer.expression && ts.isArrowFunction(node.initializer.expression)) {
      expression = node.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!expression) throw new Error("AUTH_FOCUS_CALLBACK_MISSING");
  const compiled = ts.transpileModule(`return (${expression.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(bindings), compiled)(...Object.values(bindings)) as (event?: { preventDefault(): void }) => void;
}

class ElementBoundary {
  isConnected = true;
  focusCalls: Array<{ preventScroll?: boolean }> = [];
  focus(options: { preventScroll?: boolean }) { this.focusCalls.push(options); }
}

function fixture(active: unknown = new ElementBoundary()) {
  const body = new ElementBoundary();
  const document = { activeElement: active, body };
  const dialogOpenerRef = { current: null as ElementBoundary | null };
  const bindings = { document, dialogOpenerRef, HTMLElement: ElementBoundary };
  return {
    document, dialogOpenerRef,
    open: callback("onOpenAutoFocus", bindings),
    close: callback("onCloseAutoFocus", bindings),
  };
}

describe("controlled authentication dialog focus", () => {
  test("the browser fixture initializes actual modules without Node process before reaching the render entry", async () => {
    const script = await buildAuthModalFocusFixture(false);
    const renderEntry = new Error("AUTH_FIXTURE_RENDER_ENTRY_REACHED");
    let observed: unknown;
    try {
      runInNewContext(script, {
        console, setTimeout, clearTimeout, URL, URLSearchParams,
        TextEncoder, TextDecoder, AbortController, Response, Request, Headers, crypto,
        document: { getElementById() { throw renderEntry; } },
      }, { timeout: 3_000 });
    } catch (error) {
      observed = error;
    }
    // This proves module initialization only. Real DOM mount and keyboard focus
    // remain assertions of auth-modal-focus-browser.test.ts in pinned Chrome.
    expect(observed).toBe(renderEntry);
  });

  test("captures the real opener before autofocus and restores it once without scrolling", () => {
    const opener = new ElementBoundary();
    const f = fixture(opener);
    let prevented = 0;
    f.open({ preventDefault: () => { prevented++; } });
    expect(prevented).toBe(0);
    f.document.activeElement = new ElementBoundary();
    f.close({ preventDefault: () => { prevented++; } });
    expect(opener.focusCalls).toEqual([{ preventScroll: true }]);
    expect(prevented).toBe(1);
    expect(f.dialogOpenerRef.current).toBeNull();
    f.close({ preventDefault: () => { prevented++; } });
    expect(opener.focusCalls).toHaveLength(1);
    expect(prevented).toBe(1);
  });

  test("a removed opener after navigation or session UI change is not focused", () => {
    const opener = new ElementBoundary();
    const f = fixture(opener);
    f.open();
    opener.isConnected = false;
    let prevented = false;
    f.close({ preventDefault: () => { prevented = true; } });
    expect(opener.focusCalls).toEqual([]);
    expect(prevented).toBe(false);
    expect(f.dialogOpenerRef.current).toBeNull();
  });

  test("route-driven opening without an element does not create a body focus target", () => {
    const f = fixture(null);
    f.open();
    expect(f.dialogOpenerRef.current).toBeNull();
    f.document.activeElement = f.document.body;
    f.open();
    expect(f.dialogOpenerRef.current).toBeNull();
  });

  test("reopening captures the current opener rather than the preceding one", () => {
    const first = new ElementBoundary();
    const second = new ElementBoundary();
    const f = fixture(first);
    f.open();
    f.close({ preventDefault() {} });
    f.document.activeElement = second;
    f.open();
    f.close({ preventDefault() {} });
    expect(first.focusCalls).toHaveLength(1);
    expect(second.focusCalls).toEqual([{ preventScroll: true }]);
  });
});
