import { PerplexityCrawler } from './dist/perplexity-crawler.js';

async function testLoginDetection() {
  console.log('🧪 Testing improved login detection...');

  const crawler = new PerplexityCrawler();

  try {
    console.log('📺 Initializing browser...');
    await crawler.initialize();
    console.log('✅ Browser ready! Check the login detection results below.\n');

    // Navigate to Perplexity
    console.log('🌐 Navigating to Perplexity...');
    await crawler.page.goto('https://www.perplexity.ai/', {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    console.log('⏳ Waiting for page elements...');
    await crawler.page.waitForSelector('#ask-input', { timeout: 30000 });

    // Test the improved login detection
    console.log('🔍 Testing login detection logic...\n');

    const loginStatus = await crawler.page.evaluate(() => {
      // 로그인 모달 요소들 확인 (로그아웃 상태 표시)
      const loginModal = document.querySelector('[data-testid="login-modal"]');
      const floatingSignupClose = document.querySelector('button[data-testid="floating-signup-close-button"]');

      // 로그인 텍스트 확인
      const loginTextElements = document.querySelectorAll('div.mb-xs.text-center.font-sans.text-base.font-medium.text-foreground');
      let hasLoginText = false;
      for (const element of loginTextElements) {
        if (element.textContent?.includes('로그인하거나 계정 만들기')) {
          hasLoginText = true;
          break;
        }
      }

      // Google/Apple 로그인 버튼 확인
      const googleLoginButton = document.querySelector('button svg[xmlns*="google"]')?.closest('button');
      const appleLoginButton = document.querySelector('button svg[xmlns*="apple"]')?.closest('button');

      // 계정 관련 요소들 확인 (로그인 상태 표시)
      const accountButton = document.querySelector('[data-testid="account-button"]') ||
        document.querySelector('button[aria-label*="계정"]') ||
        document.querySelector('.account-button');

      const userMenu = document.querySelector('[data-testid="user-menu"]') ||
        document.querySelector('.user-menu');

      // 프로필 메뉴 또는 설정 메뉴 확인
      const profileMenu = document.querySelector('[data-testid*="profile"]') ||
        document.querySelector('[aria-label*="프로필"]') ||
        document.querySelector('[aria-label*="설정"]');

      // 입력 필드가 활성화되어 있는지 확인 (로그인 상태의 간접 지표)
      const inputField = document.querySelector('#ask-input') as HTMLElement;
      const isInputEnabled = inputField && !inputField.hasAttribute('disabled') && inputField.offsetParent !== null;

      // 로그인 모달이 명확히 존재하는지 확인
      const hasLoginModal = !!(loginModal || floatingSignupClose || hasLoginText || googleLoginButton || appleLoginButton);

      // 로그인 상태 지표들
      const loginIndicators = [accountButton, userMenu, profileMenu].filter(Boolean);
      const isLoggedIn = loginIndicators.length > 0 && isInputEnabled && !hasLoginModal;

      return {
        isLoggedIn,
        hasLoginModal,
        indicators: {
          accountButton: !!accountButton,
          userMenu: !!userMenu,
          profileMenu: !!profileMenu,
          inputEnabled: !!isInputEnabled,
          loginModal: !!loginModal,
          floatingSignup: !!floatingSignupClose,
          loginText: hasLoginText,
          googleButton: !!googleLoginButton,
          appleButton: !!appleLoginButton
        }
      };
    });

    console.log('📊 Login Detection Results:');
    console.log('========================');
    console.log(`로그인 상태: ${loginStatus.isLoggedIn ? '✅ 로그인됨' : '❌ 로그인 안됨'}`);
    console.log(`로그인 모달 존재: ${loginStatus.hasLoginModal ? '✅ 있음' : '❌ 없음'}`);
    console.log('\n🔍 세부 지표:');
    console.log(JSON.stringify(loginStatus.indicators, null, 2));

    console.log('\n✅ Login detection test completed successfully!');

  } catch (error) {
    console.error('❌ Login detection test failed:', error.message);
  } finally {
    await crawler.close();
    console.log('🧹 Browser closed.');
  }
}

testLoginDetection();
