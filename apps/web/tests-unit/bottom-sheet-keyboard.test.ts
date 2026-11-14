import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { shouldHideModalSibling } from "../components/ui/bottom-sheet";

const source = ts.createSourceFile("bottom-sheet.tsx", readFileSync(
  new URL("../components/ui/bottom-sheet.tsx", import.meta.url), "utf8",
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// Execute the production handlers against DOM boundaries. Portaled dialogs are
// React descendants while remaining outside the sheet's physical DOM subtree.
function handler(name: string, bindings: Record<string, unknown>) {
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      expression = ts.isCallExpression(node.initializer)
        ? node.initializer.arguments[0]
        : node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!expression) throw new Error("SHEET_KEYBOARD_HANDLER_MISSING");
  const compiled = ts.transpileModule(`return (${expression.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(bindings), compiled)(...Object.values(bindings)) as
    (event: { key: string; target?: unknown; defaultPrevented: boolean; preventDefault(): void }) => void;
}

describe("bottom sheet keyboard ownership", () => {
  function fixture() {
    const ownTarget = {};
    let closes = 0;
    const bindings = {
      isModal: true,
      sheetRef: { current: { contains: (target: unknown) => target === ownTarget } },
      onClose: () => { closes++; },
    };
    return {
      ownTarget,
      closes: () => closes,
      capture: handler("handleDialogKeyDown", bindings),
      window: handler("handleKeyDown", bindings),
    };
  }

  test("the sheet consumes its own Escape once before the window listener", () => {
    const f = fixture();
    const event = {
      key: "Escape", target: f.ownTarget, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    f.capture(event);
    f.window(event);
    expect(event.defaultPrevented).toBe(true);
    expect(f.closes()).toBe(1);
  });

  test("Escape already dismissed by a nested dialog does not close the sheet", () => {
    const f = fixture();
    const event = {
      key: "Escape", target: {}, defaultPrevented: true,
      preventDefault() { throw new Error("CHILD_ESCAPE_ALREADY_OWNED"); },
    };
    f.capture(event);
    f.window(event);
    expect(f.closes()).toBe(0);
  });

  test("portal keyboard events do not enter the parent's capture trap", () => {
    const f = fixture();
    for (const key of ["Tab", "Escape"]) {
      f.capture({
        key, target: {}, defaultPrevented: false,
        preventDefault() { throw new Error("PORTAL_KEYBOARD_STOLEN"); },
      });
    }
    expect(f.closes()).toBe(0);
  });
});

test("closing a modal sheet releases sibling inert state before restoring the opener", () => {
  let effect: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect"
      && node.arguments[0]?.getText(source).includes("previouslyFocusedElementRef.current = document.activeElement")) {
      effect = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!effect) throw new Error("SHEET_MODAL_LIFECYCLE_MISSING");

  class ElementBoundary {
    parentElement: ElementBoundary | null = null;
    children: ElementBoundary[] = [];
    attributes = new Map<string, string>();
    inert = false;
    isConnected = true;
    constructor(readonly tagName: string) {}
    contains(target: ElementBoundary): boolean { return target === this || this.children.some((child) => child.contains(target)); }
    hasAttribute(name: string) { return this.attributes.has(name); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    focus() {
      if (!this.inert) document.activeElement = this;
    }
  }
  const body = new ElementBoundary("BODY");
  const sheet = new ElementBoundary("DIV");
  const opener = new ElementBoundary("BUTTON");
  body.children = [opener, sheet];
  opener.parentElement = body;
  sheet.parentElement = body;
  opener.setAttribute("aria-hidden", "false");
  const document = { body, activeElement: opener, addEventListener() {}, removeEventListener() {} };
  const bindings = {
    isOpen: true,
    isModal: true,
    sheetRef: { current: sheet },
    previouslyFocusedElementRef: { current: null },
    hiddenModalSiblingStatesRef: { current: [] },
    focusTrapAllowSelectors: [],
    shouldHideModalSibling,
    HTMLElement: ElementBoundary,
    document,
    window: { setTimeout() { return 1; }, clearTimeout() {} },
  };
  const compiled = ts.transpileModule(`return (${effect.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mount = new Function(...Object.keys(bindings), compiled)(...Object.values(bindings)) as () => () => void;
  const cleanup = mount();
  expect(opener.inert).toBe(true);
  expect(opener.getAttribute("aria-hidden")).toBe("true");
  sheet.focus();
  expect(document.activeElement).toBe(sheet);
  cleanup();
  expect(opener.inert).toBe(false);
  expect(opener.getAttribute("aria-hidden")).toBe("false");
  expect(document.activeElement).toBe(opener);
});
