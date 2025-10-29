import puppeteer, { Browser, Page } from 'puppeteer';
import { RestaurantInfo, ProcessingResult } from './types.js';

export class PerplexityCrawler {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async initialize(): Promise<void> {
    console.log('🚀 Starting browser initialization...');

    try {
      // Chrome 실행 파일 경로 설정
      let executablePath: string | undefined;

      if (process.platform === 'win32') {
        // Windows 기본 Chrome 경로들 시도
        const fs = await import('fs');
        const possiblePaths = [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          process.env.USERPROFILE + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
        ];

        for (const path of possiblePaths) {
          try {
            if (fs.existsSync(path)) {
              executablePath = path;
              console.log(`✅ Found Chrome at: ${path}`);
              break;
            }
          } catch (error) {
            // 경로 확인 실패
            console.log(`⚠️  Checked path: ${path} - not found`);
          }
        }

        if (!executablePath) {
          console.log('⚠️  Chrome executable not found in standard locations, using system default');
        }
      }

      this.browser = await puppeteer.launch({
        headless: false, // 디버깅을 위해 헤드리스 모드 해제
        executablePath, // 찾은 Chrome 경로 사용
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-ipc-flooding-protection',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--start-maximized' // 전체화면으로 브라우저 시작
        ],
        ignoreDefaultArgs: ['--disable-extensions'],
        timeout: 120000, // 2분으로 증가
        // 브라우저 프로세스 유지 설정
        handleSIGHUP: false,
        handleSIGTERM: false,
        handleSIGINT: false
      });

      console.log('✅ Browser launched successfully');

      this.page = await this.browser.newPage();
      console.log('✅ New page created');

      await this.page.setViewport({ width: 1920, height: 1080 }); // 전체화면 크기로 설정
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // 기본 타임아웃 설정 (증가하여 브라우저가 닫히는 문제 방지)
      this.page.setDefaultTimeout(120000);
      this.page.setDefaultNavigationTimeout(120000);

      console.log('✅ Browser initialization completed');
    } catch (error) {
      console.error('❌ Browser initialization failed:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async processYouTubeLink(youtubeLink: string, promptTemplate: string): Promise<ProcessingResult> {
    if (!this.page || !this.browser) {
      throw new Error('Browser not initialized');
    }

    try {
      console.log(`\n🎬 Processing: ${youtubeLink}`);
      console.log(`📝 Using prompt template (length: ${promptTemplate.length} chars)`);

      // 퍼플렉시티 페이지로 이동
      console.log('🌐 Navigating to Perplexity...');
      const response = await this.page.goto('https://www.perplexity.ai/', {
        waitUntil: 'networkidle0',
        timeout: 60000
      });

      if (!response || !response.ok()) {
        throw new Error(`Failed to load page: ${response?.status() || 'Unknown error'}`);
      }

      console.log('✅ Page loaded successfully');

      // 페이지 로드 대기 및 요소 확인
      console.log('⏳ Waiting for page elements...');

      // 더 긴 시간 동안 input 요소가 나타날 때까지 대기 (로그인 중에도 대기)
      try {
        await this.page.waitForSelector('#ask-input', { timeout: 60000 });
        console.log('✅ Page elements loaded');
      } catch (error) {
        console.log('⚠️  Input field not found within timeout, but continuing...');
        console.log('🔍 This might be normal if login modal is present');
      }

      // 로그인 상태 확인 (로그인 모달 유무로 판단)
      const loginStatus = await this.page.evaluate(() => {
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

        // 로그인 모달이 명확히 존재하는지 확인 (더 엄격하게)
        const hasLoginModal = !!(loginModal && (hasLoginText || googleLoginButton || appleLoginButton));

        // 로그인 상태 지표들
        const loginIndicators = [accountButton, userMenu, profileMenu].filter(Boolean);
        const hasAnyLoginIndicator = loginIndicators.length > 0;

        // 로그인 상태 판단: 입력창이 활성화되어 있고, 로그인 모달이 명확히 없거나, 로그인 지표가 있으면 로그인된 것으로 판단
        const isLoggedIn = isInputEnabled && (!hasLoginModal || hasAnyLoginIndicator);

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

      // 로그인 상태 표시
      if (loginStatus.isLoggedIn && !loginStatus.hasLoginModal) {
        console.log('✅ 로그인 상태 확인됨');
      } else if (loginStatus.hasLoginModal) {
        console.log('⚠️  로그인 모달이 감지됨');
      } else {
        console.log('❓ 로그인 상태 불확실');
      }
      console.log('🔍 로그인 상태 세부 정보:', JSON.stringify(loginStatus.indicators, null, 2));

      // 입력창 상태 확인
      const inputFieldExists = await this.page.evaluate(() => {
        const input = document.getElementById('ask-input');
        return !!(input && input.offsetParent !== null); // 보이는지 확인
      });

      // 무조건 사용자 확인 받기 (안전한 크롤링을 위해)
      console.log('\n⏳ [안전 확인] 크롤링을 시작하기 전에 브라우저 상태를 확인해주세요.');
      console.log('📋 다음을 확인하세요:');
      console.log(`   1. Chrome 브라우저가 전체화면으로 열려 있는지`);
      console.log(`   2. Perplexity AI 페이지가 정상적으로 로드되었는지`);
      console.log(`   3. 입력창 상태: ${inputFieldExists ? '✅ 보임' : '⚠️  아직 로드되지 않음 (로그인 필요 가능성)'} `);
      console.log('   4. 필요한 경우 브라우저에서 수동으로 로그인했는지');
      console.log('   5. 모든 준비가 완료되었으면 터미널로 돌아와서 아무 키나 누르세요');
      console.log('   6. AI 모델이 Gemini 2.5 Pro로 자동 설정됩니다');
      console.log('   7. 크롤링이 자동으로 시작됩니다\n');

      if (!inputFieldExists) {
        console.log('💡 입력창이 아직 보이지 않으면 브라우저에서 로그인을 완료해주세요.\n');
      }

      console.log('⌨️  준비 완료 후 아무 키나 눌러서 크롤링을 시작하세요...');

      // 사용자 입력 대기 (항상 실행)
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeAllListeners('data');
        };

        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        process.stdin.once('data', () => {
          cleanup();
          resolve();
        });

        // 타임아웃 추가 (긴 대기 시간)
        setTimeout(() => {
          cleanup();
          console.log('\n⏰ 대기 시간이 초과되었습니다. 자동으로 진행합니다...');
          resolve();
        }, 24 * 60 * 60 * 1000); // 24시간
      });

      console.log('🚀 크롤링을 시작합니다!\n');

      // AI 모델 선택 (Gemini 2.5 Pro)
      console.log('🤖 AI 모델을 Gemini 2.5 Pro로 설정하는 중...');

      try {
        // 먼저 현재 선택된 모델 확인
        const currentModel = await this.page.evaluate(() => {
          const selectedElement = document.querySelector('[aria-label="모델 선택"]');
          if (selectedElement) {
            const textContent = selectedElement.textContent || '';
            return textContent.includes('Gemini 2.5 Pro');
          }
          return false;
        });

        if (currentModel) {
          console.log('✅ AI 모델이 이미 Gemini 2.5 Pro로 설정되어 있습니다.');
        } else {
          // 모델 선택 버튼 클릭하여 드롭다운 열기
          await this.page.click('[aria-label="모델 선택"]');
          await new Promise(resolve => setTimeout(resolve, 1000));

          // 드롭다운에서 Gemini 2.5 Pro 찾기 (여러 방법 시도)
          const modelSelected = await this.page.evaluate(() => {
            // 방법 1: 정확한 텍스트로 찾기
            const exactMatches = Array.from(document.querySelectorAll('span')).filter(
              span => span.textContent?.trim() === 'Gemini 2.5 Pro'
            );

            if (exactMatches.length > 0) {
              (exactMatches[0] as HTMLElement).click();
              return true;
            }

            // 방법 2: 포함된 텍스트로 찾기
            const partialMatches = Array.from(document.querySelectorAll('span')).filter(
              span => span.textContent?.includes('Gemini 2.5 Pro')
            );

            if (partialMatches.length > 0) {
              (partialMatches[0] as HTMLElement).click();
              return true;
            }

            // 방법 3: role="menuitem" 요소에서 찾기
            const menuItems = Array.from(document.querySelectorAll('[role="menuitem"] span')).filter(
              span => span.textContent?.includes('Gemini 2.5 Pro')
            );

            if (menuItems.length > 0) {
              const menuItem = menuItems[0].closest('[role="menuitem"]') as HTMLElement;
              menuItem?.click();
              return true;
            }

            return false;
          });

          if (modelSelected) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            console.log('✅ AI 모델이 Gemini 2.5 Pro로 설정되었습니다.');
          } else {
            throw new Error('Gemini 2.5 Pro 모델을 찾을 수 없습니다');
          }
        }
      } catch (error) {
        console.log('⚠️  AI 모델 선택 중 오류 발생, 기본 모델로 진행합니다:', error instanceof Error ? error.message : 'Unknown error');
        console.log('💡 모델 선택 드롭다운이 제대로 열리지 않았거나, 모델명이 변경되었을 수 있습니다.');
      }

      // 사용자 확인 완료 후 바로 크롤링 시작

      // 프롬프트 생성
      const prompt = promptTemplate.replace('<유튜브 링크>', youtubeLink);
      console.log(`🔗 Generated prompt for ${youtubeLink} (length: ${prompt.length} chars)`);

      // 입력창에 텍스트 입력 (실제 타이핑 방식)
      console.log('📝 Inputting prompt to Perplexity...');

      // 입력창이 확실히 있는지 다시 확인
      const inputReady = await this.page.evaluate(() => {
        const input = document.getElementById('ask-input') as HTMLElement;
        return !!(input && input.offsetParent !== null && !input.hasAttribute('disabled'));
      });

      if (!inputReady) {
        throw new Error('Input field is not ready for typing. Please check if login is completed.');
      }

      // 1. 입력창 클릭하여 포커스 확보
      await this.page.click('#ask-input');
      await new Promise(resolve => setTimeout(resolve, 200));

      // 2. 기존 내용 클리어 (더 확실한 방법)
      await this.page.evaluate(() => {
        const element = document.getElementById('ask-input') as HTMLElement;
        if (element) {
          element.innerHTML = '<p dir="auto"><br></p>';
          element.focus();

          // Selection 설정
          const range = document.createRange();
          const selection = window.getSelection();
          range.selectNodeContents(element);
          range.collapse(true); // 시작점으로
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      });

      // 3. 줄바꿈을 고려하여 한 줄씩 Shift+Enter로 입력
      const lines = prompt.split('\n');
      console.log(`⌨️  Typing ${lines.length} lines with proper line breaks...`);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        console.log(`📏 Line ${i + 1}/${lines.length}: "${line.substring(0, 50)}${line.length > 50 ? '...' : ''}"`);

        // 각 줄의 내용을 입력 (빈 줄 포함)
        await this.page.type('#ask-input', line, { delay: 20 });

        // 마지막 줄이 아니면 Shift+Enter로 줄바꿈
        if (i < lines.length - 1) {
          console.log(`↩️  Adding line break after line ${i + 1}`);
          await this.page.keyboard.down('Shift');
          await this.page.keyboard.press('Enter');
          await this.page.keyboard.up('Shift');
          await new Promise(resolve => setTimeout(resolve, 100)); // 줄바꿈 후 잠시 대기
        }
      }

      console.log('✅ All lines typed, waiting for input to settle...');

      // 4. 입력 확인
      await new Promise(resolve => setTimeout(resolve, 1000));

      const inputText = await this.page.evaluate(() => {
        const element = document.getElementById('ask-input') as HTMLElement;
        return element ? element.textContent || element.innerText || '' : '';
      });

      console.log(`✅ Prompt input completed (input length: ${inputText.length} chars, expected: ${prompt.length})`);

      if (inputText.length === 0) {
        console.warn('⚠️  CRITICAL: Input field appears to be empty!');
        // 디버깅 정보 추가
        const debugInfo = await this.page.evaluate(() => {
          const element = document.getElementById('ask-input');
          return {
            exists: !!element,
            tagName: element?.tagName,
            contentEditable: element?.contentEditable,
            innerHTML: element?.innerHTML?.substring(0, 200),
            textContent: element?.textContent?.substring(0, 200),
            isVisible: element ? element.offsetParent !== null : false
          };
        });
        console.log('🔍 Debug info:', debugInfo);
        throw new Error('Input field is empty after typing - check debug info above');
      } else if (inputText.length < prompt.length * 0.8) {
        console.warn(`⚠️  WARNING: Input text is much shorter than expected (${inputText.length} vs ${prompt.length})`);
        console.log('📄 Actual input (first 200 chars):', inputText.substring(0, 200));
      } else {
        console.log('✅ Input validation passed');
      }

      // 제출 방법 1: Enter 키 시도
      console.log('🚀 Submitting prompt with Enter key...');
      await this.page.keyboard.press('Enter');

      // 잠시 대기 후 응답 확인
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 제출이 안되었으면 직접 제출 버튼 찾기 시도
      const submitButtonFound = await this.page.evaluate(() => {
        // 다양한 제출 버튼 패턴 검색
        const patterns = [
          'button[type="submit"]',
          'button[aria-label*="제출"]',
          'button[aria-label*="보내기"]',
          'button[aria-label*="전송"]',
          'button[data-testid*="submit"]',
          'button[data-testid*="send"]',
          // 음성 모드 버튼 근처 찾기
          'button[aria-label="음성 모드"] + button',
          'button[aria-label="음성 모드"] ~ button'
        ];

        for (const pattern of patterns) {
          const button = document.querySelector(pattern) as HTMLButtonElement;
          if (button && button.offsetParent !== null) { // 보이는 버튼인지 확인
            button.click();
            return true;
          }
        }
        return false;
      });

      if (submitButtonFound) {
        console.log('✅ Found and clicked submit button');
      } else {
        console.log('ℹ️  Using Enter key submission');
      }

      // 응답이 나타날 때까지 대기 (Puppeteer 최신 방식)
      console.log(`⏳ Waiting for response for ${youtubeLink}...`);

      try {
        // JSON 코드 블록이 나타날 때까지 대기 (최대 10분)
        await this.page.waitForSelector('pre code', {
          timeout: 10 * 60 * 1000 // 10분
        });

        // JSON 내용이 완전히 로드될 때까지 추가 대기
        await this.page.waitForFunction(() => {
          const codeElements = document.querySelectorAll('pre code');
          for (const code of codeElements) {
            const text = code.textContent || '';
            // 필수 필드들이 모두 포함되어 있는지 확인
            if (text.includes('"name"') &&
              text.includes('"youtube_link"') &&
              text.includes('"phone"') &&
              text.includes('"address"') &&
              text.includes('"reasoning_basis"')) {
              return true;
            }
          }
          return false;
        }, { timeout: 30000 });

        console.log('✅ Response detected and loaded!');

        // 최종 안정화를 위해 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error('❌ Response timeout or detection failed:', error);
        throw new Error(`Failed to get response within timeout: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // JSON 코드 블록 찾기 (Puppeteer locator 활용)
      console.log('🔍 Extracting JSON response...');

      const jsonText = await this.page.evaluate(() => {
        // 가장 최근에 나타난 JSON 코드 블록 찾기
        const codeElements = Array.from(document.querySelectorAll('pre code')).reverse(); // 최신순으로 뒤집기

        for (const code of codeElements) {
          const text = code.textContent?.trim() || '';
          if (text &&
            text.includes('"name"') &&
            text.includes('"youtube_link"') &&
            text.includes('"phone"') &&
            text.includes('"address"') &&
            text.includes('"reasoning_basis"') &&
            text.startsWith('{') &&
            text.endsWith('}')) {
            try {
              // JSON 유효성 검증
              JSON.parse(text);
              return text;
            } catch {
              // 유효하지 않은 JSON은 건너뜀
              continue;
            }
          }
        }

        return null;
      });

      if (!jsonText) {
        // 디버깅을 위해 현재 페이지 상태 확인
        const pageContent = await this.page.content();
        console.error('❌ Page content preview:', pageContent.substring(0, 1000));

        // 현재 보이는 코드 블록들 확인
        const codeBlocks = await this.page.$$eval('pre code', codes =>
          codes.map(code => code.textContent?.substring(0, 200) + '...')
        );
        console.error('❌ Available code blocks:', codeBlocks);

        throw new Error('JSON response not found. Check if the page loaded correctly.');
      }

      console.log(`✅ Found JSON response for ${youtubeLink}`);

      // JSON 파싱
      const restaurantInfo: RestaurantInfo = JSON.parse(jsonText);

      // 유효성 검증
      if (restaurantInfo.youtube_link !== youtubeLink) {
        throw new Error('YouTube link mismatch in response');
      }

      return {
        success: true,
        data: restaurantInfo,
        youtubeLink
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Error processing ${youtubeLink}:`, errorMessage);

      // 브라우저 재시작 시도
      try {
        console.log('🔄 Attempting to restart browser...');
        await this.close();
        await this.initialize();
        console.log('✅ Browser restarted successfully');
      } catch (restartError) {
        console.error('❌ Failed to restart browser:', restartError);
      }

      return {
        success: false,
        error: errorMessage,
        youtubeLink
      };
    }
  }

  async waitForPageLoad(): Promise<void> {
    if (!this.page) return;

    await this.page.waitForFunction(
      () => document.readyState === 'complete',
      { timeout: 30000 }
    );
  }
}
