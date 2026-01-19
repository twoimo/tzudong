import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import winston from 'winston';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 환경 변수 로드
const projectRoot = path.resolve(__dirname, '../../../');
// .env 로드
const backendEnvLocal = path.join(projectRoot, 'backend', '.env.local');

if (fs.existsSync(backendEnvLocal)) {
    dotenv.config({ path: backendEnvLocal });
} else {
    // Default fallback
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

// 미지정 시 기본 채널
let CHANNEL_NAME = 'tzuyang';

// 인자 파싱
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

// 쿠키 로드
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
        // 파일에 추가 (일반적으로 실행당 한 줄이지만 히스토리 지원)
        fs.appendFileSync(filepath, line, 'utf-8');
    } catch (e) {
        log('error', `Failed to write to file ${filepath}: ${e.message}`);
    }
}

function getPublishedAt(videoId) {
    const metaPath = getMetaFilePath(videoId);
    if (fs.existsSync(metaPath)) {
        try {
            // 메타 파일의 마지막 줄 읽기 (보통 한 줄이지만 혹시 모를 상황 대비)
            const content = fs.readFileSync(metaPath, 'utf-8').trim().split('\n').pop();
            if (content) {
                const meta = JSON.parse(content);
                return meta.published_at || null;
            }
        } catch (e) { }
    }
    return null;
}

function shouldCollect(videoId) {
    // 파일 존재 여부 및 최신 데이터 확인
    // Meta에서 recollect_id 및 recollect_reason 가져오기
    const metaPath = getMetaFilePath(videoId);
    let metaRecollectId = -1;
    let recollectReason = null;
    let publishedAt = null;

    if (fs.existsSync(metaPath)) {
        try {
            const content = fs.readFileSync(metaPath, 'utf-8').trim().split('\n').pop();
            if (content) {
                const meta = JSON.parse(content);
                metaRecollectId = meta.recollect_id !== undefined ? meta.recollect_id : 0;
                recollectReason = meta.recollect_reason;
                publishedAt = meta.published_at;
            }
        } catch (e) { }
    } else {
        // 메타 파일 없으면 수집 시도 (안전장치)
        return true;
    }

    // 이미 수집된 Heatmap 확인
    const filepath = getOutputFilePath(videoId);
    if (fs.existsSync(filepath)) {
        try {
            const content = fs.readFileSync(filepath, 'utf-8').trim().split('\n').pop();
            if (content) {
                const lastData = JSON.parse(content);
                const lastRecollectId = lastData.recollect_id !== undefined ? lastData.recollect_id : -1;

                // Sync Logic:
                // 1. Meta ID > Heatmap ID 일 때만 고려
                if (metaRecollectId > lastRecollectId) {
                    // 2. Reason 필터링
                    // - duration_changed: 수집 (구조적 변화)
                    // - new_video: 수집 (첫 수집)
                    // - periodic_daily: 스킵 (조회수만 변경됨)
                    // - title_changed: 스킵 (유저 인터랙션 데이터 불변 가정)

                    const ALLOWED_REASONS = ['new_video', 'duration_changed'];

                    if (recollectReason && ALLOWED_REASONS.includes(recollectReason)) {
                        return true;
                    } else {
                        // periodic_daily 등: 수집 안 함 -> 하지만 버전 싱크는 맞춰야 함?
                        // 아니오, 싱크 안 맞추고 내버려두면:
                        // 다음날 metaID 증가 -> 여전히 GAP 존재 -> reason은 또 periodic -> 또 스킵.
                        // 그러다가 duration_changed 발생 -> reason=duration -> GAP 존재 -> 수집.
                        // 즉, ID Gap이 계속 벌려져 있어도 문제 없음. Reason만 보고 판단하면 됨.
                        return false;
                    }
                }

                // ID가 같거나 Heatmap이 더 최신이면 스킵
                return false;
            }
        } catch (e) { }
    }

    // 히트맵 파일 없으면 수집
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

        // 매핑
        const targets = urls.map(url => {
            const vid = extractVideoId(url);
            return { url, video_id: vid };
        }).filter(v => {
            if (!v.video_id) return false;
            return shouldCollect(v.video_id);
        });

        log('info', `Found ${urls.length} URLs, ${targets.length} targets to process.`);

        const batch = targets; // 전체 수집 (배치 제한 제거)

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

        // Meta에서 recollect_id 가져오기
        const metaPath = getMetaFilePath(video_id);
        const metaInfo = getMetaInfo(video_id);
        const filepath = getOutputFilePath(video_id); // Define filepath here for scope access

        const formattedData = newHeatmap.data.map(item => {
            const seconds = Math.floor(item.startMillis / 1000);
            const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
            const ss = (seconds % 60).toString().padStart(2, '0');
            return {
                ...item,
                formatted_time: `${mm}:${ss}`
            };
        });

        // [Shorts Filter]
        if (formattedData.length > 0) {
            const lastPoint = formattedData[formattedData.length - 1];
            // 히트맵 마지막 포인트가 180초(3분) 미만이면 쇼츠/티저로 간주
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
                    const lastLine = lines.pop(); // Get actual last non-empty line
                    if (lastLine) {
                        const lastData = JSON.parse(lastLine);
                        // If recollect_id matches, we can skip content check (assume strict sync)
                        // But let's keep content check as safeguard, OR just strictly rely on ID.
                        // User wants strict sync with meta logic.
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
            recollect_reason: metaInfo.recollect_reason,
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

// Meta 정보 조회 헬퍼
function getMetaInfo(videoId) {
    const metaPath = getMetaFilePath(videoId);
    if (fs.existsSync(metaPath)) {
        try {
            const content = fs.readFileSync(metaPath, 'utf-8').trim().split('\n').pop();
            if (content) {
                const meta = JSON.parse(content);
                return {
                    recollect_id: meta.recollect_id !== undefined ? meta.recollect_id : 0,
                    recollect_reason: meta.recollect_reason || null,
                    published_at: meta.published_at || null
                };
            }
        } catch (e) { }
    }
    return { recollect_id: 0, recollect_reason: null, published_at: null };
}

main();
