import { PerplexityCrawler } from './dist/perplexity-crawler.js';

async function testLoginDetection() {
  const crawler = new PerplexityCrawler();

  try {
    console.log('🧪 Testing login detection...');
    await crawler.initialize();

    // 페이지 로드 대기
    await crawler.page.waitForSelector('#ask-input', { timeout: 10000 });

    // 로그인 상태 확인
    const loginStatus = await crawler.page.evaluate(() => {
      // 로그인 모달이 있으면 로그인되지 않은 상태
      const loginModal = document.querySelector('[data-testid="login-modal"]') ||
                        document.querySelector('div[class*="animate-in"][class*="fade-in"]') ||
                        document.querySelector('button[data-testid="floating-signup-close-button"]');

      // "로그인하거나 계정 만들기" 텍스트가 있으면 로그인 모달
      const loginText = document.querySelector('div.mb-xs.text-center.font-sans.text-base.font-medium.text-foreground');
      const hasLoginText = loginText && loginText.textContent?.includes('로그인하거나 계정 만들기');

      // 계정 버튼이나 사용자 메뉴가 있으면 로그인된 상태
      const accountButton = document.querySelector('[data-testid="account-button"]') ||
                           document.querySelector('button[aria-label*="계정"]') ||
                           document.querySelector('button:has-text("계정")') ||
                           document.querySelector('.account-button');

      const userMenu = document.querySelector('[data-testid="user-menu"]') ||
                      document.querySelector('.user-menu');

      const isLoggedIn = !!(accountButton || userMenu);
      const hasLoginModal = !!(loginModal || hasLoginText);

      return {
        isLoggedIn,
        hasLoginModal,
        loginModalFound: !!loginModal,
        loginTextFound: !!loginText,
        loginTextContent: loginText?.textContent,
        accountButtonFound: !!accountButton,
        userMenuFound: !!userMenu
      };
    });

    console.log('📊 Login detection result:');
    console.log(`   - Is logged in: ${loginStatus.isLoggedIn}`);
    console.log(`   - Has login modal: ${loginStatus.hasLoginModal}`);
    console.log(`   - Login modal found: ${loginStatus.loginModalFound}`);
    console.log(`   - Login text found: ${loginStatus.loginTextFound}`);
    console.log(`   - Login text content: "${loginStatus.loginTextContent}"`);
    console.log(`   - Account button found: ${loginStatus.accountButtonFound}`);
    console.log(`   - User menu found: ${loginStatus.userMenuFound}`);

    if (loginStatus.hasLoginModal) {
      console.log('\n⚠️  Login modal detected! Please log in manually.');
    } else if (loginStatus.isLoggedIn) {
      console.log('\n✅ Already logged in!');
    } else {
      console.log('\n❓ Login status unclear - please check manually.');
    }

    console.log('\n⏳ Keeping browser open for 10 seconds...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    await crawler.close();
    console.log('✅ Test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

testLoginDetection();
