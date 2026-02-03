import { defineConfig, devices } from '@playwright/test';

/**
 * .env 파일에서 환경 변수를 읽어옵니다.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * 설정 가이드: https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
    testDir: './tests',
    /* 모든 테스트 파일을 병렬로 실행 */
    fullyParallel: true,
    /* 소스 코드에 test.only가 남아있을 경우 CI 빌드 실패 처리 */
    forbidOnly: !!process.env.CI,
    /* CI 환경에서만 재시도 수행 */
    retries: process.env.CI ? 2 : 0,
    /* CI 환경에서는 병렬 테스트 비활성화 (순차 실행) */
    workers: process.env.CI ? 1 : undefined,
    /* 사용할 리포터 설정. https://playwright.dev/docs/test-reporters */
    reporter: 'html',
    /* 모든 프로젝트에 공유되는 설정. https://playwright.dev/docs/api/class-testoptions */
    use: {
        /* `await page.goto('/')` 같은 액션에서 사용할 기본 URL */
        baseURL: 'http://localhost:8080',

        /* 테스트 실패 시 재시도할 때 트레이스 수집. https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',
    },

    /* 주요 브라우저 및 기기 프로젝트 설정 */
    projects: [
        // === 데스크탑 브라우저 ===
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },

        // === 모바일 - iPhone ===
        { name: 'iPhone SE', use: { ...devices['iPhone SE'] } },
        { name: 'iPhone XR', use: { ...devices['iPhone XR'] } },
        { name: 'iPhone 11', use: { ...devices['iPhone 11'] } },
        { name: 'iPhone 12', use: { ...devices['iPhone 12'] } },
        { name: 'iPhone 12 Pro', use: { ...devices['iPhone 12 Pro'] } },
        { name: 'iPhone 12 Pro Max', use: { ...devices['iPhone 12 Pro Max'] } },
        { name: 'iPhone 13', use: { ...devices['iPhone 13'] } },
        { name: 'iPhone 13 Pro', use: { ...devices['iPhone 13 Pro'] } },
        { name: 'iPhone 13 Pro Max', use: { ...devices['iPhone 13 Pro Max'] } },
        { name: 'iPhone 14', use: { ...devices['iPhone 14'] } },
        { name: 'iPhone 14 Pro', use: { ...devices['iPhone 14 Pro'] } },
        { name: 'iPhone 14 Pro Max', use: { ...devices['iPhone 14 Pro Max'] } },

        // === 모바일 - Android ===
        { name: 'Pixel 3', use: { ...devices['Pixel 3'] } },
        { name: 'Pixel 4', use: { ...devices['Pixel 4'] } },
        { name: 'Pixel 5', use: { ...devices['Pixel 5'] } },
        { name: 'Pixel 7', use: { ...devices['Pixel 7'] } },
        { name: 'Moto G4', use: { ...devices['Moto G4'] } },
        { name: 'Galaxy S5', use: { ...devices['Galaxy S5'] } },
        { name: 'Galaxy S8', use: { ...devices['Galaxy S8'] } },
        { name: 'Galaxy S9+', use: { ...devices['Galaxy S9+'] } },

        // === 최신 Galaxy (커스텀 뷰포트) ===
        {
            name: 'Galaxy S21',
            use: {
                viewport: { width: 360, height: 800 },
                userAgent: 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                deviceScaleFactor: 3,
                isMobile: true,
                hasTouch: true,
            },
        },
        {
            name: 'Galaxy S22',
            use: {
                viewport: { width: 360, height: 780 },
                userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                deviceScaleFactor: 3,
                isMobile: true,
                hasTouch: true,
            },
        },
        {
            name: 'Galaxy S23',
            use: {
                viewport: { width: 360, height: 780 },
                userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                deviceScaleFactor: 3,
                isMobile: true,
                hasTouch: true,
            },
        },
        {
            name: 'Galaxy Z Fold 5',
            use: {
                viewport: { width: 373, height: 841 },
                userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-F946B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                deviceScaleFactor: 3,
                isMobile: true,
                hasTouch: true,
            },
        },

        // === 태블릿 - iPad ===
        { name: 'iPad Mini', use: { ...devices['iPad Mini'] } },
        { name: 'iPad', use: { ...devices['iPad (gen 7)'] } },
        { name: 'iPad Pro 11', use: { ...devices['iPad Pro 11'] } },

        // === 태블릿 - Android ===
        { name: 'Galaxy Tab S4', use: { ...devices['Galaxy Tab S4'] } },

        // === 기타 ===
        { name: 'Kindle Fire HDX', use: { ...devices['Kindle Fire HDX'] } },
        { name: 'Blackberry PlayBook', use: { ...devices['Blackberry PlayBook'] } },
    ],

    /* 테스트 시작 전 로컬 개발 서버 실행 */
    webServer: {
        command: 'bun run dev',
        url: 'http://localhost:8080',
        reuseExistingServer: !process.env.CI,
    },
});
