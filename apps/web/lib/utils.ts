import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Levenshtein Distance 계산 함수
 * 두 문자열 사이의 편집 거리를 계산합니다.
 * 
 * @param str1 첫 번째 문자열
 * @param str2 두 번째 문자열
 * @returns 편집 거리 (숫자)
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  // 초기화
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  // 동적 프로그래밍으로 편집 거리 계산
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // 교체
          matrix[i][j - 1] + 1,     // 삽입
          matrix[i - 1][j] + 1      // 삭제
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * 문자열 유사도 계산 함수
 * 0-1 사이의 값으로 반환 (1에 가까울수록 유사)
 * 
 * @param str1 첫 번째 문자열
 * @param str2 두 번째 문자열
 * @returns 유사도 (0-1 사이의 숫자)
 */
export function calculateSimilarity(str1: string, str2: string): number {
  // 정규화: 소문자 변환 및 공백 제거
  const normalizedStr1 = str1.toLowerCase().trim();
  const normalizedStr2 = str2.toLowerCase().trim();
  
  // 완전히 같으면 1.0 반환
  if (normalizedStr1 === normalizedStr2) {
    return 1.0;
  }
  
  const distance = levenshteinDistance(normalizedStr1, normalizedStr2);
  const maxLength = Math.max(normalizedStr1.length, normalizedStr2.length);
  
  // 유사도 = 1 - (편집거리 / 최대길이)
  return maxLength === 0 ? 1.0 : 1 - distance / maxLength;
}
