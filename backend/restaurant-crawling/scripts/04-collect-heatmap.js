#!/usr/bin/env node
/**
 * YouTube HeatmapMarkers 수집 스크립트 (recollect_id 기반)
 * - fetch로 HTML 가져와서 ytInitialPlayerResponse 추출
 * - Meta의 recollect_id/recollect_reason 확인하여 수집 결정
 * - title_changed, duration_changed 시 재수집
 * - published_at 기반 주기적 수집
 * 
 * 수집 조건:
 * - meta.recollect_id > heatmap.recollect_id
 * - AND (신규 OR title_changed OR duration_changed OR 주기적 수집)
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
    } catch { }
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
    if (!publishedAt || !lastCollectedAt) return false;

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

/**
 * YouTube 페이지에서 heatmapMarkers 추출
 */
async function fetchHeatmapMarkers(videoId) {
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            }
        });

        if (!response.ok) {
            return { error: `HTTP ${response.status}` };
        }

        const html = await response.text();

        if (!html.includes('ytInitialPlayerResponse')) {
            return { error: 'ytInitialPlayerResponse not found' };
        }

        const playerResponseMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:<\/script>|var)/s);
        if (!playerResponseMatch) {
            return { error: 'regex match failed' };
        }

        const initialDataMatch = html.match(/var ytInitialData\s*=\s*(\{.+?\});(?:<\/script>|var)/s);

        let ytData, ytInitialData;
        try {
            ytData = JSON.parse(playerResponseMatch[1]);
            ytInitialData = initialDataMatch ? JSON.parse(initialDataMatch[1]) : null;
        } catch {
            return { error: 'JSON parse failed' };
        }

        const videoDetails = ytData?.videoDetails || {};
        const title = videoDetails.title || '';
        const lengthSeconds = parseInt(videoDetails.lengthSeconds) || 0;
        const viewCount = parseInt(videoDetails.viewCount) || 0;

        if (viewCount < 50000) {
            return {
                video_id: videoId,
                has_heatmap: false,
                reason: 'view_count_low',
                view_count: viewCount
            };
        }

        // heatMarkers 찾기
        let heatMarkers = null;
        const sources = [
            ytData?.frameworkUpdates?.entityBatchUpdate?.mutations || [],
            ytInitialData?.frameworkUpdates?.entityBatchUpdate?.mutations || []
        ];

        for (const mutations of sources) {
            for (const mutation of mutations) {
                const entity = mutation?.payload?.macroMarkersListEntity;
                if (entity?.markersList?.markers) {
                    heatMarkers = entity.markersList.markers
                        .filter(m => m.heatMarkerRenderer)
                        .map(m => {
                            const r = m.heatMarkerRenderer;
                            return {
                                startMillis: parseInt(r.timeRangeStartMillis) || 0,
                                endMillis: (parseInt(r.timeRangeStartMillis) || 0) + (parseInt(r.markerDurationMillis) || 0),
                                intensityScoreNormalized: parseFloat(r.heatMarkerIntensityScoreNormalized) || 0
                            };
                        });
                    break;
                }
            }
            if (heatMarkers) break;
        }

        if (!heatMarkers || heatMarkers.length === 0) {
            return {
                video_id: videoId,
                has_heatmap: false,
                reason: 'markers_not_found',
                view_count: viewCount
            };
        }

        return {
            video_id: videoId,
            has_heatmap: true,
            view_count: viewCount,
            duration_ms: lengthSeconds * 1000,
            heatmap_markers: heatMarkers
        };

    } catch (error) {
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

        if (!latestMeta) {
            continue;
        }

        const metaRecollectId = latestMeta.recollect_id || 0;
        const heatmapRecollectId = latestHeatmap?.recollect_id || 0;

        // 수집 조건: meta.recollect_id > heatmap.recollect_id
        if (metaRecollectId > heatmapRecollectId) {
            const recollectReason = latestMeta.recollect_reason;

            // 신규
            if (!latestHeatmap) {
                toCollect.push({ videoId, recollectReason: "new", metaRecollectId });
                continue;
            }

            // title 또는 duration 변경
            if (recollectReason === "title_changed" || recollectReason === "duration_changed") {
                toCollect.push({ videoId, recollectReason, metaRecollectId });
                continue;
            }

            // 주기적 수집 체크
            const scheduleReason = shouldCollectBySchedule(
                latestMeta.published_at,
                latestHeatmap.collected_at
            );
            if (scheduleReason) {
                toCollect.push({ videoId, recollectReason: scheduleReason, metaRecollectId });
            }
        }
    }

    log('info', `수집 대상: ${toCollect.length}개`);

    if (toCollect.length === 0) {
        log('success', '수집 대상 없음');
        return { channel: channelName, processed: 0, success: 0, skipped: allVideoIds.length };
    }

    const stats = { success: 0, noHeatmap: 0, failed: 0 };

    for (let i = 0; i < toCollect.length; i++) {
        const { videoId, recollectReason, metaRecollectId } = toCollect[i];
        log('info', `  [${i + 1}/${toCollect.length}] ${videoId} (${recollectReason})`);

        const result = await fetchHeatmapMarkers(videoId);

        const outputData = {
            ...result,
            recollect_id: metaRecollectId,  // meta에서 가져옴
            recollect_reason: recollectReason,
            collected_at: getKSTDate().toISOString()
        };

        const outputFile = path.join(heatmapDir, `${videoId}.jsonl`);
        fs.appendFileSync(outputFile, JSON.stringify(outputData) + '\n', 'utf-8');

        if (result.error) {
            stats.failed++;
            log('warning', `    → 실패: ${result.error}`);
        } else if (result.has_heatmap) {
            stats.success++;
            log('success', `    → ${result.heatmap_markers.length}개 마커`);
        } else {
            stats.noHeatmap++;
            log('debug', `    → 히트맵 없음 (${result.reason})`);
        }

        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return {
        channel: channelName,
        processed: toCollect.length,
        success: stats.success,
        noHeatmap: stats.noHeatmap,
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
    log('info', '  YouTube 히트맵 수집 (recollect_id 기반)');
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
        const result = await collectChannelHeatmaps(channelName, channels[channelName]);
        results.push(result);
    }

    log('info', '');
    log('info', '='.repeat(60));
    log('success', '히트맵 수집 완료');
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
