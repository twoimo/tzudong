/**
 * gemini_api_request.js
 * 
 * Google Gemini API를 사용하여 프롬프트에 대한 응답을 생성하는 헬퍼 스크립트입니다.
 * 06-gemini-crawling.sh에서 CLI 호출 전 1차 시도용으로 사용됩니다.
 * 
 * Usage:
 *   node gemini_api_request.js <prompt_file> <output_file>
 * 
 * Env:
 *   GEMINI_API_KEY (필수)
 *   PRIMARY_MODEL (선택, 기본: gemini-2.5-flash)
 */

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

        // JSON 출력을 위해 프롬프트 마지막에 지침 재강조 (선택 사항)
        // const finalPrompt = prompt + "\n\nAnswer in JSON."; 
        // -> 원본 프롬프트가 이미 형식을 지정하고 있으므로 그대로 사용

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // 텍스트를 파일에 저장
        fs.writeFileSync(outputFile, text);

        // 성공 로그는 caller에서 처리하도록 최소화
        // console.log('Gemini API Success');
        process.exit(0);

    } catch (error) {
        console.error(`Gemini API Error: ${error.message}`);
        process.exit(1);
    }
}

main();
