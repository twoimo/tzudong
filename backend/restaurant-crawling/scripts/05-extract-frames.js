/**
 * 유튜브 히트맵 기반 고화질 프레임 추출기 (Node.js 버전)
 *
 * 이 스크립트는 유튜브 영상의 '가장 많이 다시 본 장면(Heatmap Peak)' 데이터를 분석하여,
 * 해당 구간의 고화질 프레임을 자동으로 추출합니다.
 *
 * [주요 기능]
 * 1. 히트맵 데이터 수집: 웹 페이지 파싱을 통해 'Most Replayed' 구간 식별
 * 2. 스마트 다운로드: `yt-dlp`를 사용하여 지정된 화질(기본 1080p)로 영상 다운로드
 * 3. 정밀 프레임 추출: `ffmpeg`를 사용하여 피크 시점 전후(Buffer) 구간을 프레임 단위로 저장
 * 4. 자동 메타데이터 연동: 기존 수집된 메타 정보(recollect_id 등)를 자동으로 감지하여 데이터 일관성 유지
 * 5. 포맷 지원: 비손실 BMP(기본) 및 무손실 압축 PNG 지원
 *
 * [사용법]
 * node 05-extract-frames.js --url "https://youtu.be/..." --fps 4 --buffer 5 --quality 1080p [--compress]
 *
 * [옵션]
 * --url       : 대상 유튜브 영상 URL (필수)
 * --channel   : 채널명 (기본: manual)
 * --fps       : 초당 추출 프레임 수 (기본: 4.0)
 * --buffer    : 피크 지점 기준 앞뒤 여유 시간(초) (기본: 5.0)
 * --quality   : 다운로드 화질 (예: 1080p, 720p) (기본: 1080p)
 * --compress  : PNG 압축 사용 (기본: BMP - 빠른 속도)
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
        channel: 'manual',
        fps: 4.0,
        buffer: 5.0,
        quality: '1080p',
        compress: false // false: BMP(Raw, 빠름), true: PNG(압축, 용량 절약)
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--url': params.url = args[++i]; break;
            case '--channel': params.channel = args[++i]; break;
            case '--fps': params.fps = parseFloat(args[++i]); break;
            case '--buffer': params.buffer = parseFloat(args[++i]); break;
            case '--quality': params.quality = args[++i]; break;
            case '--compress': params.compress = true; break;
            case '--delete-cache': params.deleteCache = true; break;
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

    const saveData = {
        youtube_link: url,
        video_id: videoId,
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

// [수정] quality 인자 추가
async function extractFrames(videoPath, segments, outputBaseDir, quality, fps, bufferSec, compress) {
    if (!fs.existsSync(videoPath)) return;

    let duration = 0;
    try {
        const { stdout } = await execPromise(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`);
        duration = parseFloat(stdout);
        log('info', `🎞️ 영상 길이 확인: ${duration}초`);
    } catch (e) {
        log('warn', `길이 확인 실패 (진행): ${e.message}`);
    }

    const ext = compress ? 'png' : 'bmp';
    log('info', `🖼️ 이미지 포맷 설정: ${ext.toUpperCase()} (압축: ${compress ? 'ON' : 'OFF'})`);

    // [최적화] Promise.all을 사용하여 모든 구간을 병렬로 처리 (CPU 활용 극대화)
    // 주의: FFMPEG는 로컬 작업이므로 유튜브 네트워크 요청 제한과 무관함 -> 안심하고 병렬 처리 가능
    await Promise.all(segments.map(async (seg, i) => {
        // [수정] 피크 지점 기준이 아닌, 마커의 전체 범위(startSec ~ endSec)에 버퍼를 더한 구간 추출
        const startTime = Math.max(0, seg.startSec - bufferSec);
        const endTime = Math.min(duration || 99999, seg.endSec + bufferSec);

        const segDirName = `${i + 1}_${Math.floor(startTime)}_${Math.floor(endTime)}`;

        // 구조: frames/VIDEO_ID/RECOLLECT_ID/SEGMENT_DIR/FORMAT_DIR/QUALITY_FPS/frame_x.ext
        // 구조: frames/VIDEO_ID/RECOLLECT_ID/SEGMENT_DIR/FORMAT_DIR/QUALITY_FPS/frame_x.ext
        const fpsStr = Number.isInteger(fps) ? `${fps}.0` : `${fps}`;
        const configDirName = `${quality}_${fpsStr}fps`;

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

        // ffmpeg 명령 생성
        const cmd = `ffmpeg -y -ss ${startTime} -t ${segDuration} -i "${videoPath}" -vf "fps=${fps}" -frame_pts 1 "${path.join(segDirPath, `frame_%d.${ext}`)}"`;

        try {
            await execPromise(cmd);

            // 파일명 정리: frame_1.bmp -> 정확한 시간(초).bmp 로 변경
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
    const { channel, fps, buffer, quality, url, compress } = params;

    // 1. 히트맵 데이터 수집 (Recollect ID 자동 감지)
    const segments = await fetchAndSaveHeatmap(channel, videoId, url);
    if (!segments || segments.length === 0) {
        log('info', `ℹ️ ${videoId}: 처리할 중요 구간(Most Replayed)이 없습니다.`);
        return;
    }

    log('info', `🔎 ${videoId}: ${segments.length}개의 주요 구간 발견`);

    // 2. 영상 다운로드 (임시 폴더) - 파일 잠금 충돌 방지용 랜덤 접미사
    const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const tempDir = path.join(getChannelDir(channel), 'temp_video', uniqueSuffix);
    fs.mkdirSync(tempDir, { recursive: true });

    // 다운로드 및 처리 로직
    let videoPath = null;
    try {
        videoPath = await downloadVideo(videoId, tempDir, quality);

        if (!videoPath) {
            log('error', '❌ 비디오 파일 확보 실패. 종료합니다.');
            return;
        }

        // 3. 프레임 추출
        const recollectId = getMetaRecollectId(channel, videoId);
        const outputDir = getFramesOutputDir(channel, videoId, recollectId);
        await extractFrames(videoPath, segments, outputDir, quality, fps, buffer, compress);

        // [옵션] 작업 완료 후 캐시 삭제 (디스크 공간 확보용)
        if (params.deleteCache && videoPath.startsWith(VIDEO_CACHE_DIR)) {
            try {
                fs.unlinkSync(videoPath);
                log('info', `🗑️ 비디오 캐시 삭제 완료: ${videoPath}`);
            } catch (e) {
                log('warn', `캐시 삭제 실패: ${e.message}`);
            }
        }

    } catch (e) {
        log('error', `오류 발생: ${e.message}`);
    } finally {
        // 4. 임시 파일 정리 (캐시된 파일은 삭제하지 않음)
        // videoPath가 캐시 폴더에 있다면 삭제 건너뜀
        if (videoPath && videoPath.startsWith(VIDEO_CACHE_DIR)) {
            // log('info', '♻️ 캐시된 파일이므로 삭제하지 않습니다.');
        } else {
            try {
                if (fs.existsSync(tempDir)) {
                    // Node.js 14.14+ required for recursive: true
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
            } catch (e) {
                log('warn', `임시 폴더 청소 중 오류 (치명적이지 않음): ${e.message}`);
            }
        }
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

        const modeStr = params.compress ? 'PNG (압축)' : 'BMP (원본/무압축)';
        log('info', `=== 비디오 Frame 추출 시작: ${videoId} ===`);
        log('info', `설정: FPS=${params.fps}, Buffer=${params.buffer}초, 화질=${params.quality}, 포맷=${modeStr}`);

        if (params.channel === 'manual') {
            fs.mkdirSync(path.join(BASE_DATA_DIR, 'manual'), { recursive: true });
        }

        await processSingleVideo(videoId, params);

    } else if (params.channel !== 'manual') {
        log('warn', '채널 일괄 모드는 현재 지원하지 않음 (단일 URL 모드 사용 권장)');
    } else {
        log('info', '사용법: node 05-extract-frames.js --url <YouTube_URL> ...');
    }
}

main().catch(e => console.error(e));
