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

if (fs.existsSync(backendEnvLocal)) {
    dotenv.config({ path: backendEnvLocal });
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
                recollectVars = meta.recollect_vars || (meta.recollect_reason ? [meta.recollect_reason] : []);
                publishedAt = meta.published_at;
            }
        } catch (e) { }
    } else {
        return true;
    }

    // 1. Mandatory Check: Min 5 Days since Published
    // (일단 업로드한지 최소 5일이어야 하고(필수))
    if (!publishedAt) {
        // Safe fallback if no published_at (assume old enough unless we want strict)
        // Or if meta exists but no date, maybe wait?
        // Let's assume passed if unknown, or return false? 
        // Better to return false to be safe and wait for valid meta.
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
                    // Trigger Conditions:
                    // 1. New Video (implied by ID check maybe, strictly "new_video" var)
                    // 2. Duration Changed
                    // 3. Periodic Collection (scheduled_*)

                    const TRIGGER_VARS = ['new_video', 'duration_changed', 'scheduled_weekly', 'scheduled_biweekly', 'scheduled_monthly'];

                    const shouldTrigger = recollectVars.some(variable => TRIGGER_VARS.includes(variable));

                    if (shouldTrigger) {
                        return true;
                    } else {
                        return false;
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
        if (!fs.existsSync(URLS_FILE)) {
            throw new Error(`URLs file not found: ${URLS_FILE}`);
        }

        const fileContent = fs.readFileSync(URLS_FILE, 'utf-8');
        const urls = fileContent.split('\n').filter(line => line.trim() !== '');

        const targets = urls.map(url => {
            const vid = extractVideoId(url);
            return { url, video_id: vid };
        }).filter(v => {
            if (!v.video_id) return false;
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
        const html = await fetchVideoPage(video_id, cookieHeader);
        const newHeatmap = extractHeatmapFromHtml(html);

        if (!newHeatmap) {
            log('warn', `No heatmap found for ${video_id}.`);
            saveVideoData(video_id, {
                youtube_link,
                video_id,
                status: 'no_heatmap',
                collected_at: new Date().toISOString()
            });
            return;
        }

        // Meta Info
        const metaInfo = getMetaInfo(video_id);
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

        // [Shorts Filter] (180초 미만)
        if (formattedData.length > 0) {
            const lastPoint = formattedData[formattedData.length - 1];
            if (lastPoint.startMillis < 180000) {
                log('info', `[Skip] Shorts detected (<180s). ID: ${video_id}`);
                saveVideoData(video_id, {
                    youtube_link,
                    video_id,
                    status: 'skipped_shorts',
                    recollect_id: metaInfo.recollect_id,
                    collected_at: new Date().toISOString()
                });
                return;
            }
        }

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
            recollect_vars: metaInfo.recollect_vars, // List
            recollect_reason: metaInfo.recollect_vars.length > 0 ? metaInfo.recollect_vars[0] : null, // Compat
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
            recollect_reason: 'error',
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
                    recollect_vars: meta.recollect_vars || (meta.recollect_reason ? [meta.recollect_reason] : []),
                    published_at: meta.published_at || null
                };
            }
        } catch (e) { }
    }
    return { recollect_id: 0, recollect_vars: [], published_at: null };
}

main();
