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

    // 각 항목 초기화
    const resetEntries = lines.map((line, index) => {
      const entry = JSON.parse(line.trim());

      // youtube_link 유지, 나머지 필드 null로 설정, reasoning_basis는 빈 문자열
      const resetEntry = {
        name: null,
        phone: null,
        address: null,
        lat: null,
        lng: null,
        category: null,
        youtube_link: entry.youtube_link, // 유지
        reasoning_basis: "" // 빈 문자열로 설정
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
    console.log('   - name, phone, address, lat, lng, category: null로 설정');
    console.log('   - reasoning_basis: 빈 문자열로 설정');

  } catch (error) {
    console.error('❌ Error resetting data:', error.message);
    process.exit(1);
  }
}

// 실행
resetData();
