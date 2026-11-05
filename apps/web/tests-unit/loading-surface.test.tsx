import { describe, expect, test } from "bun:test";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { LoadingPreview, LoadingProvider, LoadingSurface } from "../components/ui/loading-surface";

async function inspectHtml(html: string) {
    const scripts: { nonce: string | null; src: string | null }[] = [];
    let actionableCount = 0;
    const rewriter = new HTMLRewriter().on("script", {
        element(element) {
            scripts.push({ nonce: element.getAttribute("nonce"), src: element.getAttribute("src") });
        },
    });
    for (const tag of ["input", "button", "form", "a"]) {
        rewriter.on(tag, { element() { actionableCount += 1; } });
    }
    await rewriter.transform(new Response(html)).text();
    return { scripts, actionableCount };
}

describe("measured loading presentation", () => {
    test("SSR keeps samples inert and announces the pending state", () => {
        const html = renderToStaticMarkup(<LoadingSurface label="목록을 불러오는 중"><p>정적인 예시</p></LoadingSurface>);
        expect(html).toContain('role="status"');
        expect(html).toContain('aria-label="목록을 불러오는 중"');
        expect(html).toContain('aria-busy="true"');
        expect(html).toContain('aria-hidden="true"');
        expect(html).toMatch(/\sinert(?:="")?/);
        expect(html).not.toContain('data-slot="skeleton"');
    });

    test("every emitted SSR boot script retains the request nonce", async () => {
        const stream = await renderToReadableStream(<LoadingProvider nonce="request-specific-fixture"><LoadingPreview /><LoadingPreview kind="form" /></LoadingProvider>, { nonce: { script: "request-specific-fixture", style: "request-specific-fixture" } });
        const html = await new Response(stream).text();
        const { scripts } = await inspectHtml(html);
        expect(scripts.length).toBeGreaterThan(0);
        for (const script of scripts) {
            expect(script.nonce).toBe("request-specific-fixture");
            expect(script.src).toBeNull();
        }
        expect(html).not.toContain('src="http');
        expect(html).not.toContain('src="/');
    });

    test("the HTML parser handles tag case and quoted delimiters without treating attribute text as tags", async () => {
        const parsed = await inspectHtml(`
            <div data-preview="<script nonce='not-a-tag'>"></div>
            <SCRIPT data-note=">" NONCE="upper-fixture">throw new Error("PARSER_MUST_NOT_EXECUTE_SCRIPTS");</SCRIPT>
            <script nonce='lower-fixture' src='/fixture.js'></script>
            <scripted nonce="not-a-script"></scripted>
            <FORM><INPUT><BUTTON></BUTTON><A href="/fixture"></A></FORM>
        `);
        expect(parsed.scripts).toEqual([
            { nonce: "upper-fixture", src: null },
            { nonce: "lower-fixture", src: "/fixture.js" },
        ]);
        expect(parsed.actionableCount).toBe(4);
    });

    test("safe form samples render no input, link or actionable submit control", async () => {
        const html = renderToStaticMarkup(<LoadingPreview kind="form" rows={3} showHeader={false} />);
        expect((await inspectHtml(html)).actionableCount).toBe(0);
        expect(html.match(/입력 항목/g)?.length).toBe(3);
        expect(html).not.toContain('animate-pulse');
    });

    test("a malformed or excessive row count cannot create an unbounded fallback", () => {
        const excessive = renderToStaticMarkup(<LoadingPreview rows={100_000} showHeader={false} />);
        const invalid = renderToStaticMarkup(<LoadingPreview rows={Number.NaN} showHeader={false} />);
        expect(excessive.match(/맛집 이야기/g)?.length).toBe(24);
        expect(invalid.match(/맛집 이야기/g)?.length).toBe(3);
    });
});
