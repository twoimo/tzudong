import { PerplexityCrawler } from './dist/perplexity-crawler.js';
import { JsonlProcessor } from './dist/jsonl-processor.js';

// 간단한 프롬프트로 테스트
const TEST_PROMPT_TEMPLATE = `당신은 유튜브 URL에서 맛집 정보를 추출하는 AI입니다.

<유튜브 링크>에 있는 '영상 url'을 **하나씩 방문하여** 유튜버가 간 음식점에 대한 정보를 정리해야 합니다.

최종 출력은 name, phone, address, lat, lng, category, youtube_link, reasoning_basis만 있는 JSONL로 출력하세요.

<유튜브 링크>`;

async function testFullProcess() {
  console.log('🧪 Testing full process with minimal prompt...\n');

  const crawler = new PerplexityCrawler();
  const processor = new JsonlProcessor();

  try {
    // 브라우저 초기화
    console.log('📺 Initializing browser...');
    await crawler.initialize();

    console.log('✅ Browser ready!');

    // 남은 작업 수 확인
    const remainingCount = processor.getRemainingCount();
    console.log(`📊 Found ${remainingCount} entries to process`);

    if (remainingCount === 0) {
      console.log('✅ All entries are already processed!');
      return;
    }

    // 첫 번째 null 항목 가져오기
    const nextEntry = processor.getNextNullEntry();
    if (!nextEntry) {
      console.log('❌ No null entries found');
      return;
    }

    console.log(`🎯 Testing with: ${nextEntry.youtube_link}`);

    // 실제 크롤링 시도
    const result = await crawler.processYouTubeLink(
      nextEntry.youtube_link,
      TEST_PROMPT_TEMPLATE
    );

    if (result.success && result.data) {
      console.log('✅ Processing successful!');
      console.log('📄 Extracted data:', result.data);
    } else {
      console.log('❌ Processing failed:', result.error);
    }

  } catch (error) {
    console.error('💥 Test failed:', error);
  } finally {
    await crawler.close();
    console.log('🧹 Browser closed.');
  }
}

testFullProcess();
