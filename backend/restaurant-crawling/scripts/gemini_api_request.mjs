import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * 히트맵 프레임 디렉토리 구조를 재귀 탐색하여 이미지 파일 목록을 수집
 * 구조: {videoId}/{recollectId}/{segIdx}/{ext}/{quality_fps}/frame_*.jpg
 * @param {string} rootDir - 프레임 루트 디렉토리
 * @param {number} maxFrames - 최대 수집 프레임 수
 * @returns {{ filePath: string, segIndex: string }[]} - 세그먼트 정보 포함 이미지 경로 배열
 */
function collectFramesRecursive(rootDir, maxFrames = 50) {
    const imageFiles = [];

    function walk(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (imageFiles.length >= maxFrames) return; // 상한 도달 시 즉시 중단
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (/\.(jpg|jpeg|png|webp)$/i.test(entry.name)) {
                imageFiles.push(fullPath);
            }
        }
    }

    walk(rootDir);

    // 경로 기반 정렬 (세그먼트 순서 → 프레임 순서 자연 보존)
    imageFiles.sort();

    // 프레임이 maxFrames보다 많으면 균등 샘플링 (앞뒤 + 중간 고르게 뽑기)
    if (imageFiles.length > maxFrames) {
        const sampled = [];
        const step = imageFiles.length / maxFrames;
        for (let i = 0; i < maxFrames; i++) {
            sampled.push(imageFiles[Math.floor(i * step)]);
        }
        return sampled;
    }

    return imageFiles;
}

async function main() {
    console.log("DEBUG: JS Script Started (Multimodal Heatmap Frame Mode)");
    const args = process.argv.slice(2);
    // Usage: node gemini_api_request.mjs <prompt_file> <output_file> [frames_dir]
    if (args.length < 2) {
        console.error('Usage: node gemini_api_request.mjs <prompt_file> <output_file> [frames_dir]');
        process.exit(1);
    }

    const promptFile = args[0];
    const outputFile = args[1];
    const framesDir = args[2] || ""; // 세 번째 인자: 히트맵 프레임 폴더 (옵션)
    
    console.log(`DEBUG: PromptFile=${promptFile}, OutputFile=${outputFile}, FramesDir=${framesDir}`);
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
        console.error('Error: GEMINI_API_KEY environment variable not set.');
        process.exit(1);
    }

    try {
        console.log("DEBUG: Reading prompt file...");
        const promptText = fs.readFileSync(promptFile, 'utf8');
        console.log(`DEBUG: Prompt Size=${promptText.length}`);

        // 프롬프트 및 멀티모달(이미지) 데이터를 담을 배열
        const promptParts = [ promptText ];

        // 히트맵 프레임 폴더가 제공되었고, 실제로 존재할 경우 이미지를 재귀 수집
        if (framesDir && fs.existsSync(framesDir)) {
            console.log(`DEBUG: Recursively scanning heatmap frames in ${framesDir}...`);

            const MAX_FRAMES = 50; // API Payload 크기 제한 (Base64 인코딩 시 ~20MB 이내 권장)
            const imageFiles = collectFramesRecursive(framesDir, MAX_FRAMES);

            console.log(`DEBUG: Collected ${imageFiles.length} frames (max ${MAX_FRAMES}).`);

            // 프레임 이미지 → Base64 InlineData 변환
            for (const filePath of imageFiles) {
                const imageData = fs.readFileSync(filePath);
                const ext = path.extname(filePath).toLowerCase();
                const mimeType = ext === '.png' ? 'image/png'
                               : ext === '.webp' ? 'image/webp'
                               : 'image/jpeg'; // jpg, jpeg 기본값

                promptParts.push({
                    inlineData: {
                        data: imageData.toString("base64"),
                        mimeType
                    }
                });
            }

            console.log(`DEBUG: Appended ${imageFiles.length} frames to prompt payload.`);
        } else if (framesDir) {
            console.log(`DEBUG: Frames directory not found: ${framesDir} (text-only mode)`);
        }

        console.log("DEBUG: Initializing GoogleGenerativeAI...");
        const genAI = new GoogleGenerativeAI(apiKey);
        
        // 환경변수 CURRENT_MODEL 우선, 없으면 기본 모델 사용
        const modelName = process.env.CURRENT_MODEL || 'gemini-3.1-flash-lite-preview'; 
        console.log(`DEBUG: Getting Model=${modelName}...`);
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
                thinkingConfig: { thinkingLevel: "HIGH" }
            }
        });

        console.log("DEBUG: Calling generateContent...");
        
        // 텍스트 프롬프트 + Base64 이미지 배열을 함께 전송 (멀티모달)
        const result = await model.generateContent(promptParts);
        
        console.log("DEBUG: Content Generated. Getting response...");
        const response = await result.response;
        const text = response.text();
        console.log("DEBUG: Got text. Writing output...");

        fs.writeFileSync(outputFile, text);
        console.log("DEBUG: Done.");
        process.exit(0);

    } catch (error) {
        console.error(`Gemini API Error: ${error.message}`);
        process.exit(1);
    }
}

main();
