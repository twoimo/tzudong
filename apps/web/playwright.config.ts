import { defineConfig, devices, type PlaywrightTestProject } from '@playwright/test';

const RESPONSIVE_SPEC = /responsive-overflow\.spec\.ts/;
const ADMIN_SETUP_SPEC = /tests[\\/]setup[\\/]admin\.setup\.ts/;
const ADMIN_STORAGE_STATE = 'tests/.auth/admin.json';

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
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:8080',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'admin-setup',
            testMatch: ADMIN_SETUP_SPEC,
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'chromium',
            testIgnore: [RESPONSIVE_SPEC, ADMIN_SETUP_SPEC],
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'firefox',
            testIgnore: [RESPONSIVE_SPEC, ADMIN_SETUP_SPEC],
            use: { ...devices['Desktop Firefox'] },
        },
        {
            name: 'webkit',
            testIgnore: [RESPONSIVE_SPEC, ADMIN_SETUP_SPEC],
            use: { ...devices['Desktop Safari'] },
        },
        ...responsiveProjects,
    ],
    webServer: {
        command: 'bun run dev',
        url: 'http://localhost:8080',
        reuseExistingServer: !process.env.CI,
    },
});
