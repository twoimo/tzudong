/**
 * 유튜브 히트맵(Most Replayed) + 멀티모달(Storyboard Frame) 통합 수집 스크립트
 * - HTML 파싱을 통해 '가장 많이 다시 본 구간' 데이터 추출
 * - 히트맵 수집 직후 스토리보드 프레임 자동 추출
 * - Meta 수집기(02)가 생성한 recollect_vars 태그를 기반으로 수집 여부 결정
 * 
 * [수집 발동 조건 (TRIGGER_VARS)]
 * 1. new_video: 신규 영상 (무조건 수집)
 * 2. duration_changed: 길이 변경 (영상 수정됨)
 * 3. scheduled_weekly: 주간 정기 수집 (0~3개월)
 * 4. scheduled_biweekly: 격주 정기 수집 (3개월~1년)
 * 5. scheduled_monthly: 월간 정기 수집 (1년 이상)
 * 6. viral_growth: 역주행 감지 (즉시 수집)
 * 
 * [사용법]
 *   node 04-collect-heatmap.js --channel tzuyang
 *   node 04-collect-heatmap.js --channel tzuyang --backfill
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import util from 'util';
import dotenv from 'dotenv';
import winston from 'winston';

const execPromise = util.promisify(exec);

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
        winston.format.timestamp({
            format: () => {
                const now = new Date();
                const kstOffset = 9 * 60 * 60 * 1000;
                const kstDate = new Date(now.getTime() + kstOffset);
                return kstDate.toISOString().replace('T', ' ').substring(0, 19);
            }
        }),
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
const COLLECTION_INTERVAL_MS = 1000;
let CHANNEL_NAME = 'tzuyang';

const args = process.argv.slice(2);
const channelIdx = args.indexOf('--channel');
if (channelIdx !== -1 && args[channelIdx + 1]) {
    CHANNEL_NAME = args[channelIdx + 1];
}
const DO_BACKFILL = args.includes('--backfill');

const BASE_DATA_DIR = path.resolve(__dirname, `../data/${CHANNEL_NAME}`);
const DATA_DIR = path.join(BASE_DATA_DIR, 'heatmap');
const META_DIR = path.join(BASE_DATA_DIR, 'meta');
const URLS_FILE = path.join(BASE_DATA_DIR, 'urls.txt');

// 멀티모달 관련 디렉토리
const FRAMES_DIR = path.join(BASE_DATA_DIR, 'frames');
const TEMP_DIR = path.join(BASE_DATA_DIR, 'temp_frames');
const COOKIE_FILE = path.resolve(__dirname, '../data/cookies.txt');
const YT_DLP_CMD = process.platform === 'win32' ? 'yt-dlp' : '/home/ubuntu/.local/bin/yt-dlp';

// 디렉토리 생성
[DATA_DIR, FRAMES_DIR, TEMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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

        // 1. "가장 많이 다시 본 장면" 마커 추출 (timedMarkerDecorations)
        const markersDecoration = findKey(data, 'markersDecoration');
        let mostReplayedMarkers = [];
        if (markersDecoration && markersDecoration.timedMarkerDecorations) {
            mostReplayedMarkers = markersDecoration.timedMarkerDecorations
                .filter(marker => {
                    const labelText = marker.label?.runs?.[0]?.text || '';
                    return labelText.includes('가장 많이 다시 본 장면') || labelText.toLowerCase().includes('most replayed');
                })
                .map(marker => ({
                    startMillis: marker.visibleTimeRangeStartMillis,
                    endMillis: marker.visibleTimeRangeEndMillis,
                    peakMillis: marker.decorationTimeMillis,
                    label: marker.label?.runs?.[0]?.text
                }));
        }

        // 2. 기존 히트맵 데이터도 가져오기
        const markers = findKey(data, 'markers');
        let rawMarkers = null;
        if (markers && Array.isArray(markers) && markers.length > 0) {
            rawMarkers = markers;
        } else {
            const markerGraph = findKey(data, 'markerGraph');
            if (markerGraph && markerGraph.markers && Array.isArray(markerGraph.markers)) {
                rawMarkers = markerGraph.markers;
            }
        }

        return {
            type: 'raw_markers',
            data: rawMarkers,
            mostReplayedMarkers: mostReplayedMarkers
        };
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

// =====================================================
// 멀티모달 관련 함수 (07-collect-multimodal.js에서 통합)
// =====================================================

/**
 * "가장 많이 다시 본 장면" 구간 식별
 * YouTube의 timedMarkerDecorations에서 명시적으로 지정된 구간만 사용
 * @param {Array} mostReplayedMarkers - timedMarkerDecorations에서 추출한 마커 배열
 * @returns {Array} 세그먼트 배열: { startSec, endSec, peakSec }
 */
function findInterestSegments(mostReplayedMarkers) {
    if (!mostReplayedMarkers || mostReplayedMarkers.length === 0) return [];

    const segments = [];

    for (const marker of mostReplayedMarkers) {
        const startSec = Math.floor(marker.startMillis / 1000);
        const endSec = Math.ceil(marker.endMillis / 1000);
        const peakSec = marker.peakMillis / 1000;

        segments.push({
            startSec,
            endSec,
            peakSec,
            peakIntensity: 1.0  // 명시적 마커는 최고 강도로 간주
        });
    }

    // 시작 시간 기준 정렬
    segments.sort((a, b) => a.startSec - b.startSec);

    return segments;
}

/**
 * Storyboard Spec 가져오기 (yt-dlp)
 */
async function getStoryboardSpec(videoId) {
    if (!fs.existsSync(COOKIE_FILE)) {
        log('warn', `쿠키 파일을 찾을 수 없음: ${COOKIE_FILE}`);
        return null;
    }

    const cmd = `${YT_DLP_CMD} --cookies "${COOKIE_FILE}" --dump-json "https://www.youtube.com/watch?v=${videoId}"`;
    try {
        const { stdout } = await execPromise(cmd, { maxBuffer: 1024 * 1024 * 10 });
        const data = JSON.parse(stdout);

        if (!data.formats) return null;

        const sbFormats = data.formats.filter(f => f.format_id && f.format_id.startsWith('sb'));
        if (sbFormats.length === 0) return null;

        // 고해상도 우선 선택
        sbFormats.sort((a, b) => (b.width || 0) - (a.width || 0));
        return sbFormats[0];

    } catch (e) {
        log('warn', `Storyboard 정보 가져오기 실패 ${videoId}: ${e.message}`);
        return null;
    }
}

/**
 * Storyboard URL 템플릿에서 실제 URL 생성
 */
function getSheetUrl(templateUrl, sheetIndex) {
    if (templateUrl.includes('$M')) {
        return templateUrl.replace('$M', sheetIndex.toString());
    }
    if (templateUrl.match(/\/M\d+\.jpg/)) {
        return templateUrl.replace(/\/M\d+\.jpg/, `/M${sheetIndex}.jpg`);
    }
    return templateUrl;
}

/**
 * 프레임 다운로드 및 크롭
 */
async function downloadFrameFromStoryboard(videoId, timestamp, sbSpec, outputPath) {
    if (fs.existsSync(outputPath)) return 'skipped';
    if (!sbSpec) return 'failed';

    const { rows, columns, width: frameWidth, height: frameHeight } = sbSpec;

    if (!rows || !columns || !frameWidth || !frameHeight) {
        log('warn', `Invalid storyboard spec for ${videoId}: Missing dims`);
        return 'failed';
    }

    let sheetIndex = 0;
    let frameInSheet = 0;
    let sheetUrl = '';

    if (sbSpec.fragments && sbSpec.fragments.length > 0) {
        let accumulatedTime = 0;
        let foundSheet = false;

        for (let i = 0; i < sbSpec.fragments.length; i++) {
            const frag = sbSpec.fragments[i];
            const duration = frag.duration || 0;

            if (timestamp < accumulatedTime + duration) {
                sheetIndex = i;
                sheetUrl = frag.url;

                const timeInSheet = timestamp - accumulatedTime;

                if (sbSpec.fps && sbSpec.fps > 0) {
                    frameInSheet = Math.floor(timeInSheet * sbSpec.fps);
                } else {
                    const framesInSheet = rows * columns;
                    frameInSheet = Math.floor((timeInSheet / duration) * framesInSheet);
                }

                foundSheet = true;
                break;
            }
            accumulatedTime += duration;
        }

        if (!foundSheet) {
            sheetIndex = sbSpec.fragments.length - 1;
            sheetUrl = sbSpec.fragments[sheetIndex].url;
            frameInSheet = (rows * columns) - 1;
        }

    } else {
        const fps = sbSpec.fps || 1;
        const frameIndexGlobal = Math.floor(timestamp * fps);
        const framesPerSheet = rows * columns;
        sheetIndex = Math.floor(frameIndexGlobal / framesPerSheet);
        frameInSheet = frameIndexGlobal % framesPerSheet;

        if (sbSpec.url) {
            sheetUrl = getSheetUrl(sbSpec.url, sheetIndex);
        }
    }

    if (!sheetUrl) {
        log('warn', `시트 URL을 결정할 수 없음: ${videoId}`);
        return 'failed';
    }

    if (frameInSheet >= rows * columns) frameInSheet = (rows * columns) - 1;

    const colIdx = frameInSheet % columns;
    const rowIdx = Math.floor(frameInSheet / columns);

    const x = colIdx * frameWidth;
    const y = rowIdx * frameHeight;

    const tempSheetPath = path.join(TEMP_DIR, `${videoId}_sheet_${sheetIndex}.webp`);
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    try {
        // 시트 다운로드 (업 없으면)
        if (!fs.existsSync(tempSheetPath)) {
            const curlCmd = process.platform === 'win32' ? 'curl.exe' : 'curl';
            await execPromise(`${curlCmd} -L -s -A "${UA}" -b "${COOKIE_FILE}" -e "https://www.youtube.com/" "${sheetUrl}" -o "${tempSheetPath}"`);
        }

        // 파일 검증: 손상된 시트 감지 (1KB 미만이면 무효)
        if (fs.existsSync(tempSheetPath)) {
            const stats = fs.statSync(tempSheetPath);
            if (stats.size < 1024) {
                fs.unlinkSync(tempSheetPath);
                log('warn', `시트 파일 손상 (${stats.size}B), 스킵: ${videoId} sheet ${sheetIndex}`);
                return 'failed';
            }
        } else {
            return 'failed';
        }

        // WebP 품질 80 (LLM 분석용 최적화: 품질 유지 + 파일 크기 감소)
        const cropCmd = `ffmpeg -y -v error -i "${tempSheetPath}" -vf "crop=${frameWidth}:${frameHeight}:${x}:${y}" -frames:v 1 -quality 80 "${outputPath}"`;
        await execPromise(cropCmd);

        // 시트 파일 정리
        if (fs.existsSync(tempSheetPath)) fs.unlinkSync(tempSheetPath);

        return 'success';
    } catch (e) {
        // ffmpeg 실패 시 손상된 시트 삭제
        if (fs.existsSync(tempSheetPath)) {
            try { fs.unlinkSync(tempSheetPath); } catch { }
        }
        log('error', `프레임 추출 실패 ${videoId}: ${e.message.split('\n')[0]}`);
        return 'failed';
    }
}

/**
 * 멀티모달 프레임 추출 (히트맵 수집 직후 호출)
 * @param {string} videoId - 비디오 ID
 * @param {Array} mostReplayedMarkers - "가장 많이 다시 본 장면" 마커 배열
 * @param {number} recollectId - 재수집 ID
 * @param {number} duration - 비디오 길이 (초)
 */
async function extractMultimodalFrames(videoId, mostReplayedMarkers, recollectId, duration) {
    // Shorts 필터 (2분 미만 스킵)
    if (duration && duration < 120) {
        log('info', `[Multimodal] ${videoId}: Shorts 스킵 (<2분)`);
        return { status: 'skipped_shorts' };
    }

    // "가장 많이 다시 본 장면" 구간 찾기
    const segments = findInterestSegments(mostReplayedMarkers);
    if (segments.length === 0) {
        log('info', `[Multimodal] ${videoId}: "가장 많이 다시 본 장면" 마커 없음`);
        return { status: 'no_segments' };
    }

    log('info', `[Multimodal] ${videoId}: ${segments.length}개 "가장 많이 다시 본 장면" 구간 발견`);

    // Storyboard 정보 가져오기
    const sbSpec = await getStoryboardSpec(videoId);
    if (!sbSpec) {
        log('warn', `[Multimodal] ${videoId}: Storyboard를 찾을 수 없음`);
        return { status: 'no_storyboard' };
    }

    let totalSaved = 0;

    // 각 세그먼트 순회하며 프레임 추출
    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
        const seg = segments[segIdx];
        const segmentDirName = `${segIdx + 1}_${seg.startSec}_${seg.endSec}`;
        const segmentDir = path.join(FRAMES_DIR, videoId, String(recollectId), segmentDirName);

        // 폴더 생성 (이미 있으면 무시)
        fs.mkdirSync(segmentDir, { recursive: true });

        let segSavedCount = 0;
        for (let ts = seg.startSec; ts <= seg.endSec; ts++) {
            const frameFilePath = path.join(segmentDir, `${ts}.webp`);
            const res = await downloadFrameFromStoryboard(videoId, ts, sbSpec, frameFilePath);
            if (res === 'success') segSavedCount++;

            // IP 차단 방지: 프레임 간 랜덤 딜레이 (100-200ms)
            await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
        }

        if (segSavedCount > 0) {
            log('info', `[Multimodal] 세그먼트 ${segIdx + 1} (${seg.startSec}s-${seg.endSec}s): ${segSavedCount}개 프레임 저장`);
            totalSaved += segSavedCount;
        }

        // IP 차단 방지: 세그먼트 간 딜레이 (0.5-1초)
        if (segIdx < segments.length - 1) {
            await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
        }
    }

    return { status: 'success', frameCount: totalSaved, segmentCount: segments.length };
}

/**
 * 기존 히트맵 데이터에서 프레임 미수집 건 백필
 */
async function backfillMissingFrames(deletedIds) {
    log('info', `=== 프레임 백필 시작 ===`);

    const heatmapFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.jsonl'));
    let backfilledCount = 0;

    for (const file of heatmapFiles) {
        const videoId = file.replace('.jsonl', '');

        if (deletedIds.has(videoId)) continue;

        try {
            const content = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8').trim().split('\n').pop();
            if (!content) continue;

            const data = JSON.parse(content);
            if (data.status !== 'success') continue;

            // mostReplayedMarkers가 없으면 스킵 (기존 데이터는 백필 불가)
            if (!data.most_replayed_markers || data.most_replayed_markers.length === 0) {
                log('info', `[Backfill] ${videoId}: most_replayed_markers 없음, 스킵`);
                continue;
            }

            const recollectId = data.recollect_id !== undefined ? data.recollect_id : 0;

            // 세그먼트 레벨에서 존재 여부 체크하므로 여기서는 스킵하지 않음
            log('info', `[Backfill] ${videoId}: 프레임 수집 시작`);
            const result = await extractMultimodalFrames(videoId, data.most_replayed_markers, recollectId, null);

            if (result.status === 'success') {
                backfilledCount++;
            }

            // IP 차단 방지: 비디오 간 딜레이 (0.5-1초)
            await new Promise(r => setTimeout(r, 500 + Math.random() * 500));

        } catch (e) {
            log('error', `[Backfill] ${videoId} 처리 실패: ${e.message}`);
        }
    }

    log('info', `=== 프레임 백필 완료: ${backfilledCount}개 ===`);
    return backfilledCount;
}

/**
 * temp_frames 폴더 정리
 */
function cleanupTempFrames() {
    if (fs.existsSync(TEMP_DIR)) {
        try {
            const files = fs.readdirSync(TEMP_DIR);
            for (const file of files) {
                fs.unlinkSync(path.join(TEMP_DIR, file));
            }
            fs.rmdirSync(TEMP_DIR);
            log('info', `Temp 폴더 정리 완료: ${TEMP_DIR}`);
        } catch (e) {
            log('warn', `Temp 폴더 정리 실패: ${e.message}`);
        }
    }
}

// =====================================================
// 기존 히트맵 수집 로직
// =====================================================

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
    if (!publishedAt) {
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
                    const TRIGGER_VARS = ['new_video', 'duration_changed', 'scheduled_weekly', 'scheduled_biweekly', 'scheduled_monthly', 'viral_growth'];
                    const shouldTrigger = recollectVars.some(variable => TRIGGER_VARS.includes(variable));

                    if (shouldTrigger) {
                        log('info', `[트리거] ${videoId}: 트리거 변수 발견 [${recollectVars.join(', ')}]`);
                        return true;
                    } else {
                        log('info', `[스킵] ${videoId}: recollect_vars [${recollectVars.join(', ')}]는 히트맵 수집 대상 아님`);
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
    log('info', `=== HTTP 히트맵 + 멀티모달 수집기 시작 [채널: ${CHANNEL_NAME}] ===`);
    log('info', `소스: ${URLS_FILE}`);
    log('info', `저장 경로: ${DATA_DIR}`);

    const cookieHeader = await loadCookies();
    if (cookieHeader) log('info', '쿠키 로드 완료');
    else log('warn', '쿠키 없음');

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

        // 2. 기존 히트맵 데이터 중 프레임 미수집 건 백필 (옵션)
        if (DO_BACKFILL) {
            await backfillMissingFrames(deletedIds);
        }

        const urlsPath = path.join(BASE_DATA_DIR, 'urls.txt');
        if (!fs.existsSync(urlsPath)) {
            log('warn', `채널 ${CHANNEL_NAME}에 urls.txt 없음`);
            cleanupTempFrames();
            return;
        }

        const urls = fs.readFileSync(urlsPath, 'utf8')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        log('info', `${urls.length}개 URL 발견, 삭제된 영상 필터링 중...`);

        const targets = urls.map(url => {
            const vid = extractVideoId(url);
            return { url, video_id: vid };
        }).filter(v => {
            if (!v.video_id) return false;
            if (deletedIds.has(v.video_id)) {
                log('info', `[스킵] ${v.video_id}는 deleted_urls.txt에 있음`);
                return false;
            }
            return shouldCollect(v.video_id);
        });

        log('info', `총 ${urls.length}개 URL, ${targets.length}개 처리 대상`);

        const batch = targets;

        for (let i = 0; i < batch.length; i++) {
            const { video_id, url } = batch[i];
            await processVideo(video_id, url, cookieHeader);

            if (i < batch.length - 1) {
                const delay = COLLECTION_INTERVAL_MS + Math.random() * 1000;
                await new Promise(r => setTimeout(r, delay));
            }
        }

        // 완료 후 temp_frames 정리
        cleanupTempFrames();

    } catch (e) {
        log('error', `치명적 오류: ${e.message}`);
        cleanupTempFrames();
    }
}

async function processVideo(video_id, youtube_link, cookieHeader) {
    log('info', `처리 중 [${video_id}]...`);

    try {

        // 메타 정보 확인
        const metaInfo = getMetaInfo(video_id);

        // [Shorts 필터] (180초 미만) - 페이지 페치 전 확인
        if (metaInfo.duration !== null && metaInfo.duration < 180) {
            log('info', `[스킵] 메타에서 Shorts 감지 (<180초). ID: ${video_id} (길이: ${metaInfo.duration}초)`);
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

        if (!newHeatmap || !newHeatmap.data) {
            log('warn', `${video_id}에서 히트맵 찾을 수 없음 (데이터 없음)`);
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
                            log('info', `[스킵] recollect_id ${metaInfo.recollect_id}에 대해 이미 수집됨`);
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
            most_replayed_markers: newHeatmap.mostReplayedMarkers || [],
            status: 'success',
            recollect_id: metaInfo.recollect_id,
            recollect_vars: metaInfo.recollect_vars,
            collected_at: new Date().toISOString()
        });
        log('info', `${video_id} 히트맵 저장 (포인트: ${formattedData.length}개, 가장많이본장면: ${(newHeatmap.mostReplayedMarkers || []).length}개)`);

        // === 멀티모달 프레임 추출 (히트맵 수집 직후) ===
        const multimodalResult = await extractMultimodalFrames(video_id, newHeatmap.mostReplayedMarkers || [], metaInfo.recollect_id, metaInfo.duration);
        if (multimodalResult.status === 'success') {
            log('info', `[Multimodal] ${video_id}: ${multimodalResult.frameCount}개 프레임 저장 완료`);
        }

    } catch (e) {
        log('error', `${video_id} 처리 중 오류: ${e.message}`);
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
