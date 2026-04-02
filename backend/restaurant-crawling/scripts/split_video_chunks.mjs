/**
 * 비디오를 청크 계획에 따라 mp4 세그먼트로 분할
 *
 * 사용법:
 *   node split_video_chunks.mjs <video_path> <chunks_json> <output_dir>
 *
 * chunks_json: chunk_planner.py 출력 JSON 파일
 * output_dir: 세그먼트 mp4 파일이 저장될 디렉토리
 *
 * 출력: output_dir/chunk_0.mp4, chunk_1.mp4, ...
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import util from 'util';
import ffmpegStatic from 'ffmpeg-static';

const execFilePromise = util.promisify(execFile);

/** ffmpeg 실행 경로를 환경변수 → ffmpeg-static → 시스템 PATH 순으로 탐색 */
function resolveFfmpegPath() {
    const customFfmpeg = (process.env.FFMPEG_PATH || '').trim();
    const allowCustomFfmpeg = process.env.ALLOW_CUSTOM_FFMPEG === '1';
    const allowPathFfmpeg = process.env.ALLOW_PATH_FFMPEG === '1';

    if (allowCustomFfmpeg && customFfmpeg) {
        const resolved = path.resolve(customFfmpeg);
        if (fs.existsSync(resolved)) return resolved;
        console.warn(`[경고] ALLOW_CUSTOM_FFMPEG=1 이지만 경로가 유효하지 않음: ${resolved}`);
    }

    if (fs.existsSync(ffmpegStatic)) return ffmpegStatic;
    const exePath = ffmpegStatic + '.exe';
    if (fs.existsSync(exePath)) return exePath;

    if (allowPathFfmpeg) {
        console.warn('[경고] ALLOW_PATH_FFMPEG=1 설정으로 시스템 PATH의 ffmpeg를 사용합니다.');
        return 'ffmpeg';
    }

    throw new Error('안전한 ffmpeg 경로를 찾지 못함: ffmpeg-static 설치 또는 ALLOW_CUSTOM_FFMPEG=1 + FFMPEG_PATH 설정이 필요합니다.');
}
let ffmpegPath;
try {
    ffmpegPath = resolveFfmpegPath();
} catch (error) {
    console.error(`[오류] ${error.message}`);
    process.exit(1);
}
function detectWindowsExecutable(binPath) {
    if (!binPath) return false;
    if (binPath.toLowerCase().endsWith('.exe')) return true;

    try {
        const realPath = fs.realpathSync(binPath);
        if (realPath.toLowerCase().endsWith('.exe')) return true;
    } catch {
        // ignore: fallback to non-windows
    }

    return false;
}

const isWindowsExe = detectWindowsExecutable(ffmpegPath);
const MIN_TIMEOUT_MS = 15 * 60 * 1000; // 15분
const DELETE_RETRY_COUNT = 8;
const DELETE_RETRY_DELAY_MS = 500;

/** WSL 마운트 경로(/mnt/c/...)를 Windows 경로(C:/...)로 변환 */
function toWindowsPath(p) {
    if (!isWindowsExe) return p;
    const m = p.match(/^\/mnt\/([a-z])\/(.*)/);
    return m ? `${m[1].toUpperCase()}:/${m[2]}` : p;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function computeTimeoutMs(durationSec) {
    // 보수적으로 "영상 길이 * 2 + 120초"를 최소로 잡고, 하한은 15분.
    // (기존 180초 고정 타임아웃으로 장시간 인코딩이 중간 종료되는 문제 방지)
    const dynamicTimeout = (durationSec * 2000) + 120000;
    return Math.max(MIN_TIMEOUT_MS, dynamicTimeout);
}

async function removeFileBestEffort(filePath, retries = DELETE_RETRY_COUNT, delayMs = DELETE_RETRY_DELAY_MS) {
    if (!fs.existsSync(filePath)) return true;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            fs.rmSync(filePath, { force: true });
            return true;
        } catch (error) {
            const code = error?.code || 'UNKNOWN';
            const retryable = code === 'EACCES' || code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY';

            if (!retryable || attempt === retries) {
                console.warn(`[경고] 파일 정리 실패 (${code}): ${filePath}`);
                return false;
            }

            console.warn(`[경고] 파일 잠금 감지, 정리 재시도 ${attempt}/${retries}: ${filePath}`);
            await sleep(delayMs * attempt);
        }
    }

    return false;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.error('사용법: node split_video_chunks.mjs <video_path> <chunks_json> <output_dir>');
        process.exit(1);
    }

    const [videoPath, chunksJsonPath, outputDir] = args;

    if (!fs.existsSync(videoPath)) {
        console.error(`비디오 파일을 찾을 수 없음: ${videoPath}`);
        process.exit(1);
    }

    const chunks = JSON.parse(fs.readFileSync(chunksJsonPath, 'utf8'));
    if (!Array.isArray(chunks) || chunks.length === 0) {
        console.error('청크 계획이 비어있음');
        process.exit(1);
    }

    fs.mkdirSync(outputDir, { recursive: true });

    const ext = path.extname(videoPath).toLowerCase();
    const isMp4 = ext === '.mp4';

    console.log(`[분할] 총 ${chunks.length}개 청크, 소스: ${ext}, ${isMp4 ? '스트림 복사(빠름) 적용' : '재인코딩(ultrafast) 적용'}`);

    const CONCURRENCY_LIMIT = isMp4 ? 4 : 2; // 스트림 복사는 가볍게 병렬처리 4개, 재인코딩은 무거우므로 2개
    const executing = new Set();
    const results = [];

    const processChunk = async (chunk) => {
        const { chunk_index, start_sec, end_sec } = chunk;
        const duration = end_sec - start_sec;
        const outFile = path.join(outputDir, `chunk_${chunk_index}.mp4`);
        const tempOutFile = path.join(outputDir, `chunk_${chunk_index}.tmp.mp4`);

        if (fs.existsSync(outFile)) {
            console.log(`[건너뜀] chunk_${chunk_index}.mp4 이미 존재`);
            return;
        }

        await removeFileBestEffort(tempOutFile, 3, 200);

        const ffmpegArgs = isMp4 ? [
            '-y',
            '-ss', String(start_sec),
            '-t', String(duration),
            '-i', toWindowsPath(videoPath),
            '-c', 'copy',
            '-avoid_negative_ts', 'make_zero',
            toWindowsPath(tempOutFile),
        ] : [
            '-y',
            '-ss', String(start_sec),
            '-t', String(duration),
            '-i', toWindowsPath(videoPath),
            '-c:v', 'libx264',
            '-vf', 'scale=-2:360:force_original_aspect_ratio=decrease',
            '-r', '30',
            '-preset', 'ultrafast',
            '-crf', '28',
            '-c:a', 'aac',
            '-ac', '1',
            '-ar', '44100',
            '-b:a', '128k',
            '-movflags', '+faststart',
            toWindowsPath(tempOutFile),
        ];
        const timeoutMs = computeTimeoutMs(duration);

        try {
            console.log(`[분할] 청크 ${chunk_index} 시작: ${start_sec}초 ~ ${end_sec}초 (${duration}초)`);
            await execFilePromise(ffmpegPath, ffmpegArgs, { timeout: timeoutMs, maxBuffer: 100 * 1024 * 1024 });

            if (!fs.existsSync(tempOutFile)) {
                throw new Error(`임시 출력 파일이 생성되지 않음: ${tempOutFile}`);
            }

            fs.renameSync(tempOutFile, outFile);
            const stat = fs.statSync(outFile);
            console.log(`[완료] chunk_${chunk_index}.mp4 (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
        } catch (error) {
            console.error(`[오류] 청크 ${chunk_index}: ${error.message}`);
            await removeFileBestEffort(tempOutFile);
            throw error; // 에러 던져서 전체 프로세스 중단
        }
    };

    for (const chunk of chunks) {
        const p = Promise.resolve().then(() => processChunk(chunk));
        results.push(p);
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean).catch(clean);
        if (executing.size >= CONCURRENCY_LIMIT) {
            await Promise.race(executing);
        }
    }

    try {
        await Promise.all(results);
    } catch (err) {
        process.exit(1);
    }

    console.log(`[완료] ${outputDir}에 ${chunks.length}개 세그먼트 생성`);
}

main();
