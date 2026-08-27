import { defineConfig, devices, type PlaywrightTestProject } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
    E2E_ADMIN_ROUTE_BYPASS_CONTEXT,
    E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS,
    E2E_ADMIN_ROUTE_BYPASS_RUNTIME,
} from './lib/e2e-admin-route-bypass';

const RESPONSIVE_SPEC = /responsive-overflow\.spec\.ts/;
const ADMIN_SETUP_SPEC = /tests[\\/]setup[\\/]admin\.setup\.ts/;
const ADMIN_STORAGE_STATE = 'tests/.auth/admin.json';
const DEPENDENCY_MODERNIZATION_SPEC = /dependency-modernization\.spec\.ts$/;
const NAVER_LIVE_PROVIDER_SPEC = /naver-live-marker\.spec\.ts$/;
const runsDependencyModernizationSpec = process.argv.some((argument) =>
    DEPENDENCY_MODERNIZATION_SPEC.test(argument.replaceAll('\\', '/'))
);
const runsNaverLiveProviderSpec = process.argv.some((argument) =>
    NAVER_LIVE_PROVIDER_SPEC.test(argument.replaceAll('\\', '/'))
);
const runsDedicatedNaverLiveProviderSmoke =
    runsNaverLiveProviderSpec
    && process.env.PLAYWRIGHT_NAVER_LIVE_PROVIDER_SMOKE === '1';
const PLAYWRIGHT_WEB_SERVER_COMMAND =
    runsDedicatedNaverLiveProviderSmoke
        ? 'bun run dev:playwright:naver-live'
        : process.env.PLAYWRIGHT_WEB_SERVER_COMMAND
            ?? (runsDependencyModernizationSpec ? 'bun run start:playwright' : 'bun run dev:playwright');
const PLAYWRIGHT_BASE_URL =
    process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const PLAYWRIGHT_WEB_SERVER_URL =
    process.env.PLAYWRIGHT_WEB_SERVER_URL ??
    new URL('/api/health', PLAYWRIGHT_BASE_URL).toString();
const PLAYWRIGHT_NIGHTLY_MODE = process.env.NIGHTLY_MODE?.trim();
const isNightlyRegressionRun =
    PLAYWRIGHT_NIGHTLY_MODE === 'local' || PLAYWRIGHT_NIGHTLY_MODE === 'hosted';
const NIGHTLY_WEB_SERVER_ENVIRONMENT_KEYS = [
    'PATH',
    'HOME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'NODE_ENV',
    'NIGHTLY_MODE',
    'NIGHTLY_LOCAL_ENV_ONLY',
    'NIGHTLY_ENV_FILE_ONLY',
    'NIGHTLY_ENV_PROVENANCE',
    'NIGHTLY_ENV_PROVENANCE_SHA256',
    'NIGHTLY_ENV_FILE',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME',
    'NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL',
    'SUPABASE_URL',
    'NIGHTLY_ADMIN_EMAIL',
    'NIGHTLY_ADMIN_PASSWORD',
    'SUPABASE_PUBLIC_URL',
    'API_EXTERNAL_URL',
    'PLAYWRIGHT_BASE_URL',
    'PLAYWRIGHT_WEB_SERVER_URL',
    'PLAYWRIGHT_REUSE_EXISTING_SERVER',
    'APP_PORT',
    'HOST',
    'HOSTNAME',
] as const;
const pickEnvironment = (keys: readonly string[]) => Object.fromEntries(
    keys.flatMap((key) => {
        const value = process.env[key];
        return value === undefined ? [] : [[key, value]];
    }),
);
const playwrightWebServerEnvironment = isNightlyRegressionRun
    ? pickEnvironment(NIGHTLY_WEB_SERVER_ENVIRONMENT_KEYS)
    : process.env;
const PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS = Number(
    process.env.PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS ?? '180000'
);
const PLAYWRIGHT_RESPONSIVE_BROWSER =
    process.env.PLAYWRIGHT_RESPONSIVE_BROWSER ?? 'chromium';
const E2E_ADMIN_ROUTE_BYPASS_TOKEN =
    process.env.E2E_ADMIN_ROUTE_BYPASS_TOKEN?.trim() || `playwright-${randomUUID()}`;
const PLAYWRIGHT_HEALTH_RELEASE_ID = `playwright-${randomUUID()}`;
const PLAYWRIGHT_HEALTH_GIT_SHA = '0'.repeat(40);
const PLAYWRIGHT_HEALTH_DEPLOYMENT_ID = 'playwright-local-deployment';
const PLAYWRIGHT_HEALTH_PROJECT_ID = 'playwright-local-project';


type DeviceUse = {
    viewport: { width: number; height: number };
    userAgent: string;
    deviceScaleFactor: number;
    isMobile: boolean;
    hasTouch: boolean;
    storageState?: string;
};

function customDevice(
    viewport: { width: number; height: number },
    userAgent: string,
    opts?: Partial<Pick<DeviceUse, 'deviceScaleFactor' | 'isMobile' | 'hasTouch'>>
): DeviceUse {
    return {
        viewport,
        userAgent,
        deviceScaleFactor: opts?.deviceScaleFactor ?? 2,
        isMobile: opts?.isMobile ?? viewport.width < 768,
        hasTouch: opts?.hasTouch ?? true,
    };
}

function toLandscape(use: DeviceUse): DeviceUse {
    return {
        ...use,
        viewport: {
            width: use.viewport.height,
            height: use.viewport.width,
        },
    };
}

function withResponsiveOptions(name: string, use: DeviceUse): PlaywrightTestProject {
    return {
        name,
        testMatch: RESPONSIVE_SPEC,
        dependencies: ['admin-setup'],
        use: {
            browserName: PLAYWRIGHT_RESPONSIVE_BROWSER as 'chromium' | 'firefox' | 'webkit',
            ...use,
            storageState: ADMIN_STORAGE_STATE,
            trace: 'retain-on-failure',
        },
    };
}

const responsivePortraitDevices: Array<{ name: string; use: DeviceUse }> = [
    { name: 'iPhone SE', use: { ...(devices['iPhone SE'] as DeviceUse) } },
    { name: 'iPhone XR', use: { ...(devices['iPhone XR'] as DeviceUse) } },
    { name: 'iPhone 12 Pro', use: { ...(devices['iPhone 12 Pro'] as DeviceUse) } },
    { name: 'iPhone 14 Pro Max', use: { ...(devices['iPhone 14 Pro Max'] as DeviceUse) } },
    { name: 'Pixel 7', use: { ...(devices['Pixel 7'] as DeviceUse) } },
    {
        name: 'Samsung Galaxy S8+',
        use: customDevice(
            { width: 360, height: 740 },
            'Mozilla/5.0 (Linux; Android 9; SM-G955F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            { deviceScaleFactor: 4, isMobile: true, hasTouch: true }
        ),
    },
    {
        name: 'Samsung Galaxy S20 Ultra',
        use: customDevice(
            { width: 412, height: 915 },
            'Mozilla/5.0 (Linux; Android 13; SM-G988B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            { deviceScaleFactor: 3.5, isMobile: true, hasTouch: true }
        ),
    },
    { name: 'iPad Mini', use: { ...(devices['iPad Mini'] as DeviceUse) } },
    {
        name: 'iPad Air',
        use: customDevice(
            { width: 820, height: 1180 },
            'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            { deviceScaleFactor: 2, isMobile: false, hasTouch: true }
        ),
    },
    {
        name: 'iPad Pro',
        use: customDevice(
            { width: 1024, height: 1366 },
            'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            { deviceScaleFactor: 2, isMobile: false, hasTouch: true }
        ),
    },
    {
        name: 'Surface Pro 7',
        use: customDevice(
            { width: 912, height: 1368 },
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Touch) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            { deviceScaleFactor: 1.5, isMobile: false, hasTouch: true }
        ),
    },
    {
        name: 'Surface Duo',
        use: customDevice(
            { width: 540, height: 720 },
            'Mozilla/5.0 (Linux; Android 11; Surface Duo) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            { deviceScaleFactor: 2.5, isMobile: true, hasTouch: true }
        ),
    },
    {
        name: 'Galaxy Z Fold 5',
        use: customDevice(
            { width: 373, height: 841 },
            'Mozilla/5.0 (Linux; Android 14; SM-F946B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            { deviceScaleFactor: 3, isMobile: true, hasTouch: true }
        ),
    },
    {
        name: 'Asus Zenbook Fold',
        use: customDevice(
            { width: 853, height: 1280 },
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Touch) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            { deviceScaleFactor: 2, isMobile: false, hasTouch: true }
        ),
    },
    {
        name: 'Samsung Galaxy A51/71',
        use: customDevice(
            { width: 412, height: 914 },
            'Mozilla/5.0 (Linux; Android 13; SM-A515F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            { deviceScaleFactor: 2.625, isMobile: true, hasTouch: true }
        ),
    },
    {
        name: 'Nest Hub',
        use: customDevice(
            { width: 1024, height: 600 },
            'Mozilla/5.0 (Linux; Android 12; Nest Hub) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            { deviceScaleFactor: 2, isMobile: false, hasTouch: true }
        ),
    },
    {
        name: 'Nest Hub Max',
        use: customDevice(
            { width: 1280, height: 800 },
            'Mozilla/5.0 (Linux; Android 12; Nest Hub Max) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            { deviceScaleFactor: 2, isMobile: false, hasTouch: true }
        ),
    },
    { name: 'iPhone X', use: { ...(devices['iPhone X'] as DeviceUse) } },
];

const responsiveProjects: PlaywrightTestProject[] = responsivePortraitDevices.flatMap(({ name, use }) => {
    const portrait = withResponsiveOptions(name, use);
    const landscape = withResponsiveOptions(`${name} Landscape`, toLandscape(use));
    return [portrait, landscape];
});

export default defineConfig({
    metadata: { e2eAdminRouteBypassToken: E2E_ADMIN_ROUTE_BYPASS_TOKEN },
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL: PLAYWRIGHT_BASE_URL,
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'admin-setup',
            testMatch: ADMIN_SETUP_SPEC,
            use: {
                ...devices['iPhone SE'],
                browserName: PLAYWRIGHT_RESPONSIVE_BROWSER as 'chromium' | 'firefox' | 'webkit',
                trace: 'retain-on-failure',
            },
        },
        {
            name: 'chromium',
            testIgnore: [RESPONSIVE_SPEC, ADMIN_SETUP_SPEC, ...(runsDedicatedNaverLiveProviderSmoke ? [] : [NAVER_LIVE_PROVIDER_SPEC])],
            use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
        },
        {
            name: 'firefox',
            testIgnore: [RESPONSIVE_SPEC, ADMIN_SETUP_SPEC, NAVER_LIVE_PROVIDER_SPEC],
            use: { ...devices['Desktop Firefox'], browserName: 'firefox' },
        },
        {
            name: 'webkit',
            testIgnore: [RESPONSIVE_SPEC, ADMIN_SETUP_SPEC, NAVER_LIVE_PROVIDER_SPEC],
            use: { ...devices['Desktop Safari'], browserName: 'webkit' },
        },
        ...responsiveProjects,
    ],
    webServer: {
        command: PLAYWRIGHT_WEB_SERVER_COMMAND,
        url: PLAYWRIGHT_WEB_SERVER_URL,
        timeout: PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS,
        // KPI/admin runtime guards need a fresh server because stale local dev
        // processes can carry old auth-bypass env and stale .next chunks. Reuse
        // stays opt-in for deliberate local debugging only.
        reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === '1',
        env: {
            ...playwrightWebServerEnvironment,
            [E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.enabled]: '1',
            [E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.context]: E2E_ADMIN_ROUTE_BYPASS_CONTEXT,
            [E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.runtime]: E2E_ADMIN_ROUTE_BYPASS_RUNTIME,
            [E2E_ADMIN_ROUTE_BYPASS_ENV_KEYS.token]: E2E_ADMIN_ROUTE_BYPASS_TOKEN,
            TS7_RELEASE_ID: process.env.TS7_RELEASE_ID ?? PLAYWRIGHT_HEALTH_RELEASE_ID,
            VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? PLAYWRIGHT_HEALTH_GIT_SHA,
            VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID ?? PLAYWRIGHT_HEALTH_DEPLOYMENT_ID,
            VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID ?? PLAYWRIGHT_HEALTH_PROJECT_ID,
        },
    },
});
