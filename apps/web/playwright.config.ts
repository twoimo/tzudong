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

    /* 주요 브라우저 프로젝트 설정 */
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },

        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
        },

        {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
        },

        /* 모바일 뷰포트 테스트 */
        {
            name: 'Mobile Chrome',
            use: { ...devices['Pixel 5'] },
        },
        {
            name: 'Mobile Safari',
            use: { ...devices['iPhone 12'] },
        },
    ],

    /* 테스트 시작 전 로컬 개발 서버 실행 */
    webServer: {
        command: 'bun run dev',
        url: 'http://localhost:8080',
        reuseExistingServer: !process.env.CI,
    },
});
