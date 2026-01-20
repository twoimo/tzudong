/**
 * 유튜브 히트맵(Most Replayed) 데이터 수집 스크립트
 * - HTML 파싱을 통해 '가장 많이 다시 본 구간' 데이터 추출
 * - Meta 수집기(02)가 생성한 recollect_vars 태그를 기반으로 수집 여부 결정
 * 
 * [수집 발동 조건 (TRIGGER_VARS)]
 * 1. new_video: 신규 영상 (무조건 수집)
 * 2. duration_changed: 길이 변경 (영상 수정됨)
 * 3. scheduled_weekly: 주간 정기 수집 (0~6개월, 6개월~1년)
 * 4. scheduled_biweekly: 격주 정기 수집 (1년 이상)
 * 5. viral_growth: 역주행 감지 (즉시 수집)
 * 
 * [사용법]
 *   node 04-collect-heatmap.js --channel tzuyang
 *   node 04-collect-heatmap.js  # 모든 채널
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import winston from 'winston';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 환경 변수 로드
const projectRoot = path.resolve(__dirname, '../../../');
const backendEnvLocal = path.join(projectRoot, 'backend', '.env.local');
const backendEnv = path.join(projectRoot, 'backend', '.env');

if (fs.existsSync(backendEnvLocal)) {
    dotenv.config({ path: backendEnvLocal });
} else if (fs.existsSync(backendEnv)) {
    dotenv.config({ path: backendEnv });
} else {
    dotenv.config();
}

// --- 로거 설정 ---
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: path.join(__dirname, 'collect_heatmap.log') })
    ]
});

function log(level, msg) {
    logger.log(level, msg);
}

// --- 상수 ---
const COLLECTION_INTERVAL_MS = 3000;
let CHANNEL_NAME = 'tzuyang';

const args = process.argv.slice(2);
const channelIdx = args.indexOf('--channel');
if (channelIdx !== -1 && args[channelIdx + 1]) {
    CHANNEL_NAME = args[channelIdx + 1];
}

const BASE_DATA_DIR = path.resolve(__dirname, `../data/${CHANNEL_NAME}`);
const DATA_DIR = path.join(BASE_DATA_DIR, 'heatmap');
const META_DIR = path.join(BASE_DATA_DIR, 'meta');
const URLS_FILE = path.join(BASE_DATA_DIR, 'urls.txt');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
};

// --- 헬퍼 함수 ---
function getKSTDate() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (9 * 60 * 60 * 1000));
}

function extractVideoId(url) {
    if (!url) return null;
    const match = url.match(/[?&]v=([^&]+)/);
    return match ? match[1] : null;
}

function getOutputFilePath(videoId) {
    return path.join(DATA_DIR, `${videoId}.jsonl`);
}

function getMetaFilePath(videoId) {
    return path.join(META_DIR, `${videoId}.jsonl`);
}

async function loadCookies() {
    const cookiePath = path.resolve(__dirname, '../data/cookies.json');
    if (fs.existsSync(cookiePath)) {
        try {
            const cookiesString = fs.readFileSync(cookiePath, 'utf-8');
            const cookies = JSON.parse(cookiesString);
            return cookies.map(c => `${c.name}=${c.value}`).join('; ');
        } catch (e) {
            log('warn', `Failed to load cookies: ${e.message}`);
        }
    }
    return '';
}

async function fetchVideoPage(videoId, cookieHeader) {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    try {
        const response = await fetch(url, {
            headers: {
                ...HEADERS,
                'Cookie': cookieHeader
            }
        });

        if (response.status === 429) {
            throw new Error("429 Too Many Requests");
        }
        if (response.url.includes("accounts.google.com")) {
            throw new Error("Redirected to Login - Auth Failed");
        }
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }
        return await response.text();
    } catch (e) {
        throw e;
    }
}

function extractHeatmapFromHtml(html) {
    const match = html.match(/var\s+ytInitialData\s*=\s*({.*?});/s);
    if (!match) return null;

    try {
        const data = JSON.parse(match[1]);
        function findKey(obj, key) {
            if (!obj) return null;
            if (obj[key]) return obj[key];
            if (typeof obj === 'object') {
                for (const k in obj) {
                    const found = findKey(obj[k], key);
                    if (found) return found;
                }
            }
            return null;
        }

        const markers = findKey(data, 'markers');
        if (markers && Array.isArray(markers) && markers.length > 0) {
            return { type: 'raw_markers', data: markers };
        }
        const markerGraph = findKey(data, 'markerGraph');
        if (markerGraph && markerGraph.markers && Array.isArray(markerGraph.markers)) {
            return { type: 'raw_markers', data: markerGraph.markers };
        }
        return null;
    } catch (e) {
        log('warn', `Parse Error: ${e.message}`);
        return null;
    }
}

function saveVideoData(videoId, data) {
    const filepath = getOutputFilePath(videoId);
    const line = JSON.stringify(data) + '\n';
    try {
        fs.appendFileSync(filepath, line, 'utf-8');
    } catch (e) {
        log('error', `Failed to write to file ${filepath}: ${e.message}`);
    }
}

function shouldCollect(videoId) {
    const metaPath = getMetaFilePath(videoId);
    let metaRecollectId = -1;
    let recollectVars = [];
    let publishedAt = null;

    if (fs.existsSync(metaPath)) {
        try {
            const content = fs.readFileSync(metaPath, 'utf-8').trim().split('\n').pop();
            if (content) {
                const meta = JSON.parse(content);
                metaRecollectId = meta.recollect_id !== undefined ? meta.recollect_id : 0;
                recollectVars = meta.recollect_vars || [];
                publishedAt = meta.published_at;
            }
        } catch (e) { }
    } else {
        return true;
    }

    // 1. 필수 확인: 게시 후 5일 경과 여부
    // (일단 업로드한지 최소 5일이어야 하고(필수))
    if (!publishedAt) {
        // published_at이 없는 경우 안전한 대체 처리 (엄격을 원치 않으면 충분히 오래된 것으로 가정)
        // 또는 메타는 있는데 날짜가 없으면 대기할까?
        // 알 수 없으면 통과로 가정할지, 아니면 false를 반환할지?
        // 안전을 위해 false를 반환하고 유효한 메타를 기다리는 것이 좋음.
        return false;
    }

    const pubDate = new Date(publishedAt);
    const now = getKSTDate();
    const diffTime = Math.abs(now - pubDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 5) {
        return false;
    }

    const filepath = getOutputFilePath(videoId);
    if (fs.existsSync(filepath)) {
        try {
            const content = fs.readFileSync(filepath, 'utf-8').trim().split('\n').pop();
            if (content) {
                const lastData = JSON.parse(content);
                const lastRecollectId = lastData.recollect_id !== undefined ? lastData.recollect_id : -1;

                if (metaRecollectId > lastRecollectId) {
                    // 트리거 조건:
                    // 2. ID가 증가했으면, '트리거' 변수가 포함되어 있는지 확인
                    // (예: new_video, duration_changed, scheduled_*, viral_growth 등)
                    if (metaRecollectId > lastRecollectId) {
                        // heatmap 수집해야 하는 meta 변수들
                        const TRIGGER_VARS = ['new_video', 'duration_changed', 'scheduled_weekly', 'scheduled_biweekly', 'viral_growth'];

                        // recollectVars 중 하나라도 TRIGGER_VARS에 포함되면 수집
                        const shouldTrigger = recollectVars.some(variable => TRIGGER_VARS.includes(variable));

                        if (shouldTrigger) {
                            log('info', `[Trigger] Video ${videoId}: Found trigger variable(s) [${recollectVars.join(', ')}]`);
                            return true;
                        } else {
                            // ID는 증가했지만 트리거 변수가 없으면 (예: title_changed, thumbnail_changed 등) -> 스킵
                            log('info', `[Skip] Video ${videoId}: recurs_vars [${recollectVars.join(', ')}] do not trigger heatmap.`);
                            return false;
                        }
                    }
                }
                return false;
            }
        } catch (e) { }
    }

    return true;
}

async function main() {
    log('info', `=== HTTP Heatmap Collector Started [Channel: ${CHANNEL_NAME}] ===`);
    log('info', `Source: ${URLS_FILE}`);
    log('info', `Saving to: ${DATA_DIR}`);

    const cookieHeader = await loadCookies();
    if (cookieHeader) log('info', 'Cookies loaded.');
    else log('warn', 'No cookies found.');

    try {
        // 1. deleted_ids 로드
        const deletedPath = path.join(BASE_DATA_DIR, 'deleted_urls.txt');
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

        const urlsPath = path.join(BASE_DATA_DIR, 'urls.txt');
        if (!fs.existsSync(urlsPath)) {
            log('warn', `No urls.txt for channel ${CHANNEL_NAME}`);
            return;
        }

        const urls = fs.readFileSync(urlsPath, 'utf8')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        log('info', `Found ${urls.length} URLs, filtering deleted...`);

        const targets = urls.map(url => {
            const vid = extractVideoId(url);
            return { url, video_id: vid };
        }).filter(v => {
            if (!v.video_id) return false;
            // 2. 삭제된 비디오 스킵
            if (deletedIds.has(v.video_id)) {
                log('info', `[Skip] Video ID ${v.video_id} is in deleted_urls.txt.`);
                return false;
            }
            return shouldCollect(v.video_id);
        });

        log('info', `Found ${urls.length} URLs, ${targets.length} targets to process.`);

        const batch = targets;

        for (let i = 0; i < batch.length; i++) {
            const { video_id, url } = batch[i];
            await processVideo(video_id, url, cookieHeader);

            if (i < batch.length - 1) {
                const delay = COLLECTION_INTERVAL_MS + Math.random() * 2000;
                await new Promise(r => setTimeout(r, delay));
            }
        }

    } catch (e) {
        log('error', `Fatal Error: ${e.message}`);
    }
}

async function processVideo(video_id, youtube_link, cookieHeader) {
    log('info', `Processing [${video_id}]...`);

    try {

        // 메타 정보 확인
        const metaInfo = getMetaInfo(video_id);

        // [Shorts 필터] (180초 미만) - 페이지 페치 전 확인
        if (metaInfo.duration !== null && metaInfo.duration < 180) {
            log('info', `[Skip] Shorts detected from meta (<180s). ID: ${video_id} (Duration: ${metaInfo.duration}s)`);
            saveVideoData(video_id, {
                youtube_link,
                video_id,
                status: 'skipped_shorts',
                recollect_id: metaInfo.recollect_id,
                duration: metaInfo.duration,
                collected_at: new Date().toISOString()
            });
            return;
        }

        const html = await fetchVideoPage(video_id, cookieHeader);
        const newHeatmap = extractHeatmapFromHtml(html);

        if (!newHeatmap) {
            log('warn', `No heatmap found for ${video_id}.`);
            saveVideoData(video_id, {
                youtube_link,
                video_id,
                status: 'no_heatmap',
                duration: metaInfo.duration,
                collected_at: new Date().toISOString()
            });
            return;
        }

        const filepath = getOutputFilePath(video_id);

        const formattedData = newHeatmap.data.map(item => {
            const seconds = Math.floor(item.startMillis / 1000);
            const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
            const ss = (seconds % 60).toString().padStart(2, '0');
            return {
                ...item,
                formatted_time: `${mm}:${ss}`
            };
        });


        if (fs.existsSync(filepath)) {
            try {
                const lines = fs.readFileSync(filepath, 'utf-8').trim().split('\n');
                if (lines.length > 0) {
                    const lastLine = lines.pop();
                    if (lastLine) {
                        const lastData = JSON.parse(lastLine);
                        if (lastData.recollect_id === metaInfo.recollect_id && lastData.status !== 'error') {
                            log('info', `[Skip] Already collected for recollect_id ${metaInfo.recollect_id}.`);
                            return;
                        }
                    }
                }
            } catch (e) { }
        }

        saveVideoData(video_id, {
            youtube_link,
            video_id,
            interaction_data: formattedData,
            status: 'success',
            recollect_id: metaInfo.recollect_id,
            recollect_vars: metaInfo.recollect_vars, // 리스트
            collected_at: new Date().toISOString()
        });
        log('info', `Saved heatmap for ${video_id} (Points: ${formattedData.length})`);

    } catch (e) {
        log('error', `Error processing ${video_id}: ${e.message}`);
        saveVideoData(video_id, {
            youtube_link,
            video_id,
            collected_at: new Date().toISOString(),
            recollect_id: 0,
            recollect_vars: ['error'],
            status: 'error',
            error_message: e.message
        });

        if (e.message.includes("429") || e.message.includes("Auth Failed")) {
            throw e;
        }
    }
}

function getMetaInfo(videoId) {
    const metaPath = getMetaFilePath(videoId);
    if (fs.existsSync(metaPath)) {
        try {
            const content = fs.readFileSync(metaPath, 'utf-8').trim().split('\n').pop();
            if (content) {
                const meta = JSON.parse(content);
                return {
                    recollect_id: meta.recollect_id !== undefined ? meta.recollect_id : 0,
                    recollect_vars: meta.recollect_vars || [],
                    published_at: meta.published_at || null,
                    duration: meta.duration !== undefined ? meta.duration : null,
                    is_shorts: !!meta.is_shorts
                };
            }
        } catch (e) { }
    }
    return { recollect_id: 0, recollect_vars: [], published_at: null, duration: null, is_shorts: false };
}

main();
