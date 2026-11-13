import { expect, test } from "bun:test";
import { join } from "node:path";
import { chromium, expect as ui } from "@playwright/test";
import { chromeForTestingExecutable } from "./fixtures/chrome-for-testing";

const appRoot = join(import.meta.dir, "..");

async function buildFixture() {
  const entry = `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { Label } from "./components/ui/label";
    import { Separator } from "./components/ui/separator";
    import { Input } from "./components/ui/input";
    import { Checkbox } from "./components/ui/checkbox";
    import { Switch } from "./components/ui/switch";

    const trackRef = node => { if (node) node.dataset.refTag = node.tagName; };
    const trackMouseDown = event => {
      event.currentTarget.dataset.mouseDowns = String(Number(event.currentTarget.dataset.mouseDowns || 0) + 1);
    };
    function App() {
      const [checked, setChecked] = useState(false);
      const [enabled, setEnabled] = useState(false);
      return <main>
        <Label id="name-label" htmlFor="name" ref={trackRef} onMouseDown={trackMouseDown}>맛집 이름</Label>
        <Input id="name" defaultValue="합성 테스트 맛집" />
        <Checkbox id="consent" checked={checked} onCheckedChange={setChecked} />
        <Label htmlFor="consent">개인정보 동의</Label>
        <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
        <Label htmlFor="enabled">게시 상태</Label>
        <Label htmlFor="disabled">변경할 수 없는 값</Label>
        <Input id="disabled" disabled />
        <Label asChild htmlFor="slotted" ref={trackRef}><label id="slot-label">슬롯 필드</label></Label>
        <Input id="slotted" />
        <Label id="nested-label" onMouseDown={trackMouseDown}>
          내부 필드<Input id="nested-input" />
          <button id="nested-button" type="button">도움말</button>
        </Label>
        <Separator id="decorative" ref={trackRef} />
        <Separator id="horizontal" decorative={false} />
        <Separator id="vertical" decorative={false} orientation="vertical" />
        <Separator asChild decorative={false} orientation="vertical" ref={trackRef}>
          <div id="slot-separator" />
        </Separator>
      </main>;
    }
    createRoot(document.getElementById("root")).render(<App />);
  `;
  const result = await Bun.build({
    entrypoints: ["native-ui-fixture"], target: "browser", format: "iife", write: false,
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "native-ui-fixture", setup(builder) {
      builder.onResolve({ filter: /^native-ui-fixture$/ }, () => ({ path: "entry", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: entry, loader: "tsx", resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync("./" + args.path.slice(2), appRoot) }));
    } }],
  });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  return result.outputs[0].text();
}

test("native labels preserve real input, checkbox and switch activation, refs, and mouse handling", async () => {
  const script = await buildFixture();
  const browser = await chromium.launch({ executablePath: chromeForTestingExecutable(), headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => route.request().resourceType() === "document"
      ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><body><div id="root"></div></body></html>' })
      : route.abort());
    await page.goto("https://native-ui.test/");
    await page.addScriptTag({ content: script });

    const name = page.getByRole("textbox", { name: "맛집 이름", exact: true });
    await page.locator("#name-label").click();
    await ui(name).toBeFocused();
    await ui(name).toHaveValue("합성 테스트 맛집");
    await ui(page.locator("#name-label")).toHaveAttribute("data-ref-tag", "LABEL");

    const checkbox = page.getByRole("checkbox", { name: "개인정보 동의", exact: true });
    await page.locator('label[for="consent"]').click();
    await ui(checkbox).toBeChecked();
    await checkbox.focus();
    await page.keyboard.press("Space");
    await ui(checkbox).not.toBeChecked();

    const toggle = page.getByRole("switch", { name: "게시 상태", exact: true });
    await page.locator('label[for="enabled"]').click();
    await ui(toggle).toBeChecked();
    await toggle.focus();
    await page.keyboard.press("Space");
    await ui(toggle).not.toBeChecked();
    await page.locator('label[for="disabled"]').click();
    await ui(page.locator("#disabled")).not.toBeFocused();

    await page.locator("#slot-label").click();
    await ui(page.getByRole("textbox", { name: "슬롯 필드", exact: true })).toBeFocused();
    await ui(page.locator("#slot-label")).toHaveAttribute("data-ref-tag", "LABEL");

    const mouseDown = (id: string, detail: number) => page.locator(id).evaluate((element, clickCount) => {
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: clickCount });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    }, detail);
    expect(await mouseDown("#name-label", 1)).toBe(false);
    expect(await mouseDown("#name-label", 2)).toBe(true);
    await ui(page.locator("#name-label")).toHaveAttribute("data-mouse-downs", "3");
    expect(await mouseDown("#nested-input", 2)).toBe(false);
    expect(await mouseDown("#nested-button", 2)).toBe(false);
    await ui(page.locator("#nested-label")).not.toHaveAttribute("data-mouse-downs");

    await ui(page.locator("#decorative")).toHaveAttribute("role", "none");
    await ui(page.locator("#decorative")).toHaveAttribute("data-orientation", "horizontal");
    await ui(page.locator("#decorative")).toHaveAttribute("data-ref-tag", "DIV");
    await ui(page.getByRole("separator")).toHaveCount(3);
    await ui(page.locator("#horizontal")).not.toHaveAttribute("aria-orientation");
    await ui(page.locator("#vertical")).toHaveAttribute("aria-orientation", "vertical");
    await ui(page.locator("#slot-separator")).toHaveAttribute("aria-orientation", "vertical");
    await ui(page.locator("#slot-separator")).toHaveAttribute("data-ref-tag", "DIV");
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30_000);
