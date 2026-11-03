import { describe, expect, test } from "bun:test";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { LoadingPreview, LoadingProvider, LoadingSurface } from "../components/ui/loading-surface";

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
        const scripts = [...html.matchAll(/<script\b([^>]*)>/g)];
        expect(scripts.length).toBeGreaterThan(0);
        for (const script of scripts) expect(script[1]).toContain('nonce="request-specific-fixture"');
        expect(html).not.toContain('src="http');
        expect(html).not.toContain('src="/');
    });

    test("safe form samples render no input, link or actionable submit control", () => {
        const html = renderToStaticMarkup(<LoadingPreview kind="form" rows={3} showHeader={false} />);
        expect(html).not.toMatch(/<(?:input|button|form|a)\b/);
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
