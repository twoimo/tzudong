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
const ffmpegPath = ffmpegStatic;

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.error('Usage: node split_video_chunks.mjs <video_path> <chunks_json> <output_dir>');
        process.exit(1);
    }

    const videoPath = args[0];
    const chunksJsonPath = args[1];
    const outputDir = args[2];

    if (!fs.existsSync(videoPath)) {
        console.error(`Video not found: ${videoPath}`);
        process.exit(1);
    }

    const chunks = JSON.parse(fs.readFileSync(chunksJsonPath, 'utf8'));
    if (!Array.isArray(chunks) || chunks.length === 0) {
        console.error('No chunks in plan');
        process.exit(1);
    }

    fs.mkdirSync(outputDir, { recursive: true });

    const ext = path.extname(videoPath).toLowerCase();
    const needsReencode = ext !== '.mp4';

    console.log(`[Split] ${chunks.length} chunks, source: ${ext}, reencode: ${needsReencode}`);

    for (const chunk of chunks) {
        const { chunk_index, start_sec, end_sec } = chunk;
        const duration = end_sec - start_sec;
        const outFile = path.join(outputDir, `chunk_${chunk_index}.mp4`);

        if (fs.existsSync(outFile)) {
            console.log(`[Skip] chunk_${chunk_index}.mp4 already exists`);
            continue;
        }

        const codecArgs = needsReencode
            ? '-c:v libx264 -c:a aac -preset ultrafast -crf 28'
            : '-c copy';

        const cmd = `"${ffmpegPath}" -y -ss ${start_sec} -t ${duration} -i "${videoPath}" ${codecArgs} "${outFile}"`;

        try {
            console.log(`[Split] chunk ${chunk_index}: ${start_sec}s ~ ${end_sec}s (${duration}s)`);
            await execPromise(cmd, { timeout: 120000 });
            const stat = fs.statSync(outFile);
            console.log(`[OK] chunk_${chunk_index}.mp4 (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
        } catch (error) {
            console.error(`[ERROR] chunk ${chunk_index}: ${error.message}`);
            if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
            process.exit(1);
        }
    }

    console.log(`[Done] ${chunks.length} segments created in ${outputDir}`);
}

main();
