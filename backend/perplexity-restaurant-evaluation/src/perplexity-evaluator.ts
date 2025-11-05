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
  private browserId: number;

  constructor(browserId: number = 0) {
    this.browserId = browserId;
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

      // 임시 디렉토리 설정 (macOS /private/tmp 오류 방지)
      // 각 브라우저마다 고유한 디렉토리 사용
      const os = await import('os');
      const userDataDir = join(os.tmpdir(), `puppeteer_dev_profile_${this.browserId}`);

      this.browser = await puppeteer.launch({
        headless: false, // 구글 로그인 등 상호작용을 위해 헤드리스 모드 해제
        executablePath, // 찾은 Chrome 경로 사용
        userDataDir, // 브라우저별 고유 데이터 디렉토리
        defaultViewport: null, // 기본 뷰포트 설정 해제
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
          '--window-size=1440,900', // macOS에 적합한 창 크기로 설정
          '--disable-infobars', // 정보 표시줄 비활성화
          '--disable-session-crashed-bubble', // 세션 충돌 버블 비활성화
          // 구글 로그인 보안 우회를 위한 추가 플래그
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          '--accept-lang=en-US,en',
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

      // 브라우저 창이 완전히 열릴 때까지 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 브라우저 창 최대화 시도 (JavaScript로)
      try {
        await this.page.evaluate(() => {
          if (window && window.resizeTo) {
            // 화면 크기 가져오기
            const screenWidth = window.screen.availWidth;
            const screenHeight = window.screen.availHeight;
            // 창 최대화
            window.moveTo(0, 0);
            window.resizeTo(screenWidth, screenHeight);
          }
        });
        console.log('✅ 브라우저 창 최대화 시도 완료');
      } catch (error) {
        console.log('⚠️ 브라우저 창 최대화 중 오류 (무시):', error);
      }

      // 뷰포트 설정
      try {
        await this.page.setViewport({
          width: 1440,
          height: 900,
          deviceScaleFactor: 1
        });
        console.log('✅ 뷰포트 크기 설정 완료: 1440x900');
      } catch (error) {
        console.log('⚠️ 뷰포트 설정 중 오류:', error);
      }

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

      // 브라우저 창 크기 및 뷰포트 설정 보장
      await this.page.setViewport({ width: 1440, height: 900 });
      console.log('✅ 최종 뷰포트 크기 설정: 1440x900');
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
      // URL 기반 기본 확인
      const url = this.page!.url();
      const isOnMainPage = url.includes('perplexity.ai') &&
                          !url.includes('login') &&
                          !url.includes('signin');

      // Puppeteer selector로 요소 확인 (button:has-text는 지원하지 않으므로 개별 확인)
      const hasUserMenu = await this.page!.$('[data-testid="user-menu"], [class*="user"], [class*="profile"], button[aria-label*="account"], button[aria-label*="Account"]') !== null;

      // 로그인 관련 요소들을 개별로 확인
      const hasLoginButton1 = await this.page!.$('button[data-testid="login-button"]') !== null;
      const hasLoginButton2 = await this.page!.$('a[href*="login"]') !== null;
      const hasLoginModal = await this.page!.$('[role="dialog"], [class*="modal"], [class*="overlay"]') !== null;

      // 텍스트 기반 요소 확인 (evaluate 사용)
      const hasLoginText = await this.page!.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some(btn => btn.textContent?.includes('Log in') || btn.textContent?.includes('로그인'));
      });

      const hasLoginButton = hasLoginButton1 || hasLoginButton2 || hasLoginText;

      // 입력 필드 존재 여부로 추가 확인
      const hasInputField = await this.page!.$('textarea, [contenteditable="true"], input[type="text"][placeholder*="Ask"]') !== null;

      // 로그인 상태 판단 로직
      const isLoggedIn = (hasUserMenu && !hasLoginButton) || // 사용자 메뉴 있고 로그인 버튼 없음
                        (isOnMainPage && hasInputField && !hasLoginModal); // 메인페이지에 입력 필드 있고 모달 없음

      return {
        isLoggedIn,
        hasLoginModal,
        indicators: {
          url,
          isOnMainPage,
          hasUserMenu,
          hasLoginButton,
          hasLoginModal,
          hasInputField
        }
      };
    } catch (error) {
      console.error('로그인 상태 확인 실패:', error);
      // 오류 발생 시 URL로만 판단
      const url = this.page!.url();
      const isLoggedIn = url.includes('perplexity.ai') &&
                        !url.includes('login') &&
                        !url.includes('signin');

      return {
        isLoggedIn,
        hasLoginModal: false,
        indicators: { url, fallbackCheck: true, error: String(error) }
      };
    }
  }

  /**
   * 랜덤 대기 (1-3초)
   */
  private async randomDelay(min: number = 1000, max: number = 3000): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * 페이지 오류 감지 (ERR_FAILED 등)
   */
  private async checkPageError(): Promise<boolean> {
    try {
      const errorDetected = await this.page!.evaluate(() => {
        const bodyText = document.body.textContent || '';
        // ERR_FAILED, ERR_CONNECTION 등의 오류 메시지 감지
        return bodyText.includes('ERR_FAILED') || 
               bodyText.includes('사이트에 연결할 수 없음') ||
               bodyText.includes('연결이 재설정') ||
               bodyText.includes('서버를 찾을 수 없음');
      });
      return errorDetected;
    } catch (e) {
      return false;
    }
  }

  async deleteAllThreads(): Promise<void> {
    try {
      console.log('🗑️ 모든 쓰레드 삭제 시작...');

      // 1. 왼쪽 사이드바의 Home 버튼 직접 클릭
      console.log('🏠 Home 버튼 찾아서 클릭 중...');
      
      const homeClicked = await this.page!.evaluate(() => {
        // 모든 <a> 태그 찾기
        const allLinks = Array.from(document.querySelectorAll('a'));
        
        for (const link of allLinks) {
          const text = link.textContent?.trim() || '';
          const rect = link.getBoundingClientRect();
          
          // 왼쪽 사이드바 (x < 200)에서 "Home" 텍스트만 정확히 있는 링크
          // 첫 번째 자식으로 나오는 Home 버튼 (nth-child(1))
          if (text === 'Home' && rect.x < 200 && rect.width > 0 && rect.height > 0) {
            console.log('Home 버튼 <a> 발견:', {
              tag: link.tagName,
              href: link.getAttribute('href'),
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            });
            
            link.click();
            return true;
          }
        }
        
        // fallback: SVG를 포함한 부모 요소 찾기
        const allSvgs = Array.from(document.querySelectorAll('svg'));
        for (const svg of allSvgs) {
          // 부모 <a> 태그 찾기
          let parent = svg.parentElement;
          while (parent && parent.tagName !== 'A') {
            parent = parent.parentElement;
          }
          
          if (parent && parent.tagName === 'A') {
            const text = parent.textContent?.trim() || '';
            const rect = parent.getBoundingClientRect();
            
            if (text === 'Home' && rect.x < 200) {
              console.log('Home 버튼 SVG 부모로부터 발견');
              (parent as HTMLElement).click();
              return true;
            }
          }
        }
        
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
        let libraryLink = document.querySelector('a[data-testid="library-tab"]') as HTMLElement;
        
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

      // 3. Library 페이지 상단의 ... 버튼 클릭 (span > button)
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

      // 4. 팝업 메뉴에서 "Delete All..." 옵션 클릭
      console.log('🗑️ Delete All... 옵션 클릭 중...');
      
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

      // 5. 첫 번째 확인 버튼 클릭 (빨간색 bg-caution 버튼)
      console.log('� 첫 번째 확인 버튼 클릭 중...');
      
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

      // 6. 두 번째 확인 버튼 클릭 (빨간색 bg-caution 버튼)
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
        console.log('⚠️ 두 번째 확인 버튼을 찾을 수 없음 (한 번만 클릭하면 되는 경우일 수 있음)');
      } else {
        console.log('✅ 두 번째 확인 버튼 클릭 완료');
      }
      
      console.log('⏳ 삭제 완료 대기 중...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 7. Home으로 돌아가기 (새 쓰레드 시작)
      console.log('🏠 Home 버튼 클릭해서 새 쓰레드 시작...');
      
      const homeClickedAgain = await this.page!.evaluate(() => {
        // 왼쪽 사이드바의 Home 링크 찾기
        const allLinks = Array.from(document.querySelectorAll('a'));
        
        for (const link of allLinks) {
          const text = link.textContent?.trim() || '';
          const rect = link.getBoundingClientRect();
          
          // 왼쪽 사이드바 (x < 200)에서 "Home" 텍스트
          if (text === 'Home' && rect.x < 200 && rect.width > 0) {
            console.log('Home 버튼 클릭');
            link.click();
            return true;
          }
        }
        
        return false;
      });

      if (!homeClickedAgain) {
        console.log('⚠️ Home 버튼을 찾을 수 없음 - URL로 이동');
        await this.page!.goto('https://www.perplexity.ai/');
      } else {
        console.log('✅ Home 버튼 클릭 완료');
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('✅ 모든 쓰레드 삭제 완료');
    } catch (error) {
      console.error('쓰레드 삭제 실패:', error);
      console.log('⚠️ 쓰레드 삭제 중 오류 발생 - 다음 단계 진행');
    }
  }

  private async selectGeminiProModel(): Promise<void> {
    try {
      console.log('🤖 Gemini Pro 2.5 모델 선택 시작...');

      // 디버깅: 현재 페이지의 모든 모델 관련 요소 출력
      console.log('🔍 디버깅: 페이지의 모델 관련 요소들 확인 중...');
      const debugInfo = await this.page!.evaluate(() => {
        const results: any = {
          modelSelectors: [],
          modelButtons: [],
          modelTexts: [],
          allClickableWithModel: []
        };

        // 1. 모델 selector 찾기
        const selectors = [
          '[data-testid*="model"]',
          '[class*="model"]',
          '[aria-label*="model" i]',
          '[aria-label*="Model" i]'
        ];

        selectors.forEach(selector => {
          try {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
              results.modelSelectors.push({
                selector,
                tagName: el.tagName,
                text: el.textContent?.trim(),
                className: el.className,
                ariaLabel: el.getAttribute('aria-label')
              });
            });
          } catch (e) {
            // 무시
          }
        });

        // 2. 모든 버튼과 클릭 가능한 요소 중 모델 관련 찾기
        const allClickable = document.querySelectorAll('button, [role="button"], [role="option"], li, div[onclick]');
        allClickable.forEach(el => {
          const text = el.textContent?.toLowerCase() || '';
          if (text.includes('model') || text.includes('모델') ||
              text.includes('gemini') || text.includes('gpt') || text.includes('claude')) {
            results.allClickableWithModel.push({
              tagName: el.tagName,
              text: el.textContent?.trim(),
              className: el.className,
              role: el.getAttribute('role'),
              ariaLabel: el.getAttribute('aria-label')
            });
          }
        });

        // 3. 페이지 전체 텍스트에서 모델 관련 단어 찾기
        const bodyText = document.body.textContent || '';
        const modelWords = ['gemini', 'gpt', 'claude', 'model', '모델'];
        modelWords.forEach(word => {
          if (bodyText.toLowerCase().includes(word)) {
            const index = bodyText.toLowerCase().indexOf(word);
            const context = bodyText.substring(Math.max(0, index - 20), Math.min(bodyText.length, index + 20));
            results.modelTexts.push(`${word}: "${context}"`);
          }
        });

        return results;
      });

      console.log('📊 디버깅 정보:');
      console.log('모델 selectors:', JSON.stringify(debugInfo.modelSelectors, null, 2));
      console.log('모델 관련 클릭 요소:', JSON.stringify(debugInfo.allClickableWithModel, null, 2));
      console.log('페이지 내 모델 텍스트:', debugInfo.modelTexts);

      // 먼저 현재 선택된 모델 확인
      const currentModel = await this.page!.evaluate(() => {
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
        return;
      }

      // 모델 선택 버튼 찾기 및 클릭 - 여러 방법 시도
      console.log('🔍 모델 선택 버튼 찾는 중...');

      // 방법 1: 정확한 selector로 찾기
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
          const element = await this.page!.$(selector);
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
        buttonClicked = await this.page!.evaluate(() => {
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
        return;
      }

      // 드롭다운이 열린 후 사용 가능한 모델 옵션들 확인
      console.log('📋 드롭다운에서 사용 가능한 모델 옵션들 확인 중...');
      const availableModels = await this.page!.evaluate(() => {
        const options = [];
        const allElements = document.querySelectorAll('*');

        for (const el of allElements) {
          const text = el.textContent?.trim() || '';
          if (text && (text.includes('Gemini') || text.includes('GPT') || text.includes('Claude'))) {
            // 클릭 가능한지 확인
            const isClickable = el.tagName === 'BUTTON' ||
                               el.getAttribute('role') === 'button' ||
                               el.getAttribute('role') === 'option' ||
                               (el as any).onclick ||
                               el.getAttribute('data-value');

            options.push({
              text,
              tagName: el.tagName,
              role: el.getAttribute('role'),
              isClickable,
              className: el.className
            });
          }
        }

        return options;
      });

      console.log('사용 가능한 모델 옵션들:', JSON.stringify(availableModels, null, 2));

      // Gemini 모델 선택 시도 - 가장 확실한 방법
      console.log('🎯 Gemini 2.5 Pro 모델 선택 시도 중...');

      let modelSelected = false;

      // 방법 1: 정확한 menuitem 텍스트 매칭
      try {
        const geminiClicked = await this.page!.evaluate(() => {
          const menuItems = document.querySelectorAll('[role="menuitem"]');

          for (let i = 0; i < menuItems.length; i++) {
            const item = menuItems[i];
            const text = item.textContent?.trim() || '';
            console.log(`${i + 1}번째 메뉴 아이템: "${text}"`);

            if (text === 'Gemini 2.5 Pro') {
              console.log('✅ Gemini 2.5 Pro 발견! 클릭합니다.');
              (item as HTMLElement).click();
              return true;
            }
          }

          console.log('Gemini 2.5 Pro를 찾을 수 없습니다.');
          return false;
        });

        if (geminiClicked) {
          console.log('✅ Gemini 2.5 Pro 직접 클릭 성공');
          modelSelected = true;
        }
      } catch (e) {
        console.log('❌ 직접 클릭 실패:', e);
      }

      // 방법 2: 키보드 네비게이션 (더 정확한 타이밍)
      if (!modelSelected) {
        console.log('⌨️ 키보드 네비게이션으로 Gemini 선택 시도...');

        try {
          // 드롭다운이 열린 후 충분히 기다림
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Home 키로 첫 번째 옵션으로 이동
          await this.page!.keyboard.press('Home');
          await new Promise(resolve => setTimeout(resolve, 300));

          // 아래 방향키로 Gemini 2.5 Pro까지 이동 (세 번째 옵션)
          for (let i = 0; i < 2; i++) { // 0->1: GPT-5, 1->2: Claude Sonnet 4.5, 2->3: Gemini 2.5 Pro
            await this.page!.keyboard.press('ArrowDown');
            await new Promise(resolve => setTimeout(resolve, 300));
          }

          // 현재 포커스된 요소 확인
          const focusedElement = await this.page!.evaluate(() => {
            const active = document.activeElement;
            return active ? active.textContent?.trim() || 'unknown' : 'none';
          });

          console.log(`🎯 현재 포커스된 요소: "${focusedElement}"`);

          if (focusedElement.includes('Gemini')) {
            await this.page!.keyboard.press('Enter');
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
          const forcedSelection = await this.page!.evaluate(() => {
            // 모든 클릭 가능한 요소를 찾아서 Gemini 2.5 Pro 클릭
            const allElements = document.querySelectorAll('*');

            for (const el of allElements) {
              const text = el.textContent?.trim() || '';
              if (text === 'Gemini 2.5 Pro') {
                // 클릭 가능한 부모 요소 찾기
                let clickableEl = el;
                while (clickableEl && clickableEl !== document.body) {
                  if (clickableEl.getAttribute('role') === 'menuitem' ||
                      (clickableEl as any).onclick ||
                      clickableEl.tagName === 'BUTTON') {
                    console.log('강제 클릭 시도:', text);
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
      } else {
        console.log('❌ 모든 모델 선택 방법 실패 - 기본 모델 사용');
      }

      // 선택 후 대기
      if (modelSelected) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 실제 선택 확인 - 페이지에 Gemini 관련 요소가 있는지 확인
        const geminiVisible = await this.page!.evaluate(() => {
          const allText = document.body.textContent?.toLowerCase() || '';
          return allText.includes('gemini') || allText.includes('2.5') || allText.includes('pro');
        });

        if (geminiVisible) {
          console.log('✅ Gemini 모델이 페이지에서 확인됨');
        } else {
          console.log('⚠️ Gemini 모델 표시를 찾을 수 없음 (하지만 선택은 성공했을 수 있음)');
        }
      }

      // 모델 선택 창 닫기
      try {
        console.log('🔽 모델 선택 창 닫는 중...');
        await this.page!.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log('✅ 모델 선택 창 닫힘');
      } catch (e) {
        console.log('ℹ️ ESC 키 동작 실패 (무시)');
      }

      // 최종 선택된 모델 확인 - 더 넓은 범위로 검색
      const finalModel = await this.page!.evaluate(() => {
        // 1. 정확한 selector로 찾기
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

        // 2. 모든 요소에서 모델 관련 텍스트 찾기
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          const text = el.textContent?.trim() || '';
          if (text && (text.includes('Gemini') || text.includes('GPT') || text.includes('Claude'))) {
            // 부모 요소가 버튼이거나 클릭 가능한지 확인
            let parent = el.parentElement;
            while (parent) {
              if (parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'button' ||
                  parent.getAttribute('data-testid') || parent.onclick) {
                return text;
              }
              parent = parent.parentElement;
            }
            // 직접 모델 표시일 수도 있음
            if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
              return text;
            }
          }
        }

        return '';
      });

      console.log(`🎉 최종 선택된 모델: "${finalModel}"`);

      if (finalModel.includes('Gemini')) {
        console.log('✅ 모델 선택 성공!');
      } else {
        console.log('⚠️ 모델 선택 결과 불확실 - 기본 모델 사용 (문제 없을 수 있음)');
      }

      console.log('✅ 모델 선택 완료');

    } catch (error) {
      console.error('모델 선택 실패:', error);
      console.log('⚠️ 모델 선택 실패 - 기본 모델 사용 계속 진행');
    }
  }

  async processEvaluation(restaurantData: string, promptTemplate: string): Promise<ProcessingResult> {
    const maxRetries = 2; // 최초 1번 + 재시도 1번 = 총 2번
    let lastError: any = null;
    let needsModelSelection = true; // 첫 번째 실행 시에만 모델 선택

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          const waitTime = Math.floor(Math.random() * 10000) + 5000; // 5-15초 랜덤 대기
          console.log(`🔄 재시도 ${attempt}/${maxRetries} - ${Math.floor(waitTime/1000)}초 대기 중...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        // 각 단계마다 짧은 랜덤 대기
        await this.randomDelay(1000, 3000);

        const result = await this._processEvaluationInternal(restaurantData, promptTemplate, needsModelSelection);
        
        // 성공하면 바로 반환
        if (result.success) {
          return result;
        }
        
        lastError = result.error;
        
        // JSON 파싱 실패는 재시도하지 않음 (Perplexity 응답 문제)
        if (result.error && result.error.includes('평가 결과를 추출할 수 없습니다')) {
          console.log('⚠️ JSON 파싱 실패 - 재시도하지 않고 오류 기록');
          break;
        }
        
        // 마지막 시도가 아니면 계속
        if (attempt < maxRetries) {
          console.log(`⚠️ 시도 ${attempt} 실패: ${result.error}`);
        }
        
      } catch (error) {
        lastError = error;
        console.error(`❌ 시도 ${attempt} 중 오류:`, error);
        
        // 페이지 오류 감지
        const hasPageError = await this.checkPageError();
        if (hasPageError) {
          console.log('🚨 페이지 오류 감지 - 메인 페이지로 이동 후 모델 재선택 필요');
          needsModelSelection = true; // 페이지 오류 복구 후 모델 선택 필요
          try {
            await this.page!.goto('https://www.perplexity.ai', { 
              waitUntil: 'networkidle0',
              timeout: 60000 
            });
            await this.randomDelay(2000, 4000);
          } catch (gotoError) {
            console.error('❌ 메인 페이지 이동 실패:', gotoError);
          }
        } else {
          // 페이지 오류가 아니면 모델 선택 건너뜀
          needsModelSelection = false;
        }
        
        // 마지막 시도면 종료
        if (attempt === maxRetries) {
          break;
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || String(lastError) || '평가 실패',
      youtubeLink: 'failed'
    };
  }

  private async _processEvaluationInternal(restaurantData: string, promptTemplate: string, needsModelSelection: boolean = true): Promise<ProcessingResult> {
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
        throw new Error('로그인을 완료할 수 없습니다. 수동으로 로그인해주세요.');
      }

      // 랜덤 대기
      await this.randomDelay(1000, 2000);

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

      // 페이지 오류 감지
      const hasError = await this.checkPageError();
      if (hasError) {
        throw new Error('페이지 로드 중 오류 발생 (ERR_FAILED)');
      }

      // 랜덤 대기
      await this.randomDelay(1000, 2000);

      // 최종 로그인 상태 확인 (프롬프트 입력 전 필수)
      console.log('🔍 최종 로그인 상태 확인 중...');

      // 수동 로그인 모드 처리
      console.log('🔍 수동 로그인 모드 - 로그인 상태 확인 중...');

      let loginConfirmed = false;
      let attempts = 0;
      const maxAttempts = 5; // 최대 5번 확인

      while (!loginConfirmed && attempts < maxAttempts) {
        attempts++;
        console.log(`🔍 로그인 상태 확인 시도 ${attempts}/${maxAttempts}...`);

        const loginStatus = await this.checkLoginStatus();
        const url = this.page!.url();

        // 로그인 상태 판단 기준
        const isLoggedIn = loginStatus.isLoggedIn ||
                          (url.includes('perplexity.ai') &&
                           !url.includes('login') &&
                           !url.includes('signin') &&
                           !loginStatus.hasLoginModal);

        if (isLoggedIn) {
          console.log('✅ 로그인 상태 확인됨 - 프롬프트 입력 준비');
          loginConfirmed = true;
        } else {
          if (attempts === 1) {
            console.log('⚠️ 로그인이 필요합니다. 브라우저에서 로그인해주세요.');
            console.log('💡 로그인 완료 후 터미널에서 Enter 키를 눌러주세요.');
          } else {
            console.log(`⏳ 로그인 대기 중... (${attempts}/${maxAttempts})`);
          }

          // 사용자 입력 대기 (첫 번째 시도에서는 바로 대기, 이후에는 10초마다 확인)
          if (attempts === 1) {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.setEncoding('utf8');

            await new Promise((resolve) => {
              process.stdin.once('data', (key) => {
                process.stdin.setRawMode(false);
                process.stdin.pause();
                resolve(key);
              });
            });
            console.log('✅ 사용자 확인 완료 - 로그인 상태 재확인 중...');
          } else {
            // 10초 대기 후 재확인
            await new Promise(resolve => setTimeout(resolve, 10000));
          }
        }
      }

      if (!loginConfirmed) {
        throw new Error('로그인을 확인할 수 없습니다. 수동으로 진행해주세요.');
      }

      console.log('✅ 로그인 확인 완료 - 평가 시작 준비');

      // 입력 필드 준비 확인 (로그인 성공의 확실한 지표)
      console.log('⌨️ 입력 필드 확인 중...');
      const inputSelectors = [
        '[contenteditable="true"]', // 가장 성공률 높은 것 먼저
        'textarea',
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="질문"]'
      ];

      let inputFieldReady = false;
      for (const selector of inputSelectors) {
        try {
          await this.page!.waitForSelector(selector, { timeout: 3000 }); // 타임아웃 줄임
          console.log(`✅ 입력 필드 준비됨: ${selector}`);
          inputFieldReady = true;
          break;
        } catch (e) {
          // 다음 selector 시도
        }
      }

      if (!inputFieldReady) {
        console.log('⚠️ 입력 필드를 찾을 수 없음 - 수동 모드로 진행 시도');
        // 수동 모드에서는 입력 필드가 없어도 진행
        if (process.env.MANUAL_LOGIN !== 'true') {
          throw new Error('입력 필드를 찾을 수 없습니다. 로그인이 제대로 완료되지 않았을 수 있습니다.');
        }
      }

      console.log('✅ 준비 완료 - 평가 시작');

      // 랜덤 대기
      await this.randomDelay(500, 1500);

      // Gemini Pro 2.5 모델 선택 (필요한 경우에만)
      if (needsModelSelection) {
        console.log('🤖 Gemini Pro 2.5 모델 선택 중...');
        await this.selectGeminiProModel();
        // 랜덤 대기
        await this.randomDelay(1000, 2000);
      } else {
        console.log('⏩ 모델 선택 건너뜀 (이미 선택됨)');
      }

      // 입력 필드 찾기 및 프롬프트 입력
      console.log('⌨️ 프롬프트 입력 중...');
      await this.typePromptLikeHuman(promptTemplate);

      // 랜덤 대기
      await this.randomDelay(1000, 2000);

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
      console.log('⌨️ 프롬프트 입력 시작...');

      // 입력 필드 찾기 - 여러 selector 시도
      const inputSelectors = [
        '[contenteditable="true"]', // 가장 성공률 높은 것 먼저
        'textarea',
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="질문"]',
        'input[type="text"]',
        '.composer-input, #composer-input'
      ];

      let inputSelector = '';
      for (const selector of inputSelectors) {
        try {
          await this.page!.waitForSelector(selector, { timeout: 5000 });
          inputSelector = selector;
          console.log(`✅ 입력 필드 발견: ${selector}`);
          break;
        } catch (e) {
          console.log(`⚠️ 입력 필드 시도 실패: ${selector}`);
        }
      }

      if (!inputSelector) {
        throw new Error('입력 필드를 찾을 수 없습니다');
      }

      // 입력 필드 클릭 및 포커스
      console.log('🖱️ 입력 필드 클릭 중...');
      await this.page!.click(inputSelector);
      await new Promise(resolve => setTimeout(resolve, 500));

      // 현재 입력 필드 값 확인
      const initialValue = await this.page!.$eval(inputSelector, el => (el as HTMLTextAreaElement).value || (el as HTMLElement).textContent || '');
      console.log(`📝 초기 입력 필드 값: "${initialValue}"`);

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
          await new Promise(resolve => setTimeout(resolve, 50)); // 200ms → 50ms
        }

        // 현재 줄 입력 (빠르게 타이핑)
        for (let j = 0; j < line.length; j++) {
          await this.page!.type(inputSelector, line[j]);
          // 10-20ms 랜덤 간격 (훨씬 빠르게)
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10 + 10));
        }

        // 줄 입력 완료 후 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 50)); // 200ms → 50ms
      }

      // 입력 완료 후 값 확인
      const finalValue = await this.page!.$eval(inputSelector, el => (el as HTMLTextAreaElement).value || (el as HTMLElement).textContent || '');
      console.log(`✅ 입력 완료! 최종 값 길이: ${finalValue.length}자`);
      console.log(`📝 최종 값 미리보기: "${finalValue.substring(0, 100)}${finalValue.length > 100 ? '...' : ''}"`);

      // 전송 방법 1: Enter 키
      console.log('🚀 Enter 키로 전송 시도...');
      await new Promise(resolve => setTimeout(resolve, 300)); // 500ms → 300ms
      await this.page!.keyboard.press('Enter');

      // 전송 확인 대기 (결과가 나타날 때까지)
      console.log('⏳ 전송 결과 대기 중...');
      await new Promise(resolve => setTimeout(resolve, 1000)); // 2000ms → 1000ms

      // 전송 버튼 찾기 및 클릭 (Enter가 안 먹힐 경우)
      console.log('🔍 전송 버튼 찾는 중...');

      // 텍스트 기반 전송 버튼 찾기 (Puppeteer evaluate 사용)
      const submitButtonFound = await this.page!.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], [data-testid*="send"], [data-testid*="submit"]'));
        for (const btn of buttons) {
          const text = btn.textContent?.toLowerCase() || '';
          const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
          const dataTestId = btn.getAttribute('data-testid')?.toLowerCase() || '';

          if (text.includes('send') || text.includes('submit') ||
              text.includes('보내기') || text.includes('전송') ||
              ariaLabel.includes('send') || ariaLabel.includes('submit') ||
              dataTestId.includes('send') || dataTestId.includes('submit')) {
            (btn as HTMLElement).click();
            return true;
          }
        }
        return false;
      });

      if (submitButtonFound) {
        console.log('✅ 전송 버튼 클릭됨');
      } else {
        console.log('ℹ️ 전송 버튼을 찾을 수 없음 - Enter 키만 사용');
      }

      console.log('✅ 프롬프트 입력 및 전송 완료');

    } catch (error) {
      console.error('프롬프트 입력 실패:', error);
      throw error;
    }
  }

  private async waitForAndExtractResult(): Promise<any | null> {
    try {
      console.log('⏳ "Assistant steps" 텍스트가 나타날 때까지 대기 중...');
      
      // "Assistant steps" 텍스트 대기 (최대 6분 = 360초)
      let assistantStepsFound = false;
      let attempts = 0;
      const maxAttempts = 360; // 6분 동안 1초마다 확인
      
      while (!assistantStepsFound && attempts < maxAttempts) {
        attempts++;
        
        assistantStepsFound = await this.page!.evaluate(() => {
          const allElements = Array.from(document.querySelectorAll('*'));
          for (const el of allElements) {
            const text = el.textContent?.trim() || '';
            if (text === 'Assistant steps' || text.includes('Assistant steps')) {
              console.log('✅ "Assistant steps" 텍스트 발견!');
              return true;
            }
          }
          return false;
        });
        
        if (!assistantStepsFound) {
          // 1분마다 진행 상황 로그
          if (attempts % 60 === 0) {
            console.log(`⏳ ${attempts / 60}분 경과... "Assistant steps" 대기 중...`);
          }
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기 후 재시도
        }
      }
      
      if (!assistantStepsFound) {
        console.log('❌ 6분 동안 "Assistant steps" 텍스트를 찾을 수 없음 - 타임아웃');
        return null; // 타임아웃 시 null 반환 (에러로 처리됨)
      }
      
      // 응답이 완전히 생성될 때까지 충분히 대기 (5-8초 랜덤)
      const waitTime = Math.floor(Math.random() * 3000) + 5000; // 5000-8000ms
      console.log(`✅ "Assistant steps" 발견! 응답 완료 대기 중 (${Math.floor(waitTime/1000)}초)...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      // JSON 추출 시도 (방법 1: code 블록, 방법 2: Answer 내 일반 텍스트)
      console.log('🔍 JSON 데이터 추출 시도...');
      
      const extractResult = await this.page!.evaluate(() => {
        // 방법 1: code 블록에서 찾기
        console.log('📦 방법 1: code 블록에서 JSON 찾기...');
        const codeElements = Array.from(document.querySelectorAll('code'));
        console.log(`발견된 code 요소: ${codeElements.length}개`);
        
        const validCodeBlocks = codeElements.filter(code => {
          const inlineStyle = code.getAttribute('style') || '';
          const computedStyle = window.getComputedStyle(code);
          const hasPreStyle = inlineStyle.includes('white-space: pre') || 
                             inlineStyle.includes('white-space:pre') ||
                             computedStyle.whiteSpace === 'pre';
          
          const spanCount = code.querySelectorAll('span').length;
          const hasEnoughSpans = spanCount > 10;
          
          const firstSpan = code.querySelector('span');
          const looksLikeJSON = firstSpan?.textContent?.trim().startsWith('{');
          
          return hasPreStyle && hasEnoughSpans && looksLikeJSON;
        });
        
        console.log(`유효한 code 블록: ${validCodeBlocks.length}개`);
        
        if (validCodeBlocks.length === 1) {
          // code 블록에서 JSON 추출 (전체 textContent를 한 번에 가져옴)
          const codeBlock = validCodeBlocks[0];
          const jsonText = codeBlock.textContent || '';
          
          console.log(`✅ code 블록에서 JSON 추출 성공 (${jsonText.length}자)`);
          return { success: true, jsonText, method: 'code_block' };
        }
        
        // 방법 2: Answer 영역에서 일반 텍스트로 JSON 찾기
        console.log('📄 방법 2: Answer 영역에서 일반 텍스트 JSON 찾기...');
        
        // 전체 페이지 텍스트에서 JSON 패턴 찾기
        const bodyText = document.body.textContent || '';
        
        // visit_authenticity를 포함하는 JSON 객체 추출 (중첩 객체 고려)
        // { 부터 시작해서 마지막 } 까지 찾되, visit_authenticity 포함 확인
        let braceCount = 0;
        let jsonStart = -1;
        let jsonEnd = -1;
        
        for (let i = 0; i < bodyText.length; i++) {
          const char = bodyText[i];
          
          if (char === '{') {
            if (braceCount === 0) {
              jsonStart = i;
            }
            braceCount++;
          } else if (char === '}') {
            braceCount--;
            if (braceCount === 0 && jsonStart >= 0) {
              jsonEnd = i + 1;
              // visit_authenticity 포함 여부 확인
              const candidate = bodyText.substring(jsonStart, jsonEnd);
              if (candidate.includes('visit_authenticity') && 
                  candidate.includes('rb_inference_score') &&
                  candidate.includes('category_TF')) {
                console.log(`✅ Answer 영역에서 JSON 추출 성공 (${candidate.length}자)`);
                return { success: true, jsonText: candidate, method: 'answer_text' };
              }
              // 일치하지 않으면 계속 탐색
              jsonStart = -1;
            }
          }
        }
        
        // 모든 방법 실패
        console.log('❌ 모든 방법으로 JSON을 찾지 못함');
        return { 
          success: false, 
          error: 'JSON을 찾을 수 없음 (code 블록 및 Answer 텍스트 모두 실패)', 
          codeCount: codeElements.length
        };
      });

      if (!extractResult.success) {
        console.log(`❌ ${extractResult.error}`);
        console.log(`📊 디버깅 정보: code=${extractResult.codeCount}`);
        return null;
      }

      if (!extractResult.jsonText) {
        console.log('❌ JSON 텍스트가 비어있음');
        return null;
      }

      console.log(`✅ JSON 추출 완료 (방법: ${extractResult.method}, ${extractResult.jsonText.length}자)`);
      
      // JSON 파싱 시도
      console.log('🔄 JSON 파싱 중...');
      let parsedData: any;
      
      try {
        parsedData = JSON.parse(extractResult.jsonText);
        console.log('✅ JSON 파싱 성공');
      } catch (parseError) {
        console.log(`❌ JSON 파싱 실패: ${parseError}`);
        console.log(`📄 추출된 텍스트:\n${extractResult.jsonText}`);
        return null;
      }
      
      // 필수 키 5개 존재 확인
      const requiredKeys = [
        'visit_authenticity',
        'rb_inference_score',
        'rb_grounding_TF',
        'review_faithfulness_score',
        'category_TF'
      ];
      
      const missingKeys = requiredKeys.filter(key => !(key in parsedData));
      
      if (missingKeys.length > 0) {
        console.log(`❌ 필수 키 누락: ${missingKeys.join(', ')}`);
        return null;
      }
      
      console.log('✅ 모든 필수 키 존재 확인');
      
      // visit_authenticity 구조 검증 (values, missing 필드 필요)
      if (!parsedData.visit_authenticity || 
          typeof parsedData.visit_authenticity !== 'object' ||
          !Array.isArray(parsedData.visit_authenticity.values) ||
          !Array.isArray(parsedData.visit_authenticity.missing)) {
        console.log('❌ visit_authenticity 구조 오류: {values: [], missing: []} 형식이 필요합니다');
        console.log(`📄 실제 데이터: ${JSON.stringify(parsedData.visit_authenticity)}`);
        return null;
      }
      
      // 나머지 4개는 배열 구조 검증
      const arrayKeys = ['rb_inference_score', 'rb_grounding_TF', 'review_faithfulness_score', 'category_TF'];
      for (const key of arrayKeys) {
        if (!Array.isArray(parsedData[key])) {
          console.log(`❌ ${key} 구조 오류: 배열이 아닙니다`);
          console.log(`📄 실제 데이터: ${JSON.stringify(parsedData[key])}`);
          return null;
        }
      }
      
      console.log('✅ 데이터 구조 검증 완료');
      
      // 파싱된 데이터 반환
      return parsedData;

    } catch (error) {
      console.error('❌ 결과 추출 실패:', error);
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
      // 수동 로그인 모드인 경우 세션 검증 생략
      if (process.env.MANUAL_LOGIN === 'true') {
        console.log('🔄 수동 로그인 모드 - 세션 검증 생략');
        return true;
      }

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

      // 환경 변수에 수동 로그인 모드 설정 확인
      const manualLogin = process.env.MANUAL_LOGIN === 'true';

      if (manualLogin) {
        console.log('🔄 수동 로그인 모드 활성화 - 사용자가 직접 로그인해주세요');
        console.log('💡 브라우저 창에서 Perplexity에 로그인한 후, 터미널에서 Enter 키를 눌러주세요');

        // 사용자 입력 대기
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        await new Promise((resolve) => {
          process.stdin.once('data', (key) => {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            resolve(key);
          });
        });

        console.log('✅ 수동 로그인 완료로 간주하고 진행합니다');
        await this.saveSession();
        return true;
      }

      // 자동 로그인 모드
      console.log('🤖 자동 로그인 모드 - 구글 로그인 시도 중...');
      const googleLoginSuccess = await this.tryGoogleLogin();
      if (googleLoginSuccess) {
        console.log('✅ 구글 로그인 성공');
        await this.saveSession();
        return true;
      }

      // 구글 로그인이 실패하면 일반 로그인 시도
      console.log('⚠️ 구글 로그인 실패, 일반 Perplexity 로그인 시도 중...');

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
        console.log('⚠️ 로그인 버튼을 찾을 수 없음 - 수동 로그인으로 전환');
        console.log('💡 브라우저 창에서 직접 Perplexity에 로그인해주세요');
        console.log('💡 로그인 완료 후 터미널에서 Enter 키를 눌러주세요');

        // 사용자 입력 대기
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        await new Promise((resolve) => {
          process.stdin.once('data', (key) => {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            resolve(key);
          });
        });

        console.log('✅ 수동 로그인 완료로 간주하고 진행합니다');
        await this.saveSession();
        return true;
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

      // 로그인 완료 대기 및 상태 확인
      console.log('⏳ 로그인 완료 대기 중...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 로그인 성공 확인 (여러 번 시도)
      let loginSuccess = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`🔍 로그인 상태 확인 시도 ${attempt}/3...`);
        const loginStatus = await this.checkLoginStatus();

        if (loginStatus.isLoggedIn && !loginStatus.hasLoginModal) {
          console.log('✅ 로그인 성공 확인됨');
          loginSuccess = true;
          break;
        } else if (loginStatus.hasLoginModal) {
          console.log(`⚠️ 로그인 모달이 아직 표시됨 (시도 ${attempt}/3)`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          console.log(`⚠️ 로그인 상태 불확실 (시도 ${attempt}/3)`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      if (loginSuccess) {
        // 추가 검증: 입력 필드가 나타나는지 확인 (로그인 성공의 확실한 지표)
        try {
          const inputSelectors = [
            'textarea[placeholder*="Ask"]',
            'textarea[placeholder*="질문"]',
            'textarea',
            '[contenteditable="true"]'
          ];

          let inputFieldFound = false;
          for (const selector of inputSelectors) {
            try {
              await this.page!.waitForSelector(selector, { timeout: 3000 });
              console.log(`✅ 입력 필드 확인됨: ${selector} - 로그인 성공 확실`);
              inputFieldFound = true;
              break;
            } catch (e) {
              // 다음 selector 시도
            }
          }

          if (inputFieldFound) {
            console.log('✅ 일반 로그인 성공 및 입력 필드 확인됨');
            await this.saveSession();
            return true;
          } else {
            console.log('⚠️ 로그인 상태는 확인되었으나 입력 필드를 찾을 수 없음');
            return false;
          }
        } catch (error) {
          console.log('⚠️ 입력 필드 확인 중 오류:', error);
          return false;
        }
      } else {
        console.log('❌ 로그인 실패 - 로그인 상태가 유효하지 않음');
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
      if (loginStatus.isLoggedIn && !loginStatus.hasLoginModal) {
        console.log('✅ 구글 로그인 성공');

        // 추가 검증: 입력 필드가 나타나는지 확인
        try {
          const inputSelectors = [
            'textarea[placeholder*="Ask"]',
            'textarea[placeholder*="질문"]',
            'textarea',
            '[contenteditable="true"]'
          ];

          let inputFieldFound = false;
          for (const selector of inputSelectors) {
            try {
              await this.page!.waitForSelector(selector, { timeout: 3000 });
              console.log(`✅ 입력 필드 확인됨: ${selector} - 구글 로그인 성공 확실`);
              inputFieldFound = true;
              break;
            } catch (e) {
              // 다음 selector 시도
            }
          }

          if (inputFieldFound) {
            await this.saveSession();
            return true;
          } else {
            console.log('⚠️ 구글 로그인 상태는 확인되었으나 입력 필드를 찾을 수 없음');
            return false;
          }
        } catch (error) {
          console.log('⚠️ 입력 필드 확인 중 오류:', error);
          return false;
        }
      } else {
        console.log('⚠️ 구글 로그인 완료되었으나 Perplexity 로그인 상태 확인 필요');
        // 2FA나 추가 확인이 있을 수 있으므로 잠시 더 대기
        await new Promise(resolve => setTimeout(resolve, 3000));
        const finalStatus = await this.checkLoginStatus();
        if (finalStatus.isLoggedIn && !finalStatus.hasLoginModal) {
          console.log('✅ 구글 로그인 최종 확인됨');
          await this.saveSession();
          return true;
        } else {
          console.log('❌ 구글 로그인 실패');
          return false;
        }
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
