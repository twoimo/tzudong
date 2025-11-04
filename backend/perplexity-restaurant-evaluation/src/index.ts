import { PerplexityEvaluator } from './perplexity-evaluator.js';
import { readFileSync, existsSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';

// 환경 변수 로드
config();

// 평가 프롬프트 템플릿
const EVALUATION_PROMPT_TEMPLATE = `당신은 유튜브 음식 리뷰 데이터를 평가하는 전문가입니다.  
입력으로 주어지는 <평가할 데이터>는 한 유튜브 영상에서 유튜버가 방문한 음식점 데이터(restaurant 리스트 포함)입니다.  
영상 내용, reasoning_basis, tzuyang_review, category를 종합적으로 검토하여 아래의 5개 평가 항목에 대해 판단하세요.(검색 시도 금지)
**추측이나 새로운 정보 추가는 절대 금지하며, 반드시 아래 <평가 루브릭>의 평가기준·평가대상·출력형식을 그대로 따르세요.**
<평가할 데이터>
{restaurant_data}
</평가할 데이터>

<평가 루브릭>
**평가는 새로운 항목이나 근거를 추가하지 말고, 평가할 데이터와 실제 영상 근거를 기반으로만 판단하세요.**
모든 평가항목에서 eval_basis는 **구체적으로** 작성합니다.

[평가 항목 1] 방문 여부 정확성 (visit_authenticity)
- 평가 목적: **실제 영상**에서 유튜버가 실제로 해당 음식점을 방문했는지, 지점명까지 명확히 식별 가능한지, 누락된 음식점이 있는지 평가
- 평가 기준(int 0~4):
  0 = 영상과 무관 (데이터가 허구).
  1 = 음식점(매장)이 맞으며(단순 지역/위치/축제이름 등은 음식점이 아님), 직접 방문했고 지점명까지 명확.
  2 = 음식점(매장)이 맞으며, 직접 방문은 맞지만, 지점명 특정 불명확함.
  3 = 음식점을 방문하지 않고, 해당 음식점의 음식 포장/배달임.
  4 = 언급만 하거나(매장 안 감), 음식점(매장)이 아님.
- 평가 대상: 각 restaurants의 name
- 반환 형식 예시:
  {
    "values": [
      {"name": "빈해원", "eval_value": 1, "eval_basis": "간판+내부 확인"},
      {"name": "복성루", "eval_value": 1, "eval_basis": "착석 장면 존재"},
      {"name": "지린성", "eval_value": 1, "eval_basis": "주문 장면 확인"}
    ],
    "missing": []
  }

---

[평가 항목 2] reasoning_basis 추론 합리성 (rb_inference_score)
- 평가 목적: reasoning_basis가 ‘방문 지역 언급 → 간판/편집자막(시각정보) → 음식점 특정’ 구조를 따르거나, 시각·음성·검색정보를 조합해 합리적으로 특정했는지 평가
- 평가 기준(int 0~2):
  0 = 논리적 비약 있음 / 현장 증거 없이 단순 검색·추측
  1 = '방문 지역 언급 → 간판/편집자막(시각정보) 확인 → 음식점 특정' 순서로 자연스럽게 이어짐
  2 = 위 구조는 아니지만, 영상 내 시각정보(내부, 메뉴판, 간판 일부 등)와 음성정보, 검색정보를 조합하여 논리적으로 특정
- 평가 대상: 각 restaurants의 reasoning_basis 텍스트
- 반환 형식 예시:
  [
    {"name": "빈해원", "eval_value": 1, "eval_basis": "00:01:55 간판과 주소 언급을 근거로 특정"},
    {"name": "복성루", "eval_value": 1, "eval_basis": "00:08:58 간판과 주소 언급 근거로 특정"},
    {"name": "지린성", "eval_value": 1, "eval_basis": "00:15:06 간판 명시 및 현장 언급으로 특정"}
  ]
- 주의: 추측 금지, reasoning_basis 내 명시된 텍스트만 보고 평가

---

[평가 항목 3] reasoning_basis 실제 근거 일치도 (rb_grounding_TF)
- 평가 목적: reasoning_basis에 제시된 근거(지역, 간판, 시각 정보 등)가 **실제 영상에서 확인 가능한지** 검증
- 평가 기준(bool):
  true = 전반적으로 매칭됨
  false = 핵심 근거(매장 위치나 간판 등)가 영상에서 전혀 확인 안 됨
- 평가 대상: 각 restaurants의 reasoning_basis
- 반환 형식 예시:
  [
    {"name": "빈해원", "eval_value": true, "eval_basis": "1분55초 간판 장면 및 주소 자막 존재"},
    {"name": "복성루", "eval_value": true, "eval_basis": "8분58초 간판 장면 확인"},
    {"name": "지린성", "eval_value": true, "eval_basis": "15분6초 간판 및 내부 장면 확인"}
  ]

---

[평가 항목 4] 음식 리뷰 충실도 (review_faithfulness_score)
- 평가 목적: tzuyang_review가 실제로 유튜버가 먹은 메뉴와 평가(맛, 식감, 향, 매운 정도 등)를 충실히 반영하는지 평가
- 평가 기준(float 0~1):
  0.0 = 과장/없는 말 지어냄, 위험하게 틀림
  1.0 = 실제 멘트 기반으로 충실하게 요약됨, 큰 누락 없음
- 평가 대상: 각 restaurants의 tzuyang_review
- 반환 형식 예시:
  [
    {"name": "빈해원", "eval_value": 1.0, "eval_basis": "짬뽕, 탕수육, 짜장면 실제 주문 및 평가 일치"},
    {"name": "복성루", "eval_value": 1.0, "eval_basis": "짬뽕과 잡채밥 실제 주문 및 평가 일치"},
    {"name": "지린성", "eval_value": 1.0, "eval_basis": "고추짜장, 고추짬뽕 실제 주문 및 매운맛 표현 일치"}
  ]

---

[평가 항목 5] 카테고리 정합성 (category_TF)
- 평가 목적: category 필드가 **영상에서 확인되는 업장** 성격과 일치하는지 평가
- 평가 기준(bool):
  true = 영상에서 확인 시, 기존 category값이 수용 가능
  false = 영상에서 전혀 맞지 않음 (수정 필요)
- 평가 대상: 각 restaurants의 category
- 반환 형식 예시:
  [
    {"name": "빈해원", "eval_value": true, "category_revision": null},
    {"name": "복성루", "eval_value": true, "category_revision": null},
    {"name": "지린성", "eval_value": true, "category_revision": null}
  ]
- 카테고리 범위: ["치킨", "중식", "돈까스·회", "피자", "패스트푸드", "찜·탕", "족발·보쌈", "분식", "카페·디저트", "한식", "고기", "양식", "아시안", "야식", "도시락"]
</평가 루브릭>

<출력 형식>
- 최종 출력은 **반드시 5개의 평가 항목(visit_authenticity, rb_inference_score, rb_grounding_TF, review_faithfulness_score, category_TF)를 key로 하고, 그 평가 결과를 값으로 하는 단일 JSON 객체만 반환(다른 설명/언급 절대 금지).**
- 출력 예시:
{
  "visit_authenticity": {"values": [{"name": "빈해원", "eval_value": 1, "eval_basis": "간판+내부 확인"}, {"name": "복성루", "eval_value": 1, "eval_basis": "착석 장면 존재"}, {"name": "지린성", "eval_value": 1, "eval_basis": "주문 장면 확인"}], "missing": []}},
  "rb_inference_score": [...],
  "rb_grounding_TF": [...],
  "review_faithfulness_score": [...],
  "category_TF": [...]
}
(※ 위 JSON 예시는 형식 참고용이며 실제 평가값은 입력 데이터 기반으로 판단)
</출력 형식>
`;

/**
 * 터미널에서 사용자 입력을 받는 함수
 * TTY 모드와 파이프 입력 모두 지원
 */
function askUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    console.log(question);

    // TTY가 아닌 경우 (파이프 입력) setRawMode 스킵
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.once('data', (key: string) => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
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

  let evaluators: PerplexityEvaluator[] = [];

  try {
    // 병렬 처리 개수 선택
    console.log('\n병렬 처리할 브라우저 개수를 선택하세요:');
    console.log('  1 - 1개 (순차 처리)');
    console.log('  3 - 3개 (병렬 처리)');
    console.log('  5 - 5개 (병렬 처리)');
    const parallelChoice = await askUser('선택 (1/3/5): ');
    
    let parallelCount = 1; // 기본값
    const choiceNum = parseInt(parallelChoice.trim());
    
    if (choiceNum === 1) {
      parallelCount = 1;
    } else if (choiceNum === 3) {
      parallelCount = 3;
    } else if (choiceNum === 5) {
      parallelCount = 5;
    } else {
      console.log(`⚠️ 잘못된 선택: "${parallelChoice}" - 기본값 1개로 진행합니다.`);
      parallelCount = 1;
    }
    
    console.log(`\n✅ ${parallelCount}개 브라우저로 병렬 처리 시작\n`);

    // 입력 파일에서 데이터 읽기
    const inputFilePath = join(process.cwd(), 'tzuyang_restaurant_evaluation_rule_results.jsonl');
    const outputFilePath = join(process.cwd(), 'tzuyang_restaurant_evaluation_results.jsonl');
    const errorFilePath = join(process.cwd(), 'tzuyang_restaurant_evaluation_errors.jsonl');
    
    console.log(`📂 입력 파일 읽기: ${inputFilePath}`);

    const content = readFileSync(inputFilePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    console.log(`📋 총 ${lines.length}개의 레코드를 발견했습니다.`);
    
    // 이미 처리된 youtube_link 수집 (성공 + 실패 모두)
    const processedLinks = new Set<string>();
    
    // 성공 파일 확인
    if (existsSync(outputFilePath)) {
      console.log(`📂 기존 성공 파일 발견 - 이미 처리된 youtube_link 확인 중...`);
      const outputContent = readFileSync(outputFilePath, 'utf-8');
      const outputLines = outputContent.trim().split('\n').filter(line => line.trim());
      for (const line of outputLines) {
        try {
          const data = JSON.parse(line);
          if (data.youtube_link) {
            processedLinks.add(data.youtube_link);
          }
        } catch (e) {
          // 파싱 실패 무시
        }
      }
    }
    
    // 실패 파일 확인
    if (existsSync(errorFilePath)) {
      console.log(`📂 기존 오류 파일 발견 - 이미 처리된 youtube_link 확인 중...`);
      const errorContent = readFileSync(errorFilePath, 'utf-8');
      const errorLines = errorContent.trim().split('\n').filter(line => line.trim());
      for (const line of errorLines) {
        try {
          const data = JSON.parse(line);
          if (data.youtube_link) {
            processedLinks.add(data.youtube_link);
          }
        } catch (e) {
          // 파싱 실패 무시
        }
      }
    }
    
    console.log(`✅ 이미 처리된 레코드: ${processedLinks.size}개\n`);

    // 여러 브라우저 초기화 (각각 고유 ID 부여)
    console.log(`🚀 ${parallelCount}개의 브라우저 초기화 중...`);
    for (let i = 0; i < parallelCount; i++) {
      const evaluator = new PerplexityEvaluator(i);
      await evaluator.initialize();
      evaluators.push(evaluator);
      console.log(`✅ 브라우저 ${i + 1}/${parallelCount} 초기화 완료`);
    }

    // 미처리 레코드만 필터링
    const recordsToProcess: string[] = [];
    let skippedCount = 0;
    
    for (const line of lines) {
      try {
        const record = JSON.parse(line.trim());
        const youtubeLink = record.youtube_link;
        
        if (processedLinks.has(youtubeLink)) {
          skippedCount++;
          continue;
        }
        
        recordsToProcess.push(line);
      } catch (e) {
        console.error(`❌ JSON 파싱 오류, 건너뜀:`, e);
        continue;
      }
    }
    
    console.log(`⏭️  건너뛴 레코드: ${skippedCount}개 (이미 처리됨)`);
    
    // 전체 레코드 처리
    const finalRecords = recordsToProcess;
    
    console.log(`\n🎯 ${finalRecords.length}개의 레코드를 ${parallelCount}개 브라우저로 처리합니다.\n`);

    // 병렬 처리 함수
    const processRecord = async (evaluator: PerplexityEvaluator, recordIndex: number) => {
      const line = finalRecords[recordIndex];
      
      try {
        const record = JSON.parse(line.trim());

        // evaluation_target에서 평가할 음식점 필터링
        const evaluationTarget = record.evaluation_target || {};
        const restaurants = record.restaurants || [];

        // 평가 대상이 되는 음식점만 필터링
        const restaurantsToEvaluate = restaurants.filter((restaurant: any) =>
          evaluationTarget[restaurant.name] === true
        );

        if (restaurantsToEvaluate.length === 0) {
          console.log(`⏭️ 레코드 ${recordIndex + 1} 건너뜀 - 평가 대상 음식점 없음`);
          return;
        }

        console.log(`\n🏪 레코드 ${recordIndex + 1}/${finalRecords.length} 평가 시작`);
        console.log(`📝 유튜브 링크: ${record.youtube_link}`);
        console.log(`🍽️ 평가 대상 음식점: ${restaurantsToEvaluate.map((r: any) => r.name).join(', ')}`);

        // 평가용 데이터 구조 생성 (Thread 정리는 배치 시작 시에만 수행됨)
        const evaluationData = {
          youtube_link: record.youtube_link,
          restaurants: restaurantsToEvaluate
        };

        const restaurantData = JSON.stringify(evaluationData, null, 2);

        // 프롬프트 생성
        const prompt = EVALUATION_PROMPT_TEMPLATE.replace('{restaurant_data}', restaurantData);

        // Perplexity를 통한 평가
        const result = await evaluator.processEvaluation(record.youtube_link, prompt);

        if (result.success && result.data) {
          // 기존 레코드에 evaluation_results 병합
          const updatedRecord = {
            ...record,
            evaluation_results: {
              ...(record.evaluation_results || {}),
              ...result.data
            }
          };

          // 결과를 JSONL 파일에 한 줄씩 저장
          const resultLine = JSON.stringify(updatedRecord) + '\n';

          // 결과 파일에 추가
          const { writeFileSync, appendFileSync, existsSync } = await import('fs');
          const resultFilePath = join(process.cwd(), 'tzuyang_restaurant_evaluation_results.jsonl');

          if (!existsSync(resultFilePath)) {
            writeFileSync(resultFilePath, '', 'utf-8');
          }
          appendFileSync(resultFilePath, resultLine, 'utf-8');

          console.log(`✅ 레코드 ${recordIndex + 1} 평가 완료 및 저장됨`);
        } else if (result.error) {
          console.log(`❌ 레코드 ${recordIndex + 1} 평가 실패: ${result.error}`);
          
          // 에러 발생 시 에러 로그 파일에 저장
          const { appendFileSync, existsSync, writeFileSync } = await import('fs');
          const errorFilePath = join(process.cwd(), 'tzuyang_restaurant_evaluation_errors.jsonl');
          
          if (!existsSync(errorFilePath)) {
            writeFileSync(errorFilePath, '', 'utf-8');
          }
          
          const errorLine = JSON.stringify({
            ...record,
            error: result.error
          }) + '\n';
          
          appendFileSync(errorFilePath, errorLine, 'utf-8');
        }

      } catch (parseError) {
        console.error(`❌ 레코드 ${recordIndex + 1} JSON 파싱 실패:`, parseError);
      }
    };

    // 병렬 처리 실행
    let currentRecordIndex = 0;
    const activePromises: Promise<void>[] = [];
    let isFirstBatch = true;
    let processedCount = 0; // 처리된 레코드 수 (30개마다 휴식용)

    while (currentRecordIndex < finalRecords.length) {
      // 30개 처리마다 휴식 (처음 제외)
      if (processedCount > 0 && processedCount % 30 === 0) {
        const restTime = Math.floor(Math.random() * 120000) + 120000; // 2-4분 (120000-240000ms)
        console.log(`\n� 30개 처리 완료 - ${(restTime/60000).toFixed(1)}분 휴식 중... (과부하 방지)`);
        await new Promise(resolve => setTimeout(resolve, restTime));
        console.log(`✅ 휴식 완료 - 처리 재개\n`);
      }

      // 배치 시작 시 첫 번째 브라우저에서만 Delete All 수행
      if (isFirstBatch || currentRecordIndex % parallelCount === 0) {
        const firstEvaluator = evaluators[0];
        console.log('\n🧹 [배치 시작] 첫 번째 브라우저에서 쓰레드 정리 중...');
        try {
          await firstEvaluator.deleteAllThreads();
        } catch (deleteError) {
          console.error('⚠️ 쓰레드 삭제 실패 (계속 진행):', deleteError);
        }
        isFirstBatch = false;
      }

      // 각 브라우저에 작업 할당
      for (let i = 0; i < parallelCount && currentRecordIndex < finalRecords.length; i++) {
        const evaluator = evaluators[i];
        const recordIndex = currentRecordIndex;
        
        const promise = processRecord(evaluator, recordIndex);
        activePromises.push(promise);
        
        currentRecordIndex++;
      }

      // 현재 배치의 모든 작업이 완료될 때까지 대기
      await Promise.all(activePromises);
      processedCount += activePromises.length; // 처리된 개수 누적
      activePromises.length = 0; // 배열 초기화

      // 다음 배치 전 잠시 대기
      if (currentRecordIndex < finalRecords.length) {
        console.log('⏳ 다음 배치를 위해 3초 대기...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    console.log('\n🎉 모든 평가가 완료되었습니다!');

  } catch (error) {
    console.error('❌ 오류 발생:', error);
  } finally {
    // 모든 브라우저 종료
    console.log('\n🔄 브라우저 종료 중...');
    for (let i = 0; i < evaluators.length; i++) {
      try {
        await evaluators[i].close();
        console.log(`✅ 브라우저 ${i + 1}/${evaluators.length} 종료 완료`);
      } catch (e) {
        console.error(`❌ 브라우저 ${i + 1} 종료 실패:`, e);
      }
    }

    // 프로그램 종료 대기
    console.log('\n프로그램을 종료하려면 Enter 키를 누르세요...');
    await askUser('');
  }
}

// 프로그램 실행
main().catch(console.error);