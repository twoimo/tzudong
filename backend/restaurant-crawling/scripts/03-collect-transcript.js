/**
 * 자막 수집 스크립트 (recollect_id 기반)
 * - Puppeteer로 maestra.ai / tubetranscript.com에서 자막 수집
 * - Meta의 recollect_id/recollect_reason 확인하여 수집 결정
 * - duration_changed 시 재수집
 * 
 * 수집 조건:
 * - meta.recollect_id > transcript.recollect_id
 * - AND (신규 OR meta.recollect_reason == "duration_changed")
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

// .env 로드 (backend/.env 우선)
const envPaths = [
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../.env'),
];
for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        config({ path: envPath });
        break;
    }
}

// config 로드
function loadChannelsConfig() {
    const configPath = path.resolve(__dirname, '../../config/channels.yaml');
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

function getRandomDelay() {
    return 2000 + Math.floor(Math.random() * 1000);
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
        try {
            await Promise.race([
                page.waitForSelector('button.mode-toggle', { timeout: 30000 }),
                page.waitForSelector('input.search-button[type="submit"]', { timeout: 30000 })
            ]);
            const submitButton = await page.$('input.search-button[type="submit"]');
            if (submitButton) {
                await submitButton.click();
                await page.waitForSelector('button.mode-toggle', { timeout: 30000 }).catch(() => { });
            }
        } catch { }

        const currentMode = await page.evaluate(() => {
            const btn = document.querySelector('button.mode-toggle');
            return btn?.getAttribute('data-mode') || '';
        });

        if (currentMode !== 'caption') {
            try {
                await page.click('button.mode-toggle svg[data-icon="caption"]');
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch { }
        }

        try {
            await page.waitForSelector('.transcript-content samp.caption-line', { timeout: 20000 });
        } catch { }

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
    } catch {
        return null;
    }
}

async function collectFromTubeTranscript(page, videoId) {
    const url = `https://www.tubetranscript.com/ko/watch?v=${videoId}`;
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        try {
            await page.waitForSelector('#main-transcript-content .transcript-group-box', { timeout: 30000 });
        } catch { }

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

    if (!fs.existsSync(transcriptDir)) {
        fs.mkdirSync(transcriptDir, { recursive: true });
    }

    const allVideoIds = loadVideoIdsFromTxt(dataPath);
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
            // Meta 없으면 스킵
            continue;
        }

        const metaRecollectId = latestMeta.recollect_id || 0;
        const transcriptRecollectId = latestTranscript?.recollect_id || 0;

        // 수집 조건: meta.recollect_id > transcript.recollect_id
        if (metaRecollectId > transcriptRecollectId) {
            const recollectReason = latestMeta.recollect_reason;

            // 신규 또는 duration 변경 시 수집
            if (!latestTranscript || recollectReason === "duration_changed") {
                const reasonText = latestTranscript ? recollectReason : "new";
                toCollect.push({ videoId, recollectReason: reasonText, metaRecollectId });
            }
        }
    }

    log('info', `수집 대상: ${toCollect.length}개`);

    if (toCollect.length === 0) {
        log('success', '수집 대상 없음');
        return { channel: channelName, processed: 0, success: 0, skipped: allVideoIds.length };
    }

    const stats = { success: 0, noTranscript: 0, failed: 0 };

    for (let i = 0; i < toCollect.length; i++) {
        const { videoId, recollectReason, metaRecollectId } = toCollect[i];
        await acquirePuppeteerSlot();

        try {
            log('info', `  [${i + 1}/${toCollect.length}] ${videoId} (${recollectReason})`);

            const result = await getTranscriptWithPuppeteer(videoId);

            const outputData = {
                video_id: videoId,
                recollect_id: metaRecollectId,  // meta에서 가져옴
                recollect_reason: recollectReason,
                has_transcript: !!result,
                segments: result ? result.segments : [],
                text: result ? result.text : null,
                language: result ? result.language : null,
                collected_at: getKSTDate().toISOString(),
            };

            const outputFile = path.join(transcriptDir, `${videoId}.jsonl`);
            fs.appendFileSync(outputFile, JSON.stringify(outputData) + '\n', 'utf-8');

            if (result) {
                stats.success++;
                log('success', `    → ${result.segments.length}개 세그먼트`);
            } else {
                stats.noTranscript++;
                log('debug', `    → 자막 없음`);
            }
        } catch (error) {
            stats.failed++;
            log('warning', `    → 실패: ${error.message}`);
        } finally {
            releasePuppeteerSlot();
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
