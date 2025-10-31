import { JsonlProcessor } from './dist/jsonl-processor.js';

async function testSingleItem() {
  console.log('🧪 Testing single item processing setup...');

  try {
    const processor = new JsonlProcessor();
    const remainingCount = processor.getRemainingCount();
    console.log(`📊 Remaining items: ${remainingCount}`);

    if (remainingCount > 0) {
      const nextItem = processor.getNextNullEntry();
      console.log('🎯 Next item to process:', nextItem?.youtube_link);
      console.log('✅ File reading/parsing works correctly');
    } else {
      console.log('ℹ️  No remaining items to process');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testSingleItem();
