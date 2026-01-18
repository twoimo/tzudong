import fs from 'fs';
import path from 'path';
import { analyzeReceiptWithCliFallback } from '../lib/gemini-cli';

async function main() {
    const imagePath = path.join(process.cwd(), 'public', 'logo.png');

    if (!fs.existsSync(imagePath)) {
        console.error('테스트 이미지를 찾을 수 없습니다:', imagePath);
        process.exit(1);
    }

    console.log('테스트 이미지 읽는 중:', imagePath);
    const imageBuffer = fs.readFileSync(imagePath);

    // 더미 프롬프트: JSON 형식으로 설명 요청
    const dummyPrompt = "Describe this image in JSON format: { \"description\": \"string\" }";

    try {
        console.log('analyzeReceiptWithCliFallback 함수 호출 중...');
        const startTime = Date.now();
        const result = await analyzeReceiptWithCliFallback(imageBuffer, dummyPrompt);
        const endTime = Date.now();

        console.log('성공!');
        console.log('소요 시간:', endTime - startTime, 'ms');
        console.log('결과:', JSON.stringify(result, null, 2));

    } catch (error) {
        console.error('테스트 실패:', error);
    }
}

main();
