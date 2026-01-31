import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
        console.error(`Gemini API Error: ${error.message}`);
        process.exit(1);
    }
}

main();
