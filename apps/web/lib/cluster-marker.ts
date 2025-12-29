/**
 * 클러스터 마커 HTML 생성 및 애니메이션 관리
 */

import type Supercluster from 'supercluster';
import type { ClusterProperties } from './clustering';

/**
 * 카테고리 이모지 순환 애니메이션 상태 관리
 */
class ClusterAnimationManager {
  private categoryIndices: Map<number, number> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
  private listeners: Set<() => void> = new Set();

  /**
   * 애니메이션 시작
   * 
   * @param intervalMs 애니메이션 주기 (ms)
   */
  public start(intervalMs: number = 1000): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      // 모든 클러스터의 카테고리 인덱스 증가
      this.categoryIndices.forEach((index, clusterId) => {
        this.categoryIndices.set(clusterId, index + 1);
      });

      // 리스너들에게 업데이트 알림
      this.listeners.forEach((listener) => listener());
    }, intervalMs);
  }

  /**
   * 애니메이션 정지
   */
  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * 클러스터 등록
   * 
   * @param clusterId 클러스터 ID
   */
  public register(clusterId: number): void {
    if (!this.categoryIndices.has(clusterId)) {
      this.categoryIndices.set(clusterId, 0);
    }
  }

  /**
   * 클러스터 제거
   * 
   * @param clusterId 클러스터 ID
   */
  public unregister(clusterId: number): void {
    this.categoryIndices.delete(clusterId);
  }

  /**
   * 현재 카테고리 인덱스 가져오기
   * 
   * @param clusterId 클러스터 ID
   * @param totalCategories 총 카테고리 개수
   * @returns 현재 인덱스
   */
  public getCurrentIndex(clusterId: number, totalCategories: number): number {
    const index = this.categoryIndices.get(clusterId) || 0;
    return index % totalCategories;
  }

  /**
   * 업데이트 리스너 등록
   * 
   * @param listener 콜백 함수
   * @returns cleanup 함수
   */
  public addListener(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 모두 초기화
   */
  public clear(): void {
    this.stop();
    this.categoryIndices.clear();
    this.listeners.clear();
  }
}

/**
 * 싱글톤 인스턴스
 */
export const clusterAnimationManager = new ClusterAnimationManager();

/**
 * 카테고리별 이모지 매핑
 */
const CATEGORY_ICONS: Record<string, string> = {
  '고기': '🥩',
  '치킨': '🍗',
  '한식': '🍚',
  '중식': '🥢',
  '일식': '🍣',
  '양식': '🍝',
  '분식': '🥟',
  '카페·디저트': '☕',
  '아시안': '🍜',
  '패스트푸드': '🍔',
  '족발·보쌈': '🍖',
  '돈까스·회': '🍱',
  '피자': '🍕',
  '찜·탕': '🥘',
  '야식': '🌙',
  '도시락': '🍱',
};

/**
 * 카테고리 이모지 가져오기
 */
const getCategoryIcon = (category: string): string => {
  return CATEGORY_ICONS[category] || '⭐';
};

/**
 * 클러스터 마커 HTML 생성 (애니메이션 포함)
 * 
 * @param cluster 클러스터 Feature
 * @param categories 클러스터에 포함된 카테고리 목록
 * @param currentIndex 현재 표시할 카테고리 인덱스
 * @returns HTML 문자열
 */
export const createClusterMarkerHTML = (
  cluster: Supercluster.ClusterFeature<ClusterProperties>,
  categories: string[],
  currentIndex: number
): string => {
  const count = cluster.properties.point_count || 0;
  const displayCategory = categories[currentIndex % categories.length] || '기타';
  const icon = getCategoryIcon(displayCategory);

  // 개수에 따라 크기 조절
  const size = count < 10 ? 36 : count < 100 ? 44 : 52;
  const iconSize = count < 10 ? 20 : count < 100 ? 24 : 28;

  return `
    <div 
      class="cluster-marker-container"
      style="
        width: ${size}px;
        height: ${size}px;
        position: relative;
        cursor: pointer;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
      "
    >
      <!-- 카테고리 이모지 (애니메이션) -->
      <div 
        class="cluster-icon"
        style="
          font-size: ${iconSize}px;
        "
      >${icon}</div>
    </div>
  `;
};

/**
 * 개별 마커 HTML 생성 (기존과 동일)
 * 
 * @param category 카테고리
 * @param isSelected 선택 여부
 * @returns HTML 문자열
 */
export const createIndividualMarkerHTML = (
  category: string,
  isSelected: boolean
): string => {
  const icon = getCategoryIcon(category);
  const size = isSelected ? 36 : 28;
  const fontSize = isSelected ? 28 : 22;
  const dropShadow = isSelected
    ? 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.3))'
    : 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.25))';
  const transform = isSelected ? 'scale(1.15)' : 'scale(1)';
  const animationClass = isSelected ? 'marker-bounce' : '';
  const zIndex = isSelected ? '100' : '1';

  return `
    <div 
      class="${animationClass}"
      style="
        width: ${size}px;
        height: ${size}px;
        font-size: ${fontSize}px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        transform: ${transform};
        filter: ${dropShadow};
        position: relative;
        z-index: ${zIndex};
        user-select: none;
        -webkit-tap-highlight-color: transparent;
      "
      role="button"
    >${icon}</div>
  `;
};

/**
 * 클러스터 마커 CSS 애니메이션 주입
 */
export const injectClusterCSS = (): void => {
  if (document.getElementById('cluster-marker-styles')) return;

  const style = document.createElement('style');
  style.id = 'cluster-marker-styles';
  style.textContent = `
    @keyframes cluster-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.05); }
    }

    @keyframes cluster-fade {
      0% {
        opacity: 0;
        transform: scale(0.8);
      }
      15% {
        opacity: 1;
        transform: scale(1);
      }
      85% {
        opacity: 1;
        transform: scale(1);
      }
      100% {
        opacity: 0;
        transform: scale(0.8);
      }
    }
    
    @keyframes marker-bounce {
      0%, 100% { transform: scale(1.15) translateY(0); }
      50% { transform: scale(1.15) translateY(-4px); }
    }
    
    .marker-bounce {
      animation: marker-bounce 1s ease-in-out infinite;
    }

    .cluster-icon {
      animation: cluster-fade 6s ease-in-out infinite !important;
    }
    
    .cluster-marker-container:hover .cluster-circle {
      transform: scale(1.1);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4), 0 0 0 3px rgba(255, 255, 255, 0.3);
    }
  `;

  document.head.appendChild(style);
};

/**
 * 클러스터 마커 CSS 제거
 */
export const removeClusterCSS = (): void => {
  const style = document.getElementById('cluster-marker-styles');
  if (style) {
    style.remove();
  }
};
