import puppeteer, { Browser, Page } from 'puppeteer';
import { RestaurantInfo, ProcessingResult } from './types.js';
import fetch from 'node-fetch';

export class PerplexityCrawler {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private hasProcessedAnyItem: boolean = false;
  private modelSelected: boolean = false;
  private sessionPath: string = './headless-perplexity-session.json';
  private sessionRestored: boolean = false;
  private browserId: number = 0;

  constructor(browserId: number = 0) {
    this.browserId = browserId;
  }

  async initialize(): Promise<void> {
    console.log('🚀 브라우저 초기화 시작 (Headless Mode)...');

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
        headless: true, // Headless 모드 활성화 (GitHub Actions 호환)
        executablePath, // 찾은 Chrome 경로 사용
        defaultViewport: null, // 기본 뷰포트 설정 해제 (전체 화면 사용)
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
          '--disable-background-networking', // 배경 네트워킹 비활성화로 세션 유지 개선
          '--disable-default-apps',
          '--disable-sync', // 동기화 비활성화
          '--disable-translate', // 번역 비활성화
          '--disable-component-update', // 컴포넌트 업데이트 비활성화
          '--disable-background-timer-throttling', // 백그라운드 타이머 스로틀링 비활성화
          '--disable-low-end-device-mode', // 저사양 장치 모드 비활성화
          '--window-size=1440,900', // macOS에 적합한 창 크기로 설정
          '--disable-infobars', // 정보 표시줄 비활성화
          '--disable-session-crashed-bubble', // 세션 충돌 버블 비활성화
          '--disable-blink-features=AutomationControlled',
          '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          '--accept-lang=en-US,en',
          '--disable-plugins',
          '--start-maximized' // 전체화면으로 브라우저 시작
        ],
        ignoreDefaultArgs: ['--disable-extensions'],
        timeout: 120000, // 2분으로 증가
        protocolTimeout: 300000, // 5분으로 CDP 프로토콜 타임아웃 증가
        // 브라우저 프로세스 유지 설정
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

          // 저장된 URL로 이동 (선택사항)
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

            // 페이지 새로고침으로 세션 적용 (타임아웃 증가)
            await this.page.reload({ waitUntil: 'networkidle0', timeout: 60000 });
            console.log('🔄 페이지 새로고침으로 세션 적용');
            
            // 세션 복원 플래그 설정
            this.sessionRestored = true;
            
            // 세션 복원 후 홈으로 이동하고 라이브러리 삭제
            console.log('🏠 홈 페이지로 이동 중...');
            await this.page.goto('https://www.perplexity.ai/', {
              waitUntil: 'networkidle0',
              timeout: 60000
            });
            console.log('✅ 홈 페이지 이동 완료');
            
            // 첫 번째 브라우저만 라이브러리 삭제
            if (this.browserId === 0) {
              console.log('🗑️  라이브러리 삭제 시작...');
              await this.deleteAllThreads();
              console.log('✅ 라이브러리 삭제 완료');
            } else {
              console.log(`ℹ️  Browser ${this.browserId}: 라이브러리 삭제 건너뜀 (첫 번째 브라우저만 삭제)`);
            }
          } else {
            console.log('ℹ️  세션 데이터에 유효한 URL이 없어 기본 페이지로 이동');
          }
        } catch (restoreError) {
          console.log('⚠️  세션 복원 중 일부 오류:', restoreError instanceof Error ? restoreError.message : 'Unknown error');
          // 복원 실패 시 세션 데이터 초기화
          this.sessionData = null;
        }
      }

      await this.page.setViewport({ width: 1440, height: 900 }); // 화면 크기 설정
      await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // 기본 타임아웃 설정 (증가하여 브라우저가 닫히는 문제 방지)
      this.page.setDefaultTimeout(120000);
      this.page.setDefaultNavigationTimeout(120000);

      console.log('✅ 브라우저 초기화 완료');
    } catch (error) {
      console.error('❌ 브라우저 초기화 실패:', error);
      throw error;
    }
  }


  async processYouTubeLink(youtubeLink: string, promptTemplate: string): Promise<ProcessingResult> {
    if (!this.page || !this.browser) {
      throw new Error('브라우저가 초기화되지 않았습니다');
    }

    try {
      console.log(`\n🎬 처리 중: ${youtubeLink}`);
      console.log(`📝 프롬프트 템플릿 사용 (${promptTemplate.length}자)`);

      // 크롤링 시작 전 세션 상태 확인 및 자동 복구
      console.log('🔐 크롤링 전 세션 검증 중...');
      const sessionValid = await this.ensureSession();

      if (!sessionValid) {
        console.log('⚠️  세션이 유효하지 않아 수동 개입이 필요할 수 있습니다.');
        // Google 로그인 페이지 감지 및 대기
        await this.checkForGoogleLoginPage();
      }

      // 퍼플렉시티 페이지로 이동 (타임아웃 증가)
      console.log('🌐 퍼플렉시티로 이동 중...');
      const response = await this.page.goto('https://www.perplexity.ai/', {
        waitUntil: 'networkidle0',
        timeout: 120000 // 2분으로 증가
      });

      if (!response || !response.ok()) {
        throw new Error(`페이지 로드 실패: ${response?.status() || '알 수 없는 오류'}`);
      }

      console.log('✅ 페이지 로드 완료');

      // 페이지 로드 대기 및 요소 확인
      console.log('⏳ 페이지 요소 대기 중...');

      // 더 긴 시간 동안 input 요소가 나타날 때까지 대기
      try {
        await this.page.waitForSelector('#ask-input', { timeout: 60000 });
        console.log('✅ 페이지 요소 로드 완료');
      } catch (error) {
        console.log('⚠️ 입력 필드를 찾을 수 없지만 계속 진행...');
        console.log('🔍 로그인 모달이 있을 경우 정상임');
      }

      // 사용자 확인 변수들 (로그인 상태 확인 전에 미리 계산)
      const isFirstItem = !this.hasProcessedAnyItem;
      const manualMode = process.env.MANUAL_MODE === 'true';
      const sessionRestored = this.sessionRestored;

      // 로그인 상태 확인 (로그인 모달 유무로 판단)
      const loginStatus = await this.checkLoginStatus();

      // 로그인 필요 여부 확인 및 처리
      let needsLogin = false;
      let loginType = '';

      if (loginStatus.hasLoginModal) {
        // Perplexity 로그인 모달 감지
        console.log('\n🚨 Perplexity 로그인 모달 감지됨!');
        needsLogin = true;
        loginType = 'perplexity';
      } else {
        // Google 로그인 페이지 확인
        const hasGoogleLoginPage = await this.checkForGoogleLoginPage();
        if (hasGoogleLoginPage) {
          needsLogin = true;
          loginType = 'google';
        }
      }

      if (needsLogin) {
        console.log('📋 브라우저에서 수동으로 로그인해주세요.');
        console.log('⌨️ 로그인 완료 후 터미널에서 아무 키나 눌러서 크롤링을 재개하세요...\n');

        // 사용자 입력 대기 (모든 로그인 타입에서 대기)
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
            console.log('✅ 사용자가 로그인 완료를 확인했습니다.\n');
            resolve();
          });

          // 타임아웃 추가 (긴 대기 시간)
          setTimeout(() => {
            cleanup();
            console.log('\n⏰ 로그인 대기 시간이 초과되었습니다. 자동으로 진행합니다...\n');
            resolve();
          }, 24 * 60 * 60 * 1000); // 24시간
        });

        // 로그인 상태 재확인 및 세션 저장
        console.log('🔄 로그인 상태 재확인 및 세션 업데이트 중...');
        
        // 좀 더 대기한 후 로그인 상태 확인
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const updatedLoginStatus = await this.checkLoginStatus();

        if (updatedLoginStatus.isLoggedIn && !updatedLoginStatus.hasLoginModal) {
          console.log('✅ 로그인 성공 확인됨');

          // 로그인 성공 시 반드시 최신 세션 저장 (타임스탬프 업데이트)
          try {
            await this.saveSession();
            console.log('💾 로그인 세션 최신 업데이트 완료 (타임스탬프 갱신)');
          } catch (sessionError) {
            console.error('❌ 세션 저장 실패:', sessionError instanceof Error ? sessionError.message : 'Unknown error');
          }

          // 로그인 완료 후 라이브러리 삭제 (첫 번째 브라우저만)
          if (isFirstItem) {
            console.log('🗑️  로그인 완료 후 라이브러리 삭제 시작...');
            await this.deleteAllThreads();
          }
        } else {
          console.log('⚠️  로그인 상태가 아직 확인되지 않음');
          console.log('🔍 다시 로그인을 확인해주세요. 브라우저에서 로그인 완료 후 아무 키나 누르세요...\n');
          
          // 다시 사용자 입력 대기
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
              console.log('✅ 사용자가 로그인 완료를 재확인했습니다.\n');
              resolve();
            });
          });

          // 재확인 후 충분히 대기
          await new Promise(resolve => setTimeout(resolve, 2000));

          // 재확인 후 로그인 상태 최종 확인
          const finalLoginStatus = await this.checkLoginStatus();
          if (finalLoginStatus.isLoggedIn && !finalLoginStatus.hasLoginModal) {
            console.log('✅ 로그인 최종 확인 성공');
            await this.saveSession();
            console.log('💾 로그인 세션 저장 완료');

            // 로그인 완료 후 라이브러리 삭제 (첫 번째 브라우저만)
            if (isFirstItem) {
              console.log('🗑️  로그인 완료 후 라이브러리 삭제 시작...');
              await this.deleteAllThreads();
            }
          } else {
            console.log('⚠️  로그인 상태를 확인할 수 없지만 계속 진행합니다');
          }
        }
      } else if (loginStatus.isLoggedIn) {
        console.log('✅ 로그인 상태 확인됨');

        // 기존 세션이 없는 경우에만 세션 저장 (최초 실행 시)
        if (!sessionRestored) {
          try {
            await this.saveSession();
            console.log('💾 초기 로그인 세션 저장됨');
          } catch (sessionError) {
            console.error('❌ 초기 세션 저장 실패:', sessionError instanceof Error ? sessionError.message : 'Unknown error');
          }
        }
      } else {
        console.log('❓ 로그인 상태 불확실');
      }
      console.log('🔍 로그인 상태 세부 정보:', JSON.stringify(loginStatus.indicators, null, 2));

      // 입력창 상태 확인
      const inputFieldExists = await this.page.evaluate(() => {
        const input = document.getElementById('ask-input');
        return !!(input && input.offsetParent !== null); // 보이는지 확인
      });

      if (isFirstItem || manualMode) {
        if (sessionRestored) {
          console.log('\n🔄 세션 복원이 성공하여 바로 크롤링을 시작합니다!\n');
        } else {
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
        }
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
            // 다양한 방법으로 현재 모델 텍스트 찾기
            const selectors = [
              '[data-testid="model-selector"]',
              '[class*="model"] button',
              '[aria-label*="model"]',
              'button[class*="model"]',
              '.model-selector',
              '[class*="model-select"]'
            ];

            for (const selector of selectors) {
              const element = document.querySelector(selector);
              if (element) {
                const text = element.textContent?.trim() || '';
                if (text) return text;
              }
            }

            // 모델 표시 영역 찾기
            const modelElements = document.querySelectorAll('[class*="model"], [data-testid*="model"]');
            for (const el of modelElements) {
              const text = el.textContent?.trim();
              if (text && (text.includes('Gemini') || text.includes('GPT') || text.includes('Claude'))) {
                return text;
              }
            }

            return '';
          });

          console.log(`📊 현재 선택된 모델: "${currentModel}"`);

          // 이미 Gemini가 선택되어 있다면 스킵
          if (currentModel.includes('Gemini')) {
            console.log('✅ Gemini 모델이 이미 선택되어 있습니다');
            this.modelSelected = true;
          } else {
            // 모델 선택 버튼 찾기 및 클릭 시도
            console.log('🔍 모델 선택 버튼 찾는 중...');

            let buttonClicked = false;
            const buttonSelectors = [
              '[data-testid="model-selector"]',
              '[aria-label*="model" i]',
              '[aria-label*="Model" i]',
              'button[class*="model" i]',
              '[class*="model-selector"]',
              '[class*="model-select"]'
            ];

            for (const selector of buttonSelectors) {
              try {
                const element = await this.page.$(selector);
                if (element) {
                  await element.click();
                  console.log(`✅ 모델 버튼 클릭 (selector): ${selector}`);
                  buttonClicked = true;
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  break;
                }
              } catch (e) {
                // 다음 selector 시도
              }
            }

            // 방법 2: JavaScript로 텍스트 기반 찾기
            if (!buttonClicked) {
              buttonClicked = await this.page.evaluate(() => {
                const allElements = document.querySelectorAll('*');
                for (const el of allElements) {
                  const text = el.textContent?.toLowerCase() || '';
                  const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
                  const className = el.className?.toLowerCase() || '';

                  if ((text.includes('model') || ariaLabel.includes('model') ||
                       text.includes('모델') || ariaLabel.includes('모델') ||
                       className.includes('model')) &&
                      (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' ||
                       el.getAttribute('data-testid'))) {
                    (el as HTMLElement).click();
                    return true;
                  }
                }
                return false;
              });

              if (buttonClicked) {
                console.log('✅ 모델 버튼 클릭 (텍스트 기반)');
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }

            if (!buttonClicked) {
              console.log('⚠️ 모델 선택 버튼을 찾을 수 없음 - 현재 모델 유지');
            } else {
              // Gemini 모델 선택 시도 - 가장 확실한 방법
              console.log('🎯 Gemini 2.5 Pro 모델 선택 시도 중...');

              let modelSelected = false;

              // 방법 1: 정확한 menuitem 텍스트 매칭
              try {
                const geminiClicked = await this.page.evaluate(() => {
                  const menuItems = document.querySelectorAll('[role="menuitem"]');

                  for (let i = 0; i < menuItems.length; i++) {
                    const item = menuItems[i];
                    const text = item.textContent?.trim() || '';

                    if (text === 'Gemini 2.5 Pro') {
                      console.log('✅ Gemini 2.5 Pro 발견! 클릭합니다.');
                      (item as HTMLElement).click();
                      return true;
                    }
                  }

                  return false;
                });

                if (geminiClicked) {
                  console.log('✅ Gemini 2.5 Pro 직접 클릭 성공');
                  modelSelected = true;
                }
              } catch (e) {
                console.log('❌ 직접 클릭 실패:', e);
              }

              // 방법 2: 키보드 네비게이션
              if (!modelSelected) {
                console.log('⌨️ 키보드 네비게이션으로 Gemini 선택 시도...');

                try {
                  // 드롭다운이 열린 후 충분히 기다림
                  await new Promise(resolve => setTimeout(resolve, 1000));

                  // Home 키로 첫 번째 옵션으로 이동
                  await this.page.keyboard.press('Home');
                  await new Promise(resolve => setTimeout(resolve, 300));

                  // 아래 방향키로 Gemini 2.5 Pro까지 이동
                  for (let i = 0; i < 2; i++) {
                    await this.page.keyboard.press('ArrowDown');
                    await new Promise(resolve => setTimeout(resolve, 300));
                  }

                  // 현재 포커스된 요소 확인
                  const focusedElement = await this.page.evaluate(() => {
                    const active = document.activeElement;
                    return active ? active.textContent?.trim() || 'unknown' : 'none';
                  });

                  console.log(`🎯 현재 포커스된 요소: "${focusedElement}"`);

                  if (focusedElement.includes('Gemini')) {
                    await this.page.keyboard.press('Enter');
                    console.log('✅ 키보드로 Gemini 모델 선택됨');
                    modelSelected = true;
                  } else {
                    console.log('❌ Gemini가 포커스되지 않음');
                  }

                } catch (e) {
                  console.log('⚠️ 키보드 네비게이션 실패:', e);
                }
              }

              // 방법 3: JavaScript로 강제 선택 (최후의 수단)
              if (!modelSelected) {
                console.log('💪 JavaScript 강제 선택 시도...');

                try {
                  const forcedSelection = await this.page.evaluate(() => {
                    const allElements = document.querySelectorAll('*');

                    for (const el of allElements) {
                      const text = el.textContent?.trim() || '';
                      if (text === 'Gemini 2.5 Pro') {
                        let clickableEl = el;
                        while (clickableEl && clickableEl !== document.body) {
                          if (clickableEl.getAttribute('role') === 'menuitem' ||
                              (clickableEl as any).onclick ||
                              clickableEl.tagName === 'BUTTON') {
                            (clickableEl as HTMLElement).click();
                            return true;
                          }
                          clickableEl = clickableEl.parentElement!;
                        }
                      }
                    }

                    return false;
                  });

                  if (forcedSelection) {
                    console.log('✅ JavaScript 강제 선택 성공');
                    modelSelected = true;
                  }
                } catch (e) {
                  console.log('❌ JavaScript 강제 선택 실패:', e);
                }
              }

              if (modelSelected) {
                console.log('✅ 모델 선택 성공!');
                this.modelSelected = true;
                await new Promise(resolve => setTimeout(resolve, 2000));
              } else {
                console.log('❌ 모든 모델 선택 방법 실패 - 기본 모델 사용');
              }

              // 모델 선택 창 닫기
              try {
                console.log('🔽 모델 선택 창 닫는 중...');
                await this.page.keyboard.press('Escape');
                await new Promise(resolve => setTimeout(resolve, 500));
              } catch (e) {
                // 무시
              }
            }
          }

        } catch (error) {
          console.log('⚠️  AI 모델 선택 중 오류 발생, 기본 모델로 진행합니다:', error instanceof Error ? error.message : 'Unknown error');
        }
      } else {
        console.log('✅ AI 모델이 이미 Gemini 2.5 Pro로 설정되어 있습니다.');
      }

      // 사용자 확인 완료 후 바로 크롤링 시작

      // 프롬프트 생성
      const prompt = promptTemplate.replace('<유튜브 링크>', youtubeLink);
      console.log(`🔗 ${youtubeLink} 프롬프트 생성 (${prompt.length}자)`);

      // 입력창에 텍스트 입력
      console.log('📝 퍼플렉시티에 프롬프트 입력 중...');

      // 입력창이 확실히 있는지 다시 확인
      const inputReady = await this.page.evaluate(() => {
        const input = document.getElementById('ask-input') as HTMLElement;
        return !!(input && input.offsetParent !== null && !input.hasAttribute('disabled'));
      });

      if (!inputReady) {
        throw new Error('입력 필드가 타이핑 준비가 되지 않았습니다. 로그인이 완료되었는지 확인해주세요.');
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
      console.log(`⌨️ 줄바꿈 포함하여 프롬프트 입력 (${prompt.length}자)...`);

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

      console.log(`✅ 프롬프트 입력 완료 (${inputText.length}/${prompt.length}자)`);

      if (inputText.length === 0) {
        console.warn('⚠️ 입력 필드가 비어있지만 계속 진행...');
      } else if (inputText.length < prompt.length * 0.5) {
        console.warn(`⚠️ 입력 텍스트가 불완전함 (${inputText.length}/${prompt.length})`);
      } else {
        console.log('✅ 입력 검증 통과');
      }

      // 제출
      console.log('🚀 Enter 키로 제출...');
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
        console.log('✅ 제출 버튼 발견 및 클릭');
      } else {
        console.log('ℹ️ Enter 키로 제출');
      }

      // 응답이 나타날 때까지 대기 (재시도 로직 포함)
      console.log(`⏳ ${youtubeLink} 응답 대기 중...`);

      const maxRetries = 2; // 최대 2번 재시도
      let currentRetry = 0;

      while (currentRetry <= maxRetries) {
        try {
          if (currentRetry > 0) {
            console.log(`🔄 응답 대기 재시도 ${currentRetry}/${maxRetries}...`);
            // 재시도 전 페이지 새로고침 (타임아웃 증가)
            await this.page.reload({ waitUntil: 'networkidle0', timeout: 60000 });
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          
          // JSON 코드 블록이 나타날 때까지 대기 - 더 짧은 간격으로 폴링
          console.log('🎯 JSON 코드 블록 대기 시작...');
          
          let codeBlockFound = false;
          let attempts = 0;
          const maxAttempts = 900; // 15분 = 900초 (1초마다 확인)
          
          while (!codeBlockFound && attempts < maxAttempts) {
            attempts++;
            
            codeBlockFound = await this.page.evaluate(() => {
              const codeElements = document.querySelectorAll('pre code');
              if (codeElements.length === 0) return false;
              
              // code 요소 중 하나라도 JSON 내용이 있는지 확인
              for (const code of codeElements) {
                const text = code.textContent?.trim() || '';
                if (text.length > 10 && text.includes('{') && text.includes('youtube_link')) {
                  console.log('✅ JSON 코드 블록 발견!');
                  return true;
                }
              }
              return false;
            });
            
            if (!codeBlockFound) {
              // 10초마다 진행 상황 로그
              if (attempts % 10 === 0) {
                console.log(`⏳ ${attempts / 10}초 경과... JSON 코드 블록 대기 중...`);
              }
              await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기 후 재시도
            }
          }
          
          if (!codeBlockFound) {
            throw new Error('15분 동안 JSON 코드 블록을 찾을 수 없음 - 타임아웃');
          }
          
          console.log('✅ JSON 코드 블록 발견!');

          // JSON 내용이 완전히 로드될 때까지 추가 대기 (여러 개의 JSON 객체 지원)

          // 충분한 시간을 두고 모든 JSON 객체가 생성될 때까지 기다림
          console.log('⏳ 응답 생성 대기 중...');

          // JSON 내용 검증 함수
          const checkJsonContent = () => {
            try {
              const codeElements = document.querySelectorAll('pre code');

              for (const code of codeElements) {
                const text = code.textContent?.trim() || '';
                if (!text) continue;

                const lines = text.split('\n');
                let validJsonCount = 0;
                let hasValidResponse = false;

                for (const line of lines) {
                  const trimmedLine = line.trim();
                  if (!trimmedLine) continue;

                  if (trimmedLine.startsWith('{') &&
                    trimmedLine.endsWith('}') &&
                    trimmedLine.includes('"youtube_link"')) {
                    try {
                      const parsed = JSON.parse(trimmedLine);
                      // 유효한 JSON 객체인지 확인 (최소 youtube_link가 있고 name이 null이 아니거나 reasoning_basis가 있는 경우)
                      if (parsed.youtube_link && (parsed.name !== null || parsed.reasoning_basis)) {
                        validJsonCount++;
                        hasValidResponse = true;
                      }
                    } catch {
                      continue;
                    }
                  }
                }

                // 최소 1개의 유효한 응답이 있으면 진행 (식당 정보가 없어도 정상 응답으로 처리)
                if (hasValidResponse) {
                  return true;
                }
              }
              return false;
            } catch (error) {
              console.log('JSON 검증 중 오류:', error);
              return false;
            }
          };

          // JSON 내용 검증 대기 (타임아웃 5분으로 증가)
          await this.page.waitForFunction(checkJsonContent, {
            timeout: 5 * 60 * 1000 // 5분으로 증가
          });

          console.log('✅ 응답 생성 완료, 안정화 대기...');
          await new Promise(resolve => setTimeout(resolve, 10000));

          console.log('✅ 응답 로드 완료!');

          // 최종 안정화를 위해 잠시 대기
          await new Promise(resolve => setTimeout(resolve, 2000));

          break; // 성공했으므로 루프 탈출

        } catch (error) {
          console.error(`❌ 응답 대기 ${currentRetry + 1}번째 시도 실패:`, error);

          if (currentRetry >= maxRetries) {
            // 최대 재시도 횟수 초과
            throw new Error(`타임아웃 내에 응답을 받지 못함 (재시도 ${maxRetries}회 실패): ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
          }

          currentRetry++;
          console.log(`⏳ ${currentRetry}번째 재시도 준비 중...`);

          // 재시도 전 대기
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      }

      // JSON 코드 블록 찾기 (Puppeteer locator 활용) - 여러 개의 JSON 객체 지원
      console.log('🔍 JSON 응답 추출 중...');

      // HTML 응답에서 JSON 텍스트 추출 (파싱은 Node.js에서)
      const extractJsonFromHtml = () => {
        const jsonTextBlocks: string[] = [];

        try {
          // 방법 1: 정확한 selector로 찾기
          const targetSelectors = [
            'div.relative.font-sans.text-base.text-foreground code[style*="white-space: pre"]',
            'div.relative.font-sans.text-base.text-foreground pre code',
            '.prose code[style*="white-space: pre"]',
            'code[style*="white-space: pre"]'
          ];

          for (const selector of targetSelectors) {
            const codeElements = document.querySelectorAll(selector);
            
            for (const codeElement of codeElements) {
              // span 태그들에서 텍스트 추출
              const spans = codeElement.querySelectorAll('span.token');
              
              if (spans.length > 0) {
                let jsonText = '';
                spans.forEach(span => {
                  jsonText += span.textContent || '';
                });
                
                if (jsonText.includes('"youtube_link"') && jsonText.trim().startsWith('{')) {
                  jsonTextBlocks.push(jsonText);
                }
              } else {
                const text = codeElement.textContent?.trim() || '';
                if (text && text.includes('"youtube_link"') && text.startsWith('{')) {
                  jsonTextBlocks.push(text);
                }
              }
            }
            
            if (jsonTextBlocks.length > 0) break;
          }

          // 방법 2: prose 클래스에서 찾기
          if (jsonTextBlocks.length === 0) {
            const proseElements = document.querySelectorAll('.prose, [class*="prose"]');
            for (const prose of proseElements) {
              const text = prose.textContent?.trim() || '';
              if (text && text.includes('"youtube_link"') && text.includes('{')) {
                jsonTextBlocks.push(text);
              }
            }
          }

          // 방법 3: 전체 body 텍스트에서 찾기
          if (jsonTextBlocks.length === 0) {
            const bodyText = document.body.textContent || '';
            if (bodyText.includes('"youtube_link"') && bodyText.includes('{')) {
              jsonTextBlocks.push(bodyText);
            }
          }

        } catch (error) {
          console.log('HTML에서 JSON 추출 중 오류:', error);
        }

        return jsonTextBlocks;
      };

      // JSON 텍스트 추출 (브라우저 환경에서는 파싱하지 않음)
      const jsonTextResults = await this.page.evaluate(() => {
        const jsonTextBlocks: string[] = [];

        // 방법 1: 정확한 selector로 찾기 (사용자가 제공한 경로)
        // #root > div > ... > div.relative.font-sans.text-base.text-foreground
        const targetSelectors = [
          'div.relative.font-sans.text-base.text-foreground code[style*="white-space: pre"]',
          'div.relative.font-sans.text-base.text-foreground pre code',
          '.prose code[style*="white-space: pre"]',
          'pre code'
        ];

        for (const selector of targetSelectors) {
          const codeElements = Array.from(document.querySelectorAll(selector));
          
          for (const codeElement of codeElements) {
            // span 태그들에서 텍스트 추출
            const spans = codeElement.querySelectorAll('span.token');
            
            if (spans.length > 0) {
              // span 태그들의 textContent를 모두 연결
              let jsonText = '';
              spans.forEach(span => {
                jsonText += span.textContent || '';
              });
              
              // JSON 형태 검증
              if (jsonText.includes('"name"') &&
                  jsonText.includes('"youtube_link"') &&
                  jsonText.includes('"phone"') &&
                  jsonText.includes('"address"') &&
                  jsonText.includes('"reasoning_basis"') &&
                  jsonText.trim().startsWith('{')) {
                console.log(`✅ span 방식으로 JSON 발견: ${jsonText.length}자`);
                jsonTextBlocks.push(jsonText);
              }
            } else {
              // span이 없으면 textContent 사용
              const text = codeElement.textContent?.trim() || '';
              if (text.length > 10 &&
                  text.includes('"name"') &&
                  text.includes('"youtube_link"') &&
                  text.includes('"phone"') &&
                  text.includes('"address"') &&
                  text.includes('"reasoning_basis"') &&
                  text.startsWith('{')) {
                console.log(`✅ textContent 방식으로 JSON 발견: ${text.length}자`);
                jsonTextBlocks.push(text);
              }
            }
          }
          
          if (jsonTextBlocks.length > 0) {
            console.log(`✅ ${selector}에서 ${jsonTextBlocks.length}개 발견`);
            break;
          }
        }

        // 방법 2: 백업 - pre 태그에서 직접 찾기
        if (jsonTextBlocks.length === 0) {
          console.log('⚠️ 주요 selector에서 찾지 못함, pre 태그에서 백업 시도...');
          const preElements = Array.from(document.querySelectorAll('pre')).reverse();
          
          for (const pre of preElements) {
            const text = pre.textContent?.trim() || '';
            if (!text) continue;

            if (text.includes('"name"') &&
                text.includes('"youtube_link"') &&
                text.includes('"phone"') &&
                text.includes('"address"') &&
                text.includes('"reasoning_basis"') &&
                text.startsWith('{')) {
              console.log(`✅ 백업 방식으로 JSON 발견: ${text.length}자`);
              jsonTextBlocks.push(text);
            }
          }
        }

        return jsonTextBlocks;
      });

      console.log(`📄 ${jsonTextResults.length}개의 JSON 텍스트 블록 발견`);

      // Node.js 환경에서 JSON 파싱
      const jsonResults: any[] = [];
      for (const textBlock of jsonTextResults) {
        // 하나의 블록에 여러 JSON 객체가 있을 수 있음
        let jsonBlocks: string[] = [];

        if (textBlock.includes('}\n\n{')) {
          jsonBlocks = textBlock.split('}\n\n{');
          jsonBlocks = jsonBlocks.map((block, index) => {
            if (index === 0) return block + '}';
            if (index === jsonBlocks.length - 1) return '{' + block;
            return '{' + block + '}';
          });
        } else if (textBlock.includes('}\n{')) {
          jsonBlocks = textBlock.split('}\n{');
          jsonBlocks = jsonBlocks.map((block, index) => {
            if (index === 0) return block + '}';
            if (index === jsonBlocks.length - 1) return '{' + block;
            return '{' + block + '}';
          });
        } else {
          jsonBlocks = [textBlock];
        }

        // 각 블록 파싱
        for (const block of jsonBlocks) {
          const trimmedBlock = block.trim();
          if (trimmedBlock.includes('"name"') &&
              trimmedBlock.includes('"youtube_link"') &&
              trimmedBlock.includes('"phone"') &&
              trimmedBlock.includes('"address"') &&
              trimmedBlock.includes('"reasoning_basis"') &&
              trimmedBlock.startsWith('{') &&
              trimmedBlock.endsWith('}')) {
            try {
              const parsed = JSON.parse(trimmedBlock);
              jsonResults.push(parsed);
              console.log(`✅ JSON 객체 파싱 성공: ${parsed.name}`);
            } catch (error) {
              console.log('⚠️ JSON 블록 파싱 실패:', error instanceof Error ? error.message : error);
              console.log('📄 실패한 블록:', trimmedBlock.substring(0, 200));
            }
          }
        }
      }

      // HTML 응답에서 JSON 추출 시도 (기존 방법으로 못 찾았을 경우)
      if (!jsonResults || jsonResults.length === 0) {
        console.log('📄 기존 방법으로 JSON을 찾지 못함, HTML에서 추출 시도...');
        const htmlTextResults = await this.page.evaluate(extractJsonFromHtml);
        console.log(`📄 HTML에서 ${htmlTextResults.length}개의 텍스트 블록 발견`);

        // HTML 텍스트 블록에서 JSON 파싱 (Node.js 환경)
        for (const textBlock of htmlTextResults) {
          // JSON 시작과 끝 찾기
          const startIndex = textBlock.indexOf('{');
          const endIndex = textBlock.lastIndexOf('}');

          if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
            const jsonText = textBlock.substring(startIndex, endIndex + 1);
            
            // 여러 JSON 객체가 있을 수 있음
            let jsonBlocks: string[] = [];
            if (jsonText.includes('}\n\n{')) {
              jsonBlocks = jsonText.split('}\n\n{');
              jsonBlocks = jsonBlocks.map((block, index) => {
                if (index === 0) return block + '}';
                if (index === jsonBlocks.length - 1) return '{' + block;
                return '{' + block + '}';
              });
            } else if (jsonText.includes('}\n{')) {
              jsonBlocks = jsonText.split('}\n{');
              jsonBlocks = jsonBlocks.map((block, index) => {
                if (index === 0) return block + '}';
                if (index === jsonBlocks.length - 1) return '{' + block;
                return '{' + block + '}';
              });
            } else {
              jsonBlocks = [jsonText];
            }

            for (const block of jsonBlocks) {
              try {
                const parsed = JSON.parse(block);
                if (parsed && typeof parsed === 'object' && parsed.youtube_link) {
                  jsonResults.push(parsed);
                  console.log(`✅ HTML JSON 파싱 성공: ${parsed.name || '식당정보없음'}`);
                }
              } catch (parseError) {
                console.log('⚠️ HTML JSON 파싱 실패:', parseError instanceof Error ? parseError.message : parseError);
              }
            }
          }
        }
      }

      if (!jsonResults || jsonResults.length === 0) {
        // 디버깅을 위해 현재 페이지 상태 확인
        const pageContent = await this.page.content();
        console.error('❌ 페이지 내용 미리보기:', pageContent.substring(0, 1000));

        // 현재 보이는 코드 블록들 확인
        const codeBlocks = await this.page.$$eval('pre code', codes =>
          codes.map(code => code.textContent?.substring(0, 200) + '...')
        );
        console.error('❌ 발견된 코드 블록들:', codeBlocks);

        throw new Error('유효한 JSON 응답을 찾을 수 없습니다. 페이지 로드를 확인해주세요.');
      }

      console.log(`✅ ${jsonResults.length}개의 JSON 응답 발견`);

      // 모든 유효한 JSON 객체들을 RestaurantInfo로 변환
      const restaurantInfos: RestaurantInfo[] = [];

      for (const jsonObj of jsonResults) {
        try {
          // youtube_link 키에 JSON 문자열이 들어있는지 확인
          let actualYoutubeLink = youtubeLink;
          let restaurantsArray: any[] = [];

          if (typeof jsonObj.youtube_link === 'string' && jsonObj.youtube_link.trim().startsWith('{')) {
            // youtube_link에 JSON 문자열이 포함된 경우
            console.log('🔄 youtube_link 키에서 JSON 재파싱 시도...');
            try {
              const parsedYoutubeLink = JSON.parse(jsonObj.youtube_link);
              actualYoutubeLink = parsedYoutubeLink.youtube_link || youtubeLink;
              restaurantsArray = parsedYoutubeLink.restaurants || [];
              console.log(`✅ JSON 재파싱 성공: ${restaurantsArray.length}개 식당 발견`);
            } catch (parseError) {
              console.log('⚠️ youtube_link JSON 재파싱 실패, 원본 사용');
              actualYoutubeLink = jsonObj.youtube_link;
            }
          } else {
            // 일반적인 경우: youtube_link가 URL
            actualYoutubeLink = jsonObj.youtube_link;
          }

          // YouTube 링크 검증
          if (actualYoutubeLink !== youtubeLink) {
            console.log(`⚠️ 링크 불일치: ${actualYoutubeLink}`);
            continue;
          }

          // restaurants 배열이 있는 경우
          if (restaurantsArray.length > 0) {
            console.log(`📋 restaurants 배열 처리: ${restaurantsArray.length}개 항목`);
            for (const restaurant of restaurantsArray) {
              const restaurantInfo: RestaurantInfo = {
                name: restaurant.name || null,
                phone: restaurant.phone || null,
                address: restaurant.address || null,
                lat: restaurant.lat || null,
                lng: restaurant.lng || null,
                category: restaurant.category || null,
                youtube_link: actualYoutubeLink,
                reasoning_basis: restaurant.reasoning_basis || jsonObj.reasoning_basis || null,
                tzuyang_review: restaurant.tzuyang_review || jsonObj.tzuyang_review || null
              };

              restaurantInfos.push(restaurantInfo);

              if (restaurant.name) {
                console.log(`✅ 레스토랑 추가: ${restaurantInfo.name}`);
              } else {
                console.log(`ℹ️ 식당 정보 없음 처리`);
              }
            }
          } else {
            // restaurants 배열이 없는 경우: 기존 방식대로 처리
            // 필수 필드 검증 (reasoning_basis가 있으면 유효한 응답으로 간주)
            if (!jsonObj.reasoning_basis) {
              console.log(`⚠️ reasoning_basis 누락`);
              continue;
            }

            const restaurantInfo: RestaurantInfo = {
              name: jsonObj.name || null,
              phone: jsonObj.phone || null,
              address: jsonObj.address || null,
              lat: jsonObj.lat || null,
              lng: jsonObj.lng || null,
              category: jsonObj.category || null,
              youtube_link: actualYoutubeLink,
              reasoning_basis: jsonObj.reasoning_basis,
              tzuyang_review: jsonObj.tzuyang_review || null
            };

            restaurantInfos.push(restaurantInfo);

            // 식당 정보가 있는 경우와 없는 경우에 따라 다른 메시지 출력
            if (jsonObj.name) {
              console.log(`✅ 레스토랑 추가: ${restaurantInfo.name}`);
            } else {
              console.log(`ℹ️ 식당 정보 없음 처리: ${youtubeLink}`);
            }
          }
        } catch (itemError) {
          console.error(`⚠️ JSON 객체 처리 중 오류:`, itemError);
          continue;
        }
      }

      console.log(`📊 최종 결과: ${restaurantInfos.length}개 레스토랑 정보 생성`);

      if (restaurantInfos.length === 0) {
        throw new Error('일치하는 YouTube 링크를 가진 유효한 JSON 객체를 찾을 수 없습니다.');
      }

      console.log(`🎯 ${youtubeLink}에서 ${restaurantInfos.length}개 레스토랑 추출 완료`);

      // 지도 API로 좌표 정보 보완
      console.log('🗺️ 지도 API로 좌표 보완 중...');
      const enrichedRestaurants = await this.enrichCoordinates(restaurantInfos);

      // 출처 인용구 제거
      console.log('🧹 출처 인용구 제거 중...');
      const cleanedRestaurants = this.cleanSourceCitations(enrichedRestaurants);

      // 크롤링 완료 후 라이브러리 삭제 (첫 번째 브라우저만)
      if (this.browserId === 0) {
        console.log('🗑️  크롤링 완료 후 라이브러리 삭제 시작...');
        await this.deleteAllThreads();
      }

      return {
        success: true,
        data: cleanedRestaurants,
        youtubeLink
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Error processing ${youtubeLink}:`, errorMessage);

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
      '호주', 'Australia', 'Sydney', '시드니',
      '헝가리', 'Hungary', 'Budapest', '부다페스트'
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
   * 로그인 상태를 확인합니다.
   */
  async checkLoginStatus(): Promise<{
    isLoggedIn: boolean;
    hasLoginModal: boolean;
    indicators: any;
  }> {
    if (!this.page) {
      throw new Error('Browser page not initialized');
    }

    return await this.page.evaluate(() => {
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

      // 로그인 상태 판단: 로그인 모달이 없고, 로그인 지표가 있으면 로그인된 것으로 판단
      const isLoggedIn = !hasLoginModal && hasAnyLoginIndicator;

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
  }

  /**
   * 자동 로그인을 수행합니다.
   */
  private async performAutoLogin(): Promise<boolean> {
    try {
      console.log('🔄 자동 로그인 시도 중...');

      if (!this.page) {
        throw new Error('Browser page not initialized');
      }

      // 로그인 모달이 있는지 확인
      const loginStatus = await this.checkLoginStatus();

      if (!loginStatus.hasLoginModal) {
        console.log('✅ 로그인 모달이 없어 자동 로그인 불필요');
        return true;
      }

      console.log('🔍 로그인 모달 감지됨, Google 로그인 버튼 클릭 시도');

      // Google 로그인 버튼 찾기 및 클릭
      const googleButtonClicked = await this.page.evaluate(() => {
        const googleButton = document.querySelector('button svg[xmlns*="google"]')?.closest('button') as HTMLButtonElement;
        if (googleButton) {
          googleButton.click();
          return true;
        }
        return false;
      });

      if (!googleButtonClicked) {
        console.log('❌ Google 로그인 버튼을 찾을 수 없음');
        return false;
      }

      console.log('✅ Google 로그인 버튼 클릭됨');

      // 잠시 대기 후 로그인 완료 대기
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 팝업 창 처리 (Google 로그인 팝업)
      try {
        const pages = await this.browser?.pages();
        if (pages && pages.length > 1) {
          const popupPage = pages[pages.length - 1];
          console.log('🔍 Google 로그인 팝업 감지됨');

          // 팝업에서 Google 로그인 페이지 감지 및 자동 처리
          const originalPage = this.page;
          this.page = popupPage; // 팝업을 현재 페이지로 설정

          // 팝업에서 Google 로그인 페이지인지 확인
          const isGoogleLogin = await this.page.evaluate(() => {
            const hasGoogleLogo = document.querySelector('img[alt*="Google"]') ||
              document.querySelector('svg[aria-label*="Google"]') ||
              document.querySelector('[data-google-logo]');
            const hasLoginForm = document.querySelector('form[action*="signin"]') ||
              document.querySelector('input[type="email"]') ||
              document.querySelector('input[name="identifier"]');
            const currentUrl = window.location.href;
            const isGoogleAuthUrl = currentUrl.includes('accounts.google.com') ||
              currentUrl.includes('google.com/signin');

            return !!(hasGoogleLogo || hasLoginForm || isGoogleAuthUrl);
          });

          if (isGoogleLogin) {
            console.log('🚨 팝업에서 Google 로그인 페이지 감지됨 - 수동 로그인 필요');
            // Google 로그인 팝업에서는 수동 개입이 필요하므로 false 반환
            this.page = originalPage;
            return false;
          }

          this.page = originalPage; // 원래 페이지로 복원
        }
      } catch (popupError) {
        console.log('⚠️  팝업 처리 중 오류:', popupError instanceof Error ? popupError.message : 'Unknown error');
      }

      // 로그인 완료 확인 (최대 60초 대기)
      let retryCount = 0;
      const maxRetries = 30; // 30회 * 2초 = 최대 60초 대기

      while (retryCount < maxRetries) {
        const currentStatus = await this.checkLoginStatus();

        if (currentStatus.isLoggedIn && !currentStatus.hasLoginModal) {
          console.log('✅ 자동 로그인 성공!');

          // 로그인 성공 시 세션 즉시 저장
          try {
            await this.saveSession();
            console.log('💾 자동 로그인 후 세션 저장됨');
          } catch (sessionError) {
            console.warn('세션 저장 실패:', sessionError instanceof Error ? sessionError.message : 'Unknown error');
          }

          return true;
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
        retryCount++;

        if (retryCount % 10 === 0) {
          console.log(`⏳ 로그인 대기 중... (${retryCount}/${maxRetries})`);
        }
      }

      console.log('❌ 자동 로그인 실패 - 수동 로그인 필요');
      return false;

    } catch (error) {
      console.log('❌ 자동 로그인 중 오류:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Google 로그인 페이지 감지 (단순 감지만 수행)
   */
  private async checkForGoogleLoginPage(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    try {
      // Google 로그인 페이지 패턴 감지
      const isGoogleLoginPage = await this.page.evaluate(() => {
        // Google 로그인 페이지의 특징적인 HTML 요소들 확인
        const hasGoogleLogo = document.querySelector('img[alt*="Google"]') ||
          document.querySelector('svg[aria-label*="Google"]') ||
          document.querySelector('[data-google-logo]');

        const hasLoginForm = document.querySelector('form[action*="signin"]') ||
          document.querySelector('input[type="email"]') ||
          document.querySelector('input[name="identifier"]');

        const hasGoogleAuthText = Array.from(document.querySelectorAll('*')).some(el =>
          el.textContent?.includes('Google 계정으로 계속') ||
          el.textContent?.includes('Sign in with Google') ||
          el.textContent?.includes('구글 계정으로 로그인')
        );

        // URL로도 확인
        const currentUrl = window.location.href;
        const isGoogleAuthUrl = currentUrl.includes('accounts.google.com') ||
          currentUrl.includes('google.com/signin');

        return !!(hasGoogleLogo || hasLoginForm || hasGoogleAuthText || isGoogleAuthUrl);
      });

      if (isGoogleLoginPage) {
        console.log('🔍 Google 로그인 페이지 감지됨');
        return true;
      }

      return false;

    } catch (error) {
      console.log('⚠️  Google 로그인 페이지 확인 중 오류:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * 세션 상태를 확인하고 필요시 자동 복구합니다.
   * 크롤링 중간에 세션이 만료되었을 때 호출됩니다.
   */
  async ensureSession(): Promise<boolean> {
    try {
      console.log('🔍 세션 상태 확인 중...');

      // 현재 페이지가 Google 로그인 페이지인지 확인
      const hasGoogleLoginPage = await this.checkForGoogleLoginPage();
      if (hasGoogleLoginPage) {
        console.log('🚨 크롤링 중 구글 로그인 페이지 감지됨');
        return false; // 수동 개입 필요
      }

      // Perplexity 로그인 모달 확인
      const loginStatus = await this.checkLoginStatus();

      if (loginStatus.isLoggedIn && !loginStatus.hasLoginModal) {
        console.log('✅ 세션 정상 유지됨');
        return true;
      }

      if (loginStatus.hasLoginModal) {
        console.log('⚠️  로그인 모달 감지됨, 자동 재로그인 시도');
        return await this.performAutoLogin();
      }

      // 로그인 상태가 불확실한 경우
      console.log('❓ 세션 상태 불확실, 재확인 필요');
      return false;

    } catch (error) {
      console.error('❌ 세션 확인 중 오류:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * 로그인 상태를 확인하고 필요시 자동 재로그인합니다.
   */
  async ensureLoggedIn(): Promise<boolean> {
    const loginStatus = await this.checkLoginStatus();

    if (loginStatus.isLoggedIn && !loginStatus.hasLoginModal) {
      return true; // 이미 로그인됨
    }

    console.log('⚠️  로그인 상태 확인 실패, 자동 재로그인 시도');
    return await this.performAutoLogin();
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

      console.log(`🗺️ 네이버 지도 API 호출: ${address}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(apiUrl, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`⚠️ 네이버 지도 API 실패 (${response.status}): ${address}`);
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

      console.warn(`⚠️ 좌표를 찾을 수 없음: ${address}`);
      return null;

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn(`⚠️ 네이버 지도 API 타임아웃: ${address}`);
      } else {
        console.warn(`⚠️ 네이버 지도 API 오류: ${address}`);
      }
      return null;
    }
  }

  /**
   * RestaurantInfo 배열의 좌표 정보를 지도 API로 보완합니다.
   * 해외 주소: 구글 지도 사용, 국내 주소: 네이버 지도 사용
   */
  async enrichCoordinates(restaurants: RestaurantInfo[]): Promise<RestaurantInfo[]> {
    console.log(`🗺️ 좌표 정보 보완 시작: ${restaurants.length}개 레스토랑`);
    const enrichedRestaurants: RestaurantInfo[] = [];

    for (const restaurant of restaurants) {
      const enriched = { ...restaurant };

      // 주소가 있고 식당 이름도 있는 경우에만 좌표 조회
      if (enriched.address && enriched.address.trim() !== '' && enriched.name) {
        let coordinates: { lat: number; lng: number } | null = null;

        if (this.isForeignAddress(enriched.address)) {
          console.log(`🌍 해외 주소: ${enriched.address} - 구글 지도 사용`);
          coordinates = await this.getCoordinatesFromGoogleMaps(enriched.address);
        } else {
          console.log(`🇰🇷 국내 주소: ${enriched.address} - 네이버 지도 사용`);
          coordinates = await this.getCoordinatesFromNaverMap(enriched.address);
        }

        if (coordinates) {
          enriched.lat = coordinates.lat;
          enriched.lng = coordinates.lng;
          console.log(`✅ 좌표 획득: ${enriched.name}`);
        } else {
          console.log(`❌ 좌표 조회 실패: ${enriched.name}`);
        }
      } else if (!enriched.name) {
        // 식당 정보가 없는 경우
        console.log(`ℹ️ 좌표 조회 건너뜀: 식당 정보 없음`);
      }

      enrichedRestaurants.push(enriched);
    }

    console.log(`✅ 좌표 보완 완료: ${enrichedRestaurants.length}개 레스토랑`);
    return enrichedRestaurants;
  }

  /**
   * RestaurantInfo 배열의 좌표 정보를 네이버 지도 API로 보완합니다. (하위 호환성 유지)
   */
  async enrichCoordinatesWithNaverMap(restaurants: RestaurantInfo[]): Promise<RestaurantInfo[]> {
    return this.enrichCoordinates(restaurants);
  }

  /**
   * 브라우저 세션을 파일로 저장합니다.
   */
  async saveSession(): Promise<void> {
    if (!this.page || !this.browser) {
      console.log('⚠️  브라우저가 초기화되지 않아 세션을 저장할 수 없음');
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
      console.log('⚠️  세션 저장 실패:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * 저장된 브라우저 세션을 복원합니다.
   */
  private async restoreSession(): Promise<void> {
    try {
      const fs = await import('fs');

      if (!fs.existsSync(this.sessionPath)) {
        console.log('ℹ️  저장된 세션이 없음, 새 세션으로 시작');
        return;
      }

      const sessionDataText = await fs.promises.readFile(this.sessionPath, 'utf-8');
      const sessionData = JSON.parse(sessionDataText);

      console.log('📂 저장된 세션 발견, 복원 시도...');

      // 세션 데이터 검증
      if (!sessionData.cookies || !Array.isArray(sessionData.cookies)) {
        console.log('⚠️  유효하지 않은 세션 데이터, 새 세션으로 시작');
        return;
      }

      // 세션이 너무 오래된 경우 (8시간 이상) 사용하지 않음
      const sessionAge = Date.now() - new Date(sessionData.timestamp).getTime();
      const maxAge = 8 * 60 * 60 * 1000; // 8시간 (더 엄격하게)

      if (sessionAge > maxAge) {
        console.log(`⚠️  세션이 ${Math.round(sessionAge / (60 * 60 * 1000))}시간 경과됨, 새 세션으로 시작`);
        return;
      }

      // 쿠키 유효성 기본 검증
      if (!sessionData.cookies || !Array.isArray(sessionData.cookies) || sessionData.cookies.length === 0) {
        console.log('⚠️  유효한 쿠키 데이터가 없음, 새 세션으로 시작');
        return;
      }

      // Perplexity 관련 쿠키 존재 확인
      const hasPerplexityCookies = sessionData.cookies.some((cookie: any) =>
        cookie.domain && (cookie.domain.includes('perplexity.ai') || cookie.domain.includes('google.com'))
      );

      if (!hasPerplexityCookies) {
        console.log('⚠️  Perplexity 관련 쿠키가 없음, 새 세션으로 시작');
        return;
      }

      // 세션 복원 플래그 설정 (브라우저 초기화 시 사용)
      this.sessionData = sessionData;
      console.log('✅ 세션 복원 준비 완료');

      this.sessionRestored = true;
      console.log('✅ 세션 복원 성공!');
    } catch (error) {
      console.log('⚠️  세션 복원 실패:', error instanceof Error ? error.message : 'Unknown error');
      this.sessionRestored = false;
    }
  }

  // 세션 데이터 저장용 프로퍼티
  private sessionData: any = null;

  /**
   * 라이브러리의 모든 쓰레드를 삭제합니다.
   */
  async deleteAllThreads(): Promise<void> {
    try {
      console.log('🗑️  모든 쓰레드 삭제 시작...');

      // 0. 먼저 Perplexity 홈으로 이동
      console.log('🌐 Perplexity 홈으로 이동 중...');
      await this.page!.goto('https://www.perplexity.ai/', {
        waitUntil: 'networkidle0',
        timeout: 60000
      });
      console.log('✅ 홈 페이지 로드 완료');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 1. 왼쪽 사이드바의 Home 버튼 직접 클릭
      console.log('🏠 Home 버튼 찾아서 클릭 중...');
      
      const homeClicked = await this.page!.evaluate(() => {
        // 방법 1: data-testid로 찾기
        const homeByTestId = document.querySelector('a[data-testid="sidebar-home"]') as HTMLElement;
        if (homeByTestId) {
          console.log('✅ Home 버튼 찾음 (data-testid)');
          homeByTestId.click();
          return true;
        }

        // 방법 2: href="/"로 찾기 (사이드바 내)
        const allLinks = Array.from(document.querySelectorAll('a[href="/"]'));
        for (const link of allLinks) {
          const rect = link.getBoundingClientRect();
          const text = link.textContent?.trim() || '';
          
          // 왼쪽 사이드바 (x < 300)에서 "Home" 텍스트가 있는 링크
          if (rect.x < 300 && text.includes('Home') && rect.width > 0 && rect.height > 0) {
            console.log('✅ Home 버튼 찾음 (href + text)');
            (link as HTMLElement).click();
            return true;
          }
        }
        
        // 방법 3: 모든 <a> 태그에서 "Home" 텍스트 찾기
        const allAnchorLinks = Array.from(document.querySelectorAll('a'));
        for (const link of allAnchorLinks) {
          const text = link.textContent?.trim() || '';
          const rect = link.getBoundingClientRect();
          
          // 왼쪽 사이드바 (x < 300)에서 "Home" 텍스트만 정확히 있는 링크
          if (text === 'Home' && rect.x < 300 && rect.width > 0 && rect.height > 0) {
            console.log('✅ Home 버튼 찾음 (정확한 텍스트 매칭)');
            (link as HTMLElement).click();
            return true;
          }
        }
        
        // 방법 4: SVG를 포함한 부모 요소 찾기
        const allSvgs = Array.from(document.querySelectorAll('svg'));
        for (const svg of allSvgs) {
          let parent = svg.parentElement;
          while (parent && parent.tagName !== 'A') {
            parent = parent.parentElement;
          }
          
          if (parent && parent.tagName === 'A') {
            const text = parent.textContent?.trim() || '';
            const rect = parent.getBoundingClientRect();
            
            if (text === 'Home' && rect.x < 300) {
              console.log('✅ Home 버튼 찾음 (SVG 부모)');
              (parent as HTMLElement).click();
              return true;
            }
          }
        }
        
        console.log('❌ Home 버튼을 찾을 수 없음');
        return false;
      });

      if (!homeClicked) {
        console.log('❌ Home 버튼을 찾을 수 없음');
        return;
      }
      
      console.log('✅ Home 버튼 클릭 완료');
      console.log('⏳ 페이지 로딩 대기 중...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 2. 사이드바 확장을 위해 Home 버튼에 마우스 호버
      console.log('🖱️  사이드바 확장을 위해 Home 버튼에 마우스 올리기...');
      const homeHovered = await this.page!.evaluate(() => {
        const homeButton = document.querySelector('a[data-testid="sidebar-home"]') as HTMLElement;
        if (homeButton) {
          // 마우스 호버 이벤트 발생
          homeButton.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          homeButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          console.log('✅ Home 버튼에 마우스 올림');
          return true;
        }
        return false;
      });

      if (!homeHovered) {
        console.log('❌ Home 버튼 호버 실패');
        return;
      }

      // 사이드바 확장 대기
      console.log('⏳ 사이드바 확장 대기 중...');
      await new Promise(resolve => setTimeout(resolve, 500));

      // 3. Library 버튼 직접 클릭
      console.log('📚 Library 버튼 찾아서 클릭 중...');
      
      // Library 클릭 시도 (data-testid 우선, 없으면 텍스트로 찾기)
      const libraryClicked = await this.page!.evaluate(() => {
        // 1순위: data-testid="library-tab" 속성으로 찾기 (가장 안정적)
        const libraryLink = document.querySelector('a[data-testid="library-tab"]') as HTMLElement;
        
        if (libraryLink) {
          const rect = libraryLink.getBoundingClientRect();
          console.log('✅ Library 버튼 찾음 (data-testid):', {
            href: libraryLink.getAttribute('href'),
            visible: libraryLink.offsetParent !== null,
            x: Math.round(rect.x),
            y: Math.round(rect.y)
          });
          libraryLink.click();
          return true;
        }
        
        // 2순위: href="/library"로 찾기
        const allLinks = Array.from(document.querySelectorAll('a[href="/library"]'));
        for (const link of allLinks) {
          const htmlLink = link as HTMLElement;
          const rect = htmlLink.getBoundingClientRect();
          const isVisible = htmlLink.offsetParent !== null;
          
          // 왼쪽 사이드바에 위치하고 보이는 링크
          if (rect.x < 300 && isVisible && rect.width > 0) {
            console.log('✅ Library 버튼 찾음 (href):', {
              x: Math.round(rect.x),
              y: Math.round(rect.y)
            });
            htmlLink.click();
            return true;
          }
        }
        
        return false;
      });

      console.log('Library 클릭 결과:', libraryClicked);

      if (!libraryClicked) {
        console.log('❌ Library 버튼 클릭 실패 - 쓰레드 삭제 중단');
        return;
      }
      
      console.log('✅ Library 클릭 성공, 페이지 로딩 대기 중...');
      await new Promise(resolve => setTimeout(resolve, 2500));

      // 4. Library 페이지 상단의 ... 버튼 클릭 (span > button)
      console.log('🎯 ... 메뉴 버튼 클릭 중...');
      
      const dotsClicked = await this.page!.evaluate(() => {
        // Library 페이지의 첫 번째 버튼 찾기 (div:nth-child(1) > div > span > button)
        const allButtons = Array.from(document.querySelectorAll('button'));
        
        for (const btn of allButtons) {
          // span 태그의 자식이고, SVG 아이콘이 있는 버튼
          const parentIsSpan = btn.parentElement?.tagName === 'SPAN';
          const hasSvg = btn.querySelector('svg') !== null;
          const rect = btn.getBoundingClientRect();
          
          // Library 페이지 상단에 있는 버튼 (y < 200, 작은 버튼)
          if (parentIsSpan && hasSvg && rect.y < 200 && rect.width < 50 && rect.height < 50) {
            console.log('... 메뉴 버튼 발견:', {
              parentTag: btn.parentElement?.tagName,
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            });
            
            btn.click();
            return true;
          }
        }
        
        return false;
      });

      if (!dotsClicked) {
        console.log('❌ ... 버튼을 찾을 수 없음');
        return;
      }
      
      console.log('✅ ... 버튼 클릭 완료');
      console.log('⏳ 메뉴 팝업 대기 중...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 5. 팝업 메뉴에서 "Delete All..." 옵션 클릭
      console.log('🗑️  Delete All... 옵션 클릭 중...');
      
      const deleteAllClicked = await this.page!.evaluate(() => {
        // 팝업 메뉴에서 role="menuitem" 찾기
        const menuItems = Array.from(document.querySelectorAll('div[role="menuitem"]'));
        
        console.log(`메뉴 아이템 개수: ${menuItems.length}`);
        
        for (const item of menuItems) {
          const text = item.textContent?.trim() || '';
          
          // "Delete All..." 텍스트가 있는지 확인
          const hasDeleteText = text.includes('Delete All');
          
          // trash 아이콘 SVG가 있는지 확인 (use 태그의 href 속성)
          const svgUse = item.querySelector('svg use');
          const href = svgUse?.getAttribute('xlink:href') || svgUse?.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
          const hasTrashIcon = href.includes('trash');
          
          console.log(`메뉴 아이템: "${text}", trash아이콘: ${hasTrashIcon}, href: ${href}`);
          
          if (hasDeleteText && hasTrashIcon) {
            console.log('✅ Delete All... 옵션 발견! 클릭합니다.');
            (item as HTMLElement).click();
            return true;
          }
        }
        
        // fallback: "Delete All" 텍스트만으로 찾기
        for (const item of menuItems) {
          const text = item.textContent?.trim() || '';
          if (text.includes('Delete All')) {
            console.log('⚠️ trash 아이콘 없이 텍스트만으로 클릭');
            (item as HTMLElement).click();
            return true;
          }
        }
        
        return false;
      });

      if (!deleteAllClicked) {
        console.log('❌ Delete All 옵션을 찾을 수 없음');
        return;
      }
      
      console.log('✅ Delete All 옵션 클릭 완료');
      console.log('⏳ 확인 다이얼로그 대기 중...');
      await new Promise(resolve => setTimeout(resolve, 1500));

      // 6. 첫 번째 확인 버튼 클릭 (빨간색 bg-caution 버튼)
      console.log('🔴 첫 번째 확인 버튼 클릭 중...');
      
      const firstConfirmClicked = await this.page!.evaluate(() => {
        // bg-caution 클래스를 가진 버튼 찾기 (빨간색 경고 버튼)
        const buttons = Array.from(document.querySelectorAll('button'));
        
        for (const btn of buttons) {
          const className = btn.className || '';
          const isVisible = btn.offsetParent !== null;
          
          // bg-caution 클래스가 있고, 보이는 버튼
          if (className.includes('bg-caution') && isVisible) {
            const rect = btn.getBoundingClientRect();
            console.log('첫 번째 확인 버튼 발견:', {
              text: btn.textContent?.trim(),
              x: Math.round(rect.x),
              y: Math.round(rect.y)
            });
            
            btn.click();
            return true;
          }
        }
        
        return false;
      });

      if (!firstConfirmClicked) {
        console.log('❌ 첫 번째 확인 버튼을 찾을 수 없음');
        return;
      }
      
      console.log('✅ 첫 번째 확인 버튼 클릭 완료');
      console.log('⏳ 두 번째 확인 다이얼로그 대기 중...');
      await new Promise(resolve => setTimeout(resolve, 1500));

      // 7. 두 번째 확인 버튼 클릭 (빨간색 bg-caution 버튼)
      console.log('🔴 두 번째 확인 버튼 클릭 중...');
      
      const secondConfirmClicked = await this.page!.evaluate(() => {
        // bg-caution 클래스를 가진 버튼 찾기
        const buttons = Array.from(document.querySelectorAll('button'));
        
        for (const btn of buttons) {
          const className = btn.className || '';
          const isVisible = btn.offsetParent !== null;
          
          if (className.includes('bg-caution') && isVisible) {
            const rect = btn.getBoundingClientRect();
            console.log('두 번째 확인 버튼 발견:', {
              text: btn.textContent?.trim(),
              x: Math.round(rect.x),
              y: Math.round(rect.y)
            });
            
            btn.click();
            return true;
          }
        }
        
        return false;
      });

      if (!secondConfirmClicked) {
        console.log('❌ 두 번째 확인 버튼을 찾을 수 없음');
        return;
      }
      
      console.log('✅ 두 번째 확인 버튼 클릭 완료');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 7. Home으로 돌아가기
      console.log('🏠 Home으로 돌아가는 중...');
      
      const homeReturnClicked = await this.page!.evaluate(() => {
        const allLinks = Array.from(document.querySelectorAll('a'));
        
        for (const link of allLinks) {
          const text = link.textContent?.trim() || '';
          const rect = link.getBoundingClientRect();
          
          if (text === 'Home' && rect.x < 200 && rect.width > 0 && rect.height > 0) {
            link.click();
            return true;
          }
        }
        
        return false;
      });

      if (homeReturnClicked) {
        console.log('✅ Home으로 돌아감');
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      console.log('✅ 모든 쓰레드 삭제 완료!');

    } catch (error) {
      console.error('❌ 쓰레드 삭제 실패:', error);
    }
  }

  /**
   * 브라우저를 닫고 세션을 저장합니다.
   */
  async close(): Promise<void> {
    if (this.page) {
      await this.saveSession();
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  /**
   * 출처 인용구를 제거합니다.
   */
  private removeSourceCitations(text: string): string {
    if (!text) return text;

    // 출처 인용구 패턴들 제거
    // [attached_file:숫자], [web:숫자], [translate:텍스트], [숫자], {ts:숫자}, [attached-file:숫자] 등의 패턴
    const patterns = [
      // 기존 패턴들
      /\[attached_file:\d+\]/g,
      /\[attached-file:\d+\]/g,  // 하이픈 포함 패턴
      /\[web:\d+\]/g,
      /\[translate:[^\]]*\]/g,
      /\[attached_file:\d+,\s*web:\d+\]/g,
      /\[web:\d+,\s*web:\d+\]/g,
      /\[web:\d+,\s*web:\d+,\s*web:\d+\]/g,
      /\[web:\d+,\s*web:\d+,\s*web:\d+,\s*web:\d+\]/g,
      /\[\d+\]/g,  // [2], [3], [12], [14] 등의 숫자 패턴
      /\{ts:\d+\}/g,  // {ts:670}, {ts:768} 등의 타임스탬프 패턴

      // 새로운 패턴들 추가
      /\[ts:\d+\]/g,  // [ts:286]
      /\({ts:\d+\}\)/g,  // ({ts:904-915})
      /\({ts:\d+-\d+}\)/g,  // ({ts:904-915}) 범위 패턴
      /\(web:\d+\)/g,  // (web:42)
      /\{ts:\d+-\d+\}/g,  // {ts:196-228} 범위 패턴
      /\{ts:\d+(?:,\s*ts:\d+)+\}/g,  // {ts:27, ts:94}, {ts:1037, ts:1047} 등 복수 패턴
      /\[attached_file:\d+\([^)]*\)\]/g,  // [attached_file:1(ts:715, ts:754)]

      // 추가된 복잡한 패턴들
      /\(web:\d+(?:,\s*web:\d+)+\)/g,  // (web:6, web:21, web:23, web:24)
      /\({ts:\d+(?:,\s*ts:\d+(?:-\d+)?)+\}\)/g,  // ({ts:243, ts:250-296, ts:422})
      /\{ts:\d+-\d+(?:,\s*ts:\d+)+\}/g,  // {ts:526-563, ts:845}
      /\{attached_file:\d+\([^)]*\)\}/g,  // {attached_file:1(ts:176, ts:514, ts:579)}
      /\{ts:\d+(?:,\s*\d+)+\}/g,  // {ts:613, 643}
      /\(ts:\d+\)/g,  // (ts:59)

      // 새로 추가된 패턴들
      /\(\s*at\s*,\s*\)/g,  // ( at , )
      /\(ts:\d+\.\d+\)/g,  // (ts:64.001), (ts:80.84)
      /\(ts:\d+(?:,\s*ts:\d+)+\)/g,  // (ts:96, ts:104), (ts:453, ts:473, ts:430)
      /\[attached_file:\d+:\s*\d+(?:,\s*\d+)*\]/g,  // [attached_file:1: 300, 797], [attached_file:1: 54]
      /\[attached_file:\d+(?:,\s*(?:ts:\d+|(?:\d+,\s*)+\d+))+\]/g,  // [attached_file:1, ts:57, 66, 114], [attached_file:1, ts:323, ts:634, ts:694]
      /\(attached_file:\d+/g,  // (attached_file:1 (괄호 시작 부분)
      /\(web:\d+(?:,\s*\d+)+\)/g,  // (web:2, 36, 45)
      /\{attached_file:\d+\}/g,  // {attached_file:1}
      /\{ts:\d+(?:,\s*attached_file:\d+)+\}/g,  // {ts:67, attached_file:1}
    ];

    let cleanedText = text;
    for (const pattern of patterns) {
      cleanedText = cleanedText.replace(pattern, '');
    }

    // 빈 괄호 패턴들 제거 (, , , ), (, ) 등
    cleanedText = cleanedText.replace(/\(\s*,\s*\)/g, '');  // (,)
    cleanedText = cleanedText.replace(/\(\s*,\s*,\s*\)/g, '');  // (,,)
    cleanedText = cleanedText.replace(/\(\s*,\s*,\s*,\s*\)/g, '');  // (,,,)
    cleanedText = cleanedText.replace(/\(\s*,\s*,\s*,\s*,\s*\)/g, '');  // (,,,,)
    cleanedText = cleanedText.replace(/\(\s*\)/g, '');  // ()

    // 연속된 공백 정리
    cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

    return cleanedText;
  }

  /**
   * RestaurantInfo에서 출처 인용구를 제거합니다.
   */
  cleanSourceCitations(restaurants: RestaurantInfo[]): RestaurantInfo[] {
    return restaurants.map(restaurant => ({
      ...restaurant,
      reasoning_basis: this.removeSourceCitations(restaurant.reasoning_basis || ''),
      tzuyang_review: this.removeSourceCitations(restaurant.tzuyang_review || '')
    }));
  }
}
