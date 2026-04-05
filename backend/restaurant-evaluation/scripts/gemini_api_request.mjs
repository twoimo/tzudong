import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

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

async function main() {
    console.log("DEBUG: JS Script Started");
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error('Usage: node gemini_api_request.js <prompt_file> <output_file>');
        process.exit(1);
    }

    const promptFile = args[0];
    const outputFile = args[1];
    console.log(`DEBUG: PromptFile=${promptFile}, OutputFile=${outputFile}`);
    const apiKeys = buildApiKeyPool();

    if (apiKeys.length === 0) {
        console.error('Error: GEMINI_API_KEY / GEMINI_API_FALLBACK_KEYS environment variable not set.');
        process.exit(1);
    }

    try {
        console.log("DEBUG: Reading prompt file...");
        const prompt = fs.readFileSync(promptFile, 'utf8');
        console.log(`DEBUG: Prompt Size=${prompt.length}`);
        const modelName = process.env.PRIMARY_MODEL || 'gemini-3-flash-preview';
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            try {
                console.log(`DEBUG: Initializing GoogleGenerativeAI with key ${keyIndex + 1}/${apiKeys.length}...`);
                const genAI = new GoogleGenerativeAI(apiKeys[keyIndex]);
                console.log(`DEBUG: Getting Model=${modelName}...`);
                const model = genAI.getGenerativeModel({ model: modelName });

                console.log("DEBUG: Calling generateContent...");
                const result = await model.generateContent(prompt);
                console.log("DEBUG: Content Generated. Getting response...");
                const response = await result.response;
                const text = response.text();
                console.log("DEBUG: Got text. Writing output...");

                fs.writeFileSync(outputFile, text);
                console.log("DEBUG: Done.");
                process.exit(0);
            } catch (error) {
                const msg = error.message || '';
                lastError = error;
                console.error(`Gemini API Error (key ${keyIndex + 1}/${apiKeys.length}): ${msg}`);
                if ((msg.includes('429') || msg.includes('QUOTA_ERROR') || msg.includes('RESOURCE_EXHAUSTED')) && keyIndex < apiKeys.length - 1) {
                    console.error('[키 로테이션] 현재 API 키 할당량 초과. 다음 키로 전환합니다.');
                    continue;
                }
                break;
            }
        }

        if (lastError) {
            const msg = lastError.message || '';
            if (msg.includes('429') || msg.includes('QUOTA_ERROR') || msg.includes('RESOURCE_EXHAUSTED')) {
                console.error('[치명적 오류] API 할당량(Quota) 초과. 스크립트를 즉시 종료합니다.');
                process.exit(42);
            }
            throw lastError;
        }

        process.exit(1);

    } catch (error) {
        console.error(`Gemini API Error: ${error.message}`);
        if (error.message.includes('429') || error.message.includes('QUOTA_ERROR') || error.message.includes('RESOURCE_EXHAUSTED')) {
            console.error('[치명적 오류] API 할당량(Quota) 초과. 스크립트를 즉시 종료합니다.');
            process.exit(42);
        }
        process.exit(1);
    }
}

main();
