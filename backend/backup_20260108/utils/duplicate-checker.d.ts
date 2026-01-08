/**
 * 중복 검사를 위한 공통 유틸리티 함수
 * 모든 데이터 처리 스크립트에서 재사용 가능
 */
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
export declare function loadProcessedUrls(filePath: string): Set<string>;
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
export declare function loadProcessedRestaurants(filePath: string, key?: string, nestedKey?: string | null): Set<string>;
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
export declare function loadProcessedUniqueIds(filePath: string): Set<string>;
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
export declare function filterNewItems<T>(inputItems: T[], processedItems: Set<string>, keyFunc: (item: T) => string): T[];
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
export declare function appendToJsonl(filePath: string, data: any | any[], createDirs?: boolean): number;
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
export declare function loadMultipleProcessedUrls(...filePaths: string[]): Set<string>;
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
export declare function loadMultipleProcessedRestaurants(filePaths: string[], key?: string, nestedKey?: string | null): Set<string>;
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
export declare function getFileStats(filePath: string): {
    exists: boolean;
    totalLines: number;
    validLines: number;
    invalidLines: number;
    sizeBytes: number;
    sizeMB: number;
};
//# sourceMappingURL=duplicate-checker.d.ts.map