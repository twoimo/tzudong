import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

async function main() {
    const args = process.argv.slice(2);
    // Usage: node final_merge_chunk.mjs <prompt_file> <output_file> <json_data_file> <transcript_file>
    if (args.length < 4) {
        console.error('Usage: node final_merge_chunk.mjs <prompt_file> <output_file> <json_data_file> <transcript_file>');
        process.exit(1);
    }

    const [promptFile, outputFile, jsonDataFile, transcriptFile] = args;
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
        console.error('Error: GEMINI_API_KEY environment variable not set.');
        process.exit(1);
    }

    try {
        const promptTemplate = fs.readFileSync(promptFile, 'utf8');
        const chunkJsonData = fs.readFileSync(jsonDataFile, 'utf8');
        
        let fullTranscriptText = '';
        if (fs.existsSync(transcriptFile)) {
            const transcriptLines = fs.readFileSync(transcriptFile, 'utf8').trim().split('\n');
            if (transcriptLines.length > 0) {
                try {
                    const lastData = JSON.parse(transcriptLines[transcriptLines.length - 1]);
                    const segments = lastData.transcript || [];
                    fullTranscriptText = segments.map(s => {
                        const start = s.start || 0;
                        const mm = Math.floor(start / 60).toString().padStart(2, '0');
                        const ss = Math.floor(start % 60).toString().padStart(2, '0');
                        return `[${mm}:${ss}] ${s.text}`;
                    }).join('\n');
                } catch (e) {
                    console.warn(`[WARN] 자막 파일 파싱 실패: ${e.message}`);
                }
            }
        }

        const promptText = promptTemplate
            .replace('{CHUNK_JSON_DATA}', chunkJsonData)
            .replace('{FULL_TRANSCRIPT}', fullTranscriptText);

        const genAI = new GoogleGenerativeAI(apiKey);
        const modelName = process.env.CURRENT_MODEL || 'gemini-3-flash-preview';
        
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
                responseMimeType: "application/json",
            }
        });

        const result = await model.generateContent(promptText);
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