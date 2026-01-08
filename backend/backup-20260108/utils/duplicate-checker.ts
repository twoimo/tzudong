/**
 * 중복 검사를 위한 공통 유틸리티 함수
 * 모든 데이터 처리 스크립트에서 재사용 가능
 */

import fs from 'fs';
import path from 'path';

/**
 * JSONL 파일에서 처리된 youtube_link 추출
 * 
 * @param filePath JSONL 파일 경로
 * @returns 처리된 URL들의 Set
 * 
 * @example
 * const processedUrls = loadProcessedUrls('tzuyang_restaurant_results.jsonl');
 * console.log(`처리된 URL: ${processedUrls.size}개`);
 */
export function loadProcessedUrls(filePath: string): Set<string> {
  const urls = new Set<string>();
  
  if (!fs.existsSync(filePath)) {
    return urls;
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();
      if (!line) continue;
      
      try {
        const data = JSON.parse(line);
        if (data.youtube_link) {
          urls.add(data.youtube_link);
        }
      } catch (err) {
        console.warn(`⚠️  JSON 파싱 오류 (라인 ${lineNum + 1}):`, err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err) {
    console.error(`❌ 파일 읽기 실패 (${filePath}):`, err instanceof Error ? err.message : String(err));
  }
  
  return urls;
}

/**
 * JSONL 파일에서 처리된 restaurant 이름/ID 추출
 * 
 * @param filePath JSONL 파일 경로
 * @param key 추출할 키 ('name', 'unique_id' 등)
 * @param nestedKey restaurants가 들어있는 상위 키 (기본값: 'restaurants')
 * @returns 처리된 restaurant 키값들의 Set
 * 
 * @example
 * const processed = loadProcessedRestaurants('output.jsonl', 'name');
 * const newRestaurants = inputList.filter(r => !processed.has(r.name));
 */
export function loadProcessedRestaurants(
  filePath: string,
  key: string = 'name',
  nestedKey: string | null = 'restaurants'
): Set<string> {
  const restaurants = new Set<string>();
  
  if (!fs.existsSync(filePath)) {
    return restaurants;
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();
      if (!line) continue;
      
      try {
        const data = JSON.parse(line);
        
        // nestedKey가 있는 경우 (예: {'restaurants': [...]})
        if (nestedKey && data[nestedKey]) {
          const items = data[nestedKey];
          if (Array.isArray(items)) {
            for (const restaurant of items) {
              if (restaurant[key]) {
                restaurants.add(restaurant[key]);
              }
            }
          }
        }
        // nestedKey가 없는 경우 (예: 각 라인이 restaurant)
        else if (!nestedKey && data[key]) {
          restaurants.add(data[key]);
        }
      } catch (err) {
        console.warn(`⚠️  JSON 파싱 오류 (라인 ${lineNum + 1}):`, err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err) {
    console.error(`❌ 파일 읽기 실패 (${filePath}):`, err instanceof Error ? err.message : String(err));
  }
  
  return restaurants;
}

/**
 * JSONL 파일에서 처리된 unique_id 추출
 * 
 * @param filePath JSONL 파일 경로
 * @returns 처리된 unique_id들의 Set
 * 
 * @example
 * const writtenIds = loadProcessedUniqueIds('transforms.jsonl');
 * if (!writtenIds.has(uniqueId)) {
 *   // 새 데이터 추가
 * }
 */
export function loadProcessedUniqueIds(filePath: string): Set<string> {
  const ids = new Set<string>();
  
  if (!fs.existsSync(filePath)) {
    return ids;
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();
      if (!line) continue;
      
      try {
        const data = JSON.parse(line);
        if (data.unique_id) {
          ids.add(data.unique_id);
        }
      } catch (err) {
        console.warn(`⚠️  JSON 파싱 오류 (라인 ${lineNum + 1}):`, err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err) {
    console.error(`❌ 파일 읽기 실패 (${filePath}):`, err instanceof Error ? err.message : String(err));
  }
  
  return ids;
}

/**
 * 중복되지 않은 항목만 필터링
 * 
 * @param inputItems 입력 항목 리스트
 * @param processedItems 이미 처리된 항목 Set
 * @param keyFunc 항목에서 키를 추출하는 함수
 * @returns 중복되지 않은 항목 리스트
 * 
 * @example
 * const processedUrls = loadProcessedUrls('output.jsonl');
 * const newItems = filterNewItems(
 *   inputList,
 *   processedUrls,
 *   (x) => x.youtube_link
 * );
 */
export function filterNewItems<T>(
  inputItems: T[],
  processedItems: Set<string>,
  keyFunc: (item: T) => string
): T[] {
  return inputItems.filter(item => !processedItems.has(keyFunc(item)));
}

/**
 * JSONL 파일에 데이터 추가 (append 모드)
 * 
 * @param filePath JSONL 파일 경로
 * @param data 추가할 데이터 (객체 또는 배열)
 * @param createDirs 디렉토리가 없으면 생성할지 여부 (기본값: true)
 * @returns 추가된 항목 수
 * 
 * @example
 * const count = appendToJsonl('output.jsonl', newData);
 * console.log(`${count}개 항목 추가됨`);
 */
export function appendToJsonl(
  filePath: string,
  data: any | any[],
  createDirs: boolean = true
): number {
  let count = 0;
  
  // 디렉토리가 없으면 생성
  if (createDirs) {
    const dirPath = path.dirname(filePath);
    if (dirPath && !fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
  
  const items = Array.isArray(data) ? data : [data];
  
  try {
    const stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
    
    for (const item of items) {
      stream.write(JSON.stringify(item) + '\n');
      count++;
    }
    
    stream.end();
  } catch (err) {
    console.error(`❌ 파일 쓰기 실패 (${filePath}):`, err instanceof Error ? err.message : String(err));
    throw err;
  }
  
  return count;
}

/**
 * 여러 JSONL 파일에서 처리된 youtube_link 추출
 * 
 * @param filePaths JSONL 파일 경로들
 * @returns 모든 파일에서 추출한 URL들의 합집합
 * 
 * @example
 * const allProcessed = loadMultipleProcessedUrls(
 *   'results.jsonl',
 *   'errors.jsonl',
 *   'no_selection.jsonl'
 * );
 */
export function loadMultipleProcessedUrls(...filePaths: string[]): Set<string> {
  const allUrls = new Set<string>();
  
  for (const filePath of filePaths) {
    const urls = loadProcessedUrls(filePath);
    urls.forEach(url => allUrls.add(url));
  }
  
  return allUrls;
}

/**
 * 여러 JSONL 파일에서 처리된 restaurant 이름/ID 추출
 * 
 * @param filePaths JSONL 파일 경로들
 * @param key 추출할 키 ('name', 'unique_id' 등)
 * @param nestedKey restaurants가 들어있는 상위 키
 * @returns 모든 파일에서 추출한 restaurant 키값들의 합집합
 * 
 * @example
 * const allProcessed = loadMultipleProcessedRestaurants(
 *   ['results.jsonl', 'errors.jsonl'],
 *   'name'
 * );
 */
export function loadMultipleProcessedRestaurants(
  filePaths: string[],
  key: string = 'name',
  nestedKey: string | null = 'restaurants'
): Set<string> {
  const allRestaurants = new Set<string>();
  
  for (const filePath of filePaths) {
    const restaurants = loadProcessedRestaurants(filePath, key, nestedKey);
    restaurants.forEach(restaurant => allRestaurants.add(restaurant));
  }
  
  return allRestaurants;
}

/**
 * JSONL 파일의 통계 정보 반환
 * 
 * @param filePath JSONL 파일 경로
 * @returns 파일 통계 정보
 * 
 * @example
 * const stats = getFileStats('output.jsonl');
 * console.log(`총 ${stats.totalLines}개 항목, 파일 크기: ${stats.sizeMB.toFixed(2)}MB`);
 */
export function getFileStats(filePath: string): {
  exists: boolean;
  totalLines: number;
  validLines: number;
  invalidLines: number;
  sizeBytes: number;
  sizeMB: number;
} {
  if (!fs.existsSync(filePath)) {
    return {
      exists: false,
      totalLines: 0,
      validLines: 0,
      invalidLines: 0,
      sizeBytes: 0,
      sizeMB: 0
    };
  }
  
  let totalLines = 0;
  let validLines = 0;
  let invalidLines = 0;
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    
    for (const line of lines) {
      if (line.trim()) {
        totalLines++;
        try {
          JSON.parse(line);
          validLines++;
        } catch {
          invalidLines++;
        }
      }
    }
  } catch (err) {
    console.error(`❌ 파일 읽기 실패 (${filePath}):`, err instanceof Error ? err.message : String(err));
  }
  
  const fileSize = fs.statSync(filePath).size;
  
  return {
    exists: true,
    totalLines,
    validLines,
    invalidLines,
    sizeBytes: fileSize,
    sizeMB: fileSize / (1024 * 1024)
  };
}

// 테스트 코드 (직접 실행 시)
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🧪 중복 검사 유틸리티 함수 테스트\n');
  
  const testFile = 'test_output.jsonl';
  
  // 테스트 데이터 작성
  const testData = [
    { youtube_link: 'https://youtube.com/watch?v=1', unique_id: 'id1', name: 'Restaurant 1' },
    { youtube_link: 'https://youtube.com/watch?v=2', unique_id: 'id2', name: 'Restaurant 2' },
  ];
  
  console.log(`📝 테스트 파일 작성: ${testFile}`);
  appendToJsonl(testFile, testData, false);
  
  // 통계 확인
  const stats = getFileStats(testFile);
  console.log('\n📊 파일 통계:');
  console.log(`   - 총 라인: ${stats.totalLines}`);
  console.log(`   - 유효 라인: ${stats.validLines}`);
  console.log(`   - 파일 크기: ${stats.sizeMB.toFixed(4)}MB`);
  
  // URL 로드
  const urls = loadProcessedUrls(testFile);
  console.log(`\n🔗 처리된 URL: ${urls.size}개`);
  urls.forEach(url => console.log(`   - ${url}`));
  
  // unique_id 로드
  const ids = loadProcessedUniqueIds(testFile);
  console.log(`\n🆔 처리된 unique_id: ${ids.size}개`);
  ids.forEach(id => console.log(`   - ${id}`));
  
  // 테스트 파일 삭제
  if (fs.existsSync(testFile)) {
    fs.unlinkSync(testFile);
    console.log(`\n🗑️  테스트 파일 삭제: ${testFile}`);
  }
  
  console.log('\n✅ 테스트 완료!');
}
