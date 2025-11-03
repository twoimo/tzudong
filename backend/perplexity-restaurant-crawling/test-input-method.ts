import { PerplexityCrawler } from './dist/perplexity-crawler.js';

async function testInputMethod() {
  console.log('🧪 Testing improved input method (one-time input)...');

  const crawler = new PerplexityCrawler();

  try {
    console.log('📺 Initializing browser...');
    await crawler.initialize();
    console.log('✅ Browser ready!');

    // Navigate to Perplexity
    console.log('🌐 Navigating to Perplexity...');
    await crawler.page.goto('https://www.perplexity.ai/', {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    console.log('⏳ Waiting for page elements...');
    await crawler.page.waitForSelector('#ask-input', { timeout: 30000 });

    // Test the improved input method
    const testPrompt = `당신은 유튜브 URL에서 맛집 정보를 추출하는 AI입니다.

<유튜브 링크>에 있는 '영상 url'을 **하나씩 방문하여(동시 처리하지 않음)** 유튜버가 간 음식점에 대한 정보를 정리해야 합니다.

또한, Python을 포함한 어떤 프로그래밍 언어도 사용하지 마시고, 코드 실행 없이 모든 절차를 스레드 내부에서 직접 처리해야 합니다. 한 번에 하나의 YouTube 링크만 다루어 주세요.

<작업 순서>

1. YouTube 분석 (youtube:get_video_information)

- <유튜브 링크>에 있는 각 url로 툴을 호출합니다.`;

    console.log('📝 Testing one-time input method...');
    console.log('Prompt to input:', JSON.stringify(testPrompt));

    // 입력창에 텍스트 입력 (실제 Puppeteer 방식)
    console.log('📝 Testing actual input method...');

    // 1. 입력창 클릭하여 포커스
    await crawler.page.click('#ask-input');

    // 2. 기존 내용이 있다면 클리어 (Ctrl+A, Delete)
    await crawler.page.keyboard.down('Control');
    await crawler.page.keyboard.press('a');
    await crawler.page.keyboard.up('Control');
    await crawler.page.keyboard.press('Delete');

    // 3. 줄바꿈을 고려하여 한 줄씩 Shift+Enter로 입력
    console.log('⌨️  Typing test prompt with proper line breaks...');

    const lines = testPrompt.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 각 줄의 내용을 입력 (빈 줄 포함)
      await crawler.page.type('#ask-input', line, { delay: 20 });

      // 마지막 줄이 아니면 Shift+Enter로 줄바꿈
      if (i < lines.length - 1) {
        await crawler.page.keyboard.down('Shift');
        await crawler.page.keyboard.press('Enter');
        await crawler.page.keyboard.up('Shift');
        await new Promise(resolve => setTimeout(resolve, 100)); // 줄바꿈 후 잠시 대기
      }
    }

    // 4. 입력 확인
    await new Promise(resolve => setTimeout(resolve, 1000));

    const inputText = await crawler.page.evaluate(() => {
      const element = document.getElementById('ask-input') as HTMLElement;
      return element ? element.textContent || element.innerText || '' : '';
    });

    console.log(`✅ Test input completed (length: ${inputText.length} chars)`);
    if (inputText.length === 0) {
      console.warn('⚠️  Warning: Input field appears to be empty!');
    }

    console.log('✅ Prompt input completed - check the browser to see if text was input correctly');

    // 잠시 대기하여 사용자가 확인할 수 있도록
    console.log('⏳ Waiting 10 seconds for you to check the input...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log('✅ Input method test completed!');

  } catch (error) {
    console.error('❌ Input method test failed:', error.message);
  } finally {
    await crawler.close();
    console.log('🧹 Browser closed.');
  }
}

testInputMethod();
