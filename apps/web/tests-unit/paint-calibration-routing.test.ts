import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { isPaintCalibrationRequest, PAINT_CALIBRATION_REQUEST_HEADER } from '../lib/performance/paint-calibration-request';
import { isLoopbackHost, normalizeHostName } from '../lib/auth/loopback-host';

type Node = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
type FixtureResponse = { status: number; headers: Headers; forwardedHeaders?: Headers };

// Evaluate the actual proxy and root-layout module bodies against narrow server
// interfaces. This checks request derivation, JSX placement and nonce propagation
// without requiring a running Next server, credentials, project dependencies or
// network. It is not a production-build or browser-performance claim.
function evaluateModule(path: string, exportsExpression: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const transpiler = new Bun.Transpiler({ loader: 'tsx', target: 'node',
        tsconfig: { compilerOptions: { jsx: 'react', jsxFactory: 'jsx', jsxFragmentFactory: 'Fragment' } } });
    const transformed = transpiler.transformSync(source)
        .replace(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];?/g,
            (_all, names: string, specifier: string) => `const {${names.replace(/\bas\b/g, ':')}} = require(${JSON.stringify(specifier)});`)
        .replace(/import\s+([\w$]+)\s+from\s*["']([^"']+)["'];?/g,
            (_all, name: string, specifier: string) => `const ${name} = require(${JSON.stringify(specifier)}).default;`)
        .replace(/import\s*["']([^"']+)["'];?/g, (_all, specifier: string) => `require(${JSON.stringify(specifier)});`)
        .replace(/export default /g, '').replace(/export (?=(?:const|async function|function) )/g, '');
    const output: { value?: unknown } = {};
    runInNewContext(`${transformed}\noutput.value = ${exportsExpression};`, {
        require(specifier: string) {
            if (!(specifier in dependencies)) throw new Error(`Unexpected fixture dependency: ${specifier}`);
            return dependencies[specifier];
        },
        output, Headers, Request, URL, URLSearchParams, crypto, btoa,
        process: { env: { NODE_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) } },
        jsx(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Node {
            return { type, props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } };
        }, Fragment: 'fragment', ...globals,
    }, { timeout: 1000 });
    return output.value;
}

function proxyFixture() {
    const proxy = evaluateModule('../proxy.ts', 'proxy', {
        'next/server': { NextResponse: {
            next(value: { request: { headers: Headers } }): FixtureResponse { return { status: 200, headers: new Headers(), forwardedHeaders: value.request.headers }; },
            json(_body: unknown, options: { status?: number; headers?: Record<string, string> } = {}): FixtureResponse {
                return { status: options.status ?? 200, headers: new Headers(options.headers) };
            },
        } },
        '@/lib/e2e-admin-route-bypass': {
            E2E_ADMIN_ROUTE_BYPASS_HEADER: 'fixture-admin-header', E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER: 'fixture-admin-token',
            getE2EAdminRouteBypassExpectedToken: () => '', isE2EAdminRouteBypassEnvEnabled: () => false,
        },
        '@/lib/auth/dev-admin-bypass-cookie': { getDevAdminBypassCookieFromHeader: () => null, validateDevAdminBypassCookie: () => ({ ok: false }) },
        '@/lib/auth/loopback-host': { isLoopbackHost, normalizeHostName },
        '@/lib/auth/public-eligibility-session': { classifyPublicEligibilitySessionRoute: () => 'credentialless-public', isCredentiallessFieldVitalsPost: () => false },
        '@/lib/auth/auth-redirect': { isHomePrivacyOnboardingRequest: () => false },
        '@/lib/security/same-origin-mutation': { isTrustedSameOriginMutation: () => true },
        '@/lib/profile-avatar-url': { resolveConfiguredSupabaseOrigin: () => null },
        '@/lib/monitoring/sentry-dsn': { sentryIngestionOrigin: () => null },
        '@/lib/supabase-auth-session-hints': { hasSupabaseAuthCookieSessionHint: () => false },
        '@/lib/overseas-map-provider': { OVERSEAS_MAP_RESOURCE_ORIGIN: 'https://tiles.openfreemap.org' },
        '@/lib/performance/paint-calibration-request': { isPaintCalibrationRequest, PAINT_CALIBRATION_REQUEST_HEADER },
    }) as (request: { url: string; nextUrl: URL; method: string; headers: Headers }) => Promise<FixtureResponse>;
    return async (path: string, method = 'GET') => {
        const url = `https://www.tzudong.app${path}`;
        return proxy({ url, nextUrl: new URL(url), method, headers: new Headers({
            [PAINT_CALIBRATION_REQUEST_HEADER]: '1', 'x-nonce': 'spoofed-client-nonce',
            'content-security-policy': "script-src 'unsafe-inline'", 'x-unrelated-fixture': 'preserve-me',
        }) });
    };
}

async function renderLayout(headers: Headers) {
    let builds = 0;
    const layout = evaluateModule('../app/layout.tsx', 'RootLayout', {
        'next/headers': { headers: async () => headers },
        'next/font/local': { default: () => ({ variable: 'fixture-font', className: 'fixture-font-class' }) },
        'next/font/google': { Noto_Serif_KR: () => ({ variable: 'fixture-display-font' }) },
        '@/lib/seo': { DEFAULT_DESCRIPTION: '', DEFAULT_TITLE: '', OG_IMAGE_ALT: '', OG_IMAGE_PATH: '/fixture.png', SITE_NAME: 'fixture', SITE_URL: 'https://www.tzudong.app' },
        '@/lib/root-layout-resource-hints': { resolveRootLayoutResourceHintPolicy: () => ({ emitHostedResourceHints: false, supabasePreconnectUrl: null }) },
        './root-speed-insights': { RootSpeedInsights: 'fixture-speed-insights' },
        '@/components/home/LocalWorkspaceBanner': { LocalWorkspaceBanner: 'fixture-workspace-banner' },
        '@/components/ui/loading-surface': { LoadingProvider: 'fixture-loading-provider' },
        '@/lib/performance/paint-calibration-diagnostic': { buildPaintCalibrationDiagnosticScript: (sha: string) => { builds += 1; return `fixture-calibration:${sha}`; } },
        '@/lib/performance/paint-calibration-request': { PAINT_CALIBRATION_REQUEST_HEADER },
        './globals.css': {},
    }) as (props: { children: unknown }) => Promise<Node>;
    return { tree: await layout({ children: 'fixture-public-home' }), buildCount: () => builds };
}

function nodes(value: unknown): Node[] {
    if (Array.isArray(value)) return value.flatMap(nodes);
    if (!value || typeof value !== 'object' || !('type' in value) || !('props' in value)) return [];
    const node = value as Node;
    return [node, ...nodes(node.props.children)];
}

describe('paint calibration server request boundary', () => {
    test('proxy strips forged marker and derives it only for the exact public GET/HEAD request', async () => {
        const request = proxyFixture();
        for (const [path, method, expected] of [
            ['/', 'GET', false], ['/?__perf=initial-load', 'GET', false],
            ['/?__perf=paint-calibration', 'GET', true], ['/?__perf=paint-calibration', 'HEAD', true],
            ['/?__perf=paint-calibration', 'POST', false], ['/feed?__perf=paint-calibration', 'GET', false],
            ['/?__perf=paint-calibration&extra=1', 'GET', false],
            ['/?__perf=paint-calibration&__perf=paint-calibration', 'GET', false],
        ] as const) {
            const response = await request(path, method);
            expect(response.status).toBe(200);
            expect(response.forwardedHeaders?.get(PAINT_CALIBRATION_REQUEST_HEADER)).toBe(expected ? '1' : null);
            expect(response.forwardedHeaders?.get('x-unrelated-fixture')).toBe('preserve-me');
            expect(response.forwardedHeaders?.get('x-nonce')).not.toBe('spoofed-client-nonce');
            const policy = response.headers.get('content-security-policy')!;
            const scriptDirective = policy.split(';').find(part => part.trim().startsWith('script-src '))!;
            expect(response.forwardedHeaders?.get('content-security-policy')).toBe(policy);
            expect(scriptDirective).not.toContain("'unsafe-inline'");
            expect(scriptDirective).toContain(`'nonce-${response.forwardedHeaders?.get('x-nonce')}'`);
            expect(scriptDirective).toContain("'strict-dynamic'");
        }
    });

    test('exact derived request emits one nonce-bearing script in head before body; normal and near misses build none', async () => {
        const request = proxyFixture();
        for (const [path, expected] of [['/', false], ['/?__perf=paint-calibration&extra=1', false],
            ['/feed?__perf=paint-calibration', false], ['/?__perf=paint-calibration', true]] as const) {
            const response = await request(path);
            const rendered = await renderLayout(response.forwardedHeaders!);
            const all = nodes(rendered.tree);
            const scripts = all.filter(node => node.type === 'script');
            const head = all.find(node => node.type === 'head')!;
            const body = all.find(node => node.type === 'body')!;
            expect(rendered.buildCount()).toBe(expected ? 1 : 0);
            expect(scripts).toHaveLength(expected ? 1 : 0);
            expect(nodes(body).filter(node => node.type === 'script')).toHaveLength(0);
            if (expected) {
                expect(nodes(head).filter(node => node.type === 'script')).toHaveLength(1);
                expect(scripts[0]!.props.nonce).toBe(response.forwardedHeaders?.get('x-nonce'));
                expect((scripts[0]!.props.dangerouslySetInnerHTML as { __html: string }).__html).toBe(`fixture-calibration:${'a'.repeat(40)}`);
                expect(nodes(head)[1]!.type).toBe('script');
            }
        }
    });
});
