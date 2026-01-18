import fs from 'fs';
import path from 'path';
import { analyzeReceiptWithCliFallback } from '../lib/gemini-cli';

async function main() {
    const imagePath = path.join(process.cwd(), 'public', 'logo.png');

    if (!fs.existsSync(imagePath)) {
        console.error('테스트 이미지를 찾을 수 없습니다:', imagePath);
        process.exit(1);
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const dummyPrompt = "Describe this image in JSON format: { \"description\": \"string\" }";

    const iterations = 5;
    let totalTime = 0;
    const times: number[] = [];

    console.log(`[벤치마크] 총 ${iterations}회 테스트를 시작합니다...`);

    for (let i = 1; i <= iterations; i++) {
        console.log(`\n--- 테스트 #${i} ---`);
        const startTime = Date.now();

        try {
            await analyzeReceiptWithCliFallback(imageBuffer, dummyPrompt);
            const endTime = Date.now();
            const duration = endTime - startTime;

            times.push(duration);
            totalTime += duration;
            console.log(`완료: ${duration} ms`);
        } catch (error) {
            console.error(`테스트 #${i} 실패:`, error);
        }

        // 잠시 대기 (Rate Limit 방지 및 현실적인 간격)
        await new Promise(r => setTimeout(r, 1000));
    }

    const average = totalTime / times.length;

    console.log('\n=================================');
    console.log('       벤치마크 결과 요약       ');
    console.log('=================================');
    console.log(`성공 횟수: ${times.length} / ${iterations}`);
    console.log(`개별 기록: [${times.join(', ')}] ms`);
    console.log(`평균 시간: ${average.toFixed(2)} ms`);
    console.log('=================================');
}

main();
