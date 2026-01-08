import { JsonlProcessor } from './jsonl-processor.js';

async function test() {
  const processor = new JsonlProcessor('./tzuyang_restaurant_results.jsonl');

  console.log('📊 Checking JSONL file status...');

  const allEntries = processor.readAllEntries();
  const nullEntries = processor.findNullEntries();
  const remainingCount = processor.getRemainingCount();

  console.log(`📈 Total entries: ${allEntries.length}`);
  console.log(`📈 Null entries: ${nullEntries.length}`);
  console.log(`📈 Remaining to process: ${remainingCount}`);

  if (nullEntries.length > 0) {
    console.log('\n🔍 First few null entries:');
    nullEntries.slice(0, 3).forEach((entry, index) => {
      console.log(`${index + 1}. ${entry.youtube_link}`);
    });
  }

  console.log('\n✅ Test completed!');
}

test().catch(console.error);
