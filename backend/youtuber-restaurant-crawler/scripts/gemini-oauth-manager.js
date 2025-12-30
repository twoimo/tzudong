/**
 * Gemini CLI OAuth 토큰 자동 갱신 관리자
 * - Gemini CLI의 실제 Client ID를 사용하여 토큰 갱신
 * - refresh_token을 사용해서 access_token 자동 갱신
 * - 갱신된 토큰을 GitHub에 자동 커밋
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Gemini CLI의 실제 OAuth Client ID (id_token에서 추출)
const GEMINI_CLI_CLIENT_ID = '681255809395-oo8ft2oprdrn9pe3aqf6av3hmdib135j.apps.googleusercontent.com';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// 파일 경로 (youtuber-restaurant-crawler/.gemini 폴더 기준)
const CRAWLER_DIR = path.resolve(__dirname, '..');
const GEMINI_LOCAL_DIR = path.join(CRAWLER_DIR, '.gemini');
const OAUTH_CREDS_PATH = path.join(GEMINI_LOCAL_DIR, 'oauth_creds.json');
const GOOGLE_ACCOUNTS_PATH = path.join(GEMINI_LOCAL_DIR, 'google_accounts.json');
const SETTINGS_PATH = path.join(GEMINI_LOCAL_DIR, 'settings.json');
const STATE_PATH = path.join(GEMINI_LOCAL_DIR, 'state.json');
const INSTALLATION_ID_PATH = path.join(GEMINI_LOCAL_DIR, 'installation_id');

const GEMINI_CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.gemini');

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
        throw new Error('OAuth 크레덴셜 파일이 없습니다: ' + OAUTH_CREDS_PATH);
    }
    return JSON.parse(fs.readFileSync(OAUTH_CREDS_PATH, 'utf-8'));
}

/**
 * OAuth 크레덴셜 저장
 */
function saveOAuthCreds(creds) {
    fs.writeFileSync(OAUTH_CREDS_PATH, JSON.stringify(creds, null, 2), 'utf-8');
    log('success', 'OAuth 크레덴셜 저장 완료');
}

/**
 * 토큰 만료 확인
 */
function isTokenExpired(creds) {
    if (!creds.expiry_date) return true;
    
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000; // 5분 버퍼
    
    return now >= (creds.expiry_date - bufferMs);
}

/**
 * refresh_token을 사용하여 access_token 갱신
 * Gemini CLI의 실제 Client ID 사용
 */
async function refreshAccessToken(refreshToken) {
    log('info', '액세스 토큰 갱신 중...');
    
    const body = new URLSearchParams({
        client_id: GEMINI_CLI_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
    });

    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
        log('error', `토큰 갱신 응답: ${JSON.stringify(data)}`);
        throw new Error(`토큰 갱신 실패: ${data.error} - ${data.error_description || '알 수 없는 오류'}`);
    }

    log('success', '액세스 토큰 갱신 성공');
    return data;
}

/**
 * Gemini CLI 설정 디렉토리에 파일 복사
 * antigravity 관련 폴더/파일 제외
 */
function copyToGeminiConfig() {
    if (!fs.existsSync(GEMINI_CONFIG_DIR)) {
        fs.mkdirSync(GEMINI_CONFIG_DIR, { recursive: true });
    }

    log('info', `📁 로컬 .gemini 폴더: ${GEMINI_LOCAL_DIR}`);
    log('info', `📁 대상 ~/.gemini 폴더: ${GEMINI_CONFIG_DIR}`);

    // 복사할 파일 목록 (antigravity 제외)
    const files = [
        { src: OAUTH_CREDS_PATH, dest: 'oauth_creds.json' },
        { src: GOOGLE_ACCOUNTS_PATH, dest: 'google_accounts.json' },
        { src: SETTINGS_PATH, dest: 'settings.json' },
        { src: STATE_PATH, dest: 'state.json' },
        { src: INSTALLATION_ID_PATH, dest: 'installation_id' },
    ];

    let copiedCount = 0;
    files.forEach(({ src, dest }) => {
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(GEMINI_CONFIG_DIR, dest));
            log('success', `  ✓ ${dest} 복사 완료`);
            copiedCount++;
        } else {
            log('warning', `  ✗ ${dest} 파일 없음: ${src}`);
        }
    });

    log('success', `Gemini 설정 디렉토리 업데이트 완료 (${copiedCount}개 파일)`);
    
    // 복사된 파일 목록 출력
    if (fs.existsSync(GEMINI_CONFIG_DIR)) {
        const copied = fs.readdirSync(GEMINI_CONFIG_DIR);
        log('info', `📂 ~/.gemini 폴더 내용: ${copied.join(', ')}`);
    }
}

/**
 * GitHub에 변경사항 커밋
 */
function commitToGitHub() {
    if (!process.env.GITHUB_ACTIONS) {
        log('info', 'GitHub Actions 환경이 아니므로 커밋 스킵');
        return false;
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
            const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
            execSync(`git commit -m "🔐 Auto: OAuth 토큰 갱신 (${now})"`, { stdio: 'pipe' });
            execSync('git push', { stdio: 'pipe' });
            log('success', 'OAuth 크레덴셜 GitHub 커밋 완료');
            return true;
        } else {
            log('info', 'OAuth 크레덴셜 변경사항 없음');
            return false;
        }
    } catch (error) {
        log('warning', `GitHub 커밋 중 오류: ${error.message}`);
        return false;
    }
}

/**
 * 메인: OAuth 토큰 갱신 및 설정
 */
async function setupGeminiAuth() {
    log('info', '='.repeat(50));
    log('info', '  Gemini CLI OAuth 토큰 자동 갱신');
    log('info', '='.repeat(50));

    try {
        // 1. 크레덴셜 로드
        let creds = loadOAuthCreds();
        log('success', 'OAuth 크레덴셜 로드 완료');

        // 2. 토큰 만료 확인 및 갱신
        if (isTokenExpired(creds)) {
            log('warning', '액세스 토큰이 만료되었거나 곧 만료됩니다. 갱신 중...');

            if (!creds.refresh_token) {
                throw new Error('refresh_token이 없습니다. 로컬에서 다시 로그인해주세요.');
            }

            // 토큰 갱신
            const newTokens = await refreshAccessToken(creds.refresh_token);

            // 크레덴셜 업데이트
            creds.access_token = newTokens.access_token;
            creds.expiry_date = Date.now() + (newTokens.expires_in * 1000);
            
            // id_token이 있으면 업데이트
            if (newTokens.id_token) {
                creds.id_token = newTokens.id_token;
            }

            // scope가 있으면 업데이트
            if (newTokens.scope) {
                creds.scope = newTokens.scope;
            }

            // 저장
            saveOAuthCreds(creds);

            const expiryDate = new Date(creds.expiry_date);
            log('success', `토큰 갱신 완료! 새 만료 시간: ${expiryDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);

            // GitHub에 커밋
            commitToGitHub();
        } else {
            const expiryDate = new Date(creds.expiry_date);
            const remainingMs = creds.expiry_date - Date.now();
            const remainingMin = Math.floor(remainingMs / 60000);
            log('success', `토큰 유효 (${remainingMin}분 남음, 만료: ${expiryDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`);
        }

        // 3. Gemini 설정 디렉토리에 복사
        copyToGeminiConfig();

        log('info', '='.repeat(50));
        log('success', 'Gemini CLI 인증 설정 완료');
        log('info', '='.repeat(50));

        return true;
    } catch (error) {
        log('error', `설정 실패: ${error.message}`);
        throw error;
    }
}

/**
 * 토큰 상태 확인만
 */
function checkTokenStatus() {
    try {
        const creds = loadOAuthCreds();
        const expired = isTokenExpired(creds);
        const expiryDate = new Date(creds.expiry_date);
        const remainingMs = creds.expiry_date - Date.now();
        const remainingMin = Math.floor(remainingMs / 60000);

        return {
            valid: !expired,
            expired,
            expiryDate: expiryDate.toISOString(),
            remainingMinutes: remainingMin,
            hasRefreshToken: !!creds.refresh_token,
        };
    } catch (error) {
        return {
            valid: false,
            error: error.message,
        };
    }
}

// 메인 실행
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--check')) {
        // 토큰 상태만 확인
        const status = checkTokenStatus();
        console.log(JSON.stringify(status, null, 2));
        process.exit(status.valid ? 0 : 1);
    } else if (args.includes('--commit')) {
        // 변경사항 커밋만
        commitToGitHub();
    } else {
        // 기본: 토큰 갱신 및 설정
        await setupGeminiAuth();
    }
}

main().catch(error => {
    log('error', error.message);
    process.exit(1);
});

export { setupGeminiAuth, checkTokenStatus, refreshAccessToken, commitToGitHub };
