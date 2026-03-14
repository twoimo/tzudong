import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

async function main() {
    console.log("DEBUG: JS Script Started (Multimodal Array Mode)");
    const args = process.argv.slice(2);
    // Usage: node gemini_api_request.mjs <prompt_file> <output_file> [frames_dir]
    if (args.length < 2) {
        console.error('Usage: node gemini_api_request.mjs <prompt_file> <output_file> [frames_dir]');
        process.exit(1);
    }

    const promptFile = args[0];
    const outputFile = args[1];
    const framesDir = args[2] || ""; // 세 번째 인자로 프레임 폴더를 받을 수 있음 (옵션)
    
    console.log(`DEBUG: PromptFile=${promptFile}, OutputFile=${outputFile}, FramesDir=${framesDir}`);
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
        console.error('Error: GEMINI_API_KEY environment variable not set.');
        process.exit(1);
    }

    try {
        console.log("DEBUG: Reading prompt file...");
        const promptText = fs.readFileSync(promptFile, 'utf8');
        console.log(`DEBUG: Prompt Size=${promptText.length}`);

        // 프롬프트 및 멀티모달(이미지) 데이터를 담을 배열
        const promptParts = [ promptText ];

        // 프레임 폴더가 제공되었고, 실제로 존재할 경우 이미지 목록을 추가
        if (framesDir && fs.existsSync(framesDir)) {
            console.log(`DEBUG: Scanning images in ${framesDir}...`);
            const files = fs.readdirSync(framesDir)
                .filter(file => file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.jpeg'))
                .sort(); // 이름 순 정렬 (프레임 순서대로)
            
            console.log(`DEBUG: Found ${files.length} images.`);
            
            // 이미지 최대 치 제한 (30~50장 정도로 너무 많으면 슬라이싱 추천)
            const MAX_FRAMES = 50; 
            const targetFiles = files.slice(0, MAX_FRAMES);
            
            for (const file of targetFiles) {
                const filePath = path.join(framesDir, file);
                const imageData = fs.readFileSync(filePath);
                
                promptParts.push({
                    inlineData: {
                        data: imageData.toString("base64"),
                        mimeType: file.endsWith('.png') ? "image/png" : "image/jpeg"
                    }
                });
            }
            console.log(`DEBUG: Appended ${targetFiles.length} images to prompt payload.`);
        }

        console.log("DEBUG: Initializing GoogleGenerativeAI...");
        const genAI = new GoogleGenerativeAI(apiKey);
        
        // --- 🤖 여기서 사용자 요구 모델 지정! 🤖 ---
        const modelName = process.env.CURRENT_MODEL || 'gemini-3.1-flash-lite-preview'; 
        console.log(`DEBUG: Getting Model=${modelName}...`);
        const model = genAI.getGenerativeModel({ model: modelName });

        console.log("DEBUG: Calling generateContent...");
        
        // 문자열 하나가 아니라, 배열(문자열 + 여러 Base64 이미지 객체)을 넘김!
        const result = await model.generateContent(promptParts);
        
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
