/**
 * Phase 1: 자막 수집 전용 스크립트
 * Puppeteer로 모든 영상의 자막을 먼저 수집하여 저장
 * 이후 extract-addresses.js에서 저장된 자막을 로드하여 Gemini 분석
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

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
        break;
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

// [개선] 자막 파일은 날짜에 관계없이 공유 (재사용)
// data/transcripts.jsonl에 저장하여 날짜가 바뀌어도 기존 자막 활용
const SHARED_TRANSCRIPT_FILE = path.join(DATA_DIR, 'transcripts.jsonl');

// 로그 함수
const DEBUG_MODE = process.env.DEBUG === 'true';

function log(level, msg) {
    if (level === 'debug' && !DEBUG_MODE) return;

    const time = getKSTDate().toTimeString().slice(0, 8);
    const tags = {
        info: '[INFO]',
        success: '[OK]',
        warning: '[WARN]',
        error: '[ERR]',
        debug: '[DBG]',
        progress: '[PROG]'
    };

    console.log(`[${time}] ${tags[level] || '[LOG]'} ${msg}`);
}

// Puppeteer 동시 실행 제한 (성능 최적화: 로컬 3개)
const isGitHubActionsEnv = !!process.env.GITHUB_ACTIONS;
const PUPPETEER_CONCURRENCY = isGitHubActionsEnv ? 1 : 3;
let puppeteerActiveCount = 0;
const puppeteerQueue = [];

async function acquirePuppeteerSlot() {
    if (puppeteerActiveCount < PUPPETEER_CONCURRENCY) {
        puppeteerActiveCount++;
        return;
    }
    await new Promise(resolve => puppeteerQueue.push(resolve));
    puppeteerActiveCount++;
}

function releasePuppeteerSlot() {
    puppeteerActiveCount--;
    if (puppeteerQueue.length > 0) {
        const next = puppeteerQueue.shift();
        next();
    }
}

// Puppeteer 인스턴스 (재사용) - Stealth 모드 적용
let puppeteerBrowser = null;
let puppeteerModule = null;
let puppeteerChecked = false;
let stealthApplied = false;

// User-Agent 로테이션 (안티-블로킹)
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// 랜덤 딸레이 (성능 최적화: 2-3초)
function getRandomDelay() {
    return 2000 + Math.floor(Math.random() * 1000);
}

/**
 * Puppeteer로 자막 수집 (maestra.ai → tubetranscript.com fallback)
 */
async function getTranscriptWithPuppeteer(videoId) {
    // 모듈 캐싱 + Stealth 플러그인 적용
    if (!puppeteerChecked) {
        puppeteerChecked = true;
        try {
            // puppeteer-extra + stealth 플러그인 로드
            const puppeteerExtra = await import('puppeteer-extra');
            const StealthPlugin = await import('puppeteer-extra-plugin-stealth');

            // Stealth 플러그인 적용 (한 번만)
            if (!stealthApplied) {
                puppeteerExtra.default.use(StealthPlugin.default());
                stealthApplied = true;
                log('info', 'Stealth 모드 활성화됨 (봇 감지 우회)');
            }

            puppeteerModule = puppeteerExtra;
        } catch (err) {
            log('warning', `puppeteer-extra 로드 실패, 기본 puppeteer 사용: ${err.message}`);
            try {
                puppeteerModule = await import('puppeteer');
            } catch {
                log('error', 'Puppeteer 모듈 없음');
                puppeteerModule = null;
            }
        }
    }

    if (!puppeteerModule) return null;

    try {
        // 브라우저 재사용 (ARM64 시스템 Chromium 사용)
        if (!puppeteerBrowser) {
            const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';

            // 성능 최적화 플래그
            const optimizedArgs = [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-extensions',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection',
                '--memory-pressure-off',
                '--max-old-space-size=512',
            ];

            puppeteerBrowser = await puppeteerModule.default.launch({
                headless: true,
                executablePath,
                protocolTimeout: 300000,
                args: optimizedArgs
            });
            log('info', `브라우저 시작: ${executablePath}`);
        }

        const page = await puppeteerBrowser.newPage();

        // 성능 최적화: 불필요한 리소스 차단 (페이지 로딩 50% 단축)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            // 이미지, 폰트, 미디어 차단 (최소 CSS는 필요할 수 있어 유지)
            if (['image', 'font', 'media'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // 안티-블로킹: 랜덤 User-Agent 설정
        await page.setUserAgent(getRandomUserAgent());
        await page.setViewport({ width: 1280, height: 800 });

        // 요청 간 랜덤 딜레이 (3-5초)
        await new Promise(resolve => setTimeout(resolve, getRandomDelay()));

        let result = null;

        // 1차: maestra.ai 시도
        result = await collectFromMaestra(page, videoId);

        // 2차: tubetranscript.com fallback
        if (!result) {
            result = await collectFromTubeTranscript(page, videoId);
        }

        await page.close();

        if (result) {
            // 텍스트로 변환
            const text = result.transcript.map(seg => {
                const minutes = Math.floor(seg.start / 60);
                const seconds = Math.floor(seg.start % 60);
                return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}] ${seg.text}`;
            }).join('\n');

            return { text, segments: result.transcript.length, language: result.language };
        }

        return null;
    } catch (error) {
        log('debug', `Puppeteer 오류: ${error.message}`);
        return null;
    }
}

/**
 * maestra.ai에서 자막 수집
 */
async function collectFromMaestra(page, videoId) {
    const url = `https://maestra.ai/tools/video-to-text/youtube-transcript-generator?v=${videoId}`;
    const PAGE_TIMEOUT = 60000;

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

        // mode-toggle 버튼 또는 "Get Transcript" 버튼 대기
        try {
            // waitForSelector로 네이티브 대기 (성능 최적화)
            await Promise.race([
                page.waitForSelector('button.mode-toggle', { timeout: 30000 }),
                page.waitForSelector('input.search-button[type="submit"]', { timeout: 30000 })
            ]);

            // Get Transcript 버튼이 있으면 클릭
            const submitButton = await page.$('input.search-button[type="submit"]');
            if (submitButton) {
                await submitButton.click();
                await page.waitForSelector('button.mode-toggle', { timeout: 30000 }).catch(() => { });
            }
        } catch {
            // 타임아웃 - 계속 진행
        }

        // caption 모드로 전환
        const currentMode = await page.evaluate(() => {
            const btn = document.querySelector('button.mode-toggle');
            return btn?.getAttribute('data-mode') || '';
        });

        if (currentMode !== 'caption') {
            try {
                await page.click('button.mode-toggle svg[data-icon="caption"]');
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch {
                // 무시
            }
        }

        // 자막 라인 대기 (waitForSelector로 최적화)
        try {
            await page.waitForSelector('.transcript-content samp.caption-line', { timeout: 20000 });
        } catch {
            // 타임아웃 - 계속 진행
        }

        // 자막 파싱
        const transcript = await page.evaluate(() => {
            const segments = [];
            const captionLines = document.querySelectorAll('.transcript-content samp.caption-line');

            captionLines.forEach(line => {
                const textEl = line.querySelector('.caption-text');
                const dataStart = line.getAttribute('data-start');

                if (textEl) {
                    segments.push({
                        start: dataStart ? parseFloat(dataStart) : 0,
                        text: textEl.textContent?.trim() || ''
                    });
                }
            });

            return segments;
        });

        if (transcript.length === 0) return null;

        return { transcript, language: 'korean' };

    } catch (error) {
        return null;
    }
}

/**
 * tubetranscript.com에서 자막 수집 (fallback)
 */
async function collectFromTubeTranscript(page, videoId) {
    const url = `https://www.tubetranscript.com/ko/watch?v=${videoId}`;
    const PAGE_TIMEOUT = 60000;

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });

        // 자막 컨테이너 대기 (waitForSelector로 최적화)
        try {
            await page.waitForSelector('#main-transcript-content .transcript-group-box', { timeout: 30000 });
        } catch {
            // 타임아웃 - 계속 진행
        }

        // 자막 파싱
        const transcript = await page.evaluate(() => {
            const segments = [];
            const groups = document.querySelectorAll('#main-transcript-content .transcript-group-box');

            groups.forEach(group => {
                const timeEl = group.querySelector('.transcript-time a[target="_blank"]');
                const textEl = group.querySelector('.transcript-text');

                if (timeEl && textEl) {
                    const timeStr = timeEl.textContent?.trim() || '';
                    const parts = timeStr.split(':').map(Number);

                    let startSeconds = 0;
                    if (parts.length === 2) {
                        startSeconds = parts[0] * 60 + parts[1];
                    } else if (parts.length === 3) {
                        startSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
                    }

                    segments.push({
                        start: startSeconds,
                        text: textEl.textContent?.trim() || ''
                    });
                }
            });

            return segments;
        });

        if (transcript.length === 0) return null;

        return { transcript, language: 'korean' };

    } catch (error) {
        return null;
    }
}

/**
 * 단일 영상 자막 수집
 */
async function collectTranscriptForVideo(video, index, total) {
    await acquirePuppeteerSlot();

    try {
        log('info', `[${index + 1}/${total}] 자막 수집: ${video.title.slice(0, 40)}...`);

        const result = await getTranscriptWithPuppeteer(video.videoId);

        releasePuppeteerSlot();

        if (result) {
            log('success', `  → ${result.segments}개 세그먼트 수집됨`);
            return {
                videoId: video.videoId,
                transcript: result.text,
                segments: result.segments,
                language: result.language,
                hasTranscript: true,
                collectedAt: getKSTDate().toISOString()
            };
        } else {
            log('debug', `→ 자막 없음`);
            return {
                videoId: video.videoId,
                transcript: null,
                segments: 0,
                hasTranscript: false,
                collectedAt: getKSTDate().toISOString()
            };
        }
    } catch (error) {
        releasePuppeteerSlot();
        log('warning', `  → 수집 실패: ${error.message}`);
        return {
            videoId: video.videoId,
            transcript: null,
            segments: 0,
            hasTranscript: false,
            error: error.message,
            collectedAt: getKSTDate().toISOString()
        };
    }
}

/**
 * 메인 실행
 */
async function main() {
    log('info', '▶ 자막 수집 시작 (Phase 1.5)');

    const startTime = Date.now();

    // 입력 파일 확인
    let inputFile = path.join(TODAY_PATH, 'meatcreator_videos_all.jsonl');

    if (!fs.existsSync(inputFile)) {
        const allVideosFile = path.join(TODAY_PATH, 'meatcreator_videos.json');
        if (!fs.existsSync(allVideosFile)) {
            log('error', '영상 목록 파일이 없습니다. 먼저 crawl-channel.js를 실행하세요.');
            process.exit(1);
        }

        const allVideos = JSON.parse(fs.readFileSync(allVideosFile, 'utf-8'));
        const videosToProcess = allVideos.videos;

        const content = videosToProcess.map(v => JSON.stringify(v)).join('\n');
        fs.writeFileSync(inputFile, content, 'utf-8');

        log('info', `처리할 영상 ${videosToProcess.length}개 (새로 생성됨)`);
    }

    // 영상 목록 로드
    const content = fs.readFileSync(inputFile, 'utf-8');
    const videos = content.trim().split('\n').map(line => JSON.parse(line));

    log('info', `총 영상: ${videos.length}개`);

    // 이미 수집된 자막 체크 (공유 파일 사용)
    // [개선] 날짜별 폴더가 아닌 data/ 루트의 공유 파일 사용
    const transcriptFile = SHARED_TRANSCRIPT_FILE;
    const collectedTranscripts = new Map();

    if (fs.existsSync(transcriptFile)) {
        const existingContent = fs.readFileSync(transcriptFile, 'utf-8');
        const lines = existingContent.trim().split('\n');
        for (const line of lines) {
            if (line) {
                try {
                    const data = JSON.parse(line);
                    collectedTranscripts.set(data.videoId, data);
                } catch { }
            }
        }
        log('info', `기존 자막 로드 (공유): ${collectedTranscripts.size}개`);
    }

    // 수집할 영상 필터링
    const videosToCollect = videos.filter(v => !collectedTranscripts.has(v.videoId));
    log('info', `수집 대상: ${videosToCollect.length}개 / 스킵: ${videos.length - videosToCollect.length}개`);
    log('info', `병렬 처리: 동시 ${PUPPETEER_CONCURRENCY}개`);

    if (videosToCollect.length === 0) {
        log('success', '모든 자막이 이미 수집되었습니다.');
        return;
    }

    // 통계
    const stats = {
        total: videosToCollect.length,
        success: 0,
        noTranscript: 0,
        failed: 0
    };

    // 배치 처리
    const BATCH_SIZE = PUPPETEER_CONCURRENCY;
    const SAVE_INTERVAL = 20; // 20개마다 저장 (I/O 최적화)

    let processedCount = 0;
    const newResults = [];

    for (let i = 0; i < videosToCollect.length; i += BATCH_SIZE) {
        const batch = videosToCollect.slice(i, i + BATCH_SIZE);

        const results = await Promise.all(
            batch.map((video, idx) =>
                collectTranscriptForVideo(video, i + idx, videosToCollect.length)
            )
        );

        for (const result of results) {
            newResults.push(result);

            if (result.hasTranscript) {
                stats.success++;
            } else if (result.error) {
                stats.failed++;
            } else {
                stats.noTranscript++;
            }

            processedCount++;

            // 중간 저장
            if (processedCount % SAVE_INTERVAL === 0) {
                // 기존 데이터 + 새 데이터 합치기
                const allData = [...collectedTranscripts.values(), ...newResults];
                const content = allData.map(d => JSON.stringify(d)).join('\n');
                fs.writeFileSync(transcriptFile, content, 'utf-8');
                log('info', `중간 저장: ${allData.length}개`);
            }
        }
    }

    // 최종 저장
    const allData = [...collectedTranscripts.values(), ...newResults];
    const finalContent = allData.map(d => JSON.stringify(d)).join('\n');
    fs.writeFileSync(transcriptFile, finalContent, 'utf-8');

    // 브라우저 종료
    if (puppeteerBrowser) {
        await puppeteerBrowser.close();
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    log('info', '');
    log('info', '='.repeat(60));
    log('success', '자막 수집 완료');
    log('info', '='.repeat(60));
    log('info', `총 수집: ${stats.success}개`);
    log('info', `자막 없음: ${stats.noTranscript}개`);
    log('info', `실패: ${stats.failed}개`);
    log('info', `소요 시간: ${elapsed}초`);
    log('info', `저장: ${transcriptFile}`);
    log('info', '='.repeat(60));
}

main().catch(error => {
    log('error', `치명적 오류: ${error.message}`);
    console.error(error);
    process.exit(1);
});
