import fs from 'fs';
import path from 'path';
import { analyzeReceiptWithCliFallback } from '../lib/gemini-cli';

async function main() {
    const testDataDir = path.join(process.cwd(), 'tests', 'receipt-test-data');

    if (!fs.existsSync(testDataDir)) {
        console.error('테스트 데이터 디렉토리를 찾을 수 없습니다:', testDataDir);
        process.exit(1);
    }

    const files = fs.readdirSync(testDataDir).filter(file => /\.(jpg|png|jpeg)$/i.test(file));

    if (files.length === 0) {
        console.error('테스트할 이미지 파일이 없습니다.');
        process.exit(0);
    }

    console.log(`[벤치마크] 총 ${files.length}개 파일 테스트를 시작합니다...`);
    console.log(`대상 경로: ${testDataDir}\n`);

    const dummyPrompt = "Describe this image in JSON format: { \"description\": \"string\" }";
    const times: number[] = [];
    let successCount = 0;
    let totalTime = 0;

    for (let i = 0; i < files.length; i++) {
        const fileName = files[i];
        const filePath = path.join(testDataDir, fileName);
        console.log(`--- [${i + 1}/${files.length}] ${fileName} ---`);

        const imageBuffer = fs.readFileSync(filePath);
        const startTime = Date.now();

        try {
            await analyzeReceiptWithCliFallback(imageBuffer, dummyPrompt);
            const endTime = Date.now();
            const duration = endTime - startTime;

            times.push(duration);
            totalTime += duration;
            successCount++;
            console.log(`완료: ${duration} ms`);
        } catch (error: any) {
            console.error(`실패: ${error.message}`);
        }

        // Rate Limit 및 부하 분산을 위한 대기
        await new Promise(r => setTimeout(r, 1000));
    }

    const average = successCount > 0 ? totalTime / successCount : 0;

    console.log('\n=================================');
    console.log('       벤치마크 결과 요약       ');
    console.log('=================================');
    console.log(`총 파일: ${files.length}`);
    console.log(`성공: ${successCount}`);
    console.log(`실패: ${files.length - successCount}`);
    console.log(`평균 소요 시간: ${average.toFixed(2)} ms`);
    console.log(`최소/최대: ${Math.min(...times)} ms / ${Math.max(...times)} ms`);
    console.log('=================================');
}

main();
