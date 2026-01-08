/**
 * 유튜버 맛집 크롤링 전체 파이프라인
 * 1. 채널 영상 수집
 * 2. 주소 추출 및 Gemini 분석
 * 3. DB 저장
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { execSync, spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env 로드
const envPaths = [
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../.env'),
];
for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        config({ path: envPath });
    }
}

// 한국 시간 (KST)
function getKSTDate() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (9 * 60 * 60 * 1000));
}

function getTodayFolder() {
    const pipelineDate = process.env.PIPELINE_DATE;
    if (pipelineDate) return pipelineDate;

    const now = getKSTDate();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

// 데이터 디렉토리
const DATA_DIR = path.resolve(__dirname, '../data');
const TODAY_FOLDER = getTodayFolder();
const TODAY_PATH = path.join(DATA_DIR, TODAY_FOLDER);

// 로그 디렉토리
const LOG_DIR = path.resolve(__dirname, '../../log/geminiCLI-youtuber-crawler', TODAY_FOLDER);

// 디렉토리 생성
[TODAY_PATH, LOG_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// 로그 함수
function log(level, msg) {
    const time = getKSTDate().toTimeString().slice(0, 8);
    const tags = { info: '[INFO]', success: '[OK]', warning: '[WARN]', error: '[ERR]', debug: '[DBG]', phase: '[PHASE]' };
    console.log(`[${time}] ${tags[level] || '[LOG]'} ${msg}`);
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * 스크립트 실행
 */
function runScript(scriptPath, description) {
    return new Promise((resolve, reject) => {
        log('phase', `${description} 시작...`);
        const startTime = Date.now();

        const child = spawn('node', [scriptPath], {
            cwd: path.dirname(scriptPath),
            env: {
                ...process.env,
                PIPELINE_DATE: TODAY_FOLDER
            },
            stdio: 'inherit'
        });

        child.on('close', (code) => {
            const duration = Date.now() - startTime;

            if (code === 0) {
                log('success', `${description} 완료 (${formatDuration(duration)})`);
                resolve({ success: true, duration });
            } else {
                log('error', `${description} 실패 (exit code: ${code})`);
                reject(new Error(`${description} 실패`));
            }
        });

        child.on('error', (error) => {
            log('error', `${description} 에러: ${error.message}`);
            reject(error);
        });
    });
}

/**
 * Gemini OAuth 설정
 */
async function setupGeminiAuth() {
    log('phase', 'Gemini CLI 인증 설정...');

    try {
        const oauthScript = path.join(__dirname, 'gemini-oauth-manager.js');

        if (fs.existsSync(oauthScript)) {
            await runScript(oauthScript, 'OAuth 설정');
        } else {
            // API 키 모드로 대체
            const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_BYEON;
            if (geminiApiKey) {
                log('info', 'API 키 모드로 실행합니다.');
            } else {
                log('warning', 'GEMINI_API_KEY가 설정되지 않았습니다.');
            }
        }
    } catch (error) {
        log('warning', `OAuth 설정 실패, API 키 모드로 계속: ${error.message}`);
    }
}

/**
 * 메인 파이프라인
 */
async function main() {
    const totalStartTime = Date.now();

    log('info', '');
    log('info', '═'.repeat(60));
    log('info', '   유튜버 맛집 크롤링 파이프라인');
    log('info', '═'.repeat(60));
    log('info', `시작 시간: ${getKSTDate().toLocaleString('ko-KR')}`);
    log('info', `데이터 폴더: ${TODAY_FOLDER}`);
    log('info', '');

    const args = process.argv.slice(2);
    const startFrom = args.find(a => a.startsWith('--start-from='))?.split('=')[1] || '1';

    const results = {
        oauth: null,
        crawl: null,
        transcript: null,
        placeInfo: null,
        extract: null,
        geocode: null,
        insert: null
    };

    try {
        // Phase 0: Gemini OAuth 설정
        if (parseInt(startFrom) <= 1) {
            await setupGeminiAuth();
        }

        // Phase 1: 채널 영상 수집
        if (parseInt(startFrom) <= 1) {
            log('info', '');
            log('info', '─'.repeat(60));
            log('phase', 'Phase 1: 채널 영상 수집');
            log('info', '─'.repeat(60));

            results.crawl = await runScript(
                path.join(__dirname, 'crawl-channel.js'),
                '채널 크롤링'
            );
        }

        // Phase 1.5 & 1.6: 자막 수집 + 장소 정보 수집 (병렬 실행)
        if (parseInt(startFrom) <= 1.6) {
            log('info', '');
            log('info', '─'.repeat(60));
            log('phase', 'Phase 1.5 & 1.6: 자막 + 장소 정보 수집 (병렬)');
            log('info', '─'.repeat(60));

            const parallelTasks = [];

            if (parseInt(startFrom) <= 1.5) {
                parallelTasks.push(
                    runScript(path.join(__dirname, 'collect-transcripts.js'), '자막 수집')
                        .then(result => { results.transcript = result; })
                        .catch(err => { log('warning', `자막 수집 실패: ${err.message}`); })
                );
            }

            if (parseInt(startFrom) <= 1.6) {
                parallelTasks.push(
                    runScript(path.join(__dirname, 'collect-place-info.js'), '장소 정보 수집')
                        .then(result => { results.placeInfo = result; })
                        .catch(err => { log('warning', `장소 정보 수집 실패: ${err.message}`); })
                );
            }

            await Promise.all(parallelTasks);
            log('success', '자막 + 장소 정보 수집 완료');
        }

        // Phase 2: 주소 추출 및 Gemini 분석
        if (parseInt(startFrom) <= 2) {
            log('info', '');
            log('info', '─'.repeat(60));
            log('phase', 'Phase 2: AI 분석 (장소 데이터 + 자막 → 맛집 정보)');
            log('info', '─'.repeat(60));

            results.extract = await runScript(
                path.join(__dirname, 'extract-addresses.js'),
                'AI 분석'
            );
        }

        // Phase 3: 좌표 보완 (지오코딩)
        if (parseInt(startFrom) <= 3) {
            log('info', '');
            log('info', '─'.repeat(60));
            log('phase', 'Phase 3: 좌표 보완 (지오코딩)');
            log('info', '─'.repeat(60));

            results.geocode = await runScript(
                path.join(__dirname, 'enrich-coordinates.js'),
                '좌표 보완'
            );
        }

        // Phase 3.5: RULE 기반 평가
        if (parseInt(startFrom) <= 3.5) {
            log('info', '');
            log('info', '─'.repeat(60));
            log('phase', 'Phase 3.5: RULE 기반 평가 (카테고리 + 위치 검증)');
            log('info', '─'.repeat(60));

            results.evaluation = await runScript(
                path.join(__dirname, 'evaluation-rule.js'),
                'RULE 평가'
            );
        }

        // Phase 3.6: LAAJ (AI) 기반 평가
        if (parseInt(startFrom) <= 3.6) {
            log('info', '');
            log('info', '─'.repeat(60));
            log('phase', 'Phase 3.6: LAAJ 평가 (AI + 자막 기반 5개 항목)');
            log('info', '─'.repeat(60));

            try {
                results.laajEvaluation = await runScript(
                    path.join(__dirname, 'evaluation-laaj.js'),
                    'LAAJ 평가'
                );
            } catch (error) {
                log('warning', `LAAJ 평가 실패 (선택적): ${error.message}`);
                // LAAJ 실패해도 계속 진행
            }
        }

        // Phase 4: DB 저장
        if (parseInt(startFrom) <= 4) {
            log('info', '');
            log('info', '─'.repeat(60));
            log('phase', 'Phase 4: 데이터베이스 저장');
            log('info', '─'.repeat(60));

            results.insert = await runScript(
                path.join(__dirname, 'insert-to-supabase.js'),
                'DB 저장'
            );
        }

        // 완료
        const totalDuration = Date.now() - totalStartTime;

        log('info', '');
        log('info', '═'.repeat(60));
        log('success', '파이프라인 완료!');
        log('info', '═'.repeat(60));
        log('info', `총 소요 시간: ${formatDuration(totalDuration)}`);
        log('info', `종료 시간: ${getKSTDate().toLocaleString('ko-KR')}`);
        log('info', '');

        // 로그 저장
        const logFile = path.join(LOG_DIR, `pipeline_${Date.now()}.json`);
        fs.writeFileSync(logFile, JSON.stringify({
            startedAt: new Date(totalStartTime).toISOString(),
            endedAt: new Date().toISOString(),
            duration: totalDuration,
            results
        }, null, 2), 'utf-8');

        log('info', `로그 저장: ${logFile}`);

    } catch (error) {
        const totalDuration = Date.now() - totalStartTime;

        log('info', '');
        log('info', '═'.repeat(60));
        log('error', '파이프라인 실패');
        log('info', '═'.repeat(60));
        log('error', `에러: ${error.message}`);
        log('info', `소요 시간: ${formatDuration(totalDuration)}`);

        process.exit(1);
    }
}

// 도움말
if (process.argv.includes('--help')) {
    console.log(`
유튜버 맛집 크롤링 파이프라인

사용법:
  node pipeline.js [옵션]

옵션:
  --start-from=N    N단계부터 시작
                    1:   채널 크롤링
                    1.5: 자막 수집
                    1.6: 맛집 URL 정보 수집
                    2:   AI 분석 (Gemini)
                    3:   좌표 보완
                    3.5: RULE 평가 (카테고리 + 위치)
                    3.6: LAAJ 평가 (AI + 자막)
                    4:   DB 저장
  --help            도움말 표시

예시:
  node pipeline.js                    # 전체 실행
  node pipeline.js --start-from=1.5   # 자막 수집부터 시작
  node pipeline.js --start-from=2     # AI 분석부터 시작
  node pipeline.js --start-from=4     # DB 저장만 실행
`);
    process.exit(0);
}

main();
