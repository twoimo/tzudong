#!/usr/bin/env node
/**
 * YouTube Heatmap 수집 스크립트 (recollect_id 기반)
 * - Puppeteer로 히트맵 SVG 데이터 수집
 * - Meta의 recollect_id/recollect_reason 확인하여 수집 결정
 * - title_changed, duration_changed 시 재수집
 * - published_at 기반 주기적 수집
 * 
 * 수집 조건:
 * 수집 조건:
 * - (신규 OR title_changed OR duration_changed OR 주기적 수집)
 * - AND (업로드 5일 경과)
 * 
 * 사용법:
 *   node 04-collect-heatmap.js --channel tzuyang
 *   node 04-collect-heatmap.js --channel meatcreator
 *   node 04-collect-heatmap.js  # 모든 채널
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
function log(level, msg) {
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
        /youtube\.com\/shorts\/([^?]+)/,
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
    if (!fs.existsSync(urlsFile)) return [];

    const lines = fs.readFileSync(urlsFile, 'utf-8').split('\n');
    const videoIds = [];
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
    } catch (e) { log('debug', `[Error] ${path.basename(filePath)} 파싱 실패: ${e.message}`); }
    return null;
}

// Meta 로드
function getLatestMeta(dataPath, videoId) {
    return getLatestData(path.join(dataPath, 'meta', `${videoId}.jsonl`));
}

// Heatmap 로드
function getLatestHeatmap(dataPath, videoId) {
    return getLatestData(path.join(dataPath, 'heatmap', `${videoId}.jsonl`));
}

/**
 * published_at 기반 수집 주기 확인
 */
function shouldCollectBySchedule(publishedAt, lastCollectedAt) {
    if (!publishedAt || !lastCollectedAt) return null;

    const now = getKSTDate();
    const published = new Date(publishedAt);
    const lastCollected = new Date(lastCollectedAt);

    const monthsSincePublished = (now - published) / (1000 * 60 * 60 * 24 * 30);
    const daysSinceCollected = (now - lastCollected) / (1000 * 60 * 60 * 24);

    // 6개월 이상: 스킵
    if (monthsSincePublished >= 6) {
        return null;
    }
    // 3~6개월: 1달마다 (30일)
    if (monthsSincePublished >= 3 && daysSinceCollected >= 30) {
        return "scheduled_monthly";
    }
    // 1~3개월: 2주마다 (14일)
    if (monthsSincePublished >= 1 && daysSinceCollected >= 14) {
        return "scheduled_biweekly";
    }
    // 0~1개월: 매주 (7일)
    if (monthsSincePublished < 1 && daysSinceCollected >= 7) {
        return "scheduled_weekly";
    }

    return null;
}

// Puppeteer 설정
let puppeteerBrowser = null;
let puppeteerModule = null;
let puppeteerChecked = false;
let stealthApplied = false;

/**
 * Puppeteer로 히트맵 수집 (backup 코드 기반)
 */
async function collectHeatmap(videoId) {
    // Puppeteer 로드
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

    if (!puppeteerModule) {
        return { error: 'puppeteer not available' };
    }

    // 브라우저 시작
    if (!puppeteerBrowser) {
        puppeteerBrowser = await puppeteerModule.default.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1280,720'
            ]
        });
    }

    const page = await puppeteerBrowser.newPage();

    try {
        // User-Agent 설정
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 720 });

        // 한국어 쿠키 설정
        await page.setCookie({
            name: 'PREF',
            value: 'hl=ko&gl=KR',
            domain: '.youtube.com'
        });

        // YouTube 접속 (autoplay=1)
        const url = `https://www.youtube.com/watch?v=${videoId}&autoplay=1`;
        log('debug', `페이지 이동 시작: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        log('debug', '페이지 로드 완료');
        await new Promise(r => setTimeout(r, 3000));

        // 팝업 닫기
        try {
            await page.evaluate(() => {
                const dismissButtons = document.querySelectorAll(
                    'button[aria-label*="No thanks"], button[aria-label*="괜찮습니다"], ' +
                    'button[aria-label*="Dismiss"], button[aria-label*="닫기"]'
                );
                for (const btn of dismissButtons) {
                    if (btn.textContent?.includes('No thanks') || 
                        btn.textContent?.includes('괜찮습니다') ||
                        btn.textContent?.includes('나중에')) {
                        btn.click();
                        break;
                    }
                }
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            });
            await new Promise(r => setTimeout(r, 2000));
        } catch { }

        // 재생 시도
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await page.click('.html5-video-player');
                await new Promise(r => setTimeout(r, 500));
                await page.keyboard.press('k');
                await new Promise(r => setTimeout(r, 1000));
                await page.evaluate(() => {
                    const video = document.querySelector('video');
                    if (video && video.paused) {
                        video.muted = true;
                        video.play().catch(() => {});
                    }
                });
                await new Promise(r => setTimeout(r, 1000));
            } catch { }
        }

        // 광고 처리
        let isAdPlaying = await page.evaluate(() => {
            const player = document.querySelector('.html5-video-player');
            return player?.classList.contains('ad-showing') || false;
        });
        log('debug', `초기 광고 상태: ${isAdPlaying ? '광고 중' : '광고 없음'}`);

        if (isAdPlaying) {
            const maxWait = 60000;
            const startTime = Date.now();

            while (Date.now() - startTime < maxWait) {
                isAdPlaying = await page.evaluate(() => {
                    const player = document.querySelector('.html5-video-player');
                    return player?.classList.contains('ad-showing') || false;
                });

                if (!isAdPlaying) break;

                // 건너뛰기 버튼 찾기
                const skipInfo = await page.evaluate(() => {
                    const selectors = ['.ytp-skip-ad-button', '.ytp-ad-skip-button', 'button[id^="skip-button"]'];
                    for (const selector of selectors) {
                        const btn = document.querySelector(selector);
                        if (btn) {
                            const style = window.getComputedStyle(btn);
                            return { found: true, selector, visible: style.display !== 'none' };
                        }
                    }
                    return { found: false };
                });

                if (skipInfo.found && skipInfo.visible) {
                    try {
                        await page.click(skipInfo.selector);
                        await new Promise(r => setTimeout(r, 3000));
                    } catch { }
                }

                await new Promise(r => setTimeout(r, 1000));
            }
        }

        await new Promise(r => setTimeout(r, 3000));

        // 프로그레스 바 활성화 대기
        const maxProgressWait = 10000;
        const progressStart = Date.now();
        let progressBarEnabled = false;
        log('debug', '프로그레스 바 활성화 대기 중...');

        while (Date.now() - progressStart < maxProgressWait) {
            const state = await page.evaluate(() => {
                const container = document.querySelector('.ytp-progress-bar-container');
                const player = document.querySelector('.html5-video-player');
                return {
                    disabled: container?.getAttribute('aria-disabled') === 'true',
                    adPlaying: player?.classList.contains('ad-showing') || false
                };
            });

            if (!state.disabled && !state.adPlaying) {
                progressBarEnabled = true;
                break;
            }

            await new Promise(r => setTimeout(r, 500));
        }

        if (!progressBarEnabled) {
            await page.close();
            return { error: 'progress_bar_disabled' };
        }

        // 프로그레스 바 호버 (히트맵 표시)
        try {
            await page.click('.html5-video-player');
            await new Promise(r => setTimeout(r, 500));
            await page.hover('.ytp-progress-bar');
            await new Promise(r => setTimeout(r, 1500));
        } catch (e) {
            await page.close();
            return { error: 'hover_failed' };
        }

        // 히트맵 데이터 추출
        log('debug', '히트맵 SVG 데이터 추출 시도...');
        const heatmapData = await page.evaluate(() => {
            // SVG path 데이터 추출 (핵심!)
            let svgPathData = null;
            const modernHeatMap = document.querySelector('.ytp-modern-heat-map');
            if (modernHeatMap) {
                svgPathData = modernHeatMap.getAttribute('d');
            } else {
                const legacyPath = document.querySelector('.ytp-heat-map-path');
                if (legacyPath) {
                    svgPathData = legacyPath.getAttribute('d');
                }
            }

            return { svgPathData };
        });

        // svgPathData가 없으면 실패
        if (!heatmapData.svgPathData || heatmapData.svgPathData.length < 50) {
            await page.close();
            return { error: 'svg_not_found' };
        }

        await page.close();

        return {
            video_id: videoId,
            svg_path_data: heatmapData.svgPathData
        };

    } catch (error) {
        try { await page.close(); } catch { }
        return { error: error.message };
    }
}

/**
 * 채널 히트맵 수집 (recollect_id 기반)
 */
async function collectChannelHeatmaps(channelName, channelConfig) {
    const dataPath = path.resolve(__dirname, '../../', channelConfig.data_path);
    const heatmapDir = path.join(dataPath, 'heatmap');

    if (!fs.existsSync(heatmapDir)) {
        fs.mkdirSync(heatmapDir, { recursive: true });
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
        const latestHeatmap = getLatestHeatmap(dataPath, videoId);

        log('debug', `[Check] ${videoId} - Meta: ${!!latestMeta}, Heatmap: ${!!latestHeatmap}, MetaID: ${latestMeta?.recollect_id}, HeatmapID: ${latestHeatmap?.recollect_id}, Reason: ${latestMeta?.recollect_reason}`);

        if (!latestMeta) {
            log('debug', `[Skip] ${videoId} - 메타데이터 없음. Path: ${path.join(dataPath, 'meta', `${videoId}.jsonl`)}`);
            continue;
        }

        // 업로드 5일 미만 체크
        const publishedAt = new Date(latestMeta.published_at);
        const now = new Date();
        const diffDays = (now - publishedAt) / (1000 * 60 * 60 * 24);

        if (diffDays < 5) {
            log('debug', `[Skip] ${videoId} - 업로드 5일 미만 (${diffDays.toFixed(1)}일)`);
            continue;
        }

        const metaRecollectId = latestMeta.recollect_id || 0;
        const heatmapRecollectId = latestHeatmap?.recollect_id || 0;

        let shouldCollect = false;
        let pReason = null;

        // 1. 신규
        if (!latestHeatmap) {
            shouldCollect = true;
            pReason = null;
        } else {
            // 2. 메타데이터 변경 (제목/길이)
            const metaUpdated = (metaRecollectId > heatmapRecollectId) &&
                (latestMeta.recollect_reason === "title_changed" || latestMeta.recollect_reason === "duration_changed");

            // 3. 주기적 수집
            const scheduleReason = shouldCollectBySchedule(
                latestMeta.published_at,
                latestHeatmap.collected_at
            );

            if (metaUpdated) {
                shouldCollect = true;
                pReason = latestMeta.recollect_reason;
            } else if (scheduleReason) {
                shouldCollect = true;
                pReason = scheduleReason;
            }
        }

        if (shouldCollect) {
            log('debug', `[Collect] ${videoId} - Reason: ${pReason}`);
            toCollect.push({ videoId, recollectReason: pReason, metaRecollectId });
        }
    }

    log('info', `수집 대상: ${toCollect.length}개`);

    if (toCollect.length === 0) {
        log('success', '수집 대상 없음');
        return { channel: channelName, processed: 0, success: 0, failed: 0, skipped: allVideoIds.length };
    }

    const stats = { success: 0, failed: 0 };

    // Rate limit 설정
    const randomMs = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

    for (let i = 0; i < toCollect.length; i++) {
        const { videoId, recollectReason, metaRecollectId } = toCollect[i];
        log('info', `  [${i + 1}/${toCollect.length}] ${videoId} (${recollectReason})`);

        const result = await collectHeatmap(videoId);

        // 성공한 경우만 저장
        if (!result.error) {
            const outputData = {
                youtube_link: `https://www.youtube.com/watch?v=${videoId}`,
                collected_at: getKSTISOString(),
                recollect_id: metaRecollectId,
                recollect_reason: recollectReason,
                svg_path_data: result.svg_path_data
            };

            const outputFile = path.join(heatmapDir, `${videoId}.jsonl`);
            fs.appendFileSync(outputFile, JSON.stringify(outputData) + '\n', 'utf-8');

            stats.success++;
            log('success', `    → SVG 수집 완료 (${result.svg_path_data.length} chars)`);
        } else {
            stats.failed++;
            log('warning', `    → 실패: ${result.error}`);
        }

        // Rate limit
        // 50개마다 3-5분 대기
        if ((i + 1) % 50 === 0 && i < toCollect.length - 1) {
            const wait = randomMs(180000, 300000);
            log('warning', `⏳ 50개 처리 완료 - ${Math.floor(wait/1000)}초 대기...`);
            await new Promise(r => setTimeout(r, wait));
        }
        // 10개마다 30-40초 대기
        else if ((i + 1) % 10 === 0 && i < toCollect.length - 1) {
            const wait = randomMs(30000, 40000);
            log('info', `⏳ 10개 처리 완료 - ${Math.floor(wait/1000)}초 대기...`);
            await new Promise(r => setTimeout(r, wait));
        }
        // 5개마다 10-15초 대기
        else if ((i + 1) % 5 === 0 && i < toCollect.length - 1) {
            const wait = randomMs(10000, 15000);
            await new Promise(r => setTimeout(r, wait));
        }
        // 매 영상 2-5초 대기
        else if (i < toCollect.length - 1) {
            const wait = randomMs(2000, 5000);
            await new Promise(r => setTimeout(r, wait));
        }
    }

    return {
        channel: channelName,
        processed: toCollect.length,
        success: stats.success,
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
    log('info', '  YouTube 히트맵 수집 (Puppeteer, recollect_id 기반)');
    log('info', '='.repeat(60));

    const config = loadChannelsConfig();
    const channels = config.channels;
    const channelNames = channelFilter ? [channelFilter] : Object.keys(channels);

    log('info', `대상 채널: ${channelNames.join(', ')}`);

    const results = [];

    try {
        for (const channelName of channelNames) {
            if (!channels[channelName]) {
                log('error', `알 수 없는 채널: ${channelName}`);
                continue;
            }
            const result = await collectChannelHeatmaps(channelName, channels[channelName]);
            results.push(result);
        }
    } finally {
        // 브라우저 종료
        if (puppeteerBrowser) {
            await puppeteerBrowser.close();
        }
    }

    log('info', '');
    log('info', '='.repeat(60));
    log('success', '히트맵 수집 완료');
    for (const result of results) {
        log('info', `  ${result.channel}: 성공 ${result.success}개, 실패 ${result.failed}개, 스킵 ${result.skipped}개`);
    }
    log('info', '='.repeat(60));
}

main().catch(error => {
    log('error', `치명적 오류: ${error.message}`);
    console.error(error);
    process.exit(1);
});
