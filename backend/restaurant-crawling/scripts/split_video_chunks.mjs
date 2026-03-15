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
import { exec } from 'child_process';
import util from 'util';
import ffmpegStatic from 'ffmpeg-static';

const execPromise = util.promisify(exec);

/** ffmpeg 실행 경로를 환경변수 → ffmpeg-static → 시스템 PATH 순으로 탐색 */
function resolveFfmpegPath() {
    if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
    if (fs.existsSync(ffmpegStatic)) return ffmpegStatic;
    const exePath = ffmpegStatic + '.exe';
    if (fs.existsSync(exePath)) return exePath;
    return 'ffmpeg';
}

const ffmpegPath = resolveFfmpegPath();
const isWindowsExe = ffmpegPath.endsWith('.exe');

/** WSL 마운트 경로(/mnt/c/...)를 Windows 경로(C:/...)로 변환 */
function toWindowsPath(p) {
    if (!isWindowsExe) return p;
    const m = p.match(/^\/mnt\/([a-z])\/(.*)/);
    return m ? `${m[1].toUpperCase()}:/${m[2]}` : p;
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

    // 강제 재인코딩: Gemini API의 500 에러를 방지하기 위해 해상도를 최대 720p로 제한하고 
    // 오디오를 Mono + 44.1kHz로 규격화합니다.
    const ext = path.extname(videoPath).toLowerCase();
    const needsReencode = true; // 무조건 재인코딩하여 스트림 오류 방지

    console.log(`[분할] 총 ${chunks.length}개 청크, 소스: ${ext}, 재인코딩 강제 적용`);

    for (const chunk of chunks) {
        const { chunk_index, start_sec, end_sec } = chunk;
        const duration = end_sec - start_sec;
        const outFile = path.join(outputDir, `chunk_${chunk_index}.mp4`);

        if (fs.existsSync(outFile)) {
            console.log(`[건너뜀] chunk_${chunk_index}.mp4 이미 존재`);
            continue;
        }

        // 비디오: x264, 최대 720p (scale), 30fps 제한, 빠른 처리(ultrafast)
        // 오디오: aac, mono (ac 1), 44.1kHz (ar 44100), 오디오 트랙이 깨진 경우 무시
        const codecArgs = '-c:v libx264 -vf "scale=-2:\'min(720,ih)\'" -r 30 -preset ultrafast -crf 28 -c:a aac -ac 1 -ar 44100 -b:a 96k -movflags +faststart';

        const cmd = `"${ffmpegPath}" -y -ss ${start_sec} -t ${duration} -i "${toWindowsPath(videoPath)}" ${codecArgs} "${toWindowsPath(outFile)}"`;

        try {
            console.log(`[분할] 청크 ${chunk_index}: ${start_sec}초 ~ ${end_sec}초 (${duration}초)`);
            await execPromise(cmd, { timeout: 180000 });
            const stat = fs.statSync(outFile);
            console.log(`[완료] chunk_${chunk_index}.mp4 (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
        } catch (error) {
            console.error(`[오류] 청크 ${chunk_index}: ${error.message}`);
            if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
            process.exit(1);
        }
    }

    console.log(`[완료] ${outputDir}에 ${chunks.length}개 세그먼트 생성`);
}

main();
