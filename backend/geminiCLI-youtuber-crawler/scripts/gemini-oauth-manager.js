/**
 * Gemini CLI OAuth 토큰 관리 스크립트
 * 
 * 기능:
 * 1. 로컬 ~/.gemini/oauth_creds.json에서 프로젝트로 토큰 복사
 * 2. 토큰 만료 시간 체크
 * 3. 만료 임박 시 Gemini CLI로 갱신
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 경로 설정
const PROJECT_GEMINI_DIR = path.resolve(__dirname, '../.gemini');
const PROJECT_OAUTH_FILE = path.join(PROJECT_GEMINI_DIR, 'oauth_creds.json');
const HOME_GEMINI_DIR = path.join(os.homedir(), '.gemini');
const HOME_OAUTH_FILE = path.join(HOME_GEMINI_DIR, 'oauth_creds.json');

// 로그 함수
function log(level, msg) {
    const time = new Date().toTimeString().slice(0, 8);
    const tags = { info: '[INFO]', success: '[OK]', warning: '[WARN]', error: '[ERR]', debug: '[DBG]' };
    console.log(`[${time}] ${tags[level] || '[LOG]'} ${msg}`);
}

/**
 * OAuth 크레덴셜 로드
 */
function loadOAuthCreds(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content);
        }
    } catch (error) {
        log('warning', `OAuth 파일 로드 실패: ${filePath}`);
    }
    return null;
}

/**
 * OAuth 크레덴셜 저장
 */
function saveOAuthCreds(filePath, creds) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(creds, null, 2), 'utf-8');
        return true;
    } catch (error) {
        log('error', `OAuth 파일 저장 실패: ${error.message}`);
        return false;
    }
}

/**
 * 토큰 만료까지 남은 분 계산
 */
function getTokenRemainingMinutes(creds) {
    if (!creds || !creds.expiry_date) return -1;
    const now = Date.now();
    const remaining = (creds.expiry_date - now) / 60000;
    return Math.floor(remaining);
}

/**
 * Gemini CLI로 토큰 갱신
 */
function refreshTokenWithCLI() {
    log('info', 'Gemini CLI로 토큰 갱신 중...');

    try {
        // API 키 환경변수 제거 (OAuth 모드 강제)
        const env = { ...process.env };
        delete env.GEMINI_API_KEY;
        delete env.GOOGLE_API_KEY;

        // 간단한 프롬프트로 CLI 실행 (토큰 자동 갱신됨)
        // GitHub Actions에서는 gemini-3-pro-preview 사용
        const model = process.env.GITHUB_ACTIONS ? 'gemini-3-pro-preview' : 'gemini-2.5-flash';
        const result = spawnSync('bash', [
            '-c',
            `echo "ping" | timeout 30 gemini --model ${model} 2>&1 | head -3`
        ], {
            encoding: 'utf-8',
            timeout: 60000,
            env
        });

        if (result.error) {
            log('error', `CLI 실행 실패: ${result.error.message}`);
            return false;
        }

        // HOME의 토큰 파일 확인
        const newCreds = loadOAuthCreds(HOME_OAUTH_FILE);
        if (newCreds && getTokenRemainingMinutes(newCreds) > 50) {
            log('success', '토큰 갱신 성공!');
            return true;
        }

        return false;
    } catch (error) {
        log('error', `토큰 갱신 실패: ${error.message}`);
        return false;
    }
}

/**
 * 토큰 동기화 (HOME → PROJECT)
 */
function syncTokenFromHome() {
    const homeCreds = loadOAuthCreds(HOME_OAUTH_FILE);
    if (!homeCreds) {
        log('warning', `HOME 토큰 파일 없음: ${HOME_OAUTH_FILE}`);
        return false;
    }

    const homeRemaining = getTokenRemainingMinutes(homeCreds);
    const projectCreds = loadOAuthCreds(PROJECT_OAUTH_FILE);
    const projectRemaining = getTokenRemainingMinutes(projectCreds);

    log('debug', `HOME 토큰 남은 시간: ${homeRemaining}분`);
    log('debug', `PROJECT 토큰 남은 시간: ${projectRemaining}분`);

    // HOME 토큰이 더 유효하면 복사
    if (homeRemaining > projectRemaining) {
        if (saveOAuthCreds(PROJECT_OAUTH_FILE, homeCreds)) {
            log('success', `토큰 동기화 완료 (HOME → PROJECT)`);
            return true;
        }
    } else {
        log('info', 'PROJECT 토큰이 더 유효함 - 동기화 스킵');
    }

    return false;
}

/**
 * 토큰 동기화 (PROJECT → HOME)
 */
function syncTokenToHome() {
    const projectCreds = loadOAuthCreds(PROJECT_OAUTH_FILE);
    if (!projectCreds) {
        log('warning', `PROJECT 토큰 파일 없음: ${PROJECT_OAUTH_FILE}`);
        return false;
    }

    const projectRemaining = getTokenRemainingMinutes(projectCreds);
    const homeCreds = loadOAuthCreds(HOME_OAUTH_FILE);
    const homeRemaining = getTokenRemainingMinutes(homeCreds);

    // PROJECT 토큰이 더 유효하면 복사
    if (projectRemaining > homeRemaining) {
        if (saveOAuthCreds(HOME_OAUTH_FILE, projectCreds)) {
            log('success', `토큰 동기화 완료 (PROJECT → HOME)`);
            return true;
        }
    }

    return false;
}

/**
 * 토큰 체크 및 갱신 (50분 규칙)
 */
export async function checkAndRefreshToken() {
    log('info', '==================================================');
    log('info', '  Gemini OAuth 토큰 체크');
    log('info', '==================================================');

    // 1. HOME에서 최신 토큰 동기화
    syncTokenFromHome();

    // 2. 현재 토큰 상태 확인
    const creds = loadOAuthCreds(PROJECT_OAUTH_FILE);
    const remaining = getTokenRemainingMinutes(creds);

    log('info', `토큰 남은 시간: ${remaining}분`);

    // 3. 10분 이하면 갱신 필요
    if (remaining <= 10) {
        log('warning', '토큰 만료 임박 - 갱신 시도...');

        if (refreshTokenWithCLI()) {
            // HOME에서 갱신된 토큰 동기화
            syncTokenFromHome();

            const newCreds = loadOAuthCreds(PROJECT_OAUTH_FILE);
            const newRemaining = getTokenRemainingMinutes(newCreds);
            log('success', `새 토큰 남은 시간: ${newRemaining}분`);
            return true;
        } else {
            log('error', '토큰 갱신 실패');
            return false;
        }
    } else {
        log('success', '토큰 유효함 - 갱신 불필요');
        return true;
    }
}

/**
 * 유효한 Access Token 반환 (외부 모듈용)
 */
export async function getValidAccessToken() {
    // 1. 토큰 상태 체크 및 필요 시 갱신
    await checkAndRefreshToken();

    // 2. 파일에서 토큰 읽기
    const creds = loadOAuthCreds(PROJECT_OAUTH_FILE);
    if (!creds || !creds.access_token) {
        throw new Error('OAuth 토큰을 찾을 수 없습니다.');
    }

    return creds.access_token;
}

/**
 * 토큰 상태 출력
 */
export function printTokenStatus() {
    const projectCreds = loadOAuthCreds(PROJECT_OAUTH_FILE);
    const homeCreds = loadOAuthCreds(HOME_OAUTH_FILE);

    const projectRemaining = getTokenRemainingMinutes(projectCreds);
    const homeRemaining = getTokenRemainingMinutes(homeCreds);

    console.log('\n Gemini OAuth 토큰 상태:');
    console.log(`   PROJECT: ${projectRemaining}분 남음`);
    console.log(`   HOME:    ${homeRemaining}분 남음`);

    if (projectRemaining < 0 && homeRemaining < 0) {
        console.log('    모든 토큰 만료됨 - gemini 명령어로 재로그인 필요');
    } else if (projectRemaining < 10 || homeRemaining < 10) {
        console.log('    토큰 만료 임박 - 갱신 권장');
    } else {
        console.log('    토큰 유효');
    }
    console.log('');
}

/**
 * 시작 시간 기록 (파이프라인용)
 */
let pipelineStartTime = null;

export function recordPipelineStart() {
    pipelineStartTime = Date.now();
    log('info', '파이프라인 시작 시간 기록됨');
}

/**
 * 50분 경과 체크 (파이프라인 중간에 호출)
 * 참고: Gemini CLI가 access_token 만료 시 자동으로 refresh_token으로 갱신하므로
 * 이 함수 호출은 선택 사항임
 */
export async function checkTokenMidPipeline() {
    if (!pipelineStartTime) return true;

    const elapsed = (Date.now() - pipelineStartTime) / 60000;
    log('debug', `파이프라인 경과 시간: ${Math.floor(elapsed)}분`);

    // 50분 경과 시 토큰 체크 및 갱신
    if (elapsed >= 50) {
        log('warning', '50분 경과 - 토큰 체크 필요');
        const result = await checkAndRefreshToken();
        pipelineStartTime = Date.now(); // 타이머 리셋
        return result;
    }

    return true;
}

// CLI 실행
if (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('gemini-oauth-manager.js')) {
    const args = process.argv.slice(2);

    if (args.includes('--status')) {
        printTokenStatus();
    } else if (args.includes('--sync-from-home')) {
        syncTokenFromHome();
    } else if (args.includes('--sync-to-home')) {
        syncTokenToHome();
    } else if (args.includes('--refresh')) {
        refreshTokenWithCLI();
        syncTokenFromHome();
    } else {
        // 기본: 체크 및 갱신
        await checkAndRefreshToken();
    }
}
