import { PerplexityEvaluator } from './perplexity-evaluator.js';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';

// 유틸리티 함수: 여러 파일에서 처리된 URL 로드
function loadMultipleProcessedUrls(...filePaths: string[]): Set<string> {
  const allUrls = new Set<string>();
  
  for (const filePath of filePaths) {
    if (!existsSync(filePath)) continue;
    
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        if (data.youtube_link) {
          allUrls.add(data.youtube_link);
        }
      } catch (e) {
        // 파싱 실패 무시
      }
    }
  }
  
  return allUrls;
}

// 평가 프롬프트 템플릿 (index.ts와 동일)
const EVALUATION_PROMPT_TEMPLATE = `당신은 유튜버의 음식점 방문 관련 AI 기반 생성 데이터를 평가하는 전문가입니다.  
입력으로 주어지는 <평가할 데이터>는 한 유튜브 영상에서 유튜버가 방문한 음식점 데이터(restaurant 리스트 포함)입니다.  
영상 내용, reasoning_basis, tzuyang_review, category를 종합적으로 검토하여 아래의 5개 평가 항목에 대해 판단하세요.
**추측이나 새로운 정보 추가는 절대 금지하며, 반드시 아래 <평가 루브릭>의 평가기준·평가대상·출력형식을 그대로 따르세요.**
<평가할 데이터>
{restaurant_data}
</평가할 데이터>

<평가 루브릭>
- **평가는 새로운 항목이나 근거를 추가하지 말고, <평가할 데이터>와 '실제 영상' 근거를 기반으로만 판단하세요.**
- **다른 게시물/블로그 등에서 절대로 검색하지 않습니다.(오로지 해당 유튜브 영상 url 방문과 <평가할 데이터>만 이용)**
- 모든 평가항목에서 eval_basis는 **구체적으로** 작성합니다.

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
- 평가 목적: reasoning_basis가 '방문 지역 언급 → 간판/편집자막(시각정보) → 음식점 특정' 구조를 따르거나, 시각·음성·검색정보를 조합해 합리적으로 특정했는지 평가
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

async function main() {
  console.log('\n🔄 에러 레코드 재평가 시스템\n');

  const evaluators: PerplexityEvaluator[] = [];

  try {
    // 파일 경로
    const errorFilePath = join(process.cwd(), 'tzuyang_restaurant_evaluation_errors.jsonl');
    const outputFilePath = join(process.cwd(), 'tzuyang_restaurant_evaluation_results.jsonl');
    
    // youtube_meta 로드 (with_meta 파일에서)
    console.log(`📂 youtube_meta 데이터 로드 중...`);
    const metaFilePath = join(process.cwd(), '..', 'perplexity-restaurant-crawling', 'tzuyang_restaurant_results_with_meta.jsonl');
    const metaMap = new Map<string, any>();
    
    if (existsSync(metaFilePath)) {
      const metaContent = readFileSync(metaFilePath, 'utf-8');
      const metaLines = metaContent.trim().split('\n').filter(line => line.trim());
      for (const line of metaLines) {
        try {
          const data = JSON.parse(line);
          if (data.youtube_link && data.youtube_meta) {
            metaMap.set(data.youtube_link, data.youtube_meta);
          }
        } catch (e) {
          // 파싱 실패 무시
        }
      }
      console.log(`✅ youtube_meta 로드 완료: ${metaMap.size}개\n`);
    } else {
      console.log(`⚠️ youtube_meta 파일 없음 - youtube_meta 없이 진행합니다.\n`);
    }
    
    // 에러 파일 확인
    if (!existsSync(errorFilePath)) {
      console.log('❌ 에러 파일이 존재하지 않습니다:', errorFilePath);
      process.exit(1);
    }

    console.log(`📂 에러 파일 읽기: ${errorFilePath}`);
    
    const errorContent = readFileSync(errorFilePath, 'utf-8');
    const errorLines = errorContent.trim().split('\n').filter(line => line.trim());

    console.log(`📋 총 ${errorLines.length}개의 에러 레코드를 발견했습니다.`);

    if (errorLines.length === 0) {
      console.log('✅ 재평가할 에러 레코드가 없습니다!');
      process.exit(0);
    }

    // 1. 이미 성공한 youtube_link 로드 (유틸리티 함수 사용)
    console.log(`� 기존 성공 내역 확인 중...`);
    const alreadySuccessful = loadMultipleProcessedUrls(outputFilePath);
    console.log(`✅ 이미 성공한 레코드: ${alreadySuccessful.size}개\n`);

    // 2. 에러 파일에서 이미 성공한 것들 제거
    const linesToProcess = errorLines.filter(line => {
      try {
        const record = JSON.parse(line.trim());
        return !alreadySuccessful.has(record.youtube_link);
      } catch {
        return true; // 파싱 실패한 라인은 유지
      }
    });

    const skippedCount = errorLines.length - linesToProcess.length;
    if (skippedCount > 0) {
      console.log(`⏭️  이미 성공한 레코드 ${skippedCount}개 스킵 (에러 파일에서 자동 제거됨)`);
      // 에러 파일 업데이트 (이미 성공한 것 제거)
      const newErrorContent = linesToProcess.join('\n') + (linesToProcess.length > 0 ? '\n' : '');
      writeFileSync(errorFilePath, newErrorContent, 'utf-8');
      console.log(`✅ 에러 파일 업데이트 완료 (남은 에러: ${linesToProcess.length}개)`);
    }

    console.log(`📋 실제 재평가할 레코드: ${linesToProcess.length}개\n`);

    if (linesToProcess.length === 0) {
      console.log('🎉 모든 에러가 이미 처리되었습니다!');
      return;
    }

    // 병렬 처리 개수 선택
    console.log('병렬 처리할 브라우저 개수를 선택하세요:');
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

    // 여러 브라우저 초기화 (각각 고유 ID 부여)
    console.log(`🚀 ${parallelCount}개의 브라우저 초기화 중...`);
    for (let i = 0; i < parallelCount; i++) {
      const evaluator = new PerplexityEvaluator(i);
      await evaluator.initialize();
      evaluators.push(evaluator);
      console.log(`✅ 브라우저 ${i + 1}/${parallelCount} 초기화 완료`);
    }

    // 성공/실패 카운터
    let successCount = 0;
    let failCount = 0;
    const successfulYoutubeLinks = new Set<string>(); // 성공한 레코드의 youtube_link 저장

    // 병렬 처리 함수
    const processErrorRecord = async (evaluator: PerplexityEvaluator, recordIndex: number) => {
      const line = linesToProcess[recordIndex];
      
      try {
        const record = JSON.parse(line.trim());
        const youtubeLink = record.youtube_link;

        console.log(`\n🏪 레코드 ${recordIndex + 1}/${linesToProcess.length} 재평가 시작`);
        console.log(`📝 유튜브 링크: ${youtubeLink}`);

        // evaluation_target에서 평가할 음식점 필터링
        const evaluationTarget = record.evaluation_target || {};
        const restaurants = record.restaurants || [];

        const restaurantsToEvaluate = restaurants.filter((restaurant: any) =>
          evaluationTarget[restaurant.name] === true
        );

        if (restaurantsToEvaluate.length === 0) {
          console.log(`⏭️ 레코드 ${recordIndex + 1} 건너뜀 - 평가 대상 음식점 없음`);
          failCount++;
          return;
        }

        const restaurantNames = restaurantsToEvaluate.map((r: any) => r.name).join(', ');
        console.log(`🍽️ 평가 대상 음식점: ${restaurantNames}`);

        // 평가용 데이터 구조 생성
        const evaluationData = {
          youtube_link: youtubeLink,
          restaurants: restaurantsToEvaluate
        };

        const restaurantData = JSON.stringify(evaluationData, null, 2);

        // 프롬프트 생성
        const prompt = EVALUATION_PROMPT_TEMPLATE.replace('{restaurant_data}', restaurantData);

        // Perplexity 평가 실행
        const evaluationResult = await evaluator.processEvaluation(youtubeLink, prompt);

        if (evaluationResult.success && evaluationResult.data) {
          // 성공: results.jsonl에 저장
          const resultRecord: any = {
            youtube_link: youtubeLink,
            evaluation_target: evaluationTarget,
            evaluation_results: evaluationResult.data,
            restaurants: restaurants
          };
          
          // youtube_meta 추가 (있는 경우)
          const youtubeMeta = metaMap.get(youtubeLink);
          if (youtubeMeta) {
            resultRecord.youtube_meta = youtubeMeta;
          }

          const resultLine = JSON.stringify(resultRecord) + '\n';
          appendFileSync(outputFilePath, resultLine, 'utf-8');
          
          successCount++;
          successfulYoutubeLinks.add(youtubeLink);
          console.log(`✅ 레코드 ${recordIndex + 1} 재평가 성공 및 저장됨`);
        } else {
          // 실패: 그대로 errors에 유지
          failCount++;
          console.log(`❌ 레코드 ${recordIndex + 1} 재평가 실패: ${evaluationResult.error || '알 수 없는 오류'}`);
        }

      } catch (parseError) {
        console.error(`❌ 레코드 ${recordIndex + 1} JSON 파싱 실패:`, parseError);
        failCount++;
      }
    };

    // 병렬 처리 실행
    let currentRecordIndex = 0;
    const activePromises: Promise<void>[] = [];
    let isFirstBatch = true;
    let processedCount = 0; // 처리된 레코드 수 (30개마다 휴식용)

    while (currentRecordIndex < linesToProcess.length) {
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
      for (let i = 0; i < parallelCount && currentRecordIndex < linesToProcess.length; i++) {
        const evaluator = evaluators[i];
        const recordIndex = currentRecordIndex;
        
        const promise = processErrorRecord(evaluator, recordIndex);
        activePromises.push(promise);
        
        currentRecordIndex++;
      }

      // 현재 배치의 모든 작업이 완료될 때까지 대기
      await Promise.all(activePromises);
      processedCount += activePromises.length; // 처리된 개수 누적
      activePromises.length = 0; // 배열 초기화

      // 다음 배치 전 대기
      if (currentRecordIndex < linesToProcess.length) {
        console.log('\n⏳ 다음 배치를 위해 3초 대기...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    // 통계 출력
    console.log('\n' + '='.repeat(80));
    console.log('📊 재평가 완료 통계');
    console.log('='.repeat(80));
    
    // 입력 파일 통계
    const totalErrors = linesToProcess.length;
    const successRate = totalErrors > 0 ? ((successCount / totalErrors) * 100).toFixed(1) : '0.0';
    const failRate = totalErrors > 0 ? ((failCount / totalErrors) * 100).toFixed(1) : '0.0';
    
    console.log(`\n📥 입력 (에러 파일)`);
    console.log(`   총 에러 레코드: ${totalErrors}개`);    console.log(`   총 에러 레코드: ${totalErrors}개`);
    
    console.log(`\n📊 재평가 결과`);
    console.log(`   ✅ 성공: ${successCount}개 (${successRate}%)`);
    console.log(`   ❌ 실패: ${failCount}개 (${failRate}%)`);
    console.log(`   📋 총 처리: ${successCount + failCount}개`);
    
    // 최종 파일 상태
    console.log(`\n📁 최종 파일 상태`);
    
    // results.jsonl 파일 라인 수 확인
    let totalSuccessRecords = 0;
    try {
      const resultsContent = readFileSync(outputFilePath, 'utf-8');
      totalSuccessRecords = resultsContent.trim().split('\n').filter(line => line.trim()).length;
    } catch {
      totalSuccessRecords = successCount; // 파일 없으면 현재 성공 개수
    }
    
    // errors.jsonl 파일 라인 수 확인 (업데이트 후)
    let remainingErrors = 0;
    try {
      const errorsContent = readFileSync(errorFilePath, 'utf-8');
      remainingErrors = errorsContent.trim().split('\n').filter(line => line.trim()).length;
    } catch {
      remainingErrors = 0;
    }
    
    console.log(`   📄 tzuyang_restaurant_evaluation_results.jsonl: ${totalSuccessRecords}개`);
    console.log(`   📄 tzuyang_restaurant_evaluation_errors.jsonl: ${remainingErrors}개`);
    
    if (remainingErrors > 0) {
      console.log(`\n⚠️  아직 ${remainingErrors}개의 에러가 남아있습니다.`);
      console.log(`   다시 실행하려면: npm run retry-errors -- <병렬처리개수>`);
    } else {
      console.log(`\n🎉 모든 에러가 성공적으로 처리되었습니다!`);
    }
    
    console.log('='.repeat(80) + '\n');

    // 성공한 레코드를 errors.jsonl에서 제거
    if (successfulYoutubeLinks.size > 0) {
      console.log(`🗑️ 성공한 ${successfulYoutubeLinks.size}개 레코드를 에러 파일에서 제거 중...`);
      
      const remainingErrorLines = errorLines.filter(line => {
        try {
          const record = JSON.parse(line.trim());
          return !successfulYoutubeLinks.has(record.youtube_link);
        } catch {
          return true; // 파싱 실패한 라인은 유지
        }
      });

      // 에러 파일 재작성
      const newErrorContent = remainingErrorLines.join('\n') + (remainingErrorLines.length > 0 ? '\n' : '');
      writeFileSync(errorFilePath, newErrorContent, 'utf-8');
      
      console.log(`✅ 에러 파일 업데이트 완료 (남은 에러: ${remainingErrorLines.length}개)`);
    }

    console.log('\n✅ 모든 재평가 작업이 완료되었습니다!\n');
    
    // 모든 재평가 완료 후 Transform 실행
    console.log('\n🔄 Transform 작업 시작...');
    try {
      const { execSync } = await import('child_process');
      const transformScriptPath = join(process.cwd(), 'src', 'transform_evaluation_results.py');
      
      console.log(`📂 Transform 스크립트 실행: ${transformScriptPath}`);
      
      // Python 스크립트 실행
      execSync(`python3 "${transformScriptPath}"`, {
        cwd: process.cwd(),
        stdio: 'inherit'
      });
      
      console.log('\n✅ Transform 작업 완료!');
    } catch (transformError) {
      console.error('\n❌ Transform 작업 실패:', transformError);
      console.log('⚠️  Transform은 나중에 수동으로 실행할 수 있습니다: python3 src/transform_evaluation_results.py');
    }

  } catch (error) {
    console.error('❌ 오류 발생:', error);
  } finally {
    // 브라우저 종료
    console.log('🔄 브라우저 종료 중...');
    for (let i = 0; i < evaluators.length; i++) {
      try {
        await evaluators[i].close();
        console.log(`✅ 브라우저 ${i + 1}/${evaluators.length} 종료 완료`);
      } catch (closeError) {
        console.error(`❌ 브라우저 ${i + 1} 종료 실패:`, closeError);
      }
    }

    console.log('\n✅ 프로그램 종료');
  }
}

main();
