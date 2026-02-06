import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log("DEBUG: JS Script Started");
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error('Usage: node gemini_api_request.mjs <prompt_file> <output_file>');
        process.exit(1);
    }

    const promptFile = args[0];
    const outputFile = args[1];
    console.log(`DEBUG: PromptFile=${promptFile}, OutputFile=${outputFile}`);
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
        console.error('Error: GEMINI_API_KEY environment variable not set.');
        process.exit(1);
    }

    try {
        console.log("DEBUG: Reading prompt file...");
        const prompt = fs.readFileSync(promptFile, 'utf8');
        console.log(`DEBUG: Prompt Size=${prompt.length}`);

        console.log("DEBUG: Initializing GoogleGenerativeAI...");
        const genAI = new GoogleGenerativeAI(apiKey);
        const modelName = process.env.PRIMARY_MODEL || 'gemini-2.5-flash';
        console.log(`DEBUG: Getting Model=${modelName}...`);
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
                maxOutputTokens: 8192,
            },
        });

        // [최적화] 자동 재시도 로직 (Rate Limit, 일시적 오류 대응)
        let lastError = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log(`DEBUG: Calling generateContent (attempt ${attempt}/${MAX_RETRIES})...`);
                const result = await model.generateContent(prompt);
                console.log("DEBUG: Content Generated. Getting response...");
                const response = await result.response;
                const text = response.text();
                console.log("DEBUG: Got text. Writing output...");

                fs.writeFileSync(outputFile, text);
                console.log("DEBUG: Done.");
                process.exit(0);
            } catch (retryError) {
                lastError = retryError;
                const isRetryable = retryError.message?.includes('429') ||
                    retryError.message?.includes('503') ||
                    retryError.message?.includes('RESOURCE_EXHAUSTED') ||
                    retryError.message?.includes('UNAVAILABLE');

                if (isRetryable && attempt < MAX_RETRIES) {
                    const delay = RETRY_DELAY_MS * attempt;
                    console.log(`DEBUG: Retryable error (${retryError.message?.slice(0, 80)}). Waiting ${delay}ms...`);
                    await sleep(delay);
                } else {
                    throw retryError;
                }
            }
        }
        throw lastError;

    } catch (error) {
        console.error(`Gemini API Error: ${error.message}`);
        process.exit(1);
    }
}

main();
