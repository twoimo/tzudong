import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

function resetData() {
  const filePath = join(process.cwd(), 'tzuyang_restaurant_results.jsonl');

  try {
    // 파일 읽기
    console.log('📖 Reading JSONL file...');
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    console.log(`📊 Found ${lines.length} entries`);

    // 각 항목 초기화 (새로운 구조로 변환)
    const resetEntries = lines.map((line, index) => {
      const entry = JSON.parse(line.trim());

      // 새로운 RestaurantData 구조로 초기화
      const resetEntry = {
        youtube_link: entry.youtube_link, // 유지
        restaurants: [] // 빈 배열로 초기화
      };

      if ((index + 1) % 100 === 0) {
        console.log(`🔄 Processed ${index + 1} entries...`);
      }

      return resetEntry;
    });

    // 파일에 다시 쓰기
    console.log('💾 Writing reset data to file...');
    const outputContent = resetEntries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
    writeFileSync(filePath, outputContent, 'utf-8');

    console.log('✅ Data reset completed!');
    console.log(`📊 ${resetEntries.length} entries have been reset`);
    console.log('   - youtube_link: 유지됨');
    console.log('   - restaurants: 빈 배열로 초기화 (다중 레스토랑 정보 저장용)');

  } catch (error) {
    console.error('❌ Error resetting data:', error.message);
    process.exit(1);
  }
}

// 실행
resetData();
