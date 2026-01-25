/**
 * 유튜브 히트맵 기반 고화질 프레임 추출 및 자동 수집기
 *
 * 이 스크립트는 유튜브 영상의 '가장 많이 다시 본 장면(Heatmap Peak)'을 분석하여
 * 해당 구간의 고화질 프레임을 자동으로 추출합니다.
 *
 * [실행 모드]
 * 1. 자동 배치 수집 (Automatic Batch Mode)
 *    - 사용법: node 05-extract-frames-with-heatmap.js
 *    - 동작: `urls.txt`의 모든 영상을 순회하며 수집 조건(게시 5일 경과, 역주행 등)을 만족하는 경우에만 실행
 *
 * 2. 단일 영상 수집 (Single Video Mode)
 *    - 사용법: node 05-extract-frames-with-heatmap.js --url "https://youtu.be/..."
 *    - 동작: 조건과 관계없이 지정된 영상의 프레임을 즉시 추출
 *
 * [옵션]
 * --url       : 대상 유튜브 영상 URL (생략 시 자동 배치 모드 작동)
 * --channel   : 채널명 (기본: tzuyang)
 * --fps       : 초당 추출 프레임 수 (기본: 1.0)
 * --buffer    : 피크 지점 기준 앞뒤 여유 시간(초) (기본: 0.0)
 * --quality   : 다운로드 화질 (예: 1080p,720p,360p) (기본: 360p) - 쉼표로 구분하여 다중 지정 가능
 * --ext       : 이미지 포맷 (예: webp,png,jpg) (기본: jpg) - 쉼표로 구분하여 다중 지정 가능
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import util from 'util';
import https from 'https';

const execPromise = util.promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 환경 설정 ---
const SCRIPT_DIR = __dirname;
const BASE_DATA_DIR = path.resolve(SCRIPT_DIR, '../data');
const VIDEO_CACHE_DIR = path.join(BASE_DATA_DIR, 'video_cache');
if (!fs.existsSync(VIDEO_CACHE_DIR)) fs.mkdirSync(VIDEO_CACHE_DIR, { recursive: true });

// --- 로깅 헬퍼 ---
function log(level, message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

// --- 인자 파싱 ---
function parseArgs() {
    const args = process.argv.slice(2);
    const params = {
        url: null,
        channel: 'tzuyang', // 기본 채널 변경: tzuyang
        fps: 1.0,
        buffer: 0.0,
        quality: ['360p'], // 배열로 변경
        ext: ['jpg'], // 배열로 변경
        force: false // [추가] 기본값 false
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--url': params.url = args[++i]; break;
            case '--channel': params.channel = args[++i]; break;
            case '--fps': params.fps = parseFloat(args[++i]); break;
            case '--buffer': params.buffer = parseFloat(args[++i]); break;
            case '--quality': params.quality = args[++i].split(','); break; // 콤마로 구분하여 배열로 변환
            case '--ext': params.ext = args[++i].toLowerCase().split(','); break; // 콤마로 구분하여 배열로 변환
            case '--delete-cache': params.deleteCache = true; break;
            case '--force': params.force = true; break; // [추가] 강제 수집 플래그
        }
    }
    return params;
}

// --- 경로 헬퍼 ---
function getChannelDir(channelName) {
    return path.join(BASE_DATA_DIR, channelName);
}

// 프레임 저장 경로: channel/frames/videoId/recollectId/
function getFramesOutputDir(channelName, videoId, recollectId) {
    const rId = recollectId !== undefined && recollectId !== null ? recollectId.toString() : '0';
    return path.join(getChannelDir(channelName), 'frames', videoId, rId);
}

function getHeatmapOutputPath(channelName, videoId) {
    const dir = path.join(getChannelDir(channelName), 'heatmap');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${videoId}.jsonl`);
}

function getMetaOutputPath(channelName, videoId) {
    return path.join(getChannelDir(channelName), 'meta', `${videoId}.jsonl`);
}

function extractVideoId(url) {
    if (!url) return null;
    const match = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
    return match ? match[1] : null;
}

// --- 메타 데이터 유틸리티 ---

// 메타 파일에서 recollect_id 값을 읽어옴 (없으면 0 반환)
function getMetaRecollectId(channelName, videoId) {
    let metaPath = getMetaOutputPath(channelName, videoId);

    // manual 채널인 경우 tzuyang 데이터 풀백 검색 (테스트 용의성)
    if (!fs.existsSync(metaPath) && channelName === 'manual') {
        const fallbackPath = path.join(BASE_DATA_DIR, 'tzuyang', 'meta', `${videoId}.jsonl`);
        if (fs.existsSync(fallbackPath)) {
            metaPath = fallbackPath;
        }
    }

    if (fs.existsSync(metaPath)) {
        try {
            const content = fs.readFileSync(metaPath, 'utf-8').trim().split('\n').pop();
            if (content) {
                const data = JSON.parse(content);
                return typeof data.recollect_id === 'number' ? data.recollect_id : 0;
            }
        } catch (e) {
            // 무시 (기본값 0 사용)
        }
    }
    return 0;
}

// 메타 파일에서 변경 변수(recollect_vars) 확인
function getRecollectVars(channelName, videoId) {
    let metaPath = getMetaOutputPath(channelName, videoId);

    if (!fs.existsSync(metaPath) && channelName === 'manual') {
        const fallbackPath = path.join(BASE_DATA_DIR, 'tzuyang', 'meta', `${videoId}.jsonl`);
        if (fs.existsSync(fallbackPath)) {
            metaPath = fallbackPath;
            log('info', `📋 메타 참조 변경: 'tzuyang' 채널 데이터 사용 -> ${path.basename(metaPath)}`);
        }
    }

    if (fs.existsSync(metaPath)) {
        try {
            const content = fs.readFileSync(metaPath, 'utf-8').trim().split('\n').pop();
            if (content) {
                const data = JSON.parse(content);
                const vars = data.recollect_vars || [];
                log('info', `📋 감지된 변경 변수: [${vars.join(', ')}]`);
                return vars;
            }
        } catch (e) {
            log('warn', `메타 파일 파싱 오류: ${e.message}`);
        }
    }
    return [];
}

function getKSTDate() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utc + (9 * 60 * 60 * 1000));
}

function getMetaInfo(channelName, videoId) {
    const metaPath = getMetaOutputPath(channelName, videoId);
    if (fs.existsSync(metaPath)) {
        try {
            const content = fs.readFileSync(metaPath, 'utf-8').trim().split('\n').pop();
            if (content) {
                return JSON.parse(content);
            }
        } catch (e) {
            log('warn', `메타 파일 읽기 실패: ${e.message}`);
        }
    }
    return null;
}

// [수정] ignoreExisting 파라미터 추가
function shouldCollect(channelName, videoId, ignoreExisting = false) {
    const metaInfo = getMetaInfo(channelName, videoId);
    let metaRecollectId = -1;
    let recollectVars = [];
    let publishedAt = null;

    if (metaInfo) {
        metaRecollectId = metaInfo.recollect_id !== undefined ? metaInfo.recollect_id : 0;
        recollectVars = metaInfo.recollect_vars || [];
        publishedAt = metaInfo.published_at;

        // [추가] 180초(3분) 미만 영상은 Shorts로 간주하여 자동 수집 제외
        const duration = metaInfo.duration || 0;
        if (duration < 180) {
            log('info', `[스킵] ${videoId}: 3분 미만 영상 (${duration}초)`);
            return false;
        }
    } else {
        // 메타 정보 없으면 수집 대상 (또는 정책에 따라 스킵 할 수도 있음)
        // 여기서는 일단 수집 시도 (히트맵 수집 과정에서 메타 없으면 어차피 실패할 수 있음)
        return true;
    }

    // 1. 필수 확인: 게시 후 5일 경과 여부
    if (!publishedAt) {
        return false;
    }

    const pubDate = new Date(publishedAt);
    const now = getKSTDate();
    // diffTime을 ms 단위로 계산
    const diffTime = Math.abs(now - pubDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // 올림 처리

    if (diffDays < 5) {
        // [중요] 5일 미만이라도 'new_video' 같은 즉시 수집 트리거가 있으면 수집해야 할 수도 있음.
        // 하지만 04 스크립트 로직에 따르면 5일 미만은 무조건 false 입니다.
        log('info', `[스킵] ${videoId}: 게시 후 5일 미만 (${diffDays}일)`);
        return false;
    }

    // [수정] 강제 수집 모드일 경우 기존 파일 확인 스킵
    if (ignoreExisting) {
        return true;
    }

    // 이미 프레임이 추출된 상태인지 확인 (recollect_id 비교)
    // 여기서는 frames 폴더 존재 여부로 1차 판단 가능
    const framesDir = getFramesOutputDir(channelName, videoId, metaRecollectId);

    // frames 폴더가 있고 비어있지 않다면 이미 수집된 것으로 간주
    if (fs.existsSync(framesDir) && fs.readdirSync(framesDir).length > 0) {
        // 메타의 recollect_id가 더 높아졌다면 재수집 필요
        // 하지만 현 구조상 이전 recollect_id를 어디서 가져올지 애매하므로 (heatmap 파일 참조 필요)
        const heatmapPath = getHeatmapOutputPath(channelName, videoId);
        if (fs.existsSync(heatmapPath)) {
            try {
                const lines = fs.readFileSync(heatmapPath, 'utf-8').trim().split('\n');
                if (lines.length > 0) {
                    const lastLine = lines[lines.length - 1];
                    const lastData = JSON.parse(lastLine);
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
                    } else {
                        // recollect_id가 같거나 작으면 이미 최신
                        // log('info', `[스킵] ${videoId}: 이미 최신 버전 (RecollectID: ${metaRecollectId})`);
                        return false;
                    }
                }
            } catch (e) { }
        }
        // 히트맵 파일조차 없다면 수집 해야 함
        return true;
    }

    return true;
}

// --- 데이터 수집 및 다운로드 로직 ---

async function loadCookies() {
    // 1. JSON 포맷 쿠키 시도
    const jsonPath = path.join(BASE_DATA_DIR, 'cookies.json');
    if (fs.existsSync(jsonPath)) {
        try {
            const content = fs.readFileSync(jsonPath, 'utf-8');
            const cookies = JSON.parse(content);
            log('info', `🍪 cookies.json 로드 완료 (${cookies.length}개)`);
            return cookies.map(c => `${c.name}=${c.value}`).join('; ');
        } catch (e) {
            log('warn', `cookies.json 로드 실패: ${e.message}`);
        }
    }

    // 2. Netscape 포맷 쿠키 (.txt) 시도
    const txtPath = path.join(BASE_DATA_DIR, 'cookies.txt');
    if (fs.existsSync(txtPath)) {
        try {
            const content = fs.readFileSync(txtPath, 'utf-8');
            const lines = content.split('\n');
            const cookies = [];
            for (const line of lines) {
                if (line.startsWith('#') || !line.trim()) continue;
                const parts = line.split('\t');
                if (parts.length >= 7) {
                    cookies.push(`${parts[5]}=${parts[6]}`);
                }
            }
            log('info', `🍪 cookies.txt 로드 완료 (${cookies.length}개)`);
            return cookies.join('; ');
        } catch (e) {
            log('warn', `cookies.txt 로드 실패: ${e.message}`);
        }
    }
    return '';
}

async function fetchPage(url, cookieHeader) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,ko;q=0.8',
        'Cookie': cookieHeader || ''
    };

    return new Promise((resolve, reject) => {
        https.get(url, { headers }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`상태 코드 오류: ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function parseHeatmap(html) {
    // ytInitialData 객체 추출
    const match = html.match(/var\s+ytInitialData\s*=\s*({.*?});/s);
    if (!match) return null;

    try {
        const data = JSON.parse(match[1]);

        // 깊은 객체 탐색 헬퍼
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

        // '가장 많이 다시 본 장면' 마커 추출
        const markersDecoration = findKey(data, 'markersDecoration');
        let mostReplayed = [];

        if (markersDecoration && markersDecoration.timedMarkerDecorations) {
            mostReplayed = markersDecoration.timedMarkerDecorations
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

        // 일반 인터랙션 데이터 추출
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
            mostReplayedMarkers: mostReplayed,
            interactionData: rawMarkers
        };

    } catch (e) {
        log('error', `HTML 파싱 실패: ${e.message}`);
        return null;
    }
}

// 히트맵 데이터 수집 및 저장
async function fetchAndSaveHeatmap(channel, videoId, url) {
    const outPath = getHeatmapOutputPath(channel, videoId);

    // [수정] 이미 데이터가 존재하면 다시 수집하지 않고 읽어서 반환 (중복 저장 방지)
    if (fs.existsSync(outPath)) {
        try {
            const lines = fs.readFileSync(outPath, 'utf-8').trim().split('\n');
            if (lines.length > 0) {
                const lastLine = lines[lines.length - 1]; // 가장 최신 데이터 사용
                // 마지막 줄이 완전하지 않을 경우 대비 (간단 체크)
                if (lastLine.endsWith('}')) {
                    const existingData = JSON.parse(lastLine);
                    log('info', `♻️ 기존 히트맵 데이터 사용: ${outPath}`);
                    return existingData.most_replayed_markers.map(m => ({
                        startSec: m.startMillis / 1000,
                        endSec: m.endMillis / 1000,
                        peakSec: m.peakMillis / 1000
                    }));
                }
            }
        } catch (e) {
            log('warn', `기존 파일 읽기 실패 (재수집 진행): ${e.message}`);
        }
    }

    const cookieHeader = await loadCookies();
    const html = await fetchPage(url, cookieHeader);
    const parsed = parseHeatmap(html);

    if (!parsed || (!parsed.mostReplayedMarkers.length && !parsed.interactionData)) {
        log('warn', `⚠️ ${videoId}: 히트맵 정보가 없습니다.`);
        return null;
    }

    const formattedInteraction = (parsed.interactionData || []).map(item => {
        const seconds = Math.floor((item.startMillis || 0) / 1000);
        const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
        const ss = (seconds % 60).toString().padStart(2, '0');
        return {
            ...item,
            formatted_time: `${mm}:${ss}`
        };
    });

    const recollectId = getMetaRecollectId(channel, videoId);

    // [추가] 메타 정보에서 duration 가져오기
    const metaInfo = getMetaInfo(channel, videoId);
    const duration = metaInfo ? metaInfo.duration : 0;

    const saveData = {
        youtube_link: url,
        video_id: videoId,
        duration: duration, // duration 필드 추가
        interaction_data: formattedInteraction,
        most_replayed_markers: parsed.mostReplayedMarkers,
        status: 'success',
        collected_at: new Date().toISOString(),
        recollect_id: recollectId,
        recollect_vars: getRecollectVars(channel, videoId)
    };

    fs.appendFileSync(outPath, JSON.stringify(saveData) + '\n', 'utf8');
    log('info', `💾 히트맵 데이터 저장됨: ${outPath} (포인트: ${formattedInteraction.length}개)`);

    return parsed.mostReplayedMarkers.map(m => ({
        startSec: m.startMillis / 1000,
        endSec: m.endMillis / 1000,
        peakSec: m.peakMillis / 1000
    }));
}

// --- 비디오 다운로드 및 프레임 추출 ---

async function downloadVideo(videoId, outputDir, quality) {
    const match = quality.match(/\d+/);
    const height = match ? parseInt(match[0]) : 1080;

    const cookieTxt = path.join(BASE_DATA_DIR, 'cookies.txt');
    const cookieArg = fs.existsSync(cookieTxt) ? `--cookies "${cookieTxt}"` : '';

    // 포맷 유연성 확보: mp4 강제 제거 후 remux 사용 (n-challenge 해결 확률 높임)
    const format = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;

    // 1. Python 모듈 사용 (최신 버전 보장)
    // 2. Node.js 경로 명시 (n-challenge 해결 필수)
    // 3. Remote Solver 허용 (최신 yt-dlp 정책 대응)
    // 4. Output Template: 확장자 자동 결정 (%(ext)s) - Merge 에러 방지
    const nodePath = "C:\\Program Files\\nodejs\\node.exe";
    const outputFileTemplate = path.join(outputDir, `${videoId}.%(ext)s`);

    // [최적화] 캐시된 파일 확인
    const cacheFiles = fs.readdirSync(VIDEO_CACHE_DIR);
    const cachedFile = cacheFiles.find(f => f.startsWith(videoId) && (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv')));
    if (cachedFile) {
        log('info', `♻️ 캐시된 비디오 사용: ${cachedFile}`);
        return path.join(VIDEO_CACHE_DIR, cachedFile);
    }

    // --merge-output-format 제거: 원본 컨테이너 그대로 저장
    const cmd = `python -m yt_dlp ${cookieArg} --js-runtimes "node:${nodePath}" --remote-components ejs:github --no-part -f "${format}" -o "${outputFileTemplate}" "https://www.youtube.com/watch?v=${videoId}"`;

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            log('info', `📥 영상 다운로드 시작: ${videoId} (목표 화질: ${height}p) [시도 ${attempt}/${maxRetries}]`);
            await execPromise(cmd);

            // 다운로드된 파일 찾기
            const files = fs.readdirSync(outputDir);
            const videoFile = files.find(f => f.startsWith(videoId) && (f.endsWith('.mp4') || f.endsWith('.webm') || f.endsWith('.mkv')));

            if (videoFile) {
                const downloadedPath = path.join(outputDir, videoFile);

                // [최적화] 다운로드 성공 시 캐시에 복사
                try {
                    const cachePath = path.join(VIDEO_CACHE_DIR, videoFile);
                    fs.copyFileSync(downloadedPath, cachePath);
                    log('info', `💾 비디오 캐시 저장 완료: ${cachePath}`);
                } catch (e) {
                    log('warn', `캐시 저장 실패: ${e.message}`);
                }

                return downloadedPath;
            }

            log('warn', `❌ 다운로드 완료 보고되었으나 파일 없음 (재시도 대기...)`);

        } catch (e) {
            log('warn', `❌ 다운로드 실패 (시도 ${attempt}/${maxRetries}): ${e.message}`);
        }

        // 재시도 전 대기 (2초)
        if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    log('error', '❌ 최대 재시도 횟수 초과. 다운로드 포기.');
    return null;
}

// [수정] quality 인자 추가, compress -> ext 변경
async function extractFrames(videoPath, segments, outputBaseDir, quality, fps, bufferSec, ext) {
    if (!fs.existsSync(videoPath)) return;

    let duration = 0;
    try {
        const { stdout } = await execPromise(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`);
        duration = parseFloat(stdout);
        log('info', `🎞️ 영상 길이 확인: ${duration}초`);
    } catch (e) {
        log('warn', `길이 확인 실패 (진행): ${e.message}`);
    }

    log('info', `🖼️ 이미지 포맷 설정: ${ext.toUpperCase()}`);

    // 확장자별 FFMPEG 인코딩 옵션 설정
    let encodingOpts = '';
    if (ext === 'webp') {
        encodingOpts = '-c:v libwebp -lossless 1 -q:v 100'; // WebP 무손실 + 최대 압축 (용량 최소화)
    } else if (ext === 'png') {
        encodingOpts = '-c:v png -compression_level 3'; // PNG (속도/압축 균형)
    } else if (ext === 'jpg' || ext === 'jpeg') {
        encodingOpts = '-q:v 2'; // JPG 고화질 (1-31, 낮을수록 좋음)
    } else if (ext === 'bmp') {
        encodingOpts = '-c:v bmp'; // BMP (기본)
    }

    // [최적화] Promise.all을 사용하여 모든 구간을 병렬로 처리 (CPU 활용 극대화)
    await Promise.all(segments.map(async (seg, i) => {
        // [수정] 피크 지점 기준이 아닌, 마커의 전체 범위(startSec ~ endSec)에 버퍼를 더한 구간 추출
        const startTime = Math.max(0, seg.startSec - bufferSec);
        const endTime = Math.min(duration || 99999, seg.endSec + bufferSec);

        const segDirName = `${i + 1}_${Math.floor(startTime)}_${Math.floor(endTime)}`;

        const fpsStr = Number.isInteger(fps) ? `${fps}.0` : `${fps}`;
        const configDirName = `${quality}_${fpsStr}fps`;

        // 구조: frames/VIDEO_ID/RECOLLECT_ID/SEGMENT_DIR/EXT_DIR/QUALITY_FPS/frame_x.ext
        const segDirPath = path.join(outputBaseDir, segDirName, ext, configDirName);
        fs.mkdirSync(segDirPath, { recursive: true });

        // [최적화] 이미 프레임이 추출되어 있다면 스킵
        const existingFiles = fs.readdirSync(segDirPath).filter(f => f.endsWith(`.${ext}`));
        if (existingFiles.length > 0) {
            log('info', `   ⏭️ 이미 프레임이 존재하여 건너뜀 [${i + 1}/${segments.length}]: ${segDirPath}`);
            return;
        }

        log('info', `   ✂️ 구간 추출 시작 [${i + 1}/${segments.length}]: ${startTime.toFixed(1)}초 ~ ${endTime.toFixed(1)}초 -> .../${configDirName}`);

        let segDuration = endTime - startTime;
        if (segDuration < (1.0 / fps)) {
            segDuration = 1.0 / fps; // 최소 1프레임 보장
        }

        // ffmpeg 명령 생성 (인코딩 옵션 추가)
        const cmd = `ffmpeg -y -ss ${startTime} -t ${segDuration} -i "${videoPath}" -vf "fps=${fps}" ${encodingOpts} -frame_pts 1 "${path.join(segDirPath, `frame_%d.${ext}`)}"`;

        try {
            await execPromise(cmd);

            // 파일명 정리: frame_1.ext -> 정확한 시간(초).ext 로 변경
            const files = fs.readdirSync(segDirPath).filter(f => f.startsWith('frame_'));
            let count = 0;
            for (const file of files) {
                const match = file.match(new RegExp(`frame_(\\d+)\\.${ext}`));
                if (match) {
                    const idx = parseInt(match[1]);
                    const timeOffset = (idx - 1) / fps;
                    const actualTime = startTime + timeOffset;
                    const newName = `${actualTime.toFixed(2)}.${ext}`;

                    fs.renameSync(path.join(segDirPath, file), path.join(segDirPath, newName));
                    count++;
                }
            }
            log('info', `      ✅ 추출 완료 [${i + 1}/${segments.length}]: ${count}장`);

        } catch (e) {
            log('error', `      ❌ FFmpeg 오류 [${i + 1}/${segments.length}]: ${e.message}`);
        }
    }));
}

async function processSingleVideo(videoId, params) {
    const { channel, fps, buffer, quality, url, ext } = params; // quality는 이제 배열입니다

    // 1. 히트맵 데이터 수집 (Recollect ID 자동 감지)
    const segments = await fetchAndSaveHeatmap(channel, videoId, url);
    if (!segments || segments.length === 0) {
        log('info', `ℹ️ ${videoId}: 처리할 중요 구간(Most Replayed)이 없습니다.`);
        return;
    }

    log('info', `🔎 ${videoId}: ${segments.length}개의 주요 구간 발견`);

    // 모든 화질에 대해 반복 처리
    const qualities = Array.isArray(quality) ? quality : [quality];
    const extensions = Array.isArray(ext) ? ext : [ext];

    log('info', `🎯 처리할 화질 목록: [${qualities.join(', ')}]`);
    log('info', `🎨 처리할 포맷 목록: [${extensions.join(', ')}]`);

    for (const currentQuality of qualities) {
        log('info', `\n🚀 화질 처리 시작: ${currentQuality}`);

        // 2. 영상 다운로드 (임시 폴더) - 파일 잠금 충돌 방지용 랜덤 접미사
        const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        const tempDir = path.join(getChannelDir(channel), 'temp_video', uniqueSuffix);
        fs.mkdirSync(tempDir, { recursive: true });

        // 다운로드 및 처리 로직
        let videoPath = null;
        try {
            // [최적화] 스마트 재개: 이미 모든 구간의 프레임이 추출되어 있다면 다운로드/추출 스킵
            const recollectId = getMetaRecollectId(channel, videoId);
            const outputDir = getFramesOutputDir(channel, videoId, recollectId);
            const fpsStr = Number.isInteger(fps) ? `${fps}.0` : `${fps}`;
            const configDirName = `${currentQuality}_${fpsStr}fps`;

            let allSegmentsExist = true;
            for (const currentExt of extensions) {
                // 하나라도 구간이 없으면 다시 진행
                const segmentCheck = segments.every((seg, i) => {
                    const startTime = Math.max(0, seg.startSec - buffer);
                    // duration 몰라도 폴더명 매칭을 위해 대략적 추론 or 단순 존재 여부 체크
                    // 정확한 폴더명을 알기 어려우므로(duration 필요), 
                    // 해당 recollectId 폴더 내에 configDirName을 포함한 경로가 세그먼트 수만큼 있는지 체크는 복잡.
                    // 대신 extractFrames 내부 스킵 로직에 의존하되, 여기서는 '비디오 다운로드'를 막는게 핵심.
                    // 간단히: outputDir 내의 폴더들을 뒤져서 configDirName을 가진 폴더가 segments.length 만큼 되는지 확인?
                    return false; // 구현 복잡도로 인해 아래 로직으로 대체
                });

                // 더 확실한 방법: 이미 추출된 폴더 개수 확인
                // 구조: frames/VID/RID/SEG/EXT/CONF
                // SEG 폴더들을 순회하며 EXT/CONF가 있는지 확인
                if (!fs.existsSync(outputDir)) {
                    allSegmentsExist = false;
                    break;
                }

                const segDirs = fs.readdirSync(outputDir);
                // 세그먼트 폴더 개수가 히트맵 구간 수와 비슷하거나 같다고 가정
                let completedSegs = 0;
                for (const sd of segDirs) {
                    const targetPath = path.join(outputDir, sd, currentExt, configDirName);
                    if (fs.existsSync(targetPath) && fs.readdirSync(targetPath).length > 0) {
                        completedSegs++;
                    }
                }

                if (completedSegs < segments.length) {
                    allSegmentsExist = false;
                    break;
                }
            }

            if (allSegmentsExist) {
                log('info', `⏭️ [스마트 스킵] ${videoId}: 이미 ${currentQuality} 프레임 수집 완료됨.`);
                continue;
            }

            videoPath = await downloadVideo(videoId, tempDir, currentQuality);

            if (!videoPath) {
                log('error', `❌ 비디오 파일 확보 실패 (${currentQuality}). 건너뜁니다.`);
                logFailedUrl(channel, url); // [추가] 실패 로깅
                continue; // 다음 화질 처리
            }

            // 3. 프레임 추출 (모든 확장자에 대해 반복)
            // [수정] 위에서 이미 선언했으므로 재사용
            // const recollectId = ... 
            // const outputDir = ... 


            for (const currentExt of extensions) {
                await extractFrames(videoPath, segments, outputDir, currentQuality, fps, buffer, currentExt);
            }

            // [옵션] 작업 완료 후 캐시 삭제 (디스크 공간 확보용)
            // 주의: 모든 확장자 처리가 끝난 후 삭제해야 함
            if (params.deleteCache && videoPath.startsWith(VIDEO_CACHE_DIR)) {
                try {
                    fs.unlinkSync(videoPath);
                    log('info', `🗑️ 비디오 캐시 파일 삭제 완료: ${videoPath}`);

                    // 폴더가 비었으면 폴더도 삭제
                    if (fs.readdirSync(VIDEO_CACHE_DIR).length === 0) {
                        fs.rmdirSync(VIDEO_CACHE_DIR);
                        log('info', `🗑️ 비디오 캐시 폴더 삭제 완료: ${VIDEO_CACHE_DIR}`);
                    }
                } catch (e) {
                    log('warn', `캐시 삭제 실패: ${e.message}`);
                }
            }

        } catch (e) {
            log('error', `오류 발생 (${currentQuality}): ${e.message}`);
        } finally {
            // 4. 임시 파일 정리 (항상 수행)
            // tempDir은 매번 생성되는 고유 임시 폴더이므로 무조건 삭제해도 안전함 (캐시 폴더와 무관)
            try {
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }

                // 상위 temp_video 폴더가 비어있으면 삭제 시도
                const parentTempDir = path.dirname(tempDir);
                if (fs.existsSync(parentTempDir) && fs.readdirSync(parentTempDir).length === 0) {
                    fs.rmdirSync(parentTempDir);
                }
            } catch (e) {
                log('warn', `임시 폴더 청소 중 오류 (치명적이지 않음): ${e.message}`);
            }
        }
    }
}

// [추가] 실패한 URL 로깅 함수
function logFailedUrl(channel, url) {
    const failedPath = path.join(getChannelDir(channel), 'failed_urls.txt');
    try {
        fs.appendFileSync(failedPath, url + '\n', 'utf8');
        log('info', `📝 실패 목록에 추가됨: ${failedPath}`);
    } catch (e) {
        log('error', `실패 목록 저장 실패: ${e.message}`);
    }
}

async function main() {
    const params = parseArgs();

    if (params.url) {
        const videoId = extractVideoId(params.url);
        if (!videoId) {
            log('error', '잘못된 YouTube URL입니다.');
            return;
        }

        // URL 정규화 (youtu.be 단축 링크 등 리다이렉트 방지)
        params.url = `https://www.youtube.com/watch?v=${videoId}`;

        log('info', `=== 비디오 Frame 추출 시작: ${videoId} ===`);
        log('info', `설정: FPS=${params.fps}, Buffer=${params.buffer}초, 화질=${params.quality.join(', ')}, 포맷=${params.ext.join(', ').toUpperCase()}`);

        if (params.channel === 'manual') {
            fs.mkdirSync(path.join(BASE_DATA_DIR, 'manual'), { recursive: true });
        }

        await processSingleVideo(videoId, params);

    } else {
        // 자동 배치 수집 모드
        log('info', `\n=== 자동 배치 수집 모드 시작 [채널: ${params.channel}] ===`);
        await processBatch(params);
    }
}

async function processBatch(params) {
    const { channel } = params;
    const urlsPath = path.join(getChannelDir(channel), 'urls.txt');
    const deletedPath = path.join(getChannelDir(channel), 'deleted_urls.txt');

    if (!fs.existsSync(urlsPath)) {
        log('error', `urls.txt를 찾을 수 없습니다: ${urlsPath}`);
        return;
    }

    // 1. deleted_ids 로드
    const deletedIds = new Set();
    if (fs.existsSync(deletedPath)) {
        try {
            const lines = fs.readFileSync(deletedPath, 'utf8').split('\n');
            for (const line of lines) {
                const vid = extractVideoId(line);
                if (vid) deletedIds.add(vid);
            }
        } catch (e) { log('warn', `deleted_urls.txt 로드 실패: ${e.message}`); }
    }

    const urls = fs.readFileSync(urlsPath, 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    log('info', `총 ${urls.length}개 URL 발견`);

    let processedCount = 0;
    let skippedCount = 0;

    for (const url of urls) {
        const videoId = extractVideoId(url);
        if (!videoId) continue;

        if (deletedIds.has(videoId)) {
            // log('info', `[스킵] ${videoId} (삭제된 영상)`);
            skippedCount++;
            continue;
        }

        if (shouldCollect(channel, videoId, params.force)) { // [수정] force 플래그 전달
            log('info', `\n--- [${processedCount + 1}] 처리 시작: ${videoId} ---`);
            params.url = url; // 현재 URL 설정
            await processSingleVideo(videoId, params);
            processedCount++;

            // IP 차단 방지 딜레이 강화 (10 ~ 30초)
            const delay = 10000 + Math.random() * 20000;
            log('info', `⏳ 대기: ${(delay / 1000).toFixed(1)}초...`);
            await new Promise(r => setTimeout(r, delay));

            // [추가] 10개마다 긴 휴식 (1분 ~ 3분)
            if (processedCount % 10 === 0) {
                const longPause = 60000 + Math.random() * 120000;
                log('info', `☕ 긴 휴식 (IP 차단 방지): ${(longPause / 1000).toFixed(1)}초...`);
                await new Promise(r => setTimeout(r, longPause));
            }
        } else {
            skippedCount++;
            // log('info', `[스킵] ${videoId} (수집 조건 미달)`);
        }
    }

    log('info', `=== 배치 작업 완료: 처리 ${processedCount}개, 스킵 ${skippedCount}개 ===`);
}

main().catch(e => console.error(e));
