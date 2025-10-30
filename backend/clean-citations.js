import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

/**
 * 출처 인용구를 제거합니다.
 */
function removeSourceCitations(text) {
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
 * JSONL 파일에서 출처 인용구를 제거합니다.
 */
function cleanCitationsInFile(filePath) {
  console.log(`🧹 Cleaning citations in ${filePath}...`);

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    const cleanedLines = lines.map(line => {
      if (!line.trim()) return line;

      try {
        const data = JSON.parse(line);

        // restaurants 배열의 각 항목에서 출처 인용구 제거
        if (data.restaurants && Array.isArray(data.restaurants)) {
          data.restaurants = data.restaurants.map(restaurant => ({
            ...restaurant,
            reasoning_basis: removeSourceCitations(restaurant.reasoning_basis || ''),
            tzuyang_review: removeSourceCitations(restaurant.tzuyang_review || '')
          }));
        }

        return JSON.stringify(data);
      } catch (parseError) {
        console.warn(`⚠️  Failed to parse line: ${parseError.message}`);
        return line;
      }
    });

    const cleanedContent = cleanedLines.join('\n');
    writeFileSync(filePath, cleanedContent, 'utf-8');

    console.log(`✅ Citations cleaned successfully in ${filePath}`);

  } catch (error) {
    console.error(`❌ Error cleaning citations: ${error.message}`);
  }
}

// 테스트용: 새로운 패턴들이 제대로 필터링되는지 확인
function testNewPatterns() {
  console.log('🧪 Testing new citation patterns...\n');

  const testTexts = [
    '이것은 [ts:286] 테스트입니다.',
    '여러 개의 {ts:27, ts:94} 패턴이 있습니다.',
    '세 개의 {ts:310, ts:343, ts:424} 타임스탬프가 있습니다.',
    '괄호와 중괄호 ({ts:904-915}) 조합입니다.',
    '범위 {ts:196-228} 패턴입니다.',
    '또 다른 {ts:1037, ts:1047} 패턴입니다.',
    '첨부 파일 [attached_file:1(ts:715, ts:754)] 패턴입니다.',
    '(web:42) 웹 패턴입니다.',
    '복잡한 (web:6, web:21, web:23, web:24) 패턴입니다.',
    '복합 패턴 ({ts:243, ts:250-296, ts:422}) 입니다.',
    '실제 데이터 패턴 {ts:526-563, ts:845} 입니다.',
    '첨부 파일 중괄호 {attached_file:1(ts:176, ts:514, ts:579)} 패턴입니다.',
    '특별한 ts 패턴 {ts:613, 643} 입니다.',
    '괄호 ts (ts:59) 패턴입니다.'
  ];

  testTexts.forEach((text, index) => {
    const cleaned = removeSourceCitations(text);
    console.log(`테스트 ${index + 1}:`);
    console.log(`  원본: ${text}`);
    console.log(`  결과: ${cleaned}`);
    console.log('');
  });
}

// 메인 실행
if (process.argv.includes('--test')) {
  testNewPatterns();
} else {
  const filePath = resolve('./tzuyang_restaurant_results.jsonl');
  cleanCitationsInFile(filePath);
}
