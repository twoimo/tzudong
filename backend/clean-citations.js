import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

/**
 * 출처 인용구를 제거합니다.
 */
function removeSourceCitations(text) {
  if (!text) return text;

  // 출처 인용구 패턴들 제거
  // [attached_file:숫자], [web:숫자], [translate:텍스트], [숫자] 등의 패턴
  const patterns = [
    /\[attached_file:\d+\]/g,
    /\[web:\d+\]/g,
    /\[translate:[^\]]*\]/g,
    /\[attached_file:\d+,\s*web:\d+\]/g,
    /\[web:\d+,\s*web:\d+\]/g,
    /\[web:\d+,\s*web:\d+,\s*web:\d+\]/g,
    /\[web:\d+,\s*web:\d+,\s*web:\d+,\s*web:\d+\]/g,
    /\[\d+\]/g  // [2], [3], [12], [14] 등의 숫자 패턴
  ];

  let cleanedText = text;
  for (const pattern of patterns) {
    cleanedText = cleanedText.replace(pattern, '');
  }

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

// 메인 실행
const filePath = resolve('./tzuyang_restaurant_results.jsonl');
cleanCitationsInFile(filePath);
