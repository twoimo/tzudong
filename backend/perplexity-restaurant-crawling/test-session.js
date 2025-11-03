const { PerplexityCrawler } = require('./dist/perplexity-crawler.js');

async function testSessionManagement() {
  console.log('🧪 세션 관리 기능 테스트\n');

  const crawler = new PerplexityCrawler();

  try {
    // 1. 브라우저 초기화 (세션 복원 시도)
    console.log('1️⃣ 브라우저 초기화 및 세션 복원 테스트');
    await crawler.initialize();

    // 2. 로그인 상태 확인
    console.log('\n2️⃣ 로그인 상태 확인');
    const isLoggedIn = await crawler.ensureLoggedIn();
    console.log(`로그인 상태: ${isLoggedIn ? '✅ 로그인됨' : '❌ 로그인 필요'}`);

    // 3. 세션 저장 테스트
    console.log('\n3️⃣ 세션 저장 테스트');
    await crawler.saveSession();

    console.log('\n✅ 세션 관리 테스트 완료');

  } catch (error) {
    console.error('❌ 테스트 실패:', error.message);
  } finally {
    // 세션 저장 후 브라우저 닫기
    await crawler.close();
  }
}

testSessionManagement();
