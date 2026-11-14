import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

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
