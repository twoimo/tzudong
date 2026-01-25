/**
 * YouTube 히트맵 기반 프레임 추출기 (Node.js 버전)
 * 
 * 기능:
 * 1. 히트맵 데이터 수집 (04-collect-heatmap.js 로직 동일)
 * 2. 가장 많이 다시 본 장면(피크) 구간 식별
 * 3. yt-dlp로 고화질 영상 다운로드
 * 4. FFmpeg로 정확한 타임스탬프 프레임 추출
 *    - 기본: BMP (Raw, 무압축)
 *    - --compress 옵션: PNG (Lossless Compression)
 * 
 * 사용법:
 *   node 05-extract-frames.js --url "https://..." --fps 4 --buffer 5 --quality 1080p [--compress]
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

// 로깅 헬퍼
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
        recollectId: 0,
        compress: false // 기본값: false (BMP/Raw), true: PNG
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--url': params.url = args[++i]; break;
            case '--channel': params.channel = args[++i]; break;
            case '--fps': params.fps = parseFloat(args[++i]); break;
            case '--buffer': params.buffer = parseFloat(args[++i]); break;
            case '--quality': params.quality = args[++i]; break;
            case '--recollect-id': params.recollectId = parseInt(args[++i]); break;
            case '--compress': params.compress = true; break;
        }
    }
    return params;
}

// --- 경로 헬퍼 ---
function getChannelDir(channelName) {
    return path.join(BASE_DATA_DIR, channelName);
}

function getFramesOutputDir(channelName, videoId, recollectId, quality, fps, compress) {
    const fpsStr = Number.isInteger(fps) ? `${fps}.0` : `${fps}`;
    const dirName = `${quality}_${fpsStr}fps`;
    // 요청사항: 10 대신 bmp, 11 대신 png 등 포맷명을 폴더명으로 사용
    const formatFolder = compress ? 'png' : 'bmp';
    return path.join(getChannelDir(channelName), 'high_res_frames', videoId, formatFolder, dirName);
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

// --- 데이터 수집 로직 ---

async function loadCookies() {
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
                reject(new Error(`Status Code: ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function parseHeatmap(html) {
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
        log('error', `Parsing Error: ${e.message}`);
        return null;
    }
}

function getRecollectVars(channelName, videoId) {
    // 1. 현재 채널에서 검색
    let metaPath = getMetaOutputPath(channelName, videoId);

    // 2. 없으면 'tzuyang' 채널(메인 데이터)에서 폴백 검색
    if (!fs.existsSync(metaPath) && channelName === 'manual') {
        const fallbackPath = path.join(BASE_DATA_DIR, 'tzuyang', 'meta', `${videoId}.jsonl`);
        if (fs.existsSync(fallbackPath)) {
            metaPath = fallbackPath;
            log('info', `📋 Meta Info: 'tzuyang' 채널 데이터 참조 -> ${path.basename(metaPath)}`);
        }
    }

    if (fs.existsSync(metaPath)) {
        try {
            const content = fs.readFileSync(metaPath, 'utf-8').trim().split('\n').pop();
            if (content) {
                const data = JSON.parse(content);
                const vars = data.recollect_vars || [];
                log('info', `📋 Meta Vars Found: [${vars.join(', ')}]`);
                return vars;
            }
        } catch (e) {
            log('warn', `Meta 파일 파싱 실패: ${e.message}`);
        }
    } else {
        log('info', `ℹ️ Meta 파일 없음: ${videoId} (recollect_vars=[])`);
    }
    return [];
}

async function fetchAndSaveHeatmap(channel, videoId, url, recollectId) {
    const cookieHeader = await loadCookies();
    const html = await fetchPage(url, cookieHeader);
    const parsed = parseHeatmap(html);

    if (!parsed || (!parsed.mostReplayedMarkers.length && !parsed.interactionData)) {
        log('warn', `⚠️ ${videoId}: 히트맵 데이터 없음`);
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

    const outPath = getHeatmapOutputPath(channel, videoId);
    fs.appendFileSync(outPath, JSON.stringify(saveData) + '\n', 'utf8');
    log('info', `💾 히트맵 저장 완료: ${outPath} (포인트: ${formattedInteraction.length}개)`);

    return parsed.mostReplayedMarkers.map(m => ({
        startSec: m.startMillis / 1000,
        endSec: m.endMillis / 1000,
        peakSec: m.peakMillis / 1000
    }));
}

// --- 비디오 처리 ---

async function downloadVideo(videoId, outputPath, quality) {
    const match = quality.match(/\d+/);
    const height = match ? parseInt(match[0]) : 1080;

    const format = `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}][ext=mp4]/best[ext=mp4]`;
    const cmd = `yt-dlp -f "${format}" -o "${outputPath}" "https://www.youtube.com/watch?v=${videoId}"`;

    log('info', `📥 다운로드 시작: ${videoId} (목표화질: ${height}p)`);
    try {
        await execPromise(cmd);
        return true;
    } catch (e) {
        log('error', `❌ 다운로드 실패: ${e.message}`);
        return false;
    }
}

async function extractFrames(videoPath, segments, outputBaseDir, fps, bufferSec, compress) {
    if (!fs.existsSync(videoPath)) return;

    let duration = 0;
    try {
        const { stdout } = await execPromise(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`);
        duration = parseFloat(stdout);
        log('info', `🎞️ 비디오 길이: ${duration}초`);
    } catch (e) {
        log('warn', `Duration 확인 실패, 진행함: ${e.message}`);
    }

    // 포맷 설정: compress=false(default) -> BMP, compress=true -> PNG
    const ext = compress ? 'png' : 'bmp';
    const qualityOption = '';

    log('info', `🖼️ 이미지 포맷: ${ext.toUpperCase()} (압축모드: ${compress ? 'ON (.png)' : 'OFF (.bmp/Raw)'})`);

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const startTime = Math.max(0, seg.peakSec - bufferSec);
        const endTime = Math.min(duration || 99999, seg.peakSec + bufferSec);

        const segDirName = `${i + 1}_${Math.floor(startTime)}_${Math.floor(endTime)}`;
        const segDir = path.join(outputBaseDir, segDirName);
        fs.mkdirSync(segDir, { recursive: true });

        log('info', `   ✂️ 추출 중: 구간 ${i + 1} (${startTime.toFixed(1)}s ~ ${endTime.toFixed(1)}s) -> ${segDirName}`);

        let segDuration = endTime - startTime;
        if (segDuration < (1.0 / fps)) {
            segDuration = 1.0 / fps; // 최소 1프레임 확보
        }
        // Output with %d.ext
        const cmd = `ffmpeg -y -ss ${startTime} -t ${segDuration} -i "${videoPath}" -vf "fps=${fps}" -frame_pts 1 "${path.join(segDir, `frame_%d.${ext}`)}"`;

        try {
            await execPromise(cmd);

            const files = fs.readdirSync(segDir).filter(f => f.startsWith('frame_'));
            let count = 0;
            for (const file of files) {
                const match = file.match(new RegExp(`frame_(\\d+)\\.${ext}`));
                if (match) {
                    const idx = parseInt(match[1]);
                    const timeOffset = (idx - 1) / fps;
                    const actualTime = startTime + timeOffset;
                    const newName = `${actualTime.toFixed(2)}.${ext}`;

                    fs.renameSync(path.join(segDir, file), path.join(segDir, newName));
                    count++;
                }
            }
            log('info', `      ✅저장 완료: ${count}장`);

        } catch (e) {
            log('error', `      ❌ 추출 실패: ${e.message}`);
        }
    }
}

async function processSingleVideo(videoId, params) {
    const { channel, fps, buffer, quality, recollectId, url, compress } = params;

    // 1. Heatmap
    const segments = await fetchAndSaveHeatmap(channel, videoId, url, recollectId);
    if (!segments || segments.length === 0) {
        log('info', `ℹ️ ${videoId}: 처리할 중요 구간 없음`);
        return;
    }

    log('info', `🔎 ${videoId}: ${segments.length}개의 피크 구간 발견`);

    // 2. Download
    const tempDir = path.join(getChannelDir(channel), 'temp_video');
    fs.mkdirSync(tempDir, { recursive: true });
    const videoPath = path.join(tempDir, `${videoId}.mp4`);

    let downloaded = false;
    if (fs.existsSync(videoPath)) {
        log('info', "♻️ 기존 비디오 사용");
        downloaded = true;
    } else {
        downloaded = await downloadVideo(videoId, videoPath, quality);
    }

    if (!downloaded) return;

    // 3. Extract
    const outputDir = getFramesOutputDir(channel, videoId, recollectId, quality, fps, compress);
    await extractFrames(videoPath, segments, outputDir, fps, buffer, compress);

    // 4. Cleanup
    try {
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        if (fs.readdirSync(tempDir).length === 0) fs.rmdirSync(tempDir);
    } catch (e) {
        log('warn', `파일 정리 실패: ${e.message}`);
    }
}

async function main() {
    const params = parseArgs();

    if (params.url) {
        const videoId = extractVideoId(params.url);
        if (!videoId) {
            log('error', '잘못된 URL입니다.');
            return;
        }

        log('info', `=== 단일 비디오 처리: ${videoId} (Recollect ID: ${params.recollectId}) (Mode: ${params.compress ? 'PNG' : 'BMP'}) ===`);

        if (params.channel === 'manual') {
            fs.mkdirSync(path.join(BASE_DATA_DIR, 'manual'), { recursive: true });
        }

        await processSingleVideo(videoId, params);

    } else if (params.channel !== 'manual') {
        log('warn', '채널 데모 모드 (기능 제한)');
    } else {
        log('info', '사용법: node 05-extract-frames.js --url <URL> ...');
    }
}

main().catch(e => console.error(e));
