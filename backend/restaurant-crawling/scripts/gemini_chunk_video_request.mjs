/**
 * Gemini File API를 사용한 청크 비디오 멀티모달 분석
 * (표준 SDK @google/generative-ai 사용 버전)
 */

import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';

/** 파일 처리 상태 폴링 간격 (밀리초) */
const POLL_INTERVAL_MS = 3000;
/** 최대 폴링 시도 횟수 (약 5분 대기 - 긴 영상 처리 대응) */
const MAX_POLL_ATTEMPTS = 100;
/** 전체 프로세스(업로드 포함) 최대 재시도 횟수 (3회 시도) */
const MAX_PROCESS_RETRIES = 3;

/** API 호출 타임아웃 래퍼 */
async function fetchWithTimeout(fn, timeoutMs = 60000) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`API 호출 타임아웃 (${timeoutMs}ms)`)), timeoutMs);
    });
    return Promise.race([fn(), timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

/** 업로드된 파일이 ACTIVE 상태가 될 때까지 폴링 대기 */
async function waitForProcessing(fileManager, fileName) {
    // [GitHub Action 최적화] 업로드 직후 바로 상태를 찌르지 않고 잠시 대기하여 500 에러 방지
    console.log('  [대기] 서버 파싱을 위해 2초간 초기 대기...');
    for (let s = 1; s <= 2; s++) {
        await new Promise(r => setTimeout(r, 1000));
        if (s % 2 === 0) console.log(`    초기 대기 진행 중... ${s}초/2초`);
    }

    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
        try {
            console.log(`  [상태 확인 요청] ${fileName} 상태 확인 중... (${i + 1}/${MAX_POLL_ATTEMPTS})`);
            const file = await fetchWithTimeout(() => fileManager.getFile(fileName), 30000);
            console.log(`  [상태 응답] ${fileName} 상태: ${file.state}`);
            if (file.state === FileState.ACTIVE) return file;
            if (file.state === FileState.FAILED) throw new Error(`파일 처리 실패: ${fileName}`);
        } catch (error) {
            // 구글 서버가 비정상 응답(HTML 등)을 보낼 경우 catch됨
            console.log(`  [경고] 상태 확인 중 통신 에러 (재시도 예정): ${error.message}`);
            // [Quota Error 감지] 500 에러나 429 에러가 반복될 경우, 쿼타/내부 서버 문제로 판단하고 즉시 중단
            if (error.message.includes('500 Internal Server Error') || error.message.includes('429') || error.message.includes('403')) {
                throw new Error(`[QUOTA_ERROR] ${error.message}`);
            }
        }
        
        console.log(`    [폴링 대기] 다음 확인까지 ${POLL_INTERVAL_MS / 1000}초 대기 시작...`);
        for (let s = 1; s <= (POLL_INTERVAL_MS / 1000); s++) {
            await new Promise(r => setTimeout(r, 1000));
        }
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
        const ext = path.extname(videoPath).toLowerCase();
        let mimeType = 'video/mp4';
        if (ext === '.webm') mimeType = 'video/webm';
        else if (ext === '.mov') mimeType = 'video/quicktime';
        else if (ext === '.mpeg' || ext === '.mpg') mimeType = 'video/mpeg';
        else if (ext === '.wmv') mimeType = 'video/x-ms-wmv';
        
        console.log(`[업로드] Gemini File API에 비디오 업로드 중 (${displayName}, Mime: ${mimeType})...`);
        uploadedFile = await fetchWithTimeout(() => fileManager.uploadFile(videoPath, {
            mimeType: mimeType,
            displayName: displayName,
        }), 60000);
        console.log(`[업로드] 완료: ${uploadedFile.file.name}`);

        console.log('[대기] 비디오 처리 상태 확인 중...');
        const processedFile = await waitForProcessing(fileManager, uploadedFile.file.name);
        console.log(`[준비] 비디오 처리 완료: ${processedFile.uri}`);

        console.log(`[생성] Gemini API 호출 중 (모델: ${modelName})...`);
        const model = genAI.getGenerativeModel({ model: modelName });
        
        // 3.1 모델 호환성을 고려하되, 500 에러 유발 가능성이 있는 thinkingConfig는 명시적 제외 (기본값 사용)
        const result = await fetchWithTimeout(() => model.generateContent([
            { text: promptText },
            {
                fileData: {
                    fileUri: processedFile.uri,
                    mimeType: processedFile.mimeType,
                },
            },
        ]), 300000); // 전체 영상 분석을 위해 타임아웃 5분(300000ms)으로 연장

        const response = await result.response;
        const text = response.text();
        if (!text) throw new Error('Gemini 응답이 비어있음');

        fs.writeFileSync(outputFile, text);
        console.log(`[완료] 응답 저장됨: ${outputFile}`);
        return true;
    } catch (error) {
        const msg = error.message || '';
        // 503 (Service Unavailable)은 일시적인 과부하임. QUOTA_ERROR로 분류하지 않고 상위에서 재시도하게 함.
        if (msg.includes('503') || msg.includes('Service Unavailable')) {
            throw error; // 일반 에러로 던져서 메인 루프에서 재시도 유도
        }
        
        if (error.message.includes('429') || error.message.includes('QUOTA_ERROR') || error.message.includes('RESOURCE_EXHAUSTED')) {
             throw new Error(`[QUOTA_ERROR] ${error.message}`);
        }
        throw error;
    } finally {
        if (uploadedFile) {
            try {
                await fetchWithTimeout(() => fileManager.deleteFile(uploadedFile.file.name), 15000);
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

    const modelName = process.env.CURRENT_MODEL || 'gemini-3-flash-preview';
    console.log(`[Gemini] 모델: ${modelName}, 비디오: ${path.basename(videoPath)}`);

    const promptText = fs.readFileSync(promptFile, 'utf8');

    for (let retry = 0; retry < MAX_PROCESS_RETRIES; retry++) {
        try {
            const success = await runSingleAttempt(apiKey, modelName, promptText, videoPath, outputFile);
            if (success) return;
        } catch (error) {
            const msg = error.message || '';
            console.error(`[시도 ${retry + 1}/${MAX_PROCESS_RETRIES}] 오류 발생: ${msg}`);
            
            // 쿼타 에러 감지 시 특수 종료 코드(42) 반환
            if (msg.includes('[QUOTA_ERROR]') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
                console.error('[치명적 오류] API 할당량(Quota) 초과 또는 심각한 API 에러 발생. 스크립트를 즉시 종료합니다.');
                process.exit(42);
            }

            // 503 Service Unavailable 또는 500 에러 등에 대한 상세 로그
            if (msg.includes('503') || msg.includes('500') || msg.includes('Service Unavailable')) {
                console.warn('  [서버 에러] 구글 Gemini 서버 일시적 과부하 또는 오류 감지. 잠시 후 재시도합니다.');
            }

            console.error('=== 상세 에러 로그 ===');
            console.error(error);
            console.error('======================');
            
            if (retry < MAX_PROCESS_RETRIES - 1) {
                // 지수 백오프 적용 (30초, 60초...)
                const waitSec = 30 * (retry + 1);
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