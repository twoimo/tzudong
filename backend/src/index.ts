import { PerplexityCrawler } from './perplexity-crawler.js';
import { JsonlProcessor } from './jsonl-processor.js';
import { ProcessingResult } from './types.js';

// 프롬프트 템플릿
const PROMPT_TEMPLATE = `당신은 유튜브 URL에서 맛집 정보를 추출하는 AI입니다.

<유튜브 링크>에 있는 '영상 url'을 **하나씩 방문하여(동시 처리하지 않음)** 유튜버가 간 음식점에 대한 정보를 정리해야 합니다.

또한, Python을 포함한 어떤 프로그래밍 언어도 사용하지 마시고, 코드 실행 없이 모든 절차를 스레드 내부에서 직접 처리해야 합니다. 한 번에 하나의 YouTube 링크만 다루어 주세요.

<작업 순서>

1. YouTube 분석 (youtube:get_video_information)

- <유튜브 링크>에 있는 각 url로 툴을 호출합니다.

- (매우 중요) 영상 3분 내의 **식당 간판, 영상 내 자막, 메뉴판 등의 시각 정보**를 반드시 최우선으로 정밀 분석하여, 식당명과 **'특정 지점명'(예: 약수점)**까지 반드시 확보합니다. 음성 기록(transcript)이나 제목(title)은 보조 자료로만 활용하며, 시각 정보가 음성 기록과 다를 경우 **시각 정보를 최우선으로 신뢰합니다.**

- (매우 중요) 시각 정보에서 **'식당 간판 내 식당 이름', '식당 이름과 관련한 영상 내 자막'을 가장 먼저 찾아내어 분석하고**, 해당 정보가 없을 시에 그 이외의 것을 후순위로 참고할 것.

- 반드시 유튜버가 해당 음식점을 방문한 것이 맞는지 여러 정보들을 '크로스체킹'하여 정확하게 파악해야 합니다.

- 특정 지점명이 있는 음식점일 경우, 영상 내 자막, 간판, 유튜버의 발화 내용 기반으로 지역을 추측할 수 있지만, 프랜차이즈 브랜드명은 추측 절대 금지.

- **유튜버가 자리를 찾아 식탁 앞에 앉아 있는 상황에서 영상 30초~2분 전에 음식점 정보에 힌트가 있는 경우가 많습니다.**

2. Google 검색 (google:search)

- 1단계 단서(예: "쯔양 이스탄불 홍합밥")로 툴을 호출합니다.

- 가장 정확한 상호명과 위치 정보를 확보합니다.

- 1의 결과와 유튜버명 '쯔양' 키워드를 포함하여 게시글 검색을 통해 음식점을 특정할 수 있습니다.

3. 위치 확정 (지도 검색)

- 2단계에서 확보한 정보(식당명, 위치 단서)를 기반으로 한국 음식점인지 해외 음식점인지 판단합니다.

- [한국 음식점의 경우] 네이버 지도 검색

1) 2단계 정보(예: "군산 달구지 소곱창")로 '네이버 지도 검색'을 수행하여 정확한 상호명, 주소, 전화번호, 좌표를 확보합니다.

2) 이 응답을 최종 데이터 출처로 사용합니다.

- [해외 음식점의 경우] Google Maps 확정 (Maps)

1) 2단계 정보(예: "Midyeci Ahmet, Beşiktaş, İstanbul")로 툴을 호출합니다.

2) 이 응답(place 객체)을 최종 데이터 출처로 사용합니다.

4. JSONL 생성

- name, phone, address, lat (latitude), lng (longitude): 3단계의 확정된 지도 응답(네이버 지도 또는 Google Maps)에서 추출 (없으면 null).

- youtube_link: 원본 URL 입력.

- reasoning_basis: 추론 근거(음식점 정보 정리의 판단 근거) 작성.

- category: Maps 응답의 types 등을 분석하여 아래 필수 카테고리 1개로 매핑 (없으면 null).

필수 카테고리: ["치킨", "중식", "돈까스·회", "피자", "패스트푸드", "찜·탕", "족발·보쌈", "분식", "카페·디저트", "한식", "고기", "양식", "아시안", "야식", "도시락"]

(예: "seafood_restaurant" -> "돈까스·회", "korean_restaurant" -> "한식", "cafe" -> "카페·디저트")

</작업 순서>

<작성 규칙>

- **모르거나 정보 추출 실패 시 반드시 추측하지 않고, null로 두어야 함(다만, youtube_link는 반드시 작성).**

</작성 규칙>

<출력 규칙>

1) **최종 출력은 <유튜브 링크>들에 대해 정보를 저장한 jsonl(한 줄씩 작성)만 출력함(다른 설명, 마크다운 태그 없음).**

2) 출력 시 key는 name, phone, address, lat, lng, category, youtube_link, reasoning_basis만 있어야 함.

3) key 설명

- name: 음식점 이름

- phone: 전화번호

- address: 주소

- lat: 위도

- lng: 경도

- category: 음식 종류

- youtube_link: 유튜브 url

- reasoning_basis: 판단 근거

4) **<작성 규칙>에서 '예.'는 예시일 뿐이므로 출력 결과값으로 사용하지 않으며, 반드시 <작성 규칙>에 따라 정리한 결과를 사용합니다.**

</출력 규칙>

<유튜브 링크>

<유튜브 링크>`;

async function main() {
  console.log('🚀 Starting Perplexity Restaurant Info Crawler...\n');

  const crawler = new PerplexityCrawler();
  const processor = new JsonlProcessor();

  try {
    // 브라우저 초기화
    console.log('📺 Initializing browser...');
    await crawler.initialize();

    console.log('✅ Browser ready! Chrome window should be visible now.');
    console.log('💡 If you see a login prompt, please log in manually.\n');

    // 남은 작업 수 확인
    const remainingCount = processor.getRemainingCount();
    console.log(`📊 Found ${remainingCount} entries to process\n`);

    if (remainingCount === 0) {
      console.log('✅ All entries are already processed!');
      return;
    }

    let processed = 0;
    let successCount = 0;
    let errorCount = 0;

    // 테스트 모드 또는 일반 모드 결정
    const TEST_MODE = process.env.TEST_MODE === 'true';
    const maxToProcess = TEST_MODE ? 1 : remainingCount; // 전체 처리 모드
    console.log(`🎯 Processing up to ${maxToProcess} entries this run (${TEST_MODE ? 'TEST MODE' : 'FULL MODE'})\n`);

    for (let i = 0; i < maxToProcess; i++) {
      const nextEntry = processor.getNextNullEntry();
      if (!nextEntry) break;

      console.log(`\n🔄 Processing ${processed + 1}/${remainingCount}: ${nextEntry.youtube_link}`);

      try {
        const result: ProcessingResult = await crawler.processYouTubeLink(
          nextEntry.youtube_link,
          PROMPT_TEMPLATE
        );

        if (result.success && result.data) {
          try {
            const updated = processor.updateEntry(nextEntry.youtube_link, result.data);
            if (updated) {
              successCount++;
              console.log(`✅ Successfully updated: ${result.data.name || 'Unknown'}`);
            } else {
              errorCount++;
              console.log('❌ Failed to update file');
            }
          } catch (fileError) {
            errorCount++;
            console.log(`❌ File update error: ${fileError instanceof Error ? fileError.message : 'Unknown file error'}`);
          }
        } else {
          errorCount++;
          console.log(`❌ Processing failed: ${result.error}`);

          // 연속된 오류가 3번 이상이면 잠시 대기
          if (errorCount >= 3 && errorCount % 3 === 0) {
            console.log('⏸️ Multiple errors detected, waiting 30 seconds...');
            await new Promise(resolve => setTimeout(resolve, 30000));
          }
        }

      } catch (error) {
        errorCount++;
        console.log(`❌ Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      processed++;

      // 진행 상황 표시
      console.log(`📈 Progress: ${processed}/${remainingCount} (Success: ${successCount}, Errors: ${errorCount})`);

      // 각 요청 사이에 잠시 대기 (서버 부하 방지)
      if (i < maxToProcess - 1) {
        console.log('⏳ Waiting 10 seconds before next request...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }

    console.log('\n🎉 Processing completed!');
    console.log(`📊 Final Results: ${successCount} successful, ${errorCount} errors`);
    console.log(`📊 Remaining entries: ${processor.getRemainingCount()}`);

  } catch (error) {
    console.error('💥 Fatal error:', error);
  } finally {
    await crawler.close();
  }
}

// 실행
main().catch(console.error);
