/**
 * Gemini File API를 사용한 청크 비디오 멀티모달 분석
 * (표준 SDK @google/generative-ai 사용 버전)
 */

import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';

/** 파일 처리 상태 폴링 간격 (밀리초) */
const POLL_INTERVAL_MS = 15000;
/** 최대 폴링 시도 횟수 (약 10분 대기) */
const MAX_POLL_ATTEMPTS = 40;
/** 전체 프로세스(업로드 포함) 최대 재시도 횟수 */
const MAX_PROCESS_RETRIES = 3;

/** 업로드된 파일이 ACTIVE 상태가 될 때까지 폴링 대기 */
async function waitForProcessing(fileManager, fileName) {
    // [GitHub Action 최적화] 업로드 직후 바로 상태를 찌르지 않고 잠시 대기하여 500 에러 방지
    console.log('  [대기] 서버 파싱을 위해 20초간 초기 대기...');
    await new Promise(r => setTimeout(r, 20000));

    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
        try {
            const file = await fileManager.getFile(fileName);
            if (file.state === FileState.ACTIVE) return file;
            if (file.state === FileState.FAILED) throw new Error(`파일 처리 실패: ${fileName}`);
            console.log(`  처리 중... (${i + 1}/${MAX_POLL_ATTEMPTS}) - 상태: ${file.state}`);
        } catch (error) {
            // 구글 서버가 비정상 응답(HTML 등)을 보낼 경우 catch됨
            console.warn(`  [경고] 상태 확인 중 통신 에러 (재시도 예정): ${error.message}`);
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`파일 처리 타임아웃: ${fileName}`);
}

async function runSingleAttempt(apiKey, modelName, promptText, videoPath, outputFile) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const fileManager = new GoogleAIFileManager(apiKey);
    let uploadedFile = null;

    try {
        const timestamp = Date.now();
        const displayName = `${path.basename(videoPath)}-${timestamp}`;
        
        console.log(`[업로드] Gemini File API에 비디오 업로드 중 (${displayName})...`);
        uploadedFile = await fileManager.uploadFile(videoPath, {
            mimeType: 'video/mp4',
            displayName: displayName,
        });
        console.log(`[업로드] 완료: ${uploadedFile.file.name}`);

        console.log('[대기] 비디오 처리 상태 확인 중...');
        const processedFile = await waitForProcessing(fileManager, uploadedFile.file.name);
        console.log(`[준비] 비디오 처리 완료: ${processedFile.uri}`);

        console.log(`[생성] Gemini API 호출 중 (모델: ${modelName})...`);
        const model = genAI.getGenerativeModel({ model: modelName });
        
        // 3.1 모델 호환성을 고려하되, 500 에러 유발 가능성이 있는 thinkingConfig는 명시적 제외 (기본값 사용)
        const result = await model.generateContent([
            { text: promptText },
            {
                fileData: {
                    fileUri: processedFile.uri,
                    mimeType: processedFile.mimeType,
                },
            },
        ]);

        const response = await result.response;
        const text = response.text();
        if (!text) throw new Error('Gemini 응답이 비어있음');

        fs.writeFileSync(outputFile, text);
        console.log(`[완료] 응답 저장됨: ${outputFile}`);
        return true;
    } finally {
        if (uploadedFile) {
            try {
                await fileManager.deleteFile(uploadedFile.file.name);
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

    for (let retry = 0; retry < MAX_PROCESS_RETRIES; retry++) {
        try {
            const success = await runSingleAttempt(apiKey, modelName, promptText, videoPath, outputFile);
            if (success) return;
        } catch (error) {
            console.error(`[시도 ${retry + 1}/${MAX_PROCESS_RETRIES}] 오류 발생: ${error.message}`);
            if (retry < MAX_PROCESS_RETRIES - 1) {
                const waitSec = 30;
                console.log(`  ${waitSec}초 후 재시도 시작 (처음부터 다시 업로드)...`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
            } else {
                console.error('모든 재시도 실패.');
                process.exit(1);
            }
        }
    }
}

main();
