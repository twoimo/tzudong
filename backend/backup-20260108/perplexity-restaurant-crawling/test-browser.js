import { PerplexityCrawler } from './dist/perplexity-crawler.js';

async function testBrowser() {
  const crawler = new PerplexityCrawler();

  try {
    console.log('🧪 Testing browser initialization...');
    await crawler.initialize();
    console.log('✅ Browser initialized successfully!');
    console.log('⏳ Waiting 5 seconds to check if Chrome window is visible...');

    await new Promise(resolve => setTimeout(resolve, 5000));

    await crawler.close();
    console.log('✅ Browser closed successfully!');
    console.log('🎉 Test completed successfully!');
  } catch (error) {
    console.error('❌ Browser initialization failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

testBrowser();
