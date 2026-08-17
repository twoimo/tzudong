/**
 * Gemini File API를 사용한 청크 비디오 멀티모달 분석
 * (@google/genai — 헬스체크/런타임과 동일한 SDK)
 */

import fs from 'fs';
import path from 'path';
import { GoogleGenAI, FileState } from '@google/genai';
import { logSafeError } from '../../utils/privacy-log.mjs';
import { pathToFileURL } from 'node:url';

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
const UPLOAD_TIMEOUT_MS = 300000;
const GENERATE_TIMEOUT_MS = 300000;

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
        if (typeof error?.code === 'string') return error.code;
    } catch {
        return '';
    }
    const status = errorHttpStatus(error);
    return status ? `HTTP_${status}` : '';
}

export function errorHttpStatus(error) {
    try {
        const status = error?.status;
        if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
            return status;
        }
        if (typeof status === 'string' && /^\d{3}$/.test(status)) {
            return Number(status);
        }
    } catch {
        return 0;
    }
    return 0;
}

function createReasonError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

export function isQuotaError(error) {
    const code = errorCode(error);
    if (code === 'GEMINI_QUOTA_EXHAUSTED' || code === 'HTTP_429') return true;
    if (errorHttpStatus(error) === 429) return true;
    const message = errorText(error);
    return message.includes('[QUOTA_ERROR]')
        || message.includes('RESOURCE_EXHAUSTED')
        || /\b429\b/.test(message);
}

export function isTransientServerError(error) {
    const code = errorCode(error);
    if (code === 'GEMINI_API_TIMEOUT' || code === 'GEMINI_FILE_PROCESSING_TIMEOUT') return true;
    const status = errorHttpStatus(error);
    if (status === 500 || status === 502 || status === 503 || status === 504) return true;
    const message = errorText(error);
    return message.includes('503')
        || message.includes('500')
        || message.includes('Service Unavailable')
        || message.includes('GEMINI_API_TIMEOUT');
}
export function classifyGeminiHttpReason(error) {
    const status = errorHttpStatus(error);
    const message = errorText(error).toLowerCase();
    if (status !== 400) return '';
    if (message.includes('thinking')) return 'GEMINI_THINKING_UNSUPPORTED';
    if (/\bapi[_ ]?key\b/.test(message) || message.includes('api_key_invalid')) {
        return 'GEMINI_API_KEY_REJECTED';
    }
    if (message.includes('file') && (message.includes('not found') || message.includes('invalid'))) {
        return 'GEMINI_FILE_REFERENCE_INVALID';
    }
    if (message.includes('model') || message.includes('not found') || message.includes('not supported')) {
        return 'GEMINI_MODEL_REJECTED';
    }
    return 'GEMINI_HTTP_400';

}

function promoteClassifiedError(error) {
    const reason = classifyGeminiHttpReason(error);
    if (!reason) return error;
    const promoted = createReasonError(reason);
    promoted.status = errorHttpStatus(error);
    return promoted;
}

async function generateChunkContent(ai, modelName, promptText, processedFile, mimeType, thinkingLevel) {
    const contents = [{
        role: 'user',
        parts: [
            { text: promptText },
            {
                fileData: {
                    fileUri: processedFile.uri,
                    mimeType: processedFile.mimeType || mimeType,
                },
            },
        ],
    }];
    const request = {
        model: modelName,
        contents,
    };
    if (thinkingLevel) {
        request.config = {
            temperature: 0.2,
            maxOutputTokens: 4096,
            thinkingConfig: { thinkingLevel },
        };
    }
    return fetchWithTimeout(() => ai.models.generateContent(request), GENERATE_TIMEOUT_MS);
}


function resolveMimeType(videoPath) {
    const ext = path.extname(videoPath).toLowerCase();
    if (ext === '.webm') return 'video/webm';
    if (ext === '.mov') return 'video/quicktime';
    if (ext === '.mpeg' || ext === '.mpg') return 'video/mpeg';
    if (ext === '.wmv') return 'video/x-ms-wmv';
    return 'video/mp4';
}

function fileNameOf(file) {
    return typeof file?.name === 'string' ? file.name : '';
}

function fileIsActive(file) {
    return file?.state === FileState.ACTIVE || file?.state === 'ACTIVE';
}

function fileIsFailed(file) {
    return file?.state === FileState.FAILED || file?.state === 'FAILED';
}

/** API 호출 타임아웃 래퍼 */
async function fetchWithTimeout(fn, timeoutMs = 60000) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(createReasonError('GEMINI_API_TIMEOUT')), timeoutMs);
    });
    return Promise.race([fn(), timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function waitForProcessing(ai, fileName) {
    await new Promise(r => setTimeout(r, 2000));

    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
        try {
            console.log(`GEMINI_FILE_STATUS_CHECK attempt=${i + 1}/${MAX_POLL_ATTEMPTS}`);
            const file = await fetchWithTimeout(() => ai.files.get({ name: fileName }), 30000);
            console.log('GEMINI_FILE_STATUS_RECEIVED');
            if (fileIsActive(file)) return file;
            if (fileIsFailed(file)) throw createReasonError('GEMINI_FILE_PROCESSING_FAILED');
        } catch (error) {
            logSafeError(error, line => console.warn(`GEMINI_FILE_STATUS_RETRY ${line.trim()}`));
            if (errorCode(error) === 'GEMINI_FILE_PROCESSING_FAILED') throw error;
            if (isQuotaError(error)) throw createReasonError('GEMINI_QUOTA_EXHAUSTED');
        }

        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw createReasonError('GEMINI_FILE_PROCESSING_TIMEOUT');
}

async function runSingleAttempt(apiKey, modelName, promptText, videoPath, outputFile) {
    const ai = new GoogleGenAI({ apiKey });
    let uploadedName = '';

    try {
        const displayName = `${path.basename(videoPath)}-${Date.now()}`;
        const mimeType = resolveMimeType(videoPath);

        console.log('GEMINI_FILE_UPLOAD_STARTED');
        const uploadedFile = await fetchWithTimeout(() => ai.files.upload({
            file: videoPath,
            config: {
                mimeType,
                displayName,
            },
        }), UPLOAD_TIMEOUT_MS);
        uploadedName = fileNameOf(uploadedFile);
        if (!uploadedName) throw createReasonError('GEMINI_FILE_UPLOAD_NAME_MISSING');
        console.log('GEMINI_FILE_UPLOAD_COMPLETED');

        console.log('[대기] 비디오 처리 상태 확인 중...');
        const processedFile = await waitForProcessing(ai, uploadedName);
        console.log('GEMINI_FILE_READY');

        const thinkingLevel = resolveThinkingLevel(process.env.GEMINI_CHUNK_THINKING_LEVEL, process.env.GEMINI_THINKING_LEVEL, 'LOW');
        console.log('GEMINI_GENERATION_STARTED');
        let result;
        try {
            result = await generateChunkContent(ai, modelName, promptText, processedFile, mimeType, thinkingLevel);
        } catch (error) {
            if (errorHttpStatus(error) === 400 && classifyGeminiHttpReason(error) === 'GEMINI_THINKING_UNSUPPORTED') {
                console.warn('GEMINI_THINKING_RETRY_WITHOUT_CONFIG');
                result = await generateChunkContent(ai, modelName, promptText, processedFile, mimeType, '');
            } else {
                throw promoteClassifiedError(error);
            }
        }

        const text = typeof result?.text === 'string' ? result.text : '';
        if (!text) throw createReasonError('GEMINI_EMPTY_RESPONSE');

        fs.writeFileSync(outputFile, text);
        console.log('GEMINI_OUTPUT_WRITTEN');
        return true;
    } catch (error) {
        if (isTransientServerError(error)) {
            throw error;
        }

        if (isQuotaError(error)) {
            throw createReasonError('GEMINI_QUOTA_EXHAUSTED');
        }
        throw promoteClassifiedError(error);
    } finally {
        if (uploadedName) {
            try {
                await fetchWithTimeout(() => ai.files.delete({ name: uploadedName }), 15000);
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

    const modelName = process.env.CURRENT_MODEL || 'gemini-3.7-flash';
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

        if (errorCode(lastError) === 'GEMINI_API_KEY_REJECTED' || classifyGeminiHttpReason(lastError) === 'GEMINI_API_KEY_REJECTED') {
            console.error('GEMINI_CHUNK_API_KEY_REJECTED');
            process.exit(44);
        }
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        logSafeError(error, line => console.error(`GEMINI_CHUNK_REQUEST_FATAL ${line.trim()}`));
        process.exit(1);
    });
}
