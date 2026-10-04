import { createGeminiClient, generateWithProjectBudget, logGeminiUsage, requireGeminiText } from '../../utils/gemini-client.mjs';
import fs from 'fs';
import { logSafeError } from '../../utils/privacy-log.mjs';

function resolveThinkingLevel(...candidates) {
    const allowed = new Set(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']);
    for (const candidate of candidates) {
        const value = String(candidate || '').trim().toUpperCase();
        if (allowed.has(value)) return value;
    }
    return 'MEDIUM';
}

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
        console.error('GEMINI_API_REQUEST_ARGUMENTS_INVALID code=ARGUMENTS_INVALID');
        process.exit(1);
    }

    const promptFile = args[0];
    const outputFile = args[1];
    console.log('DEBUG: Request files accepted');
    const apiKeys = buildApiKeyPool();

    if (apiKeys.length === 0) {
        console.error('GEMINI_API_REQUEST_CONFIGURATION_MISSING code=API_KEY_CONFIGURATION_MISSING');
        process.exit(1);
    }

    try {
        console.log("DEBUG: Reading prompt file...");
        const prompt = fs.readFileSync(promptFile, 'utf8');
        console.log(`DEBUG: Prompt Size=${prompt.length}`);
        const modelName = process.env.PRIMARY_MODEL || 'gemini-3.7-flash';
        const thinkingLevel = resolveThinkingLevel(process.env.LAAJ_THINKING_LEVEL, process.env.GEMINI_THINKING_LEVEL, 'MEDIUM');
        const isGemini38 = modelName.replace(/^models\//, '') === 'gemini-3.8-flash';
        if (isGemini38 && thinkingLevel === 'MINIMAL') {
            throw Object.assign(new Error('GEMINI_THINKING_LEVEL_UNSUPPORTED'), { code: 'GEMINI_THINKING_LEVEL_UNSUPPORTED' });
        }
        let lastError = null;

        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            try {
                console.log(`DEBUG: Initializing GoogleGenerativeAI with key ${keyIndex + 1}/${apiKeys.length}...`);
                const ai = createGeminiClient(apiKeys[keyIndex]);
                const response = await generateWithProjectBudget(ai, {
                    model: modelName,
                    contents: prompt,
                    config: {
                        // Preserve older-model settings; 3.8 removed sampling overrides.
                        ...(isGemini38 ? {} : { temperature: 0.1 }),
                        maxOutputTokens: 4096,
                        thinkingConfig: { thinkingLevel },
                    },
                });
                logGeminiUsage(response);
                const text = requireGeminiText(response);

                fs.writeFileSync(outputFile, text);
                console.log("DEBUG: Done.");
                process.exit(0);
            } catch (error) {
                const msg = error.message || '';
                lastError = error;
                logSafeError(error, line => console.error(`GEMINI_API_REQUEST_ATTEMPT_FAILED attempt=${keyIndex + 1}/${apiKeys.length} ${line.trim()}`));
                if ((msg.includes('429') || msg.includes('QUOTA_ERROR') || msg.includes('RESOURCE_EXHAUSTED')) && keyIndex < apiKeys.length - 1) {
                    console.error('GEMINI_API_REQUEST_QUOTA_ROTATION code=GEMINI_QUOTA_EXHAUSTED');
                    continue;
                }
                break;
            }
        }

        if (lastError) {
            const msg = lastError.message || '';
            if (msg.includes('429') || msg.includes('QUOTA_ERROR') || msg.includes('RESOURCE_EXHAUSTED')) {
                console.error('GEMINI_API_REQUEST_QUOTA_EXHAUSTED code=GEMINI_QUOTA_EXHAUSTED');
                process.exit(42);
            }
            throw lastError;
        }

        process.exit(1);

    } catch (error) {
        logSafeError(error, line => console.error(`GEMINI_API_REQUEST_FAILED ${line.trim()}`));
        if (error.message.includes('429') || error.message.includes('QUOTA_ERROR') || error.message.includes('RESOURCE_EXHAUSTED')) {
            console.error('GEMINI_API_REQUEST_QUOTA_EXHAUSTED code=GEMINI_QUOTA_EXHAUSTED');
            process.exit(42);
        }
        process.exit(1);
    }
}

main();
