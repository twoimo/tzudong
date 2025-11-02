import { PerplexityEvaluator } from './perplexity-evaluator.js';
import { JsonlProcessor } from './jsonl-processor.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

// 환경 변수 로드
config();

// 평가 프롬프트 템플릿
const EVALUATION_PROMPT_TEMPLATE = `
<평가대상>
{restaurant_data}
</평가대상>

<루브릭평가>
</루브릭평가>
`;

/**
 * 터미널에서 사용자 입력을 받는 함수
 */
function askUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    console.log(question);

    process.stdin.setRawMode(false);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.once('data', (key: string) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(key.trim());
    });
  });
}

/**
 * 메인 실행 함수
 */
async function main() {
  console.log('🍽️ Perplexity 식당 평가 시스템 시작\n');

  let evaluator: PerplexityEvaluator | null = null;
  let processor: JsonlProcessor | null = null;

  try {
    // 입력 파일에서 데이터 읽기
    const inputFilePath = join(process.cwd(), '../perplexity-restaurant-crawling/tzuyang_restaurant_results_with_meta.jsonl');
    console.log(`📂 입력 파일 읽기: ${inputFilePath}`);

    const content = readFileSync(inputFilePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    console.log(`📋 총 ${lines.length}개의 레코드를 발견했습니다.\n`);

    // 브라우저 초기화
    console.log('🚀 브라우저 초기화 중...');
    evaluator = new PerplexityEvaluator();
    await evaluator.initialize();

    // JSONL 프로세서 초기화
    processor = new JsonlProcessor('./tzuyang_restaurant_evaluation.jsonl');

    // 각 레코드에 대해 평가 수행 (테스트를 위해 첫 2개만)
    const maxRecords = 2; // 테스트용으로 2개만 처리
    for (let i = 0; i < Math.min(lines.length, maxRecords); i++) {
      const line = lines[i];
      try {
        const record = JSON.parse(line.trim());
        const restaurantData = JSON.stringify(record, null, 2);

        console.log(`\n🏪 레코드 ${i + 1}/${lines.length} 평가 시작`);
        console.log(`📝 식당 데이터: ${record.name || record.youtube_link || 'Unknown'}`);

        // 프롬프트 생성
        const prompt = EVALUATION_PROMPT_TEMPLATE.replace('{restaurant_data}', restaurantData);

        // Perplexity를 통한 평가
        const result = await evaluator.processEvaluation(record.name || record.youtube_link || `Record_${i}`, prompt);

        if (result.success && result.data) {
          // 결과를 JSONL 파일에 저장 (youtube_link을 키로 사용)
          const youtubeLink = record.youtube_link || `unknown_${i}`;
          processor.updateEntry(youtubeLink, result.data);
          console.log(`✅ 레코드 ${i + 1} 평가 완료 및 저장됨`);
        } else {
          console.log(`❌ 레코드 ${i + 1} 평가 실패: ${result.error}`);
        }

        // 다음 요청 전 잠시 대기 (API 호출 제한 방지)
        console.log('⏳ 다음 평가를 위해 5초 대기...');
        await new Promise(resolve => setTimeout(resolve, 5000));

      } catch (parseError) {
        console.error(`❌ 레코드 ${i + 1} JSON 파싱 실패:`, parseError);
        continue;
      }
    }

    console.log('\n🎉 모든 평가가 완료되었습니다!');

  } catch (error) {
    console.error('❌ 오류 발생:', error);
  } finally {
    // 브라우저 종료
    if (evaluator) {
      await evaluator.close();
    }

    // 프로그램 종료 대기
    console.log('\n프로그램을 종료하려면 Enter 키를 누르세요...');
    await askUser('');
  }
}

// 프로그램 실행
main().catch(console.error);