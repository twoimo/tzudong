import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error('Usage: node gemini_api_request.js <prompt_file> <output_file>');
        process.exit(1);
    }

    const promptFile = args[0];
    const outputFile = args[1];
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.error('Error: GEMINI_API_KEY environment variable not set.');
        process.exit(1);
    }

    try {
        const prompt = fs.readFileSync(promptFile, 'utf8');
        const genAI = new GoogleGenerativeAI(apiKey);
        const modelName = process.env.PRIMARY_MODEL || 'gemini-2.5-flash';
        const model = genAI.getGenerativeModel({ model: modelName });

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        fs.writeFileSync(outputFile, text);
        process.exit(0);

    } catch (error) {
        console.error(`Gemini API Error: ${error.message}`);
        process.exit(1);
    }
}

main();
