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

/** 파일 처리 상태 폴링 간격 (밀리초) */
const POLL_INTERVAL_MS = 3000;
/** 최대 폴링 시도 횟수 */
const MAX_POLL_ATTEMPTS = 60;

/** 업로드된 파일이 ACTIVE 상태가 될 때까지 폴링 대기 */
async function waitForProcessing(ai, fileName) {
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
        const file = await ai.files.get({ name: fileName });
        if (file.state === 'ACTIVE') return file;
        if (file.state === 'FAILED') throw new Error(`파일 처리 실패: ${fileName}`);
        console.log(`  처리 중... (${i + 1}/${MAX_POLL_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`파일 처리 타임아웃: ${fileName}`);
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.error('사용법: node gemini_chunk_video_request.mjs <prompt_file> <output_file> <video_path>');
        process.exit(1);
    }

    const [promptFile, outputFile, videoPath] = args;
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
        console.error('오류: GEMINI_API_KEY 환경변수가 설정되지 않음');
        process.exit(1);
    }

    if (!fs.existsSync(videoPath)) {
        console.error(`비디오 파일을 찾을 수 없음: ${videoPath}`);
        process.exit(1);
    }

    const modelName = process.env.CURRENT_MODEL || 'gemini-3.1-flash-lite-preview';
    console.log(`[Gemini] 모델: ${modelName}, 비디오: ${path.basename(videoPath)}`);

    try {
        const promptText = fs.readFileSync(promptFile, 'utf8');
        const ai = new GoogleGenAI({ apiKey });

        console.log('[업로드] Gemini File API에 비디오 업로드 중...');
        const uploadResult = await ai.files.upload({
            file: videoPath,
            config: { mimeType: 'video/mp4' },
        });
        console.log(`[업로드] 완료: ${uploadResult.name}`);

        console.log('[대기] 비디오 처리 대기 중...');
        const processedFile = await waitForProcessing(ai, uploadResult.name);
        console.log(`[준비] 비디오 처리 완료: ${processedFile.uri}`);

        console.log('[생성] Gemini API 호출 중 (thinkingLevel: HIGH)...');
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
        if (!text) throw new Error('Gemini 응답이 비어있음');

        fs.writeFileSync(outputFile, text);
        console.log(`[완료] 응답 저장됨: ${outputFile}`);

        try {
            await ai.files.delete({ name: processedFile.name });
            console.log('[정리] 업로드된 파일 삭제 완료');
        } catch (e) {
            console.warn(`[경고] 파일 정리 실패: ${e.message}`);
        }
    } catch (error) {
        console.error(`[오류] ${error.message}`);
        process.exit(1);
    }
}

main();
