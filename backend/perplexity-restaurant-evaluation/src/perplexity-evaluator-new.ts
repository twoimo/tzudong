import puppeteer, { Browser, Page } from 'puppeteer';
import { RestaurantEvaluation, ProcessingResult } from './types.js';
import fetch from 'node-fetch';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export class PerplexityEvaluator {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private hasProcessedAnyItem: boolean = false;
  private modelSelected: boolean = false;
  private sessionPath: string;
  private sessionRestored: boolean = false;
  private sessionData: any = null;

  constructor() {
    this.sessionPath = join(process.cwd(), 'perplexity-session.json');
  }

  async initialize(): Promise<void> {
    console.log('🚀 브라우저 초기화 시작...');

    try {
      // 저장된 세션 복원 시도
      await this.restoreSession();

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
              console.log(`✅ Chrome 발견: ${path}`);
              break;
            }
          } catch (error) {
            // 경로 확인 실패
            console.log(`⚠️ 경로 확인 실패: ${path}`);
          }
        }

        if (!executablePath) {
          console.log('⚠️ 표준 경로에서 Chrome을 찾을 수 없어 시스템 기본값 사용');
        }
      }

      this.browser = await puppeteer.launch({
        headless: false, // 구글 로그인 등 상호작용을 위해 헤드리스 모드 해제
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
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--disable-component-update',
          '--disable-background-timer-throttling',
          '--disable-low-end-device-mode',
          '--start-maximized',
          // 구글 로그인 보안 우회를 위한 추가 플래그
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          '--accept-lang=en-US,en',
          '--disable-extensions-except=/tmp',
          '--load-extension=/tmp',
          '--disable-plugins',
          '--disable-images', // 이미지 로딩 비활성화로 속도 향상
          '--disable-javascript-harmony-shipping',
          '--disable-background-media-download',
          '--disable-print-preview',
          '--disable-component-extensions-with-background-pages'
        ],
        ignoreDefaultArgs: ['--disable-extensions'],
        timeout: 120000,
        protocolTimeout: 300000,
        handleSIGHUP: false,
        handleSIGTERM: false,
        handleSIGINT: false
      });

      console.log('✅ 브라우저 실행 성공');

      this.page = await this.browser.newPage();
      console.log('✅ 새 페이지 생성');

      // 저장된 세션이 있으면 복원
      if (this.sessionData) {
        try {
          // 쿠키 복원
          if (this.sessionData.cookies && Array.isArray(this.sessionData.cookies)) {
            await this.page.setCookie(...this.sessionData.cookies);
            console.log('🍪 쿠키 복원 완료');
          }

          // 저장된 URL로 이동
          if (this.sessionData.url && this.sessionData.url.includes('perplexity.ai')) {
            await this.page.goto(this.sessionData.url, { waitUntil: 'networkidle0', timeout: 10000 });
            console.log('🔗 저장된 페이지로 이동');

            // 로컬 스토리지 복원
            if (this.sessionData.localStorage) {
              await this.page.evaluate((localData) => {
                for (const [key, value] of Object.entries(localData)) {
                  window.localStorage.setItem(key, value as string);
                }
              }, this.sessionData.localStorage);
              console.log('💼 로컬 스토리지 복원 완료');
            }

            // 세션 스토리지 복원
            if (this.sessionData.sessionStorage) {
              await this.page.evaluate((sessionData) => {
                for (const [key, value] of Object.entries(sessionData)) {
                  window.sessionStorage.setItem(key, value as string);
                }
              }, this.sessionData.sessionStorage);
              console.log('📋 세션 스토리지 복원 완료');
            }

            // 페이지 새로고침으로 세션 적용
            await this.page.reload({ waitUntil: 'networkidle0', timeout: 60000 });
            console.log('🔄 페이지 새로고침으로 세션 적용');

            // 세션 복원 후 실제 로그인 상태 검증
            console.log('🔍 세션 복원 후 로그인 상태 검증 중...');
            await new Promise(resolve => setTimeout(resolve, 2000));

            const loginStatus = await this.checkLoginStatus();
            if (loginStatus.isLoggedIn && !loginStatus.hasLoginModal) {
              console.log('✅ 세션 복원 성공! 로그인 상태 확인됨');
            } else {
              console.log('⚠️  세션 복원은 완료되었으나 로그인 상태가 유효하지 않습니다');
              console.log('🔍 로그인 상태 세부 정보:', JSON.stringify(loginStatus.indicators, null, 2));
              this.sessionData = null;
              console.log('🗑️  유효하지 않은 세션 데이터를 초기화했습니다');
            }
          } else {
            console.log('ℹ️  세션 데이터에 유효한 URL이 없어 기본 페이지로 이동');
          }
        } catch (restoreError) {
          console.log('⚠️  세션 복원 중 일부 오류:', restoreError instanceof Error ? restoreError.message : 'Unknown error');
          this.sessionData = null;
        }
      }

      await this.page.setViewport({ width: 2560, height: 1440 }); // 더 큰 화면 크기로 설정하여 로그인 UI가 잘리지 않도록 함
      await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // 구글 로그인 보안 우회를 위한 추가 설정
      await this.page.evaluateOnNewDocument(() => {
        // Automation 표시 제거
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });

        // Chrome 플러그인 시뮬레이션
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'Chrome PDF Plugin', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
            { name: 'Chrome PDF Viewer', description: '', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
            { name: 'Native Client', description: '', filename: 'internal-nacl-plugin' }
          ],
        });

        // 언어 설정
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
      });

      // 추가 HTTP 헤더 설정
      await this.page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'max-age=0',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"macOS"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      });

      this.page.setDefaultTimeout(120000);
      this.page.setDefaultNavigationTimeout(120000);

      console.log('✅ 브라우저 초기화 완료');
    } catch (error) {
      console.error('❌ 브라우저 초기화 실패:', error);
      throw error;
    }
  }

  private async restoreSession(): Promise<void> {
    try {
      const fs = await import('fs');
      if (fs.existsSync(this.sessionPath)) {
        const sessionContent = readFileSync(this.sessionPath, 'utf-8');
        this.sessionData = JSON.parse(sessionContent);
        console.log('📂 저장된 세션 데이터 로드 완료');
      } else {
        console.log('ℹ️ 저장된 세션 데이터가 없습니다');
      }
    } catch (error) {
      console.log('⚠️ 세션 데이터 로드 실패:', error);
    }
  }

  private async checkLoginStatus(): Promise<{ isLoggedIn: boolean; hasLoginModal: boolean; indicators: any }> {
    try {
      const indicators = await this.page!.evaluate(() => {
        const hasUserMenu = !!document.querySelector('[data-testid="user-menu"]');
        const hasLoginButton = !!document.querySelector('button[data-testid="login-button"]');
        const hasSignUpButton = !!document.querySelector('button[data-testid="signup-button"]');
        const hasLoginModal = !!document.querySelector('[role="dialog"]');

        return {
          hasUserMenu,
          hasLoginButton,
          hasSignUpButton,
          hasLoginModal
        };
      });

      const isLoggedIn = indicators.hasUserMenu && !indicators.hasLoginButton;
      const hasLoginModal = indicators.hasLoginModal;

      return { isLoggedIn, hasLoginModal, indicators };
    } catch (error) {
      console.error('로그인 상태 확인 실패:', error);
      return { isLoggedIn: false, hasLoginModal: false, indicators: {} };
    }
  }

  private async selectGeminiProModel(): Promise<void> {
    try {
      // 모델 선택 드롭다운이나 버튼 찾기
      const modelSelectors = [
        'button[data-testid="model-selector"]',
        'button:has-text("Model")',
        'button:has-text("모델")',
        '[class*="model"] button',
        '[class*="dropdown"] button',
        'select[name*="model"]',
        'button[class*="model"]',
        '[aria-label*="model"]',
        '[aria-label*="Model"]'
      ];

      let modelSelectorFound = false;
      for (const selector of modelSelectors) {
        try {
          await this.page!.waitForSelector(selector, { timeout: 3000 });
          await this.page!.click(selector);
          console.log(`✅ 모델 선택 버튼 클릭: ${selector}`);
          modelSelectorFound = true;
          await new Promise(resolve => setTimeout(resolve, 1000));
          break;
        } catch (e) {
          // 다음 selector 시도
        }
      }

      if (!modelSelectorFound) {
        console.log('ℹ️ 모델 선택 버튼을 찾을 수 없음 - 기본 모델 사용');
        return;
      }

      // Gemini Pro 2.5 옵션 찾기 및 선택
      const geminiSelectors = [
        'button:has-text("Gemini Pro 2.5")',
        'button:has-text("Gemini 2.5")',
        'option:has-text("Gemini Pro 2.5")',
        'option:has-text("Gemini 2.5")',
        '[data-value*="gemini-pro-2.5"]',
        '[data-value*="gemini-2.5"]',
        `button:has-text("Gemini")`,
        `option:has-text("Gemini")`
      ];

      let geminiSelected = false;
      for (const selector of geminiSelectors) {
        try {
          await this.page!.waitForSelector(selector, { timeout: 2000 });
          await this.page!.click(selector);
          console.log(`✅ Gemini Pro 2.5 모델 선택: ${selector}`);
          geminiSelected = true;
          await new Promise(resolve => setTimeout(resolve, 1000));
          break;
        } catch (e) {
          // 다음 selector 시도
        }
      }

      if (!geminiSelected) {
        console.log('⚠️ Gemini Pro 2.5 모델을 찾을 수 없음 - 사용 가능한 모델 중 선택 시도');

        // 다른 Gemini 모델 시도
        const fallbackSelectors = [
          'button:has-text("Gemini")',
          'option:has-text("Gemini")',
          'button:has-text("Google")',
          'option:has-text("Google")'
        ];

        for (const selector of fallbackSelectors) {
          try {
            await this.page!.waitForSelector(selector, { timeout: 2000 });
            await this.page!.click(selector);
            console.log(`✅ 대안 Gemini 모델 선택: ${selector}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            break;
          } catch (e) {
            // 다음 selector 시도
          }
        }
      }

      // 모델 선택 창 닫기 (열려있는 경우)
      try {
        await this.page!.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        // ESC 키 동작 실패 (무시)
      }

      console.log('✅ 모델 선택 완료');

    } catch (error) {
      console.error('모델 선택 실패:', error);
      console.log('⚠️ 모델 선택 실패 - 기본 모델 사용 계속 진행');
    }
  }

  async processEvaluation(restaurantData: string, promptTemplate: string): Promise<ProcessingResult> {
    if (!this.page || !this.browser) {
      throw new Error('브라우저가 초기화되지 않았습니다');
    }

    try {
      console.log(`\n🍽️ 평가 중: ${restaurantData.substring(0, 100)}...`);
      console.log(`📝 프롬프트 템플릿 사용 (${promptTemplate.length}자)`);

      // 세션 상태 확인 및 자동 복구
      console.log('🔐 평가 전 세션 검증 중...');
      const sessionValid = await this.ensureSession();

      if (!sessionValid) {
        console.log('⚠️ 세션이 유효하지 않아 수동 개입이 필요할 수 있습니다.');
      }

      // 퍼플렉시티 페이지로 이동
      console.log('🌐 퍼플렉시티로 이동 중...');
      const response = await this.page.goto('https://www.perplexity.ai/', {
        waitUntil: 'networkidle0',
        timeout: 120000
      });

      if (!response || !response.ok()) {
        throw new Error(`페이지 로드 실패: ${response?.status() || '알 수 없는 오류'}`);
      }

      console.log('✅ 페이지 로드 완료');

      // Gemini Pro 2.5 모델 선택
      console.log('🤖 Gemini Pro 2.5 모델 선택 중...');
      await this.selectGeminiProModel();

      // 입력 필드 찾기 및 프롬프트 입력
      console.log('⌨️ 프롬프트 입력 중...');
      await this.typePromptLikeHuman(promptTemplate);

      // 결과 대기 및 추출
      console.log('⏳ 결과 대기 중...');
      const evaluationResult = await this.waitForAndExtractResult();

      if (evaluationResult) {
        console.log('✅ 평가 완료');
        return {
          success: true,
          data: evaluationResult,
          youtubeLink: 'processed' // 임시 값
        };
      } else {
        return {
          success: false,
          error: '평가 결과를 추출할 수 없습니다',
          youtubeLink: 'failed'
        };
      }

    } catch (error) {
      console.error(`❌ 평가 실패:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '알 수 없는 오류',
        youtubeLink: 'failed'
      };
    }
  }

  private async typePromptLikeHuman(prompt: string): Promise<void> {
    try {
      // 입력 필드 찾기 - 여러 selector 시도
      const inputSelectors = [
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="질문"]',
        'textarea',
        'input[type="text"]',
        '[contenteditable="true"]',
        '.composer-input, #composer-input'
      ];

      let inputSelector = '';
      for (const selector of inputSelectors) {
        try {
          await this.page!.waitForSelector(selector, { timeout: 2000 });
          inputSelector = selector;
          console.log(`✅ 입력 필드 발견: ${selector}`);
          break;
        } catch (e) {
          // 다음 selector 시도
        }
      }

      if (!inputSelector) {
        throw new Error('입력 필드를 찾을 수 없습니다');
      }

      // 입력 필드 클릭
      await this.page!.click(inputSelector);

      // 프롬프트를 줄 단위로 나누기
      const lines = prompt.split('\n');

      // 각 줄을 Shift+Enter로 입력 (첫 줄 제외)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 첫 줄이 아니면 Shift+Enter로 줄바꿈
        if (i > 0) {
          await this.page!.keyboard.down('Shift');
          await this.page!.keyboard.press('Enter');
          await this.page!.keyboard.up('Shift');
          // 줄바꿈 후 잠시 대기
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // 현재 줄 입력 (사람처럼 타이핑)
        for (let j = 0; j < line.length; j++) {
          await this.page!.type(inputSelector, line[j]);
          // 50-150ms 랜덤 간격
          await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
        }
      }

      // 최종 전송을 위해 Enter 키 입력
      await new Promise(resolve => setTimeout(resolve, 500)); // 마지막 입력 후 잠시 대기
      await this.page!.keyboard.press('Enter');

    } catch (error) {
      console.error('프롬프트 입력 실패:', error);
      throw error;
    }
  }

  private async waitForAndExtractResult(): Promise<RestaurantEvaluation[] | null> {
    try {
      // 결과가 나타날 때까지 대기 - 여러 selector 시도
      const resultSelectors = [
        '.prose',
        '[data-testid="response"]',
        '.response',
        '.message',
        '.answer',
        '[class*="response"]',
        '[class*="answer"]'
      ];

      let foundSelector = '';
      for (const selector of resultSelectors) {
        try {
          await this.page!.waitForSelector(selector, { timeout: 5000 });
          foundSelector = selector;
          console.log(`✅ 결과 영역 발견: ${selector}`);
          break;
        } catch (e) {
          // 다음 selector 시도
        }
      }

      if (!foundSelector) {
        console.log('⚠️ 결과 영역을 찾을 수 없어 일반적인 텍스트 추출 시도');
        // 페이지가 로드될 때까지 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // 결과 텍스트 추출
      const resultText = await this.page!.evaluate(() => {
        // 다양한 방법으로 텍스트 추출 시도
        const selectors = [
          '.prose',
          '[data-testid="response"]',
          '.response',
          '.message',
          '.answer',
          '[class*="response"]',
          '[class*="answer"]',
          'article',
          'main',
          'body'
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            let text = '';
            elements.forEach(element => {
              text += element.textContent + '\n';
            });
            if (text.trim().length > 50) { // 의미 있는 텍스트가 있는 경우
              return text.trim();
            }
          }
        }

        // fallback: body 텍스트
        return document.body.textContent || '';
      });

      if (!resultText || resultText.length < 10) {
        console.log('⚠️ 추출된 텍스트가 너무 짧거나 없음');
        return null;
      }

      console.log(`📝 추출된 텍스트 길이: ${resultText.length}자`);

      // 결과를 파싱해서 RestaurantEvaluation 형식으로 변환
      const evaluation: RestaurantEvaluation = {
        restaurant_name: '평가 대상 식당', // 실제로는 결과에서 추출
        evaluation_score: this.extractScoreFromText(resultText),
        evaluation_reason: resultText,
        evaluation_date: new Date().toISOString(),
        evaluator: 'Perplexity AI'
      };

      return [evaluation];

    } catch (error) {
      console.error('결과 추출 실패:', error);
      return null;
    }
  }

  private extractScoreFromText(text: string): number {
    // 다양한 점수 추출 패턴 시도
    const patterns = [
      /점수[:\s]*(\d+(?:\.\d+)?)/gi,  // "점수: 8.5" 또는 "점수 8.5"
      /평점[:\s]*(\d+(?:\.\d+)?)/gi,  // "평점: 8.5"
      /(\d+(?:\.\d+)?)점/gi,          // "8.5점"
      /(\d+(?:\.\d+)?)\/10/gi,        // "8.5/10"
      /(\d+(?:\.\d+)?)\/5/gi,         // "4.2/5"
      /별점[:\s]*(\d+(?:\.\d+)?)/gi,  // "별점: 4.5"
      /rating[:\s]*(\d+(?:\.\d+)?)/gi, // "rating: 8.5"
      /(\d+(?:\.\d+)?)\s*stars?/gi,   // "4.5 stars"
      /(\d+(?:\.\d+)?)\s*out\s*of\s*10/gi, // "8.5 out of 10"
      /(\d+(?:\.\d+)?)\s*out\s*of\s*5/gi   // "4.2 out of 5"
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          const scoreMatch = match.match(/(\d+(?:\.\d+)?)/);
          if (scoreMatch) {
            const score = parseFloat(scoreMatch[1]);
            if (score >= 0 && score <= 10) {
              console.log(`✅ 점수 추출 성공: ${score} (패턴: ${pattern})`);
              return score;
            }
          }
        }
      }
    }

    // 숫자 범위 기반 추출 (0-10 사이의 숫자)
    const numberMatches = text.match(/\b(\d+(?:\.\d+)?)\b/g);
    if (numberMatches) {
      for (const numStr of numberMatches) {
        const num = parseFloat(numStr);
        if (num >= 0 && num <= 10) {
          console.log(`✅ 숫자 기반 점수 추출: ${num}`);
          return num;
        }
      }
    }

    console.log('⚠️ 점수를 찾을 수 없어 기본값 5.0 반환');
    return 5.0; // 기본값
  }

  private async ensureSession(): Promise<boolean> {
    try {
      const loginStatus = await this.checkLoginStatus();

      if (loginStatus.isLoggedIn && !loginStatus.hasLoginModal) {
        console.log('✅ 세션이 유효합니다');
        return true;
      }

      console.log('⚠️ 세션이 유효하지 않아 자동 로그인 시도 중...');

      // 자동 로그인 시도
      const loginSuccess = await this.attemptAutoLogin();
      if (loginSuccess) {
        console.log('✅ 자동 로그인 성공');
        return true;
      }

      console.log('❌ 자동 로그인 실패 - 수동 개입 필요');
      return false;

    } catch (error) {
      console.error('세션 검증 실패:', error);
      return false;
    }
  }

  private async attemptAutoLogin(): Promise<boolean> {
    try {
      console.log('🔑 자동 로그인 시도 중...');

      // Perplexity 로그인 페이지로 이동
      await this.page!.goto('https://www.perplexity.ai/', { waitUntil: 'networkidle0' });
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 구글 로그인을 우선적으로 시도
      console.log('🔵 구글 로그인 우선 시도 중...');
      const googleLoginSuccess = await this.tryGoogleLogin();
      if (googleLoginSuccess) {
        console.log('✅ 구글 로그인 성공');
        await this.saveSession();
        return true;
      }

      // 구글 로그인이 실패하면 일반 로그인 시도
      console.log('⚠️ 구글 로그인 실패, 일반 로그인 시도 중...');

      // 로그인 버튼 찾기 및 클릭
      const loginSelectors = [
        'button[data-testid="login-button"]',
        'button:has-text("Log in")',
        'button:has-text("로그인")',
        'a[href*="login"]',
        '[class*="login"] button',
        '[class*="sign-in"] button'
      ];

      let loginClicked = false;
      for (const selector of loginSelectors) {
        try {
          await this.page!.waitForSelector(selector, { timeout: 3000 });
          await this.page!.click(selector);
          console.log(`✅ 로그인 버튼 클릭: ${selector}`);
          loginClicked = true;
          await new Promise(resolve => setTimeout(resolve, 2000));
          break;
        } catch (e) {
          // 다음 selector 시도
        }
      }

      if (!loginClicked) {
        console.log('⚠️ 로그인 버튼을 찾을 수 없음 - 수동 로그인 필요');
        return false;
      }

      // 로그인 폼 대기 및 입력 필드 찾기
      const emailSelectors = [
        'input[type="email"]',
        'input[placeholder*="email"]',
        'input[placeholder*="이메일"]',
        'input[name="email"]'
      ];

      let emailFound = false;
      for (const selector of emailSelectors) {
        try {
          await this.page!.waitForSelector(selector, { timeout: 5000 });
          console.log(`✅ 이메일 입력 필드 발견: ${selector}`);

          // 환경 변수에서 이메일 가져오기
          const email = process.env.PERPLEXITY_EMAIL;
          if (!email) {
            console.log('⚠️ 환경 변수 PERPLEXITY_EMAIL이 설정되지 않음');
            return false;
          }

          await this.page!.type(selector, email, { delay: 100 });
          emailFound = true;
          break;
        } catch (e) {
          // 다음 selector 시도
        }
      }

      if (!emailFound) {
        console.log('⚠️ 이메일 입력 필드를 찾을 수 없음');
        return false;
      }

      // 비밀번호 입력 필드 찾기
      const passwordSelectors = [
        'input[type="password"]',
        'input[placeholder*="password"]',
        'input[placeholder*="비밀번호"]',
        'input[name="password"]'
      ];

      let passwordFound = false;
      for (const selector of passwordSelectors) {
        try {
          await this.page!.waitForSelector(selector, { timeout: 3000 });
          console.log(`✅ 비밀번호 입력 필드 발견: ${selector}`);

          // 환경 변수에서 비밀번호 가져오기
          const password = process.env.PERPLEXITY_PASSWORD;
          if (!password) {
            console.log('⚠️ 환경 변수 PERPLEXITY_PASSWORD가 설정되지 않음');
            return false;
          }

          await this.page!.type(selector, password, { delay: 100 });
          passwordFound = true;
          break;
        } catch (e) {
          // 다음 selector 시도
        }
      }

      if (!passwordFound) {
        console.log('⚠️ 비밀번호 입력 필드를 찾을 수 없음');
        return false;
      }

      // 로그인 버튼 클릭
      const submitSelectors = [
        'button[type="submit"]',
        'button:has-text("Log in")',
        'button:has-text("로그인")',
        'button:has-text("Sign in")',
        'input[type="submit"]'
      ];

      let submitClicked = false;
      for (const selector of submitSelectors) {
        try {
          await this.page!.waitForSelector(selector, { timeout: 3000 });
          await this.page!.click(selector);
          console.log(`✅ 로그인 제출 버튼 클릭: ${selector}`);
          submitClicked = true;
          break;
        } catch (e) {
          // 다음 selector 시도
        }
      }

      if (!submitClicked) {
        console.log('⚠️ 로그인 제출 버튼을 찾을 수 없음');
        return false;
      }

      // 로그인 완료 대기
      console.log('⏳ 로그인 완료 대기 중...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 로그인 상태 재확인
      const finalStatus = await this.checkLoginStatus();
      if (finalStatus.isLoggedIn) {
        console.log('✅ 일반 로그인 성공');
        // 세션 저장
        await this.saveSession();
        return true;
      } else {
        console.log('❌ 로그인 실패 - 로그인 상태가 여전히 유효하지 않음');
        return false;
      }

    } catch (error) {
      console.error('자동 로그인 실패:', error);
      return false;
    }
  }

  private async tryGoogleLogin(): Promise<boolean> {
    try {
      console.log('🔵 구글 로그인 시도 중...');

      // 구글 로그인 버튼 찾기
      const googleSelectors = [
        'button:has-text("Continue with Google")',
        'button:has-text("Sign in with Google")',
        'button:has-text("구글로 로그인")',
        'button:has-text("Google")',
        '[data-provider="google"]',
        'button[class*="google"]',
        'a[href*="google"]',
        'button[aria-label*="Google"]'
      ];

      let googleClicked = false;
      for (const selector of googleSelectors) {
        try {
          await this.page!.waitForSelector(selector, { timeout: 3000 });
          await this.page!.click(selector);
          console.log(`✅ 구글 로그인 버튼 클릭: ${selector}`);
          googleClicked = true;
          await new Promise(resolve => setTimeout(resolve, 2000));
          break;
        } catch (e) {
          // 다음 selector 시도
        }
      }

      if (!googleClicked) {
        console.log('ℹ️ 구글 로그인 버튼을 찾을 수 없음');
        return false;
      }

      // 구글 로그인 팝업이나 페이지 대기
      console.log('⏳ 구글 로그인 페이지 대기 중...');

      // 팝업 창이 열리는지 확인
      const newPagePromise = new Promise<Page>((resolve) => {
        this.browser!.once('targetcreated', async (target) => {
          const newPage = await target.page();
          if (newPage) {
            resolve(newPage);
          }
        });
      });

      let googlePage: Page;
      try {
        googlePage = await Promise.race([
          newPagePromise,
          new Promise<Page>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
        ]);
        console.log('✅ 구글 로그인 팝업 감지됨');
      } catch (e) {
        // 팝업이 없으면 현재 페이지에서 진행
        console.log('ℹ️ 구글 로그인 팝업이 없어 현재 페이지에서 진행');
        googlePage = this.page!;
      }

      // 구글 이메일 입력
      const googleEmail = process.env.GOOGLE_EMAIL;
      if (!googleEmail) {
        console.log('⚠️ 환경 변수 GOOGLE_EMAIL이 설정되지 않음');
        return false;
      }

      const emailInputSelectors = [
        'input[type="email"]',
        '#identifierId',
        'input[aria-label*="Email"]',
        'input[name="identifier"]'
      ];

      let emailEntered = false;
      for (const selector of emailInputSelectors) {
        try {
          await googlePage.waitForSelector(selector, { timeout: 5000 });
          await googlePage.type(selector, googleEmail, { delay: 100 });
          console.log('✅ 구글 이메일 입력 완료');
          emailEntered = true;

          // 다음 버튼 클릭
          await googlePage.keyboard.press('Enter');
          await new Promise(resolve => setTimeout(resolve, 2000));
          break;
        } catch (e) {
          // 다음 selector 시도
        }
      }

      if (!emailEntered) {
        console.log('⚠️ 구글 이메일 입력 필드를 찾을 수 없음');
        return false;
      }

      // 비밀번호 입력 (2단계 인증이 없는 경우)
      const googlePassword = process.env.GOOGLE_PASSWORD;
      if (googlePassword) {
        const passwordInputSelectors = [
          'input[type="password"]',
          'input[name="password"]',
          'input[aria-label*="Password"]'
        ];

        for (const selector of passwordInputSelectors) {
          try {
            await googlePage.waitForSelector(selector, { timeout: 5000 });
            await googlePage.type(selector, googlePassword, { delay: 100 });
            console.log('✅ 구글 비밀번호 입력 완료');

            await googlePage.keyboard.press('Enter');
            await new Promise(resolve => setTimeout(resolve, 3000));
            break;
          } catch (e) {
            // 다음 selector 시도
          }
        }
      }

      // 로그인 완료 대기
      console.log('⏳ 구글 로그인 완료 대기 중...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 원래 페이지로 돌아가기 (팝업이 있었던 경우)
      if (googlePage !== this.page!) {
        try {
          await googlePage.close();
          console.log('✅ 구글 로그인 팝업 닫힘');
        } catch (e) {
          // 팝업 닫기 실패 (무시)
        }
      }

      // 로그인 상태 확인
      const loginStatus = await this.checkLoginStatus();
      if (loginStatus.isLoggedIn) {
        console.log('✅ 구글 로그인 성공');
        return true;
      } else {
        console.log('⚠️ 구글 로그인 완료되었으나 Perplexity 로그인 상태 확인 필요');
        // 2FA나 추가 확인이 있을 수 있으므로 잠시 더 대기
        await new Promise(resolve => setTimeout(resolve, 3000));
        const finalStatus = await this.checkLoginStatus();
        return finalStatus.isLoggedIn;
      }

    } catch (error) {
      console.error('구글 로그인 실패:', error);
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      console.log('🔒 브라우저 종료 중...');
      await this.browser.close();
      console.log('✅ 브라우저 종료 완료');
    }
  }

  /**
   * 브라우저 세션을 파일로 저장합니다.
   */
  private async saveSession(): Promise<void> {
    if (!this.page || !this.browser) {
      console.log('⚠️ 브라우저가 초기화되지 않아 세션을 저장할 수 없음');
      return;
    }

    try {
      // 쿠키 저장
      const cookies = await this.page.cookies();

      // 로컬 스토리지 저장
      const localStorageData = await this.page.evaluate(() => {
        const items: { [key: string]: string } = {};
        const ls = window.localStorage;
        for (let i = 0; i < ls.length; i++) {
          const key = ls.key(i);
          if (key) {
            items[key] = ls.getItem(key) || '';
          }
        }
        return items;
      });

      // 세션 스토리지 저장
      const sessionStorageData = await this.page.evaluate(() => {
        const items: { [key: string]: string } = {};
        const ss = window.sessionStorage;
        for (let i = 0; i < ss.length; i++) {
          const key = ss.key(i);
          if (key) {
            items[key] = ss.getItem(key) || '';
          }
        }
        return items;
      });

      const sessionData = {
        cookies,
        localStorage: localStorageData,
        sessionStorage: sessionStorageData,
        url: this.page.url(),
        timestamp: new Date().toISOString()
      };

      const fs = await import('fs');
      await fs.promises.writeFile(this.sessionPath, JSON.stringify(sessionData, null, 2));
      console.log('💾 브라우저 세션이 저장됨');

    } catch (error) {
      console.error('세션 저장 실패:', error);
    }
  }
}
