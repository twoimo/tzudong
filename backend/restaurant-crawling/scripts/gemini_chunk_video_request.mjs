/**
 * Gemini File API를 사용한 청크 비디오 멀티모달 분석
 * (표준 SDK @google/generative-ai 사용 버전)
 */

import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import { logSafeError } from '../../utils/privacy-log.mjs';

function resolveThinkingLevel(...candidates) {
    const allowed = new Set(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']);
    for (const candidate of candidates) {
        const value = String(candidate || '').trim().toUpperCase();
        if (allowed.has(value)) return value;
    }
    return 'MEDIUM';
}

/** 파일 처리 상태 폴링 간격 (밀리초) */
const POLL_INTERVAL_MS = 3000;
/** 최대 폴링 시도 횟수 (약 3분 대기 - 긴 영상 처리 대응) */
const MAX_POLL_ATTEMPTS = 60;
/** 전체 프로세스(업로드 포함) 최대 재시도 횟수 (2회 시도) */
const MAX_PROCESS_RETRIES = 2;

function buildApiKeyPool() {
    const rawPrimary = (process.env.GEMINI_API_KEY || '').trim();
    const rawFallbacks = String(process.env.GEMINI_API_FALLBACK_KEYS || '');
    const pool = [];

    if (rawPrimary) {
        pool.push(rawPrimary);
    }

    for (const candidate of rawFallbacks.split(/[,\n]/)) {
        const key = candidate.trim();
        if (!key) continue;
        if (!pool.includes(key)) {
            pool.push(key);
        }
    }

    return pool;
}
function errorText(error) {
    try {
        return typeof error?.message === 'string' ? error.message : '';
    } catch {
        return '';
    }
}

function errorCode(error) {
    try {
        return typeof error?.code === 'string' ? error.code : '';
    } catch {
        return '';
    }
}

function createReasonError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function isQuotaError(error) {
    const message = errorText(error);
    return errorCode(error) === 'GEMINI_QUOTA_EXHAUSTED'
        || message.includes('[QUOTA_ERROR]')
        || message.includes('429')
        || message.includes('RESOURCE_EXHAUSTED');
}

function isTransientServerError(error) {
    const message = errorText(error);
    return message.includes('503')
        || message.includes('500')
        || message.includes('Service Unavailable');
}


/** API 호출 타임아웃 래퍼 */
async function fetchWithTimeout(fn, timeoutMs = 60000) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(createReasonError('GEMINI_API_TIMEOUT')), timeoutMs);
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
            console.log(`GEMINI_FILE_STATUS_CHECK attempt=${i + 1}/${MAX_POLL_ATTEMPTS}`);
            const file = await fetchWithTimeout(() => fileManager.getFile(fileName), 30000);
            console.log('GEMINI_FILE_STATUS_RECEIVED');
            if (file.state === FileState.ACTIVE) return file;
            if (file.state === FileState.FAILED) throw createReasonError('GEMINI_FILE_PROCESSING_FAILED');
        } catch (error) {
            // 구글 서버가 비정상 응답(HTML 등)을 보낼 경우 catch됨
            logSafeError(error, line => console.warn(`GEMINI_FILE_STATUS_RETRY ${line.trim()}`));
            // [Quota Error 감지] 500 에러나 429 에러가 반복될 경우, 쿼타/내부 서버 문제로 판단하고 즉시 중단
            if (errorText(error).includes('500 Internal Server Error') || errorText(error).includes('429') || errorText(error).includes('403')) {
                throw createReasonError('GEMINI_QUOTA_EXHAUSTED');
            }
        }
        
        console.log(`    [폴링 대기] 다음 확인까지 ${POLL_INTERVAL_MS / 1000}초 대기 시작...`);
        for (let s = 1; s <= (POLL_INTERVAL_MS / 1000); s++) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    throw createReasonError('GEMINI_FILE_PROCESSING_TIMEOUT');
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
        
        console.log('GEMINI_FILE_UPLOAD_STARTED');
        uploadedFile = await fetchWithTimeout(() => fileManager.uploadFile(videoPath, {
            mimeType: mimeType,
            displayName: displayName,
        }), 60000);
        console.log('GEMINI_FILE_UPLOAD_COMPLETED');

        console.log('[대기] 비디오 처리 상태 확인 중...');
        const processedFile = await waitForProcessing(fileManager, uploadedFile.file.name);
        console.log('GEMINI_FILE_READY');

        const thinkingLevel = resolveThinkingLevel(process.env.GEMINI_CHUNK_THINKING_LEVEL, process.env.GEMINI_THINKING_LEVEL, 'MEDIUM');
        console.log('GEMINI_GENERATION_STARTED');
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
                thinkingConfig: { thinkingLevel },
            },
        });

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
        if (!text) throw createReasonError('GEMINI_EMPTY_RESPONSE');

        fs.writeFileSync(outputFile, text);
        console.log('GEMINI_OUTPUT_WRITTEN');
        return true;
    } catch (error) {
        // 503 (Service Unavailable)은 일시적인 과부하임. QUOTA_ERROR로 분류하지 않고 상위에서 재시도하게 함.
        if (isTransientServerError(error)) {
            throw error; // 일반 에러로 던져서 메인 루프에서 재시도 유도
        }

        if (isQuotaError(error)) {
             throw createReasonError('GEMINI_QUOTA_EXHAUSTED');
        }
        throw error;
    } finally {
        if (uploadedFile) {
            try {
                await fetchWithTimeout(() => fileManager.deleteFile(uploadedFile.file.name), 15000);
                console.log('[정리] 업로드된 파일 삭제 완료');
            } catch (e) {
                logSafeError(e, line => console.warn(`GEMINI_FILE_CLEANUP_FAILED ${line.trim()}`));
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
    const apiKeys = buildApiKeyPool();

    if (apiKeys.length === 0) {
        console.error('GEMINI_API_KEY_UNAVAILABLE');
        process.exit(1);
    }

    if (!fs.existsSync(videoPath)) {
        console.error('GEMINI_CHUNK_VIDEO_MISSING');
        process.exit(1);
    }

    const modelName = process.env.CURRENT_MODEL || 'gemini-3.5-flash';
    console.log('GEMINI_CHUNK_REQUEST_STARTED');

    const promptText = fs.readFileSync(promptFile, 'utf8');

    for (let retry = 0; retry < MAX_PROCESS_RETRIES; retry++) {
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const apiKey = apiKeys[keyIndex];
            try {
                const success = await runSingleAttempt(apiKey, modelName, promptText, videoPath, outputFile);
                if (success) return;
            } catch (error) {
                const quotaError = isQuotaError(error);
                lastError = error;
                logSafeError(error, line => console.error(`GEMINI_CHUNK_ATTEMPT_FAILED retry=${retry + 1}/${MAX_PROCESS_RETRIES} key=${keyIndex + 1}/${apiKeys.length} ${line.trim()}`));

                if (quotaError && keyIndex < apiKeys.length - 1) {
                    console.warn(`GEMINI_CHUNK_KEY_ROTATION next_key=${keyIndex + 2}/${apiKeys.length}`);
                    continue;
                }

                break;
            }
        }

        const quotaError = isQuotaError(lastError);
        const transientServerError = isTransientServerError(lastError);

        if (quotaError && retry === MAX_PROCESS_RETRIES - 1) {
            console.error('GEMINI_CHUNK_QUOTA_EXHAUSTED');
            process.exit(42);
        }

        if (!quotaError && retry === MAX_PROCESS_RETRIES - 1) {
            if (transientServerError) {
                console.error('GEMINI_CHUNK_TRANSIENT_EXHAUSTED');
                process.exit(43);
            }
            console.error('GEMINI_CHUNK_RETRIES_EXHAUSTED');
            process.exit(1);
        }

        if (transientServerError) {
            console.warn('GEMINI_CHUNK_TRANSIENT_RETRY');
        }


        const waitSec = 30 * (retry + 1);
        console.log(`GEMINI_CHUNK_RETRY_DELAY seconds=${waitSec}`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
    }
}

main().catch(error => {
    logSafeError(error, line => console.error(`GEMINI_CHUNK_REQUEST_FATAL ${line.trim()}`));
    process.exit(1);
});
