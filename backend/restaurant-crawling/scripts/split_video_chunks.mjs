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
const isWindowsExe = ffmpegPath.endsWith('.exe');
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

    // 강제 재인코딩: Gemini API의 500 에러를 방지하기 위해 해상도를 최대 360p로 제한하고
    // 오디오를 Mono + 44.1kHz로 규격화합니다.
    const ext = path.extname(videoPath).toLowerCase();

    console.log(`[분할] 총 ${chunks.length}개 청크, 소스: ${ext}, 재인코딩 강제 적용`);

    for (const chunk of chunks) {
        const { chunk_index, start_sec, end_sec } = chunk;
        const duration = end_sec - start_sec;
        const outFile = path.join(outputDir, `chunk_${chunk_index}.mp4`);
        const tempOutFile = path.join(outputDir, `chunk_${chunk_index}.tmp.mp4`);

        if (fs.existsSync(outFile)) {
            console.log(`[건너뜀] chunk_${chunk_index}.mp4 이미 존재`);
            continue;
        }

        await removeFileBestEffort(tempOutFile, 3, 200);

        // 비디오: x264, 최대 360p (scale), 30fps 제한, Baseline profile (안정성 극대화)
        // 오디오: aac, mono (ac 1), 44.1kHz (ar 44100)
        const ffmpegArgs = [
            '-y',
            '-ss', String(start_sec),
            '-t', String(duration),
            '-i', toWindowsPath(videoPath),
            '-c:v', 'libx264',
            // NOTE: min(360,ih) 형태는 쉼표가 필터 구분자로 오인되어
            // 일부 ffmpeg 빌드에서 "No such filter: 'ih)'" 오류를 유발할 수 있음.
            // force_original_aspect_ratio=decrease로 동일 의도를 안전하게 표현.
            '-vf', 'scale=-2:360:force_original_aspect_ratio=decrease',
            '-r', '30',
            '-profile:v', 'baseline',
            '-level', '3.0',
            '-pix_fmt', 'yuv420p',
            '-preset', 'fast',
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
            console.log(`[분할] 청크 ${chunk_index}: ${start_sec}초 ~ ${end_sec}초 (${duration}초)`);
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
            process.exit(1);
        }
    }

    console.log(`[완료] ${outputDir}에 ${chunks.length}개 세그먼트 생성`);
}

main();
