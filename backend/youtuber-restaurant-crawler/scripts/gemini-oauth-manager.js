/**
 * Gemini CLI OAuth 토큰 관리자
 * - oauth_creds.json 파일을 사용하여 인증
 * - 토큰 만료 시 자동 갱신
 * - GitHub Actions에서 갱신된 토큰 커밋
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// OAuth 크레덴셜 파일 경로
const OAUTH_CREDS_PATH = path.resolve(__dirname, '../../oauth_creds.json');
const GEMINI_CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.gemini');
const GEMINI_OAUTH_PATH = path.join(GEMINI_CONFIG_DIR, 'oauth_creds.json');
const GEMINI_SETTINGS_PATH = path.join(GEMINI_CONFIG_DIR, 'settings.json');

// Google OAuth 설정 (Gemini CLI 공식 클라이언트 ID)
const GOOGLE_CLIENT_ID = '681255809395-oo8ft2oprdrn9pe3aqf6av3hmdib135j.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// 로그 함수
function log(level, msg) {
    const time = new Date().toTimeString().slice(0, 8);
    const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌', debug: '🔍' };
    console.log(`[${time}] ${icons[level] || ''} ${msg}`);
}

/**
 * OAuth 크레덴셜 로드
 */
function loadOAuthCreds() {
    if (!fs.existsSync(OAUTH_CREDS_PATH)) {
        log('error', `OAuth 크레덴셜 파일이 없습니다: ${OAUTH_CREDS_PATH}`);
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(OAUTH_CREDS_PATH, 'utf-8'));
    } catch (error) {
        log('error', `OAuth 크레덴셜 파싱 실패: ${error.message}`);
        return null;
    }
}

/**
 * OAuth 토큰이 만료되었는지 확인
 */
function isTokenExpired(creds) {
    if (!creds || !creds.expiry_date) {
        return true;
    }

    // 5분 버퍼를 두고 만료 확인
    const bufferMs = 5 * 60 * 1000;
    const now = Date.now();

    return now >= (creds.expiry_date - bufferMs);
}

/**
 * refresh_token으로 access_token 갱신
 */
async function refreshAccessToken(refreshToken) {
    log('info', '액세스 토큰 갱신 중...');

    try {
        const response = await fetch(TOKEN_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }).toString(),
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(`토큰 갱신 실패: ${data.error} - ${data.error_description}`);
        }

        log('success', '액세스 토큰 갱신 완료');

        return {
            access_token: data.access_token,
            expires_in: data.expires_in,
            expiry_date: Date.now() + (data.expires_in * 1000),
            token_type: data.token_type || 'Bearer',
            scope: data.scope,
            id_token: data.id_token,
        };
    } catch (error) {
        log('error', `토큰 갱신 실패: ${error.message}`);
        throw error;
    }
}

/**
 * OAuth 크레덴셜 저장 (프로젝트 파일 + Gemini 설정 디렉토리)
 */
function saveOAuthCreds(creds) {
    // 프로젝트 파일에 저장
    fs.writeFileSync(OAUTH_CREDS_PATH, JSON.stringify(creds, null, 2), 'utf-8');
    log('success', `OAuth 크레덴셜 저장: ${OAUTH_CREDS_PATH}`);

    // Gemini 설정 디렉토리 생성
    if (!fs.existsSync(GEMINI_CONFIG_DIR)) {
        fs.mkdirSync(GEMINI_CONFIG_DIR, { recursive: true });
    }

    // Gemini OAuth 파일에도 저장
    fs.writeFileSync(GEMINI_OAUTH_PATH, JSON.stringify(creds, null, 2), 'utf-8');
    log('success', `Gemini OAuth 저장: ${GEMINI_OAUTH_PATH}`);
}

/**
 * Gemini CLI 설정 파일 생성
 */
function setupGeminiSettings() {
    if (!fs.existsSync(GEMINI_CONFIG_DIR)) {
        fs.mkdirSync(GEMINI_CONFIG_DIR, { recursive: true });
    }

    const settings = {
        auth: { type: 'oauth' },
        theme: 'default',
        sandbox: false,
        yoloMode: true,
        selectedModel: 'gemini-3.0-flash'
    };

    fs.writeFileSync(GEMINI_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
    log('success', `Gemini 설정 저장: ${GEMINI_SETTINGS_PATH}`);
}

/**
 * Gemini CLI 로그인 상태 확인
 */
function checkGeminiLogin() {
    try {
        // gemini 명령어 실행하여 로그인 상태 확인
        const result = execSync('gemini --version', {
            encoding: 'utf-8',
            timeout: 10000,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        log('debug', `Gemini CLI 버전: ${result.trim()}`);

        // OAuth 파일 존재 확인
        if (fs.existsSync(GEMINI_OAUTH_PATH)) {
            const creds = JSON.parse(fs.readFileSync(GEMINI_OAUTH_PATH, 'utf-8'));
            if (creds.access_token && !isTokenExpired(creds)) {
                log('success', 'Gemini CLI 로그인 상태: 유효한 토큰 있음');
                return true;
            }
        }

        return false;
    } catch (error) {
        log('warning', `Gemini CLI 확인 실패: ${error.message}`);
        return false;
    }
}

/**
 * GitHub Actions에서 변경사항 커밋
 */
function commitOAuthCreds() {
    // GitHub Actions 환경인지 확인
    if (!process.env.GITHUB_ACTIONS) {
        log('info', 'GitHub Actions 환경이 아니므로 커밋 스킵');
        return;
    }

    try {
        // Git 설정
        execSync('git config user.name "github-actions[bot]"', { stdio: 'pipe' });
        execSync('git config user.email "github-actions[bot]@users.noreply.github.com"', { stdio: 'pipe' });

        // 변경사항 추가
        execSync(`git add "${OAUTH_CREDS_PATH}"`, { stdio: 'pipe' });

        // 변경사항 확인
        const status = execSync('git status --porcelain', { encoding: 'utf-8' });

        if (status.includes('oauth_creds.json')) {
            // 커밋 및 푸시
            execSync('git commit -m "🔐 Auto: OAuth 토큰 갱신"', { stdio: 'pipe' });
            execSync('git push', { stdio: 'pipe' });
            log('success', 'OAuth 크레덴셜 변경사항 커밋 완료');
        } else {
            log('info', 'OAuth 크레덴셜 변경사항 없음');
        }
    } catch (error) {
        log('warning', `커밋 실패: ${error.message}`);
    }
}

/**
 * Gemini CLI 인증 설정 (메인)
 */
async function setupGeminiAuth() {
    log('info', '='.repeat(50));
    log('info', '  Gemini CLI OAuth 인증 설정');
    log('info', '='.repeat(50));

    // 1. OAuth 크레덴셜 로드
    const creds = loadOAuthCreds();
    if (!creds) {
        log('error', 'OAuth 크레덴셜을 로드할 수 없습니다.');
        log('info', '');
        log('info', '해결 방법:');
        log('info', '1. 로컬에서 `gemini` 명령어로 로그인');
        log('info', `2. ~/.gemini/oauth_creds.json 파일을 ${OAUTH_CREDS_PATH}에 복사`);
        process.exit(1);
    }

    log('success', 'OAuth 크레덴셜 로드 완료');

    // 2. 토큰 만료 확인 및 갱신
    let updatedCreds = { ...creds };

    if (isTokenExpired(creds)) {
        log('warning', '액세스 토큰이 만료되었습니다. 갱신 중...');

        if (!creds.refresh_token) {
            log('error', 'refresh_token이 없습니다. 다시 로그인이 필요합니다.');
            process.exit(1);
        }

        const newTokens = await refreshAccessToken(creds.refresh_token);

        updatedCreds = {
            ...creds,
            access_token: newTokens.access_token,
            expiry_date: newTokens.expiry_date,
            id_token: newTokens.id_token || creds.id_token,
        };

        // 갱신된 크레덴셜 저장
        saveOAuthCreds(updatedCreds);

        // GitHub Actions에서 커밋
        commitOAuthCreds();
    } else {
        log('success', '액세스 토큰이 유효합니다.');

        // 만료 시간 출력
        const expiryDate = new Date(creds.expiry_date);
        log('info', `토큰 만료 시간: ${expiryDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
    }

    // 3. Gemini 설정 디렉토리에 복사
    saveOAuthCreds(updatedCreds);
    setupGeminiSettings();

    // 4. 로그인 상태 확인
    const isLoggedIn = checkGeminiLogin();

    if (isLoggedIn) {
        log('success', 'Gemini CLI 인증 설정 완료!');
    } else {
        log('warning', 'Gemini CLI 로그인 상태를 확인할 수 없습니다.');
        log('info', 'API 키 모드로 대체 실행됩니다.');
    }

    log('info', '='.repeat(50));

    return isLoggedIn;
}

/**
 * API 키 모드 설정
 */
function setupApiKeyMode() {
    log('info', 'API 키 모드로 Gemini CLI 설정 중...');

    // Gemini 설정 디렉토리 생성
    if (!fs.existsSync(GEMINI_CONFIG_DIR)) {
        fs.mkdirSync(GEMINI_CONFIG_DIR, { recursive: true });
    }

    const settings = {
        auth: { type: 'api-key' },
        theme: 'default',
        sandbox: false,
        yoloMode: true,
        selectedModel: 'gemini-3.0-flash'
    };

    fs.writeFileSync(GEMINI_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
    log('success', 'API 키 모드 설정 완료');
}

// 메인 실행
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--api-key')) {
        // API 키 모드
        setupApiKeyMode();
    } else if (args.includes('--check')) {
        // 로그인 상태만 확인
        const isLoggedIn = checkGeminiLogin();
        process.exit(isLoggedIn ? 0 : 1);
    } else {
        // OAuth 모드 (기본)
        try {
            await setupGeminiAuth();
        } catch (error) {
            log('error', `OAuth 설정 실패: ${error.message}`);
            log('info', 'API 키 모드로 대체합니다.');
            setupApiKeyMode();
        }
    }
}

main();

export { setupGeminiAuth, checkGeminiLogin, refreshAccessToken, isTokenExpired };
