import { PerplexityCrawler } from './headless-perplexity-crawler.js';
import { JsonlProcessor } from './jsonl-processor.js';
import { ProcessingResult } from './types.js';

// Headless 모드 병렬 처리 설정 (1개 고정)
const PARALLEL_WORKERS = 1;
const DELAY_BETWEEN_STARTS = 5000; // 브라우저 시작 간격 (5초)

// 프롬프트 템플릿
const PROMPT_TEMPLATE = `당신은 유튜브 URL에서 맛집 정보를 추출하는 AI입니다.

<유튜브 링크>을 방문하여 유튜버가 간 음식점에 대한 정보를 정리해야 합니다.

또한, Python을 포함한 어떤 프로그래밍 언어도 사용하지 마시고, 코드 실행 없이 모든 절차를 스레드 내부에서 직접 처리해야 합니다. 하나의 YouTube 링크에서 여러 개의 식당 정보를 추출할 수 있습니다.

<작업 순서>

**중요: 이 영상에서 등장하는 모든 식당 정보를 찾아서 각각에 대해 별도의 JSON 객체를 생성해야 합니다.**

1. YouTube 영상 분석 (youtube:get_video_information)

- <유튜브 링크>의 전체 영상을 분석하여 **등장하는 모든 식당을 찾아냅니다**.

- 각 식당마다 다음 정보를 수집:
  - (매우 중요) 유튜브 영상 내의 **식당 간판, 영상 내 자막, 메뉴판 등의 시각 정보**를 반드시 최우선으로 정밀 분석하여, 식당명과 **'특정 지점명'(예: 약수점)**까지 반드시 확보합니다.
  - (매우 중요) 시각 정보에서 **'식당 간판 내 식당 이름', '식당 이름과 관련한 영상 내 자막'을 가장 먼저 찾아내어 분석합니다**.
  - 반드시 유튜버가 해당 음식점을 방문한 것이 맞는지 여러 정보들을 '크로스체킹'하여 정확하게 파악해야 합니다.
  - **유튜버가 자리를 찾아 식탁 앞에 앉아 있는 상황에서 영상 30초~2분 전에 음식점 정보에 힌트가 있는 경우가 많습니다.**

2. Google 검색 (google:search)

- 각 식당마다 1단계에서 확보한 단서(예: "쯔양 군산 빈해원 짬뽕")로 툴을 호출합니다.

- 가장 정확한 상호명과 위치 정보를 확보합니다.

- 1의 결과와 유튜버명 '쯔양' 키워드를 포함하여 게시글 검색을 통해 음식점을 특정할 수 있습니다.

3. 위치 확정 (지도 검색)

- 각 식당마다 2단계에서 확보한 정보(식당명, 위치 단서)를 기반으로 한국 음식점인지 해외 음식점인지 판단합니다.

- [한국 음식점의 경우] 네이버 지도 검색

1) 2단계 정보(예: "군산 빈해원 중식당")로 '네이버 지도 검색'을 수행하여 정확한 상호명, 주소, 전화번호, 좌표를 확보합니다.

2) 이 응답을 최종 데이터 출처로 사용합니다.

- [해외 음식점의 경우] Google Maps 확정 (Maps)

1) 2단계 정보(예: "Midyeci Ahmet, Beşiktaş, İstanbul")로 툴을 호출합니다.

2) 이 응답(place 객체)을 최종 데이터 출처로 사용합니다.

4. 쯔양 리뷰 요약

- **각 음식점마다** 쯔양이 영상에서 한 리뷰 내용을 전부 요약하여 정리합니다.

- 쯔양의 구체적인 의견, 맛 평가, 추천 이유, 특징 등을 포함하여 상세하게 요약합니다.

- 영상 전체를 통해 해당 음식점에 대한 쯔양의 모든 언급과 평가를 종합합니다.

5. JSONL 생성

- **영상에서 등장하는 각 식당마다 별도의 JSON 객체를 생성합니다**.

- 각 JSON 객체의 필드:
  - name, phone, address, lat (latitude), lng (longitude): 3단계의 확정된 지도 응답에서 추출 (없으면 null).
  - youtube_link: 원본 URL 입력.
  - reasoning_basis: 추론 근거(해당 식당 정보 정리의 판단 근거) 작성.
  - tzuyang_review: 4단계에서 요약한 쯔양의 해당 식당 리뷰 내용 (없으면 null).
  - category: Maps 응답의 types 등을 분석하여 아래 필수 카테고리 1개로 매핑 (없으면 null).

필수 카테고리: ["치킨", "중식", "돈까스·회", "피자", "패스트푸드", "찜·탕", "족발·보쌈", "분식", "카페·디저트", "한식", "고기", "양식", "아시안", "야식", "도시락"]

(예: "seafood_restaurant" -> "돈까스·회", "korean_restaurant" -> "한식", "cafe" -> "카페·디저트")

</작업 순서>

<작성 규칙>

- **모르거나 정보 추출 실패 시 반드시 추측하지 않고, null로 두어야 함(다만, youtube_link는 반드시 작성).**

</작성 규칙>

<출력 규칙>

1) **하나의 유튜브 링크에서 여러 개의 식당이 등장할 경우, 각 식당마다 별도의 JSON 객체를 생성하여 한 줄씩 출력함.**

2) **최종 출력은 식당 정보 JSON 객체들만 출력함(다른 설명, 마크다운 태그 없음).**

3) 출력 시 각 JSON 객체의 key는 name, phone, address, lat, lng, category, youtube_link, reasoning_basis, tzuyang_review만 있어야 함.

4) key 설명

- name: 음식점 이름

- phone: 전화번호

- address: 주소

- lat: 위도

- lng: 경도

- category: 음식 종류

- youtube_link: 유튜브 url

- reasoning_basis: 판단 근거

- tzuyang_review: 쯔양의 리뷰 요약

4) **<작성 규칙>에서 '예.'는 예시일 뿐이므로 출력 결과값으로 사용하지 않으며, 반드시 <작성 규칙>에 따라 정리한 결과를 사용합니다.**

</출력 규칙>
`;

/**
 * 단일 크롤러로 URL 처리 (병렬 처리용)
 */
async function processWithCrawler(crawler: PerplexityCrawler, youtubeLink: string, processor: JsonlProcessor): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`🎬 처리 시작: ${youtubeLink}`);

    const result: ProcessingResult = await crawler.processYouTubeLink(youtubeLink, PROMPT_TEMPLATE);

    if (result.success && result.data && result.data.length > 0) {
      const updated = processor.updateEntry(youtubeLink, result.data);
      if (updated) {
        console.log(`✅ 처리 완료: ${youtubeLink} (${result.data.length}개 레스토랑)`);
        return { success: true };
      } else {
        console.log(`❌ 파일 업데이트 실패: ${youtubeLink}`);
        return { success: false, error: '파일 업데이트 실패' };
      }
    } else {
      console.log(`❌ 처리 실패: ${youtubeLink} - ${result.error}`);
      return { success: false, error: result.error };
    }

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류';
    console.error(`❌ 처리 중 오류: ${youtubeLink} - ${errorMsg}`);

    // 크롤링 실패 시 세션 상태 확인 (구글 로그인 만료 가능성)
    try {
      console.log('🔍 크롤링 실패로 인한 세션 검증 중...');
      const sessionValid = await crawler.ensureSession();
      if (!sessionValid) {
        console.log('⚠️  세션 만료가 의심됩니다. 다음 크롤링에서 재로그인이 필요할 수 있습니다.');
      }
    } catch (sessionError) {
      console.warn('세션 검증 실패:', sessionError instanceof Error ? sessionError.message : 'Unknown error');
    }

    return { success: false, error: errorMsg };
  }
}

/**
 * 청크 단위로 배열 나누기
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * 단일 모드로 순차 처리
 */
/**
 * 단일 모드로 순차 처리
 */
async function processSequentially(youtubeLinks: string[], processor: JsonlProcessor): Promise<void> {
  const crawler = new PerplexityCrawler(0); // browserId 0 (단일 모드)

  try {
    // 브라우저 초기화
    console.log('📺 브라우저 초기화 중...');
    await crawler.initialize();
    console.log('✅ 브라우저 준비 완료! Chrome 창이 보이면 로그인해주세요.\n');

    let processed = 0;
    let successCount = 0;
    let errorCount = 0;

    for (const youtubeLink of youtubeLinks) {
      console.log(`\n🔄 처리 중 ${processed + 1}/${youtubeLinks.length}: ${youtubeLink}`);

      try {
        const result: ProcessingResult = await crawler.processYouTubeLink(
          youtubeLink,
          PROMPT_TEMPLATE
        );

        if (result.success && result.data && result.data.length > 0) {
          const updated = processor.updateEntry(youtubeLink, result.data);
          if (updated) {
            successCount++;
            console.log(`✅ 업데이트 완료: ${result.data.length}개 레스토랑 추출`);
          } else {
            errorCount++;
            console.log('❌ 파일 업데이트 실패');
          }
        } else {
          errorCount++;
          console.log(`❌ 처리 실패: ${result.error}`);
        }

      } catch (error) {
        errorCount++;
        console.log(`❌ 오류 발생: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      }

      processed++;

      // 진행 상황 표시
      console.log(`📈 진행률: ${processed}/${youtubeLinks.length} (성공: ${successCount}, 실패: ${errorCount})`);

      // 마지막 항목이 아니면 대기
      if (processed < youtubeLinks.length) {
        console.log('⏳ 다음 요청까지 10초 대기...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }

    console.log('\n🎉 순차 처리 완료!');
    console.log(`📊 결과: ${successCount}개 성공, ${errorCount}개 실패`);

  } catch (error) {
    console.error('💥 순차 처리 중 치명적 오류:', error);
  } finally {
    await crawler.close();
  }
}

async function main() {
  console.log('🍜 쯔양 맛집 크롤러 시작! (Headless 모드 - 단일 처리)\n');

  try {
    // JSONL 파일 프로세서 생성
    const processor = new JsonlProcessor('./tzuyang_restaurant_results.jsonl');
    
    // 파일 존재 여부 확인
    const fs = await import('fs');
    const jsonlExists = fs.existsSync('./tzuyang_restaurant_results.jsonl');
    
    let allUrls: string[] = [];
    let processedUrls: Set<string> = new Set();
    
    if (jsonlExists) {
      // 기존 파일이 있으면 이미 처리된 URL 수집
      const entries = processor.readAllEntries();
      entries.forEach(entry => {
        if (entry.youtube_link) {
          processedUrls.add(entry.youtube_link);
        }
      });
      console.log(`📋 기존 파일에서 ${entries.length}개 항목 로드 (처리 완료: ${Array.from(processedUrls).filter(url => {
        const entry = entries.find(e => e.youtube_link === url);
        return entry && entry.restaurants && entry.restaurants.length > 0;
      }).length}개)`);
    }
    
    // URL 파일에서 전체 URL 목록 읽기
    if (!fs.existsSync('./tzuyang_youtubeVideo_urls.txt')) {
      console.log('❌ tzuyang_youtubeVideo_urls.txt 파일을 찾을 수 없습니다!');
      return;
    }
    
    const urlContent = fs.readFileSync('./tzuyang_youtubeVideo_urls.txt', 'utf-8');
    allUrls = urlContent.trim().split('\n').filter(line => line.trim());
    
    if (allUrls.length === 0) {
      console.log('❌ 처리할 URL이 없습니다!');
      return;
    }
    
    // 아직 처리되지 않은 URL 필터링
    const unprocessedUrls = allUrls.filter(url => !processedUrls.has(url));
    
    if (unprocessedUrls.length === 0) {
      console.log('✅ 모든 항목이 이미 처리되었습니다!');
      return;
    }

    console.log(`📋 전체 URL: ${allUrls.length}개, 미처리: ${unprocessedUrls.length}개`);

    // Headless 모드는 단일 처리만 지원
    console.log('🔄 단일 모드: 순차 처리 시작\n');
    await processSequentially(unprocessedUrls, processor);

  } catch (error) {
    console.error('💥 치명적 오류:', error);
  }
}

/**
 * 병렬로 URL들을 처리
 */
async function processInParallel(youtubeLinks: string[], processor: JsonlProcessor): Promise<{ success: boolean; error?: string }[]> {
  const allResults: { success: boolean; error?: string }[] = [];

  try {
    // 세션 파일 존재 여부 확인
    const fs = await import('fs');
    const sessionExists = fs.existsSync('../perplexity-session.json');

    if (sessionExists) {
      console.log('📂 세션 파일 발견: 병렬 처리 시 세션 공유를 위해 각 브라우저가 세션을 복원합니다');
    } else {
      console.log('ℹ️ 세션 파일 없음: 각 브라우저가 수동 로그인을 필요로 할 수 있습니다');
    }

    // 청크 단위로 나누기 (각 청크는 PARALLEL_WORKERS만큼의 URL들)
    const chunks = chunkArray(youtubeLinks, PARALLEL_WORKERS);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      console.log(`\n📦 청크 ${chunkIndex + 1}/${chunks.length} 처리 시작 (${chunk.length}개 URL)`);

      const crawlers: PerplexityCrawler[] = [];
      const chunkPromises: Promise<{ success: boolean; error?: string }>[] = [];

      // 현재 청크의 크롤러들 초기화 (시간차를 두고)
      for (let i = 0; i < chunk.length; i++) {
        if (DELAY_BETWEEN_STARTS > 0 && i > 0) {
          console.log(`⏳ 브라우저 ${i + 1} 시작 대기...`);
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_STARTS));
        }

        try {
          const crawler = new PerplexityCrawler(crawlers.length); // browserId 전달
          await crawler.initialize();

          // 병렬 처리 시 세션 상태 확인
          if (sessionExists) {
            const loginStatus = await crawler.checkLoginStatus();
            if (loginStatus.isLoggedIn && !loginStatus.hasLoginModal) {
              console.log(`🔐 브라우저 ${crawlers.length + 1} 세션 복원 성공`);
            } else {
              console.log(`⚠️ 브라우저 ${crawlers.length + 1} 세션 복원 필요`);
            }
          }

          crawlers.push(crawler);
          console.log(`🚀 브라우저 ${crawlers.length} 초기화 완료`);
        } catch (initError) {
          console.error(`❌ 브라우저 ${i + 1} 초기화 실패:`, initError);
          // 실패한 크롤러는 건너뜀
          crawlers.push(null as any);
        }
      }

      // 현재 청크의 모든 URL을 병렬로 처리
      for (let i = 0; i < chunk.length; i++) {
        const youtubeLink = chunk[i];
        const crawler = crawlers[i];

        if (crawler) {
          chunkPromises.push(processWithCrawler(crawler, youtubeLink, processor));
        } else {
          // 크롤러 초기화 실패시 실패 결과 추가
          chunkPromises.push(Promise.resolve({ success: false, error: '브라우저 초기화 실패' }));
        }
      }

      // 현재 청크 완료 대기
      const chunkResults = await Promise.all(chunkPromises);
      allResults.push(...chunkResults);

      console.log(`✅ 청크 ${chunkIndex + 1} 완료 (${chunkResults.filter(r => r.success).length}/${chunk.length} 성공)\n`);

      // 병렬 처리 시 세션 관리: 마지막 크롤러의 세션을 전체 세션으로 갱신
      if (sessionExists && crawlers.length > 0) {
        const lastCrawler = crawlers[crawlers.length - 1];
        if (lastCrawler) {
          try {
            const loginStatus = await lastCrawler.checkLoginStatus();
            if (loginStatus.isLoggedIn && !loginStatus.hasLoginModal) {
              console.log('🔄 병렬 처리용 세션 갱신 중...');
              await lastCrawler.saveSession();
              console.log('💾 세션 파일 업데이트됨 (병렬 처리용)');
            } else {
              console.log('⚠️ 세션이 만료되었을 수 있음 - 다음 청크에서 재로그인 필요');
            }
          } catch (sessionError) {
            console.warn('세션 갱신 중 오류:', sessionError);
          }
        }
      }

      // 현재 청크의 크롤러들 정리
      for (const crawler of crawlers) {
        if (crawler) {
          try {
            await crawler.close();
          } catch (error) {
            console.warn('크롤러 정리 중 오류:', error);
          }
        }
      }
    }

  } catch (error) {
    console.error('❌ 병렬 처리 중 오류:', error);
  }

  return allResults;
}

// 실행
main().catch(console.error);
