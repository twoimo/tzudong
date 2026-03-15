/**
 * Gemini File API를 사용한 청크 비디오 멀티모달 분석
 *
 * 사용법:
 *   node gemini_chunk_video_request.mjs <prompt_file> <output_file> <video_path>
 */

import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

/** 파일 처리 상태 폴링 간격 (밀리초) */
const POLL_INTERVAL_MS = 10000;
/** 최대 폴링 시도 횟수 (5분 대기) */
const MAX_POLL_ATTEMPTS = 30;
/** 전체 프로세스(업로드 포함) 최대 재시도 횟수 */
const MAX_PROCESS_RETRIES = 3;

/** API 호출 재시도 유틸리티 */
async function fetchWithRetry(fn, retries = 3, delayMs = 10000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === retries - 1) throw err;
            console.warn(`  [경고] API 호출 실패 (${err.message}). ${delayMs/1000}초 후 재시도... (${i+1}/${retries})`);
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
}

/** 업로드된 파일이 ACTIVE 상태가 될 때까지 폴링 대기 */
async function waitForProcessing(ai, fileName) {
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
        try {
            const file = await ai.files.get({ name: fileName });
            if (file.state === 'ACTIVE') return file;
            if (file.state === 'FAILED') throw new Error(`파일 처리 실패: ${fileName}`);
            console.log(`  처리 중... (${i + 1}/${MAX_POLL_ATTEMPTS})`);
        } catch (error) {
            // 500 에러 등 일시적 통신 오류는 무시하고 계속 폴링
            console.warn(`  [경고] 상태 확인 중 에러: ${error.message} (계속 대기)`);
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`파일 처리 타임아웃: ${fileName}`);
}

async function runSingleAttempt(ai, modelName, promptText, videoPath, outputFile) {
    let uploadedFile = null;
    try {
        console.log('[업로드] Gemini File API에 비디오 업로드 중...');
        uploadedFile = await fetchWithRetry(() => ai.files.upload({
            file: videoPath,
            config: { mimeType: 'video/mp4' },
        }), 2, 5000);
        console.log(`[업로드] 완료: ${uploadedFile.name}`);

        console.log('[대기] 비디오 처리 대기 중...');
        const processedFile = await waitForProcessing(ai, uploadedFile.name);
        console.log(`[준비] 비디오 처리 완료: ${processedFile.uri}`);

        console.log('[생성] Gemini API 호출 중 (thinkingLevel: HIGH)...');
        const response = await fetchWithRetry(() => ai.models.generateContent({
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
                thinkingConfig: { thinkingLevel: 'HIGH' },
            },
        }), 2, 10000);

        const text = response.text;
        if (!text) throw new Error('Gemini 응답이 비어있음');

        fs.writeFileSync(outputFile, text);
        console.log(`[완료] 응답 저장됨: ${outputFile}`);
        return true;
    } finally {
        if (uploadedFile) {
            try {
                await ai.files.delete({ name: uploadedFile.name });
                console.log('[정리] 업로드된 파일 삭제 완료');
            } catch (e) {
                console.warn(`[경고] 파일 정리 실패: ${e.message}`);
            }
        }
    }
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

    const promptText = fs.readFileSync(promptFile, 'utf8');
    const ai = new GoogleGenAI({ apiKey });

    for (let retry = 0; retry < MAX_PROCESS_RETRIES; retry++) {
        try {
            const success = await runSingleAttempt(ai, modelName, promptText, videoPath, outputFile);
            if (success) return;
        } catch (error) {
            console.error(`[시도 ${retry + 1}/${MAX_PROCESS_RETRIES}] 오류 발생: ${error.message}`);
            if (retry < MAX_PROCESS_RETRIES - 1) {
                const waitSec = 15;
                console.log(`  ${waitSec}초 후 재시도 시작 (파일 재업로드)...`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
            } else {
                console.error('모든 재시도 실패.');
                process.exit(1);
            }
        }
    }
}

main();
