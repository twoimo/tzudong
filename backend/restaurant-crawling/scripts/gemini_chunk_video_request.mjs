/**
 * Gemini File API를 사용한 청크 비디오 멀티모달 분석
 *
 * 사용법:
 *   node gemini_chunk_video_request.mjs <prompt_file> <output_file> <video_path>
 *
 * 비디오를 Gemini File API로 업로드한 뒤, 프롬프트 + 비디오를 함께 분석 요청합니다.
 * thinkingLevel: HIGH로 설정하여 최대 추론 깊이를 활성화합니다.
 */

import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60;

async function waitForProcessing(ai, fileName) {
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
        const file = await ai.files.get({ name: fileName });
        if (file.state === 'ACTIVE') return file;
        if (file.state === 'FAILED') throw new Error(`File processing failed: ${fileName}`);
        console.log(`  Processing... (${i + 1}/${MAX_POLL_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`File processing timeout: ${fileName}`);
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.error('Usage: node gemini_chunk_video_request.mjs <prompt_file> <output_file> <video_path>');
        process.exit(1);
    }

    const [promptFile, outputFile, videoPath] = args;
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
        console.error('Error: GEMINI_API_KEY not set');
        process.exit(1);
    }

    if (!fs.existsSync(videoPath)) {
        console.error(`Video not found: ${videoPath}`);
        process.exit(1);
    }

    const modelName = process.env.CURRENT_MODEL || 'gemini-3.1-flash-lite-preview';
    console.log(`[Gemini] Model: ${modelName}, Video: ${path.basename(videoPath)}`);

    try {
        const promptText = fs.readFileSync(promptFile, 'utf8');
        const ai = new GoogleGenAI({ apiKey });

        console.log('[Upload] Uploading video to Gemini File API...');
        const uploadResult = await ai.files.upload({
            file: videoPath,
            config: { mimeType: 'video/mp4' },
        });
        console.log(`[Upload] Done: ${uploadResult.name}`);

        console.log('[Wait] Waiting for video processing...');
        const processedFile = await waitForProcessing(ai, uploadResult.name);
        console.log(`[Ready] Video processed: ${processedFile.uri}`);

        console.log('[Generate] Calling Gemini API with thinkingLevel: HIGH...');
        const response = await ai.models.generateContent({
            model: modelName,
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: promptText },
                        {
                            fileData: {
                                fileUri: processedFile.uri,
                                mimeType: processedFile.mimeType,
                            },
                        },
                    ],
                },
            ],
            config: {
                thinkingConfig: {
                    thinkingLevel: 'HIGH',
                },
            },
        });

        const text = response.text;
        if (!text) throw new Error('Empty response from Gemini');

        fs.writeFileSync(outputFile, text);
        console.log(`[OK] Response saved: ${outputFile}`);

        try {
            await ai.files.delete({ name: processedFile.name });
            console.log('[Cleanup] Uploaded file deleted');
        } catch (e) {
            console.warn(`[Warn] File cleanup failed: ${e.message}`);
        }

        process.exit(0);
    } catch (error) {
        console.error(`[ERROR] ${error.message}`);
        process.exit(1);
    }
}

main();
