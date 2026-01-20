#!/usr/bin/env node
/**
 * Phase B: 멀티모달 데이터 수집기 (Storyboard Frame Extraction)
 * 전략:
 * 1. 히트맵 JSONL 읽기 -> 피크 타임스탬프 찾기
 * 2. 썸네일 다운로드 (Redundant -> Meta 수집기에서 이미 수행함, 여기서 제거)
 * 3. 스크린샷: YouTube Storyboard(Preview) API 활용
 *    - yt-dlp --dump-json 으로 storyboard spec 획득
 *    - 해당 타임스탬프의 스프라이트 이미지 URL 및 좌표 계산
 *    - ffmpeg crop 필터로 프레임 추출 (OCI IP 차단 우회)
 * 4. 자막: Transcript 매핑 (기존 유지)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import util from 'util';
import winston from 'winston';
import { config } from 'dotenv';

const execPromise = util.promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 설정 ---
const CHANNEL_NAME = process.argv.includes('--channel')
    ? process.argv[process.argv.indexOf('--channel') + 1]
    : 'tzuyang';

const BASE_DATA_DIR = path.resolve(__dirname, `../data/${CHANNEL_NAME}`);
const HEATMAP_DIR = path.join(BASE_DATA_DIR, 'heatmap');
const FRAMES_DIR = path.join(BASE_DATA_DIR, 'frames');
const TRANSCRIPT_DIR = path.join(BASE_DATA_DIR, 'transcript'); // 자막 디렉토리 (필요시)
const TEMP_DIR = path.join(BASE_DATA_DIR, 'temp_frames'); // 임시 다운로드 폴더

// .env 로드
const projectRoot = path.resolve(__dirname, '../../../');
const backendEnvLocal = path.join(projectRoot, 'backend', '.env.local');

if (fs.existsSync(backendEnvLocal)) {
    config({ path: backendEnvLocal });
} else {
    config();
}
const COOKIE_FILE = path.resolve(__dirname, '../data/cookies.txt');

// yt-dlp 절대 경로
const YT_DLP_CMD = '/home/ubuntu/.local/bin/yt-dlp';

// --- 로거 ---
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] [${level.toUpperCase()}] ${message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: path.join(__dirname, 'collect_multimodal.log') })
    ]
});

function log(level, msg) {
    logger.log(level, msg);
}

// 디렉토리 확인 및 생성
[FRAMES_DIR, TEMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- 헬퍼 함수 ---

// 1. 피크 타임스탬프 찾기 (legacy - kept for reference)
function findPeak(interactionData) {
    if (!interactionData || interactionData.length === 0) return null;
    let maxItem = interactionData[0];
    for (const item of interactionData) {
        if (item.intensityScoreNormalized > maxItem.intensityScoreNormalized) {
            maxItem = item;
        }
    }
    return parseFloat(maxItem.startMillis) / 1000.0;
}

/**
 * 고관심 구간 식별
 * @param {Array} interactionData - 히트맵 강도 데이터
 * @param {number} peakThreshold - 피크 식별 임계값 (기본값 0.4)
 * @param {number} boundaryThreshold - 구간 경계 확장 임계값 (기본값 0.2)
 * @returns {Array} 세그먼트 배열: { startSec, endSec, peakSec, peakIntensity }
 */
function findInterestSegments(interactionData, peakThreshold = 0.4, boundaryThreshold = 0.2) {
    if (!interactionData || interactionData.length === 0) return [];

    // 1. 임계값 이상의 모든 로컬 피크 찾기
    const peaks = [];
    for (let i = 1; i < interactionData.length - 1; i++) {
        const prev = interactionData[i - 1].intensityScoreNormalized;
        const curr = interactionData[i].intensityScoreNormalized;
        const next = interactionData[i + 1].intensityScoreNormalized;

        // 로컬 최대값이고 임계값 이상인 경우
        if (curr > prev && curr >= next && curr >= peakThreshold) {
            peaks.push({
                index: i,
                startMillis: parseFloat(interactionData[i].startMillis),
                intensity: curr
            });
        }
    }

    if (peaks.length === 0) return [];

    // 2. 각 피크를 확장하여 세그먼트 경계 찾기
    const segments = [];
    const usedIndices = new Set();

    for (const peak of peaks) {
        if (usedIndices.has(peak.index)) continue;

        let leftIdx = peak.index;
        let rightIdx = peak.index;

        // 왼쪽으로 확장
        while (leftIdx > 0) {
            const prevIntensity = interactionData[leftIdx - 1].intensityScoreNormalized;
            if (prevIntensity < boundaryThreshold) break;
            leftIdx--;
        }

        // 오른쪽으로 확장
        while (rightIdx < interactionData.length - 1) {
            const nextIntensity = interactionData[rightIdx + 1].intensityScoreNormalized;
            if (nextIntensity < boundaryThreshold) break;
            rightIdx++;
        }

        // 사용된 인덱스 표시
        for (let j = leftIdx; j <= rightIdx; j++) {
            usedIndices.add(j);
        }

        const startSec = parseFloat(interactionData[leftIdx].startMillis) / 1000.0;
        const endSec = (parseFloat(interactionData[rightIdx].startMillis) +
            parseFloat(interactionData[rightIdx].durationMillis || 0)) / 1000.0;
        const peakSec = peak.startMillis / 1000.0;

        segments.push({
            startSec: Math.floor(startSec),
            endSec: Math.ceil(endSec),
            peakSec,
            peakIntensity: peak.intensity
        });
    }

    // 피크 강도 기준 내림차순 정렬
    segments.sort((a, b) => b.peakIntensity - a.peakIntensity);

    return segments;
}

// 2. Storyboard Spec 가져오기 (yt-dlp)
async function getStoryboardSpec(videoId) {
    // 쿠키 파일 존재 확인
    if (!fs.existsSync(COOKIE_FILE)) {
        throw new Error(`쿠키 파일을 찾을 수 없음: ${COOKIE_FILE}`);
    }

    const cmd = `${YT_DLP_CMD} --cookies "${COOKIE_FILE}" --dump-json "https://www.youtube.com/watch?v=${videoId}"`;
    try {
        const { stdout } = await execPromise(cmd, { maxBuffer: 1024 * 1024 * 10 }); // 10MB buffer
        const data = JSON.parse(stdout);

        // formats 또는 thumbnails 안에 storyboards 정보가 있는지 확인 (yt-dlp 버전에 따라 다름)
        // 보통 'formats' array 안에 note='storyboard' 인 항목이 있거나 root 레벨에 있을 수 있음.
        // 하지만 --dump-json의 root 객체에 'storyboards' 필드가 있는 것이 일반적 (최신 yt-dlp)
        // 예: "formats": [ ... ], "storyboards": [ { ... } ]

        // 만약 root에 없으면 _format_sort_fields 등 복잡한 곳에 숨어있을 수 있으나, 
        // 최신 yt-dlp는 root에 'storyboards'를 제공함.

        if (!data.formats) return null;

        // data.formats 안에서 찾는 것이 더 안전할 수도 있으나, 
        // 일반적으로 storyboards 필드가 별도로 존재함. 
        // yt-dlp output example check 필요. 
        // 여기서는 yt-dlp JSON output 구조에 의존.
        // 일반적으로 formats 내부에 sb0, sb1, sb2... id로 존재.

        const sbFormats = data.formats.filter(f => f.format_id && f.format_id.startsWith('sb'));

        if (sbFormats.length === 0) return null;

        // 우선순위: L2 (M) -> L1 (L) -> L3 (H)
        // 보통 sb2가 L2(160x90)인 경우가 많음 (확실하지 않음, 해상도 보고 판단)

        // 우선순위: L2 (M) -> L1 (L) -> L3 (H)
        // 고해상도 우선 선택: 최대 너비 기준 정렬
        sbFormats.sort((a, b) => (b.width || 0) - (a.width || 0));
        let selected = sbFormats[0];

        return selected; // rows, columns, fragments 포함된 전체 객체 반환

    } catch (e) {
        // Warning: yt-dlp 실패 시 (쿠키 이슈 등)
        log('warn', `비디오 정보 가져오기 실패 ${videoId}: ${e.message}`);
        return null;
    }
}


// 3. 자막 가져오기 (기존 로직 유지)
function getTranscriptAt(videoId, timestamp) {
    const filePath = path.join(TRANSCRIPT_DIR, `${videoId}.jsonl`);
    if (!fs.existsSync(filePath)) return null;

    try {
        const content = fs.readFileSync(filePath, 'utf-8').trim().split('\n').pop();
        if (!content) return null;

        const data = JSON.parse(content);
        if (!data.transcript || !Array.isArray(data.transcript)) return null;

        const segment = data.transcript.find(s => {
            const start = parseFloat(s.start);
            const end = start + parseFloat(s.duration);
            return timestamp >= start && timestamp <= end;
        });

        if (segment) return segment.text;

        const closest = data.transcript.reduce((prev, curr) => {
            const currStart = parseFloat(curr.start);
            const prevStart = parseFloat(prev.start);
            return (Math.abs(currStart - timestamp) < Math.abs(prevStart - timestamp) ? curr : prev);
        });

        if (Math.abs(parseFloat(closest.start) - timestamp) < 5.0) {
            return closest.text;
        }

        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Storyboard URL 템플릿에서 실제 URL 생성 (Fallback)
 */
function getSheetUrl(templateUrl, sheetIndex) {
    // URL에 $M 또는 $N이 포함된 경우 치환
    // 특정 파일(M0.jpg 등)인 경우 더 스마트하게 처리 필요
    // 일반적인 패턴에 대한 단순 regex 치환
    if (templateUrl.includes('$M')) {
        return templateUrl.replace('$M', sheetIndex.toString());
    }
    // M0을 M{index}로 치환 시도
    if (templateUrl.match(/\/M\d+\.jpg/)) {
        return templateUrl.replace(/\/M\d+\.jpg/, `/M${sheetIndex}.jpg`);
    }
    return templateUrl;
}

// 4. 프레임 다운로드 및 크롭 (핵심 로직)
// outputPath: 제공되면 해당 경로 사용, 아니면 기본 경로 사용
async function downloadFrameFromStoryboard(videoId, timestamp, sbSpec, outputPath = null) {
    const outputFramePath = outputPath || path.join(FRAMES_DIR, `${videoId}.jpg`);
    if (fs.existsSync(outputFramePath)) return 'skipped';

    if (!sbSpec) return 'failed';

    const { rows, columns, width: frameWidth, height: frameHeight } = sbSpec;

    if (!rows || !columns || !frameWidth || !frameHeight) {
        log('warn', `Invalid storyboard spec for ${videoId}: Missing dims`);
        return 'failed';
    }

    // FPS 추정:
    // sbSpec.fragments가 있으면 프래그먼트 duration을 사용하여 타임스탬프와 시트/프레임 매핑 가능
    // 일반적으로 fragment에는 'duration' 필드가 있음

    let sheetIndex = 0;
    let frameInSheet = 0;
    let frameIndexGlobal = 0;

    // 타임스탬프 기반 전역 프레임 인덱스 계산
    // 대략 1fps로 가정하거나 특정 duration 사용
    // YouTube 스토리보드는 일반적으로 N초당 1프레임
    // L2는 보통 1~2초당 1프레임
    // 프래그먼트에서 추론 필요

    // 총 프레임 수 계산?
    // 가능하면 시트당 균일한 duration 가정 또는 프래그먼트 반복

    /* 
       프래그먼트 방식:
       각 프래그먼트는 'duration' 초를 커버함.
       각 프래그먼트는 (rows * columns) 프레임 포함.
       실제로 보통 하나의 프래그먼트 = 하나의 시트.
       따라서 해당 타임스탬프를 포함하는 프래그먼트를 찾음.
    */

    let sheetUrl = '';

    if (sbSpec.fragments && sbSpec.fragments.length > 0) {
        let accumulatedTime = 0;
        let foundSheet = false;

        for (let i = 0; i < sbSpec.fragments.length; i++) {
            const frag = sbSpec.fragments[i];
            const duration = frag.duration || 0; // seconds

            // 이 시트가 해당 타임스탬프를 포함하는가?
            if (timestamp < accumulatedTime + duration) {
                // 네
                sheetIndex = i;
                sheetUrl = frag.url;

                // 이 시트 내 프레임 위치 계산
                // 시트 내 프레임 수? rows * columns (최대).
                // 마지막 시트는 더 적을 수 있음.
                // 시트 duration 내에서 프레임이 균일하게 분포되어 있다고 가정.
                // 시트 내 시간 = timestamp - accumulatedTime
                // 프레임 인덱스 = floor( (시트 내 시간 / Duration) * 시트 내 프레임 수 )
                // 참고: YouTube SB 프레임은 이산적 포인트.
                // 보통 X초마다 1프레임.
                // fps 스펙 = 초당 프레임 수.
                // frameIndexInSheet = Math.floor((timestamp - accumulatedTime) * sbSpec.fps)

                const timeInSheet = timestamp - accumulatedTime;

                // fps가 있고 0보다 크면 사용
                if (sbSpec.fps && sbSpec.fps > 0) {
                    frameInSheet = Math.floor(timeInSheet * sbSpec.fps);
                } else {
                    // Fallback: 시트 duration 내에서 프레임이 균등하게 분포되어 있다고 가정
                    const framesInSheet = rows * columns;
                    // 시트가 꼽 차지 않으면 문제가 될 수 있으나 중간 시트는 꼽 차 있다고 가정
                    frameInSheet = Math.floor((timeInSheet / duration) * framesInSheet);
                }

                foundSheet = true;
                break;
            }
            accumulatedTime += duration;
        }

        if (!foundSheet) {
            // 타임스탬프가 범위 밖 (스토리보드보다 까?), 마지막 시트 사용
            sheetIndex = sbSpec.fragments.length - 1;
            sheetUrl = sbSpec.fragments[sheetIndex].url;
            frameInSheet = (rows * columns) - 1; // 마지막 프레임
        }

    } else {
        // 프래그먼트 없음, 템플릿 URL과 단순 계산 사용 (1fps 또는 총 duration 기반 가정)
        // duration 정보 없이는 어려움. 1프레임/초로 Fallback?
        // sbSpec.fps가 있을 수 있음.
        const fps = sbSpec.fps || 1; // 기본값 1
        frameIndexGlobal = Math.floor(timestamp * fps);
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

    // frameInSheet를 최대 프레임 수로 제한
    if (frameInSheet >= rows * columns) frameInSheet = (rows * columns) - 1;

    const colIdx = frameInSheet % columns;
    const rowIdx = Math.floor(frameInSheet / columns);

    const x = colIdx * frameWidth;
    const y = rowIdx * frameHeight;

    // 시트 다운로드
    // YouTube Storyboard는 URL이 .jpg로 끝나도 WebP를 반환하는 경우가 많음.
    // .webp로 저장하면 ffmpeg가 포맷을 정확히 감지함.
    const tempSheetPath = path.join(TEMP_DIR, `${videoId}_sheet_${sheetIndex}.webp`);

    // 403/HTML 응답 방지를 위한 User-Agent 필수
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    try {
        // 1. 시트 다운로드
        if (!fs.existsSync(tempSheetPath)) {
            // curl (리다이렉트 따름 -L, 사일런트 -s, User-Agent -A, 쿠키 -b, Referer -e)
            // sigh 파라미터 내 $의 셸 확장 방지를 위해 URL에 단일 따옴표 사용
            await execPromise(`curl -L -s -A "${UA}" -b "${COOKIE_FILE}" -e "https://www.youtube.com/" '${sheetUrl}' -o "${tempSheetPath}"`);
        }

        // 2. 크롭
        const cropCmd = `ffmpeg -y -v error -i "${tempSheetPath}" -vf "crop=${frameWidth}:${frameHeight}:${x}:${y}" -frames:v 1 "${outputFramePath}"`;
        await execPromise(cropCmd);

        // 시트 파일 정리
        if (fs.existsSync(tempSheetPath)) fs.unlinkSync(tempSheetPath);

        return 'success';
    } catch (e) {
        log('error', `프레임 추출 실패 ${videoId}: ${e.message}`);
        return 'failed';
    }
}

// --- 메인 루프 ---

async function main() {
    log('info', `=== 멀티모달 수집기 시작 [채널: ${CHANNEL_NAME}] ===`);

    if (!fs.existsSync(HEATMAP_DIR)) {
        log('warn', '히트맵 디렉토리가 존재하지 않습니다.');
        return;
    }

    const files = fs.readdirSync(HEATMAP_DIR).filter(f => f.endsWith('.jsonl'));
    log('info', `히트맵 파일 ${files.length}개 발견.`);

    // 0. 삭제된 ID 로드
    const deletedPath = path.join(BASE_DATA_DIR, 'deleted_urls.txt');
    const deletedIds = new Set();
    if (fs.existsSync(deletedPath)) {
        const lines = fs.readFileSync(deletedPath, 'utf8').split('\n');
        for (const line of lines) {
            const parts = line.split('\t');
            if (parts[0]) {
                const vid = parts[0].includes('v=') ? parts[0].split('v=')[1].split('&')[0] : null;
                if (vid) deletedIds.add(vid);
            }
        }
    }

    // 통계용
    let processedCount = 0;
    let sboardFailCount = 0;

    for (const file of files) {
        const videoId = file.replace('.jsonl', '');

        if (deletedIds.has(videoId)) continue;

        // 이미 프레임이 있으면 스킵
        const outputFramePath = path.join(FRAMES_DIR, `${videoId}.jpg`);
        if (fs.existsSync(outputFramePath)) {
            continue;
        }

        const filePath = path.join(HEATMAP_DIR, file);

        try {
            const content = fs.readFileSync(filePath, 'utf-8').trim().split('\n').pop();
            if (!content) continue;
            const data = JSON.parse(content);

            if (data.status !== 'success' || !data.interaction_data) continue;

            // Shorts Filter
            if (data.interaction_data.length > 0) {
                const lastPoint = data.interaction_data[data.interaction_data.length - 1];
                if (lastPoint.startMillis < 120000) {
                    continue; // 2분 미만 스킵
                }
            }

            // 1. 고관심 구간 찾기 (새 알고리즘)
            const segments = findInterestSegments(data.interaction_data);
            if (segments.length === 0) {
                log('info', `[${videoId}] 관심 구간이 발견되지 않음.`);
                continue;
            }

            const recollectId = data.recollect_id !== undefined ? data.recollect_id : 0;
            log('info', `[${videoId}] ${segments.length}개 구간 발견 (recollect_id: ${recollectId})`);

            // 2. 스토리보드 다운로더
            const sbSpec = await getStoryboardSpec(videoId);
            if (!sbSpec) {
                log('warn', `  스토리보드를 찾을 수 없음: ${videoId}`);
                sboardFailCount++;
                continue;
            }

            // 3. 각 세그먼트 순회하며 프레임 추출
            let totalSaved = 0;

            for (let segIdx = 0; segIdx < segments.length; segIdx++) {
                const seg = segments[segIdx];
                const segmentDirName = `${segIdx + 1}_${seg.startSec}_${seg.endSec}`;
                const segmentDir = path.join(FRAMES_DIR, videoId, String(recollectId), segmentDirName);

                // 이미 해당 세그먼트 폴더가 있으면 스킵
                if (fs.existsSync(segmentDir)) {
                    log('info', `  세그먼트 ${segIdx + 1} 이미 존재, 스킵.`);
                    continue;
                }

                // 세그먼트 폴더 생성
                fs.mkdirSync(segmentDir, { recursive: true });

                // 1초 간격으로 프레임 추출
                let segSavedCount = 0;
                for (let ts = seg.startSec; ts <= seg.endSec; ts++) {
                    const frameFilePath = path.join(segmentDir, `${ts}.jpg`);
                    const res = await downloadFrameFromStoryboard(videoId, ts, sbSpec, frameFilePath);
                    if (res === 'success') segSavedCount++;
                }

                if (segSavedCount > 0) {
                    log('info', `  세그먼트 ${segIdx + 1} (${seg.startSec}s-${seg.endSec}s): ${segSavedCount}개 프레임 저장.`);
                    totalSaved += segSavedCount;
                }
            }

            if (totalSaved > 0) {
                processedCount++;
            }

            // 3. 자막 (Optional: 로그만 남김)
            // const spokenText = getTranscriptAt(videoId, peakTime);
            // if (spokenText) log('info', `  Transcript: "${spokenText}"`);

            // 딜레이
            const delay = Math.random() * 1000 + 500;
            await new Promise(r => setTimeout(r, delay));

        } catch (e) {
            log('error', `처리 실패 ${videoId}: ${e.message}`);
        }
    }

    // Temp 정리
    if (fs.existsSync(TEMP_DIR)) {
        // fs.rmdirSync(TEMP_DIR, { recursive: true }); // 디버깅 위해 남겨둘 수도 있음
    }

    log('info', `=== 완료. 처리됨: ${processedCount}, SB 실패: ${sboardFailCount} ===`);
}

main();


