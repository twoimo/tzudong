import puppeteer, { Browser, Page } from 'puppeteer';
import { RestaurantInfo, ProcessingResult } from './types.js';
import fetch from 'node-fetch';

export class PerplexityCrawler {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private hasProcessedAnyItem: boolean = false;
  private modelSelected: boolean = false;
  private sessionPath: string = './perplexity-session.json';
  private sessionRestored: boolean = false;

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

            // 페이지 새로고침으로 세션 적용
            await this.page.reload({ waitUntil: 'networkidle0' });
            console.log('🔄 페이지 새로고침으로 세션 적용');
          }
        } catch (restoreError) {
          console.log('⚠️  세션 복원 중 일부 오류:', restoreError instanceof Error ? restoreError.message : 'Unknown error');
        }
      }

      await this.page.setViewport({ width: 1920, height: 1080 }); // 전체화면 크기로 설정
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

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

      // 퍼플렉시티 페이지로 이동
      console.log('🌐 퍼플렉시티로 이동 중...');
      const response = await this.page.goto('https://www.perplexity.ai/', {
        waitUntil: 'networkidle0',
        timeout: 60000
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

      // 로그인 상태 확인 (로그인 모달 유무로 판단)
      const loginStatus = await this.checkLoginStatus();

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
      const sessionRestored = this.sessionRestored;

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
          // 먼저 현재 선택된 모델 확인 (여러 방법 시도)
          const currentModel = await this.page.evaluate(() => {
            // 방법 1: aria-label="Gemini 2.5 Pro" 버튼이 있는지 확인
            const geminiButton = document.querySelector('[aria-label="Gemini 2.5 Pro"]');
            if (geminiButton) {
              return true;
            }

            // 방법 2: 모델 선택 버튼의 텍스트 확인
            const modelSelectButton = document.querySelector('[aria-label="모델 선택"]');
            if (modelSelectButton) {
              const textContent = modelSelectButton.textContent || '';
              return textContent.includes('Gemini 2.5 Pro');
            }

            // 방법 3: 현재 활성화된 모델 표시 요소 확인
            const activeModel = document.querySelector('[data-state="closed"][aria-label="Gemini 2.5 Pro"]');
            if (activeModel) {
              return true;
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

      // 응답이 나타날 때까지 대기
      console.log(`⏳ ${youtubeLink} 응답 대기 중...`);

      try {
        // JSON 코드 블록이 나타날 때까지 대기 (최대 10분)
        await this.page.waitForSelector('pre code', {
          timeout: 10 * 60 * 1000 // 10분
        });

        // JSON 내용이 완전히 로드될 때까지 추가 대기 (여러 개의 JSON 객체 지원)

        // 충분한 시간을 두고 모든 JSON 객체가 생성될 때까지 기다림
        console.log('⏳ 응답 생성 대기 중...');

        await this.page.waitForFunction(() => {
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
        }, { timeout: 60000 });

        console.log('✅ 응답 생성 완료, 안정화 대기...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        console.log('✅ 응답 로드 완료!');

        // 최종 안정화를 위해 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error('❌ 응답 타임아웃 또는 감지 실패:', error);
        throw new Error(`타임아웃 내에 응답을 받지 못함: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
      }

      // JSON 코드 블록 찾기 (Puppeteer locator 활용) - 여러 개의 JSON 객체 지원
      console.log('🔍 JSON 응답 추출 중...');

      const jsonResults = await this.page.evaluate(() => {
        // 모든 JSON 코드 블록 찾기 (HTML 구조에 맞게 수정)
        const validJsonObjects: any[] = [];

        // 방법 1: pre 태그 안의 code 태그 찾기
        const preElements = Array.from(document.querySelectorAll('pre')).reverse();

        for (const pre of preElements) {
          // pre 태그 안에서 code 태그 찾기
          const codeElement = pre.querySelector('code');
          if (!codeElement) continue;

          const text = codeElement.textContent?.trim() || '';
          if (!text) continue;

          // 하나의 code 태그 안에 여러 JSON 객체가 있을 수 있음
          // "}\n\n{" 또는 "}\n{" 패턴으로 분리 시도
          let jsonBlocks: string[] = [];

          if (text.includes('}\n\n{')) {
            // 빈 줄로 구분된 경우
            jsonBlocks = text.split('}\n\n{');
            // 첫 번째와 마지막에 중괄호 추가
            jsonBlocks = jsonBlocks.map((block, index) => {
              if (index === 0) return block + '}';
              if (index === jsonBlocks.length - 1) return '{' + block;
              return '{' + block + '}';
            });
          } else if (text.includes('}\n{')) {
            // 바로 이어지는 경우
            jsonBlocks = text.split('}\n{');
            jsonBlocks = jsonBlocks.map((block, index) => {
              if (index === 0) return block + '}';
              if (index === jsonBlocks.length - 1) return '{' + block;
              return '{' + block + '}';
            });
          } else {
            // 다른 방식으로 시도
            jsonBlocks = [text];
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
                validJsonObjects.push(parsed);
                console.log(`✅ JSON 객체 파싱 성공: ${parsed.name}`);
              } catch (error) {
                console.log('JSON 블록 파싱 실패:', error, '블록 길이:', trimmedBlock.length);
              }
            }
          }

          // 개행 분리로 찾지 못했으면 정규식으로 시도
          if (validJsonObjects.length === 0) {
            const jsonRegex = /\{[^{}]*"name"[^}]*"youtube_link"[^}]*"phone"[^}]*"address"[^}]*"reasoning_basis"[^}]*\}/g;
            let match;

            while ((match = jsonRegex.exec(text)) !== null) {
              const jsonText = match[0].trim();

              if (jsonText.includes('"name"') &&
                jsonText.includes('"youtube_link"') &&
                jsonText.includes('"phone"') &&
                jsonText.includes('"address"') &&
                jsonText.includes('"reasoning_basis"') &&
                jsonText.startsWith('{') &&
                jsonText.endsWith('}')) {
                try {
                  // JSON 유효성 검증
                  const parsed = JSON.parse(jsonText);
                  validJsonObjects.push(parsed);
                } catch (error) {
                  console.log('정규식 JSON 파싱 실패:', error, '텍스트:', jsonText.substring(0, 100));
                  continue;
                }
              }
            }
          }
        }

        // 방법 2: 백업 - 모든 pre 태그의 텍스트에서 JSON 추출 시도
        if (validJsonObjects.length === 0) {
          console.log('첫 번째 방법으로 JSON을 찾지 못함, 백업 방법 시도');

          for (const pre of preElements) {
            const text = pre.textContent?.trim() || '';
            if (!text) continue;

            // JSON 객체들을 찾아서 분리
            const jsonMatches = text.match(/\{[^}]*"name"[^}]*"youtube_link"[^}]*"phone"[^}]*"address"[^}]*"reasoning_basis"[^}]*\}/g);

            if (jsonMatches) {
              for (const jsonMatch of jsonMatches) {
                try {
                  const parsed = JSON.parse(jsonMatch);
                  validJsonObjects.push(parsed);
                } catch (error) {
                  console.log('백업 방법 JSON 파싱 실패:', error);
                  continue;
                }
              }
            }
          }
        }

        return validJsonObjects;
      });

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
        // YouTube 링크 검증
        if (jsonObj.youtube_link !== youtubeLink) {
          console.log(`⚠️ 링크 불일치: ${jsonObj.youtube_link}`);
          continue;
        }

        // 필수 필드 검증 (reasoning_basis가 있으면 유효한 응답으로 간주)
        if (!jsonObj.reasoning_basis) {
          console.log(`⚠️ reasoning_basis 누락`);
          continue;
        }

        // 식당 정보가 없는 경우 (모두 null)도 유효한 응답으로 처리
        const restaurantInfo: RestaurantInfo = {
          name: jsonObj.name,
          phone: jsonObj.phone,
          address: jsonObj.address,
          lat: jsonObj.lat,
          lng: jsonObj.lng,
          category: jsonObj.category,
          youtube_link: jsonObj.youtube_link,
          reasoning_basis: jsonObj.reasoning_basis,
          tzuyang_review: jsonObj.tzuyang_review
        };

        restaurantInfos.push(restaurantInfo);

        // 식당 정보가 있는 경우와 없는 경우에 따라 다른 메시지 출력
        if (jsonObj.name) {
          console.log(`✅ 레스토랑 추가: ${restaurantInfo.name}`);
        } else {
          console.log(`ℹ️ 식당 정보 없음 처리: ${youtubeLink}`);
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

      return {
        success: true,
        data: cleanedRestaurants,
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
   * 로그인 상태를 확인합니다.
   */
  private async checkLoginStatus(): Promise<{
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

          // 팝업에서 로그인 완료 대기 (실제로는 수동 로그인 필요)
          await popupPage.waitForNavigation({ timeout: 60000 }).catch(() => {
            console.log('⚠️  팝업 네비게이션 타임아웃');
          });
        }
      } catch (popupError) {
        console.log('⚠️  팝업 처리 중 오류:', popupError instanceof Error ? popupError.message : 'Unknown error');
      }

      // 로그인 완료 확인
      let retryCount = 0;
      const maxRetries = 30; // 30회 * 2초 = 최대 60초 대기

      while (retryCount < maxRetries) {
        const currentStatus = await this.checkLoginStatus();

        if (currentStatus.isLoggedIn && !currentStatus.hasLoginModal) {
          console.log('✅ 자동 로그인 성공!');
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

      // 세션이 너무 오래된 경우 (24시간 이상) 사용하지 않음
      const sessionAge = Date.now() - new Date(sessionData.timestamp).getTime();
      const maxAge = 24 * 60 * 60 * 1000; // 24시간

      if (sessionAge > maxAge) {
        console.log('⚠️  세션이 24시간 이상 경과됨, 새 세션으로 시작');
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
