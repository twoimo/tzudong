/**
 * 자막 수집 스크립트 (recollect_id 기반)
 * - Puppeteer로 maestra.ai / tubetranscript.com에서 자막 수집
 * - Meta의 recollect_id/recollect_vars 확인하여 수집 결정
 * - duration_changed 시 재수집
 * 
 * 수집 조건:
 * - meta.recollect_id > transcript.recollect_id
 * - AND (신규 OR meta.recollect_vars에 "duration_changed" 포함)
 * 
 * 사용법:
 *   node 03-collect-transcript.js --channel tzuyang
 *   node 03-collect-transcript.js --channel meatcreator
 *   node 03-collect-transcript.js  # 모든 채널
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env 로드
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    config({ path: envPath });
}

// config 로드 (CHANNELS_CONFIG 환경변수로 지정 가능)
function loadChannelsConfig() {
    const configName = process.env.CHANNELS_CONFIG || 'channels.yaml';
    const configPath = path.resolve(__dirname, '../../config', configName);
    if (!fs.existsSync(configPath)) {
        throw new Error(`설정 파일 없음: ${configPath}`);
    }
    return yaml.load(fs.readFileSync(configPath, 'utf-8'));
}

// 한국 시간 (KST)
function getKSTDate() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (9 * 60 * 60 * 1000));
}

// KST ISO 문자열 생성 (2025-12-04T01:37:01.799+09:00 형식)
function getKSTISOString() {
    const now = new Date();
    return now.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(' ', 'T') +
        '.' + String(now.getMilliseconds()).padStart(3, '0') + '+09:00';
}

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
    };
    console.log(`[${time}] ${tags[level] || '[LOG]'} ${msg}`);
}

// URL에서 video_id 추출
function extractVideoId(url) {
    const patterns = [
        /youtube\.com\/watch\?v=([^&]+)/,
        /youtu\.be\/([^?]+)/,
        /youtube\.com\/embed\/([^?]+)/,
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

// urls.txt에서 video_id 목록 로드
function loadVideoIdsFromTxt(dataPath) {
    const urlsFile = path.join(dataPath, 'urls.txt');
    const videoIds = [];

    if (!fs.existsSync(urlsFile)) return videoIds;

    const lines = fs.readFileSync(urlsFile, 'utf-8').split('\n');
    for (const line of lines) {
        const url = line.trim();
        if (url) {
            const videoId = extractVideoId(url);
            if (videoId) videoIds.push(videoId);
        }
    }
    return videoIds;
}

// JSONL 파일의 마지막 줄 (최신 데이터) 로드
function getLatestData(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
        if (lines.length > 0 && lines[lines.length - 1]) {
            return JSON.parse(lines[lines.length - 1]);
        }
    } catch { }
    return null;
}

// Meta에서 최신 데이터 로드
function getLatestMeta(dataPath, videoId) {
    const metaFile = path.join(dataPath, 'meta', `${videoId}.jsonl`);
    return getLatestData(metaFile);
}

// Transcript에서 최신 데이터 로드
function getLatestTranscript(dataPath, videoId) {
    const transcriptFile = path.join(dataPath, 'transcript', `${videoId}.jsonl`);
    return getLatestData(transcriptFile);
}

// 블랙리스트 디렉토리
const NO_TRANSCRIPT_DIR = path.resolve(__dirname, '../../data/no_transcript_link');
const NO_TRANSCRIPT_PERMANENT = path.join(NO_TRANSCRIPT_DIR, 'no_transcript_permanent.json');

// 영구 스킵 URL 로드 (retry_num >= 3)
function loadPermanentSkipUrls() {
    const skipUrls = new Set();

    if (fs.existsSync(NO_TRANSCRIPT_PERMANENT)) {
        try {
            const content = fs.readFileSync(NO_TRANSCRIPT_PERMANENT, 'utf-8');
            const entries = JSON.parse(content);

            for (const entry of entries) {
                if (entry.retry_num >= 3) {
                    skipUrls.add(entry.youtube_link);
                }
            }

            if (skipUrls.size > 0) {
                log('warning', `영구 스킵 URL: ${skipUrls.size}개 (retry_num >= 3)`);
            }
        } catch (error) {
            log('warning', `no_transcript_permanent.json 로드 실패: ${error.message}`);
        }
    }

    return skipUrls;
}

// 블랙리스트 업데이트 (자막 없는 URL 기록)
function updateNoTranscriptPermanent(youtubeUrl) {
    try {
        if (!fs.existsSync(NO_TRANSCRIPT_DIR)) {
            fs.mkdirSync(NO_TRANSCRIPT_DIR, { recursive: true });
        }

        let entries = [];
        if (fs.existsSync(NO_TRANSCRIPT_PERMANENT)) {
            const content = fs.readFileSync(NO_TRANSCRIPT_PERMANENT, 'utf-8');
            entries = JSON.parse(content);
        }

        const existingIndex = entries.findIndex(e => e.youtube_link === youtubeUrl);
        if (existingIndex >= 0) {
            entries[existingIndex].retry_num += 1;
            log('warning', `no_transcript 업데이트: ${youtubeUrl} (retry: ${entries[existingIndex].retry_num})`);
        } else {
            entries.push({
                youtube_link: youtubeUrl,
                retry_num: 1
            });
            log('warning', `no_transcript 추가: ${youtubeUrl}`);
        }

        fs.writeFileSync(NO_TRANSCRIPT_PERMANENT, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (error) {
        log('warning', `no_transcript 업데이트 실패: ${error.message}`);
    }
}

// Puppeteer 설정
const isGitHubActionsEnv = !!process.env.GITHUB_ACTIONS;
const PUPPETEER_CONCURRENCY = isGitHubActionsEnv ? 1 : 3;
let puppeteerActiveCount = 0;
const puppeteerQueue = [];
let puppeteerBrowser = null;
let puppeteerModule = null;
let puppeteerChecked = false;
let stealthApplied = false;

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

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

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const DELAY_MIN = 1000;  // 1초
const DELAY_MAX = 3000;  // 3초

function getRandomDelay() {
    return Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1)) + DELAY_MIN;
}

/**
 * Puppeteer로 자막 수집
 */
async function getTranscriptWithPuppeteer(videoId) {
    if (!puppeteerChecked) {
        puppeteerChecked = true;
        try {
            const puppeteerExtra = await import('puppeteer-extra');
            const StealthPlugin = await import('puppeteer-extra-plugin-stealth');
            if (!stealthApplied) {
                puppeteerExtra.default.use(StealthPlugin.default());
                stealthApplied = true;
            }
            puppeteerModule = puppeteerExtra;
        } catch {
            try {
                puppeteerModule = await import('puppeteer');
            } catch {
                puppeteerModule = null;
            }
        }
    }

    if (!puppeteerModule) return null;

    try {
        if (!puppeteerBrowser) {
            const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
            puppeteerBrowser = await puppeteerModule.default.launch({
                headless: true,
                executablePath,
                protocolTimeout: 300000,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-extensions',
                ]
            });
        }

        const page = await puppeteerBrowser.newPage();
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'font', 'media'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });
        await page.setUserAgent(getRandomUserAgent());
        await page.setViewport({ width: 1280, height: 800 });
        await new Promise(resolve => setTimeout(resolve, getRandomDelay()));

        let result = await collectFromMaestra(page, videoId);
        if (!result) {
            result = await collectFromTubeTranscript(page, videoId);
        }

        await page.close();

        if (result) {
            const text = result.transcript.map(seg => {
                const minutes = Math.floor(seg.start / 60);
                const seconds = Math.floor(seg.start % 60);
                return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}] ${seg.text}`;
            }).join('\n');
            return { text, segments: result.transcript, language: result.language };
        }
        return null;
    } catch (error) {
        log('debug', `Puppeteer 오류: ${error.message}`);
        return null;
    }
}

async function collectFromMaestra(page, videoId) {
    const url = `https://maestra.ai/tools/video-to-text/youtube-transcript-generator?v=${videoId}`;
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // mode-toggle 버튼 또는 "텍스트 변환하기" 버튼 대기 (최대 60초)
        let modeToggleFound = false;
        const startTime = Date.now();
        const maxWait = 60000;

        while (Date.now() - startTime < maxWait) {
            const hasModeToggle = await page.evaluate(() => {
                return document.querySelector('button.mode-toggle') !== null;
            });

            if (hasModeToggle) {
                modeToggleFound = true;
                break;
            }

            // "텍스트 변환하기" 또는 "Get Transcript" 버튼 체크
            const submitButton = await page.evaluate(() => {
                const btn = document.querySelector('input.search-button[type="submit"]');
                if (btn && (btn.value === '텍스트 변환하기' || btn.value === 'Get Transcript')) {
                    return true;
                }
                return false;
            });

            if (submitButton) {
                await page.click('input.search-button[type="submit"]');
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (!modeToggleFound) {
            return null;
        }

        // 현재 모드 확인 후 caption 모드로 전환
        const currentMode = await page.evaluate(() => {
            const btn = document.querySelector('button.mode-toggle');
            return btn?.getAttribute('data-mode') || '';
        });

        if (currentMode !== 'caption') {
            try {
                await page.click('button.mode-toggle svg[data-icon="caption"]');
            } catch { }

            // data-mode="caption"이 될 때까지 대기 (최대 10초)
            let captionModeReady = false;
            const modeStartTime = Date.now();
            while (Date.now() - modeStartTime < 10000) {
                const mode = await page.evaluate(() => {
                    const btn = document.querySelector('button.mode-toggle');
                    return btn?.getAttribute('data-mode') || '';
                });
                if (mode === 'caption') {
                    captionModeReady = true;
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            if (!captionModeReady) {
                return null;
            }
        }

        // 자막 라인(.caption-line)이 나타날 때까지 대기 (최대 30초)
        let captionLinesFound = false;
        const captionStartTime = Date.now();
        const captionMaxWait = 30000;

        while (Date.now() - captionStartTime < captionMaxWait) {
            const count = await page.evaluate(() => {
                return document.querySelectorAll('.transcript-content samp.caption-line').length;
            });

            if (count > 0) {
                captionLinesFound = true;
                break;
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (!captionLinesFound) {
            return null;
        }

        // 언어 추출
        const language = await page.evaluate(() => {
            const langOption = document.querySelector('.language-selector select option:checked');
            if (langOption) {
                return langOption.textContent?.toLowerCase() || 'korean';
            }
            return 'korean';
        });

        // 자막 파싱
        const transcript = await page.evaluate(() => {
            const segments = [];
            const captionLines = document.querySelectorAll('.transcript-content samp.caption-line');

            const parseTimeToSeconds = (timeStr) => {
                const parts = timeStr.split(':').map(Number);
                if (parts.length === 2) return parts[0] * 60 + parts[1];
                if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
                return 0;
            };

            captionLines.forEach(line => {
                const textEl = line.querySelector('.caption-text');
                const timeEl = line.querySelector('.caption-time') || line.querySelector('.timestamp');
                const dataStart = line.getAttribute('data-start');

                if (textEl) {
                    let duration = null;
                    if (timeEl) {
                        const timeText = timeEl.textContent?.trim() || '';
                        const timeMatch = timeText.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)/);
                        if (timeMatch) {
                            const startFromRange = parseTimeToSeconds(timeMatch[1]);
                            const endFromRange = parseTimeToSeconds(timeMatch[2]);
                            duration = endFromRange - startFromRange;
                        }
                    }

                    segments.push({
                        start: dataStart ? parseFloat(dataStart) : 0,
                        duration: duration,
                        text: textEl.textContent?.trim() || ''
                    });
                }
            });
            return segments;
        });

        if (transcript.length === 0) return null;
        return { transcript, language };
    } catch {
        return null;
    }
}

async function collectFromTubeTranscript(page, videoId) {
    const url = `https://www.tubetranscript.com/ko/watch?v=${videoId}`;
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // main-transcript-content가 나타날 때까지 대기 (최대 60초)
        try {
            await page.waitForFunction(
                () => document.querySelector('#main-transcript-content') !== null,
                { timeout: 60000, polling: 1000 }
            );
        } catch {
            return null;
        }

        // 실제 자막 콘텐츠(.transcript-group-box)가 나타날 때까지 대기 (최대 60초)
        try {
            await page.waitForFunction(
                () => document.querySelector('#main-transcript-content .transcript-group-box') !== null,
                { timeout: 60000, polling: 1000 }
            );
        } catch {
            return null;
        }

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
                    if (parts.length === 2) startSeconds = parts[0] * 60 + parts[1];
                    else if (parts.length === 3) startSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
                    segments.push({
                        start: startSeconds,
                        duration: null,  // TubeTranscript은 duration 정보 없음
                        text: textEl.textContent?.trim() || ''
                    });
                }
            });
            return segments;
        });

        if (transcript.length === 0) return null;
        return { transcript, language: 'korean' };
    } catch {
        return null;
    }
}

/**
 * 채널 자막 수집 (recollect_id 기반)
 */
async function collectChannelTranscripts(channelName, channelConfig) {
    const dataPath = path.resolve(__dirname, '../../', channelConfig.data_path);
    const transcriptDir = path.join(dataPath, 'transcript');

    // const channelDataPath = path.join(DATA_DIR, channelName); // ERROR
    const deletedPath = path.join(dataPath, 'deleted_urls.txt');

    // 1. deleted_ids 로드
    const deletedIds = new Set();
    if (fs.existsSync(deletedPath)) {
        const lines = fs.readFileSync(deletedPath, 'utf8').split('\n');
        for (const line of lines) {
            const parts = line.split('\t');
            if (parts[0]) {
                const vid = extractVideoId(parts[0]);
                if (vid) deletedIds.add(vid);
            }
        }
    }

    // 2. Load all video IDs
    const allVideoIds = loadVideoIdsFromTxt(channelName).filter(vid => !deletedIds.has(vid));
    // ...const transcriptDir = path.join(dataPath, 'transcript');

    if (!fs.existsSync(transcriptDir)) {
        fs.mkdirSync(transcriptDir, { recursive: true });
    }

    const permanentSkipUrls = loadPermanentSkipUrls();  // 블랙리스트 로드
    log('info', `채널: ${channelConfig.name}`);
    log('info', `전체 URL: ${allVideoIds.length}개`);

    if (allVideoIds.length === 0) {
        log('warning', 'URL 없음');
        return { channel: channelName, processed: 0, success: 0, skipped: 0 };
    }

    const toCollect = [];

    for (const videoId of allVideoIds) {
        const latestMeta = getLatestMeta(dataPath, videoId);
        const latestTranscript = getLatestTranscript(dataPath, videoId);

        if (!latestMeta) {
            continue;
        }

        // 블랙리스트 확인 (retry_num >= 3)
        const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
        if (permanentSkipUrls.has(youtubeUrl)) {
            continue;
        }

        const metaRecollectId = latestMeta.recollect_id || 0;
        const transcriptRecollectId = latestTranscript?.recollect_id || 0;

        // 수집 조건: meta.recollect_id > transcript.recollect_id
        if (metaRecollectId > transcriptRecollectId) {
            const recollectVars = latestMeta.recollect_vars || [];

            // 신규 또는 duration 변경 시 수집
            if (!latestTranscript || recollectVars.includes("duration_changed")) {
                const reasonVars = latestTranscript ? recollectVars : [];  // 신규는 빈 배열
                toCollect.push({ videoId, recollectVars: reasonVars, metaRecollectId });
            }
        }
    }

    log('info', `수집 대상: ${toCollect.length}개`);

    if (toCollect.length === 0) {
        log('success', '수집 대상 없음');
        return { channel: channelName, processed: 0, success: 0, skipped: allVideoIds.length };
    }

    const stats = { success: 0, noTranscript: 0, failed: 0 };
    const REST_INTERVAL = 100;   // 100개마다 휴식
    const REST_DURATION = 180000; // 3분 (180초)

    for (let i = 0; i < toCollect.length; i++) {
        const { videoId, recollectVars, metaRecollectId } = toCollect[i];
        await acquirePuppeteerSlot();

        try {
            log('info', `  [${i + 1}/${toCollect.length}] ${videoId} (${recollectVars.join(', ') || 'new'})`);

            const result = await getTranscriptWithPuppeteer(videoId);

            const outputData = {
                youtube_link: `https://www.youtube.com/watch?v=${videoId}`,
                language: result ? result.language : null,
                collected_at: getKSTISOString(),
                transcript: result ? result.segments : [],
                // recollect 정보
                recollect_id: metaRecollectId,
                recollect_vars: recollectVars,
            };

            const outputFile = path.join(transcriptDir, `${videoId}.jsonl`);
            fs.appendFileSync(outputFile, JSON.stringify(outputData) + '\n', 'utf-8');

            if (result) {
                stats.success++;
                log('success', `    → ${result.segments.length}개 세그먼트`);
            } else {
                stats.noTranscript++;
                // 블랙리스트에 추가
                updateNoTranscriptPermanent(`https://www.youtube.com/watch?v=${videoId}`);
                log('debug', `    → 자막 없음`);
            }
        } catch (error) {
            stats.failed++;
            log('warning', `    → 실패: ${error.message}`);
        } finally {
            releasePuppeteerSlot();
        }

        // 100개마다 3분 휴식 (rate limit 방지)
        if ((i + 1) % REST_INTERVAL === 0 && i < toCollect.length - 1) {
            log('warning', `🛑 ${i + 1}개 완료 - ${REST_DURATION / 60000}분 휴식 시작...`);
            await new Promise(resolve => setTimeout(resolve, REST_DURATION));
            log('success', `🚀 휴식 끝 - 수집 재개`);
        }

        // 영상별 딜레이 (마지막 제외)
        if (i < toCollect.length - 1) {
            await new Promise(resolve => setTimeout(resolve, getRandomDelay()));
        }
    }

    return {
        channel: channelName,
        processed: toCollect.length,
        success: stats.success,
        noTranscript: stats.noTranscript,
        failed: stats.failed,
        skipped: allVideoIds.length - toCollect.length,
    };
}

/**
 * 메인 실행
 */
async function main() {
    const args = process.argv.slice(2);
    let channelFilter = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--channel' || args[i] === '-c') {
            channelFilter = args[i + 1];
        }
    }

    log('info', '='.repeat(60));
    log('info', '  자막 수집 (recollect_id 기반)');
    log('info', '='.repeat(60));

    const config = loadChannelsConfig();
    const channels = config.channels;
    const channelNames = channelFilter ? [channelFilter] : Object.keys(channels);

    log('info', `대상 채널: ${channelNames.join(', ')}`);

    const results = [];

    for (const channelName of channelNames) {
        if (!channels[channelName]) {
            log('error', `알 수 없는 채널: ${channelName}`);
            continue;
        }
        const result = await collectChannelTranscripts(channelName, channels[channelName]);
        results.push(result);
    }

    if (puppeteerBrowser) {
        await puppeteerBrowser.close();
    }

    log('info', '');
    log('info', '='.repeat(60));
    log('success', '자막 수집 완료');
    for (const result of results) {
        log('info', `  ${result.channel}: 성공 ${result.success}개, 스킵 ${result.skipped}개`);
    }
    log('info', '='.repeat(60));
}

main().catch(error => {
    log('error', `치명적 오류: ${error.message}`);
    console.error(error);
    process.exit(1);
});