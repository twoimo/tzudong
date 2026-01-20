#!/usr/bin/env node
/**
 * Phase B: 멀티모달 데이터 수집기 (yt-dlp download-sections)
 * 전략:
 * 1. 히트맵 JSONL 읽기 -> 피크 타임스탬프 찾기
 * 2. 썸네일 다운로드 (yt-dlp --write-thumbnail)
 * 3. 스크린샷: 1초 영상 구간 다운로드 -> ffmpeg 프레임 추출
 * 4. 자막: 오디오 다운로드 없이 transcript/*.jsonl 파일에서 피크 시간대 텍스트 매핑
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
const THUMB_DIR = path.join(BASE_DATA_DIR, 'thumbnails');
const FRAMES_DIR = path.join(BASE_DATA_DIR, 'frames');
const TRANSCRIPT_DIR = path.join(BASE_DATA_DIR, 'transcript');
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
[THUMB_DIR, FRAMES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- 헬퍼 함수 ---

async function downloadThumbnail(videoId) {
    const outputTemplate = path.join(THUMB_DIR, `${videoId}.%(ext)s`);
    const extensions = ['jpg', 'webp', 'png'];
    if (extensions.some(ext => fs.existsSync(path.join(THUMB_DIR, `${videoId}.${ext}`)))) {
        return 'skipped';
    }

    const cmd = `${YT_DLP_CMD} --write-thumbnail --skip-download --convert-thumbnails jpg --cookies "${COOKIE_FILE}" -o "${outputTemplate}" "https://www.youtube.com/watch?v=${videoId}"`;
    try {
        await execPromise(cmd);
        return 'success';
    } catch (e) {
        log('error', `Thumbnail failed for ${videoId}: ${e.message}`);
        return 'failed';
    }
}

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

function getTranscriptAt(videoId, timestamp) {
    const filePath = path.join(TRANSCRIPT_DIR, `${videoId}.jsonl`);
    if (!fs.existsSync(filePath)) return null;

    try {
        const content = fs.readFileSync(filePath, 'utf-8').trim().split('\n').pop();
        if (!content) return null;

        const data = JSON.parse(content);
        if (!data.transcript || !Array.isArray(data.transcript)) return null;

        // 타임스탬프가 포함된 세그먼트 찾기
        // Segment: { text, start, duration, lang }
        // 자막 start/duration은 보통 초 단위(float)입니다.

        const segment = data.transcript.find(s => {
            const start = parseFloat(s.start);
            const end = start + parseFloat(s.duration);
            return timestamp >= start && timestamp <= end;
        });

        if (segment) return segment.text;

        // 정확한 매칭이 없으면 가장 가까운 것 찾기 (5초 이내)
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

// --- 메인 루프 ---

async function main() {
    log('info', `=== Multimodal Collector Started [Channel: ${CHANNEL_NAME}] ===`);

    // 히트맵 디렉토리 확인
    if (!fs.existsSync(HEATMAP_DIR)) {
        log('warn', 'Heatmap directory does not exist.');
        return;
    }

    const files = fs.readdirSync(HEATMAP_DIR).filter(f => f.endsWith('.jsonl'));
    log('info', `Found ${files.length} heatmap files.`);

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

    for (const file of files) {
        const videoId = file.replace('.jsonl', '');

        // 삭제된 영상 스킵
        if (deletedIds.has(videoId)) {
            // log('info', `[Skip] Deleted video: ${videoId}`);
            continue;
        }

        const filePath = path.join(HEATMAP_DIR, file);

        try {
            const content = fs.readFileSync(filePath, 'utf-8').trim().split('\n').pop();
            if (!content) continue;
            const data = JSON.parse(content);

            if (data.status !== 'success' || !data.interaction_data) continue;

            // [Shorts Filter] (Phase 2 Check)
            if (data.interaction_data.length > 0) {
                const lastPoint = data.interaction_data[data.interaction_data.length - 1];
                if (lastPoint.startMillis < 120000) {
                    log('info', `[Skip] Shorts detected (<120s). ID: ${videoId}`);
                    continue;
                }
            }

            // 1. 피크 구간 찾기
            const peakTime = findPeak(data.interaction_data);
            if (peakTime === null) {
                log('warn', `No peak found for ${videoId}`);
                continue;
            }

            log('info', `[${videoId}] Processing (Peak: ${peakTime.toFixed(1)}s)...`);

            // 2. 자막 매핑 (Transcript Lookup)
            const spokenText = getTranscriptAt(videoId, peakTime);
            if (spokenText) {
                log('info', `  Transcript at Peak: "${spokenText}"`);
            } else {
                log('warn', `  No matching transcript found around peak.`);
            }

            // 3. 썸네일 다운로드
            const thumbRes = await downloadThumbnail(videoId);
            if (thumbRes === 'success') log('info', `  Thumbnail downloaded`);

            // 루프 딜레이 (부하 분산)
            const delay = Math.random() * 3000 + 2000;
            await new Promise(r => setTimeout(r, delay));

        } catch (e) {
            log('error', `Failed processing ${videoId}: ${e.message}`);
        }
    }

    log('info', '=== Multimodal Collection Complete ===');
}

main();
