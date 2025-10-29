import puppeteer, { Browser, Page } from 'puppeteer';
import { RestaurantInfo, ProcessingResult } from './types.js';
import fetch from 'node-fetch';

export class PerplexityCrawler {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private hasProcessedAnyItem: boolean = false;
  private modelSelected: boolean = false;

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

      // 사용자 확인 (첫 번째 항목에서만 또는 수동 모드에서만)
      const isFirstItem = !this.hasProcessedAnyItem;
      const manualMode = process.env.MANUAL_MODE === 'true';

      if (isFirstItem || manualMode) {
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

        // 사용자 입력 대기
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
      } else {
        console.log('🔄 다음 항목 처리 시작...\n');
      }

      // 첫 번째 항목 처리 표시
      this.hasProcessedAnyItem = true;

      // AI 모델 선택 (Gemini 2.5 Pro) - 한 번만 수행
      if (!this.modelSelected) {
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
            this.modelSelected = true;
          } else {
            // 모델 선택 버튼 클릭하여 드롭다운 열기
            await this.page.click('[aria-label="모델 선택"]');
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 드롭다운에서 Gemini 2.5 Pro 찾기 (여러 방법 시도)
            const modelSelectedResult = await this.page.evaluate(() => {
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

            if (modelSelectedResult) {
              await new Promise(resolve => setTimeout(resolve, 1000));
              console.log('✅ AI 모델이 Gemini 2.5 Pro로 설정되었습니다.');
              this.modelSelected = true;
            } else {
              throw new Error('Gemini 2.5 Pro 모델을 찾을 수 없습니다');
            }
          }
        } catch (error) {
          console.log('⚠️  AI 모델 선택 중 오류 발생, 기본 모델로 진행합니다:', error instanceof Error ? error.message : 'Unknown error');
          console.log('💡 모델 선택 드롭다운이 제대로 열리지 않았거나, 모델명이 변경되었을 수 있습니다.');
        }
      } else {
        console.log('✅ AI 모델이 이미 Gemini 2.5 Pro로 설정되어 있습니다.');
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

      // 3. 줄바꿈을 고려하여 Shift+Enter로 입력
      console.log(`⌨️  Typing prompt with proper line breaks (${prompt.length} characters)...`);

      // 입력창 클릭하여 포커스
      await this.page.click('#ask-input');
      await new Promise(resolve => setTimeout(resolve, 200));

      // 기존 내용 클리어 (Ctrl+A, Delete)
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('a');
      await this.page.keyboard.up('Control');
      await this.page.keyboard.press('Delete');

      // 프롬프트를 줄 단위로 나누어 Shift+Enter로 입력
      const lines = prompt.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 각 줄의 내용을 입력 (빈 줄 포함)
        await this.page.type('#ask-input', line, { delay: 0 });

        // 마지막 줄이 아니면 Shift+Enter로 줄바꿈
        if (i < lines.length - 1) {
          await this.page.keyboard.down('Shift');
          await this.page.keyboard.press('Enter');
          await this.page.keyboard.up('Shift');
          await new Promise(resolve => setTimeout(resolve, 50)); // 줄바꿈 후 짧은 대기
        }
      }

      // 타이핑 완료 후 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 500));

      // 입력 확인
      const inputText = await this.page.evaluate(() => {
        const element = document.getElementById('ask-input') as HTMLElement;
        return element ? element.textContent || element.innerText || '' : '';
      });

      console.log(`✅ Prompt input completed (input length: ${inputText.length} chars, expected: ${prompt.length})`);

      if (inputText.length === 0) {
        console.warn('⚠️  WARNING: Input field is empty, but continuing...');
      } else if (inputText.length < prompt.length * 0.5) {
        console.warn(`⚠️  WARNING: Input text seems incomplete (${inputText.length} vs ${prompt.length})`);
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

        // JSON 내용이 완전히 로드될 때까지 추가 대기 (여러 개의 JSON 객체 지원)
        await this.page.waitForFunction(() => {
          const codeElements = document.querySelectorAll('pre code');
          let validJsonCount = 0;

          for (const code of codeElements) {
            const text = code.textContent?.trim() || '';
            if (!text) continue;

            // 여러 줄의 JSON 객체들을 분리해서 처리
            const jsonBlocks = text.split('\n').filter(line => line.trim());

            for (const block of jsonBlocks) {
              const trimmedBlock = block.trim();
              if (trimmedBlock &&
                trimmedBlock.includes('"name"') &&
                trimmedBlock.includes('"youtube_link"') &&
                trimmedBlock.includes('"phone"') &&
                trimmedBlock.includes('"address"') &&
                trimmedBlock.includes('"reasoning_basis"') &&
                trimmedBlock.startsWith('{') &&
                trimmedBlock.endsWith('}')) {
                try {
                  JSON.parse(trimmedBlock);
                  validJsonCount++;
                  // 최소 1개의 유효한 JSON이 있으면 충분
                  if (validJsonCount >= 1) {
                    return true;
                  }
                } catch {
                  continue;
                }
              }
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

      // JSON 코드 블록 찾기 (Puppeteer locator 활용) - 여러 개의 JSON 객체 지원
      console.log('🔍 Extracting JSON responses...');

      const jsonResults = await this.page.evaluate(() => {
        // 모든 JSON 코드 블록 찾기 (최신순으로 뒤집기)
        const codeElements = Array.from(document.querySelectorAll('pre code')).reverse();
        const validJsonObjects: any[] = [];

        for (const code of codeElements) {
          const text = code.textContent?.trim() || '';
          if (!text) continue;

          // 여러 줄의 JSON 객체들을 분리해서 처리
          const jsonBlocks = text.split('\n').filter(line => line.trim());

          for (const block of jsonBlocks) {
            const trimmedBlock = block.trim();
            if (trimmedBlock &&
              trimmedBlock.includes('"name"') &&
              trimmedBlock.includes('"youtube_link"') &&
              trimmedBlock.includes('"phone"') &&
              trimmedBlock.includes('"address"') &&
              trimmedBlock.includes('"reasoning_basis"') &&
              trimmedBlock.startsWith('{') &&
              trimmedBlock.endsWith('}')) {
              try {
                // JSON 유효성 검증
                const parsed = JSON.parse(trimmedBlock);
                validJsonObjects.push(parsed);
              } catch {
                // 유효하지 않은 JSON은 건너뜀
                continue;
              }
            }
          }
        }

        return validJsonObjects;
      });

      if (!jsonResults || jsonResults.length === 0) {
        // 디버깅을 위해 현재 페이지 상태 확인
        const pageContent = await this.page.content();
        console.error('❌ Page content preview:', pageContent.substring(0, 1000));

        // 현재 보이는 코드 블록들 확인
        const codeBlocks = await this.page.$$eval('pre code', codes =>
          codes.map(code => code.textContent?.substring(0, 200) + '...')
        );
        console.error('❌ Available code blocks:', codeBlocks);

        throw new Error('No valid JSON responses found. Check if the page loaded correctly.');
      }

      console.log(`✅ Found ${jsonResults.length} JSON response(s) for ${youtubeLink}`);

      // 모든 유효한 JSON 객체들을 RestaurantInfo로 변환
      const restaurantInfos: RestaurantInfo[] = [];

      for (const jsonObj of jsonResults) {
        // YouTube 링크가 일치하는지 검증 (가장 중요)
        if (jsonObj.youtube_link !== youtubeLink) {
          console.log(`⚠️ Skipping JSON with mismatched YouTube link: ${jsonObj.youtube_link}`);
          continue;
        }

        // RestaurantInfo로 변환
        const restaurantInfo: RestaurantInfo = {
          name: jsonObj.name,
          phone: jsonObj.phone,
          address: jsonObj.address,
          lat: jsonObj.lat,
          lng: jsonObj.lng,
          category: jsonObj.category,
          youtube_link: jsonObj.youtube_link,
          reasoning_basis: jsonObj.reasoning_basis || '',
          tzuyang_review: jsonObj.tzuyang_review || null
        };

        restaurantInfos.push(restaurantInfo);
        console.log(`✅ Added restaurant: ${restaurantInfo.name || 'Unknown'}`);
      }

      if (restaurantInfos.length === 0) {
        throw new Error('No valid JSON objects found with matching YouTube link.');
      }

      console.log(`🎯 Extracted ${restaurantInfos.length} restaurant(s) for ${youtubeLink}`);

      // 지도 API로 좌표 정보 보완 (해외: 구글 지도, 국내: 네이버 지도)
      console.log('🗺️  Enriching coordinates with Map APIs...');
      const enrichedRestaurants = await this.enrichCoordinates(restaurantInfos);

      return {
        success: true,
        data: enrichedRestaurants,
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

  /**
   * 해외 주소인지 판별합니다.
   */
  private isForeignAddress(address: string): boolean {
    const foreignKeywords = [
      '튀르키예', 'Türkiye', '터키', 'İstanbul', 'Istanbul',
      '일본', 'Japan', 'Tokyo', '도쿄',
      '중국', 'China', 'Beijing', '베이징', 'Shanghai', '상하이',
      '미국', 'USA', 'United States', 'New York', '뉴욕', 'Los Angeles', 'LA',
      '영국', 'UK', 'London', '런던',
      '프랑스', 'France', 'Paris', '파리',
      '독일', 'Germany', 'Berlin', '베를린',
      '이탈리아', 'Italy', 'Rome', '로마',
      '스페인', 'Spain', 'Madrid', '마드리드',
      '캐나다', 'Canada', 'Toronto', '토론토',
      '호주', 'Australia', 'Sydney', '시드니'
    ];

    return foreignKeywords.some(keyword => address.includes(keyword));
  }

  /**
   * 구글 지도에서 주소로 검색하여 좌표를 추출합니다.
   */
  private async getCoordinatesFromGoogleMaps(address: string): Promise<{ lat: number; lng: number } | null> {
    if (!address || address.trim() === '') {
      return null;
    }

    try {
      console.log(`🌍 Google Maps 검색: ${address}`);

      // 구글 지도 검색 URL 생성
      const searchQuery = encodeURIComponent(address.trim());
      const searchUrl = `https://www.google.com/maps/search/${searchQuery}`;

      // 페이지 이동
      if (!this.page) {
        throw new Error('Browser page not initialized');
      }

      await this.page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // 잠시 대기하여 지도가 로드되도록 함
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 현재 URL에서 좌표 추출 시도
      const currentUrl = this.page.url();

      // URL에서 @lat,lng,zoom 형식의 좌표 추출
      const urlMatch = currentUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+)z/);
      if (urlMatch) {
        const lat = parseFloat(urlMatch[1]);
        const lng = parseFloat(urlMatch[2]);

        if (!isNaN(lat) && !isNaN(lng)) {
          console.log(`✅ 구글 지도 좌표 획득: ${address} → (${lat}, ${lng})`);
          return { lat, lng };
        }
      }

      // URL에서 좌표를 찾지 못한 경우, 페이지에서 직접 검색
      try {
        // 지도 컨테이너에서 data-lat, data-lng 속성 찾기
        const coordinates = await this.page.evaluate(() => {
          // 여러 가능한 셀렉터 시도
          const selectors = [
            '[data-lat][data-lng]',
            '.place-result[data-lat][data-lng]',
            '[jsinstance*="place-result"]'
          ];

          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
              const lat = element.getAttribute('data-lat');
              const lng = element.getAttribute('data-lng');
              if (lat && lng) {
                return {
                  lat: parseFloat(lat),
                  lng: parseFloat(lng)
                };
              }
            }
          }

          // 다른 방법: URL 변경 감지
          const links = Array.from(document.querySelectorAll('a[href*="maps/place"]'));
          for (const link of links) {
            const href = link.getAttribute('href');
            if (href) {
              const match = href.match(/@(-?\d+\.\d+),(-?\d+\.\d+),(\d+)z/);
              if (match) {
                return {
                  lat: parseFloat(match[1]),
                  lng: parseFloat(match[2])
                };
              }
            }
          }

          return null;
        });

        if (coordinates && !isNaN(coordinates.lat) && !isNaN(coordinates.lng)) {
          console.log(`✅ 구글 지도 좌표 획득 (페이지 파싱): ${address} → (${coordinates.lat}, ${coordinates.lng})`);
          return coordinates;
        }
      } catch (evalError) {
        console.warn(`⚠️  구글 지도 페이지 파싱 실패: ${evalError instanceof Error ? evalError.message : 'Unknown error'}`);
      }

      console.warn(`⚠️  구글 지도에서 좌표를 찾을 수 없음: ${address}`);
      return null;

    } catch (error) {
      console.warn(`⚠️  구글 지도 검색 오류 (${address}):`, error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }

  /**
   * 네이버 지도 API를 통해 주소로 좌표를 조회합니다.
   */
  private async getCoordinatesFromNaverMap(address: string): Promise<{ lat: number; lng: number } | null> {
    if (!address || address.trim() === '') {
      return null;
    }

    try {
      // 주소를 URL 인코딩
      const encodedAddress = encodeURIComponent(address.trim());
      const apiUrl = `http://www.moamodu.com/develop/naver_map_new_proxy.php?query=${encodedAddress}`;

      console.log(`🗺️  Naver Map API 호출: ${address}`);

      // AbortController로 타임아웃 구현
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(apiUrl, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`⚠️  Naver Map API 실패 (${response.status}): ${address}`);
        return null;
      }

      const data = await response.json() as any;

      if (data.status === 'OK' && data.addresses && data.addresses.length > 0) {
        const firstResult = data.addresses[0];
        const lat = parseFloat(firstResult.y);
        const lng = parseFloat(firstResult.x);

        if (!isNaN(lat) && !isNaN(lng)) {
          console.log(`✅ 좌표 획득: ${address} → (${lat}, ${lng})`);
          return { lat, lng };
        }
      }

      console.warn(`⚠️  유효한 좌표를 찾을 수 없음: ${address}`);
      return null;

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn(`⚠️  Naver Map API 타임아웃 (${address})`);
      } else {
        console.warn(`⚠️  Naver Map API 오류 (${address}):`, error instanceof Error ? error.message : 'Unknown error');
      }
      return null;
    }
  }

  /**
   * RestaurantInfo 배열의 좌표 정보를 지도 API로 보완합니다.
   * 해외 주소: 구글 지도 사용, 국내 주소: 네이버 지도 사용
   */
  async enrichCoordinates(restaurants: RestaurantInfo[]): Promise<RestaurantInfo[]> {
    const enrichedRestaurants: RestaurantInfo[] = [];

    for (const restaurant of restaurants) {
      const enriched = { ...restaurant };

      // lat 또는 lng가 null이거나 undefined인 경우에만 API 호출
      if ((enriched.lat === null || enriched.lat === undefined ||
        enriched.lng === null || enriched.lng === undefined) &&
        enriched.address && enriched.address.trim() !== '') {

        let coordinates: { lat: number; lng: number } | null = null;

        // 해외 주소인지 판별
        if (this.isForeignAddress(enriched.address)) {
          console.log(`🌍 해외 주소 감지: ${enriched.address} - 구글 지도 사용`);
          coordinates = await this.getCoordinatesFromGoogleMaps(enriched.address);
        } else {
          console.log(`🇰🇷 국내 주소: ${enriched.address} - 네이버 지도 사용`);
          coordinates = await this.getCoordinatesFromNaverMap(enriched.address);
        }

        if (coordinates) {
          enriched.lat = coordinates.lat;
          enriched.lng = coordinates.lng;
          console.log(`📍 좌표 보완: ${enriched.name || 'Unknown'} - ${enriched.address}`);
        }
      }

      enrichedRestaurants.push(enriched);
    }

    return enrichedRestaurants;
  }

  /**
   * RestaurantInfo 배열의 좌표 정보를 네이버 지도 API로 보완합니다. (하위 호환성 유지)
   */
  async enrichCoordinatesWithNaverMap(restaurants: RestaurantInfo[]): Promise<RestaurantInfo[]> {
    return this.enrichCoordinates(restaurants);
  }
}
