/**
 * Gemini CLI OAuth 설정 관리자
 * - oauth_creds.json 및 관련 설정 파일을 ~/.gemini/에 복사
 * - Gemini CLI가 자체적으로 토큰 갱신을 처리함
 * - GitHub Actions에서 변경된 파일 커밋
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 파일 경로
const BACKEND_DIR = path.resolve(__dirname, '../..');
const OAUTH_CREDS_PATH = path.join(BACKEND_DIR, 'oauth_creds.json');
const GOOGLE_ACCOUNTS_PATH = path.join(BACKEND_DIR, 'google_accounts.json');
const SETTINGS_PATH = path.join(BACKEND_DIR, 'settings.json');
const STATE_PATH = path.join(BACKEND_DIR, 'state.json');

const GEMINI_CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.gemini');

// 로그 함수
function log(level, msg) {
    const time = new Date().toTimeString().slice(0, 8);
    const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌', debug: '🔍' };
    console.log(`[${time}] ${icons[level] || ''} ${msg}`);
}

/**
 * 파일 복사 (존재하는 경우)
 */
function copyIfExists(src, dest, description) {
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        log('success', `${description} 복사 완료`);
        return true;
    }
    return false;
}

/**
 * OAuth 토큰 만료 확인
 */
function checkTokenExpiry() {
    if (!fs.existsSync(OAUTH_CREDS_PATH)) {
        return { valid: false, message: 'OAuth 크레덴셜 파일이 없습니다.' };
    }

    try {
        const creds = JSON.parse(fs.readFileSync(OAUTH_CREDS_PATH, 'utf-8'));
        
        if (!creds.expiry_date) {
            return { valid: false, message: 'expiry_date가 없습니다.' };
        }

        const now = Date.now();
        const bufferMs = 5 * 60 * 1000; // 5분 버퍼

        if (now >= (creds.expiry_date - bufferMs)) {
            const expiryDate = new Date(creds.expiry_date);
            return {
                valid: false,
                expired: true,
                message: `토큰이 만료되었습니다. (만료: ${expiryDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`
            };
        }

        const expiryDate = new Date(creds.expiry_date);
        return {
            valid: true,
            message: `토큰 유효 (만료: ${expiryDate.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`
        };
    } catch (error) {
        return { valid: false, message: `파일 파싱 실패: ${error.message}` };
    }
}

/**
 * Gemini CLI 설정 디렉토리 설정
 */
function setupGeminiConfig() {
    log('info', '='.repeat(50));
    log('info', '  Gemini CLI 설정 복사');
    log('info', '='.repeat(50));

    // 1. OAuth 크레덴셜 확인
    if (!fs.existsSync(OAUTH_CREDS_PATH)) {
        log('error', `OAuth 크레덴셜 파일이 없습니다: ${OAUTH_CREDS_PATH}`);
        log('info', '');
        log('info', '해결 방법:');
        log('info', '1. 로컬에서 `gemini` 명령어로 로그인');
        log('info', '2. ~/.gemini/ 폴더의 파일들을 backend/ 폴더에 복사');
        log('info', '3. GitHub에 커밋');
        process.exit(1);
    }

    // 2. 토큰 만료 확인
    const tokenStatus = checkTokenExpiry();
    if (tokenStatus.valid) {
        log('success', tokenStatus.message);
    } else if (tokenStatus.expired) {
        log('warning', tokenStatus.message);
        log('warning', 'Gemini CLI가 실행 시 자동으로 토큰 갱신을 시도합니다.');
        log('warning', '만약 실패하면 로컬에서 다시 로그인이 필요합니다.');
    } else {
        log('error', tokenStatus.message);
    }

    // 3. Gemini 설정 디렉토리 생성
    if (!fs.existsSync(GEMINI_CONFIG_DIR)) {
        fs.mkdirSync(GEMINI_CONFIG_DIR, { recursive: true });
        log('success', `설정 디렉토리 생성: ${GEMINI_CONFIG_DIR}`);
    }

    // 4. 파일 복사
    copyIfExists(OAUTH_CREDS_PATH, path.join(GEMINI_CONFIG_DIR, 'oauth_creds.json'), 'oauth_creds.json');
    copyIfExists(GOOGLE_ACCOUNTS_PATH, path.join(GEMINI_CONFIG_DIR, 'google_accounts.json'), 'google_accounts.json');
    copyIfExists(SETTINGS_PATH, path.join(GEMINI_CONFIG_DIR, 'settings.json'), 'settings.json');
    copyIfExists(STATE_PATH, path.join(GEMINI_CONFIG_DIR, 'state.json'), 'state.json');

    log('info', '');
    log('info', `📁 ${GEMINI_CONFIG_DIR} 내용:`);
    const files = fs.readdirSync(GEMINI_CONFIG_DIR);
    files.forEach(f => log('debug', `  - ${f}`));

    log('info', '='.repeat(50));
    log('success', 'Gemini CLI 설정 완료');
    log('info', '='.repeat(50));
}

/**
 * GitHub Actions에서 변경된 설정 파일 커밋
 */
function commitChangedFiles() {
    if (!process.env.GITHUB_ACTIONS) {
        log('info', 'GitHub Actions 환경이 아니므로 커밋 스킵');
        return;
    }

    try {
        // Gemini CLI가 토큰을 갱신했을 수 있으므로 ~/.gemini/에서 backend/로 복사
        const geminiOAuthPath = path.join(GEMINI_CONFIG_DIR, 'oauth_creds.json');
        
        if (fs.existsSync(geminiOAuthPath)) {
            const geminiCreds = fs.readFileSync(geminiOAuthPath, 'utf-8');
            const backendCreds = fs.existsSync(OAUTH_CREDS_PATH) 
                ? fs.readFileSync(OAUTH_CREDS_PATH, 'utf-8') 
                : '';

            // 파일이 변경되었으면 복사
            if (geminiCreds !== backendCreds) {
                fs.writeFileSync(OAUTH_CREDS_PATH, geminiCreds, 'utf-8');
                log('success', 'OAuth 크레덴셜 업데이트됨 (Gemini CLI에서 갱신)');
            }
        }

        // Git 설정
        execSync('git config user.name "github-actions[bot]"', { stdio: 'pipe' });
        execSync('git config user.email "github-actions[bot]@users.noreply.github.com"', { stdio: 'pipe' });

        // 변경사항 추가
        execSync(`git add "${OAUTH_CREDS_PATH}" 2>/dev/null || true`, { stdio: 'pipe' });

        // 변경사항 확인
        const status = execSync('git status --porcelain', { encoding: 'utf-8' });

        if (status.includes('oauth_creds.json')) {
            execSync('git commit -m "🔐 Auto: OAuth 토큰 업데이트"', { stdio: 'pipe' });
            execSync('git push', { stdio: 'pipe' });
            log('success', 'OAuth 크레덴셜 변경사항 커밋 완료');
        } else {
            log('info', 'OAuth 크레덴셜 변경사항 없음');
        }
    } catch (error) {
        log('warning', `커밋 처리 중 오류: ${error.message}`);
    }
}

// 메인 실행
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--check')) {
        // 토큰 상태만 확인
        const status = checkTokenExpiry();
        console.log(JSON.stringify(status, null, 2));
        process.exit(status.valid ? 0 : 1);
    } else if (args.includes('--commit')) {
        // 변경사항 커밋만
        commitChangedFiles();
    } else {
        // 기본: 설정 복사
        setupGeminiConfig();
    }
}

main();

export { setupGeminiConfig, checkTokenExpiry, commitChangedFiles };
