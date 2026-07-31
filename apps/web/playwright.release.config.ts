import { defineConfig, devices, type PlaywrightTestProject } from '@playwright/test';

const RELEASE_VISUAL_SPEC = /release-visual\.spec\.ts/;
const LOCALHOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const isAllowedRemoteHost = (hostname: string) => hostname === 'tzudong.app' || hostname === 'www.tzudong.app' || /^tzudong-[a-z0-9-]+\.vercel\.app$/.test(hostname);

function requireExactOrigin(value: string | undefined, label: string, localhost: boolean, expectedHostname?: string): string {
    if (!value?.trim()) throw new Error(`${label} must be an absolute origin`);
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        throw new Error(`${label} must be an absolute origin`);
    }
    const isLocalhost = LOCALHOSTS.has(url.hostname);
    if (url.protocol !== (localhost ? 'http:' : 'https:') || isLocalhost !== localhost || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (!localhost && url.port)) {
        throw new Error(`${label} must be an exact ${localhost ? 'localhost HTTP' : 'public HTTPS'} origin`);
    }
    if (!localhost) {
        if (!expectedHostname?.trim() || expectedHostname !== expectedHostname.toLowerCase() || !isAllowedRemoteHost(expectedHostname)) throw new Error('RELEASE_PUBLIC_EXPECTED_HOSTNAME must be an allowed exact public hostname');
        if (url.hostname !== expectedHostname) throw new Error('RELEASE_PUBLIC_BASE_URL hostname must exactly match RELEASE_PUBLIC_EXPECTED_HOSTNAME');
    }
    return url.toString();
}

const target = process.env.RELEASE_VISUAL_TARGET;
if (target !== 'remote' && target !== 'localhost') throw new Error('RELEASE_VISUAL_TARGET must be remote or localhost');

const projects: PlaywrightTestProject[] = target === 'remote'
    ? [{
        name: 'release-public-remote-chromium',
        testMatch: RELEASE_VISUAL_SPEC,
        use: {
            ...devices['Desktop Chrome'],
            baseURL: requireExactOrigin(process.env.RELEASE_PUBLIC_BASE_URL, 'RELEASE_PUBLIC_BASE_URL', false, process.env.RELEASE_PUBLIC_EXPECTED_HOSTNAME),
            trace: 'off',
            video: 'off',
            screenshot: 'off',
        },
    }]
    : [{
        name: 'release-localhost-synthetic-chromium',
        testMatch: RELEASE_VISUAL_SPEC,
        use: {
            ...devices['Desktop Chrome'],
            baseURL: requireExactOrigin(process.env.RELEASE_SYNTHETIC_BASE_URL, 'RELEASE_SYNTHETIC_BASE_URL', true),
            trace: 'off',
            video: 'off',
            screenshot: 'off',
        },
    }];

export default defineConfig({
    testDir: './tests',
    fullyParallel: false,
    forbidOnly: true,
    use: {
        screenshot: 'off',
        video: 'off',
        trace: 'off',
    },
    projects,
});
