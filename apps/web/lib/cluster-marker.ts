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
  private animationFrameId: number | null = null;
  private listeners: Set<() => void> = new Set();
  private lastUpdateTime: number = 0;

  /**
   * 애니메이션 시작 (requestAnimationFrame 사용)
   * 
   * @param intervalMs 애니메이션 주기 (ms)
   */
  public start(intervalMs: number = 1000): void {
    if (this.animationFrameId) return;

    const animate = (currentTime: number) => {
      // 마지막 업데이트로부터 intervalMs가 경과했는지 확인
      if (currentTime - this.lastUpdateTime >= intervalMs) {
        // 모든 클러스터의 카테고리 인덱스 증가
        this.categoryIndices.forEach((index, clusterId) => {
          this.categoryIndices.set(clusterId, index + 1);
        });

        // 리스너들에게 업데이트 알림
        this.listeners.forEach((listener) => listener());

        this.lastUpdateTime = currentTime;
      }

      // 다음 프레임 예약
      this.animationFrameId = requestAnimationFrame(animate);
    };

    // 첫 프레임 시작
    this.lastUpdateTime = performance.now();
    this.animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * 애니메이션 정지
   */
  public stop(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
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
/**
 * 카테고리별 이미지 경로 매핑
 */
const CATEGORY_IMAGES: Record<string, string> = {
  '고기': '/images/maker-images/meat_bbq.png',
  '치킨': '/images/maker-images/chicken.png',
  '한식': '/images/maker-images/korean.png',
  '중식': '/images/maker-images/chinese.png',
  '일식': '/images/maker-images/cutlet_sashimi.png',
  '양식': '/images/maker-images/western.png',
  '분식': '/images/maker-images/snack_bar.png',
  '카페·디저트': '/images/maker-images/cafe_dessert.png',
  '아시안': '/images/maker-images/asian.png',
  '패스트푸드': '/images/maker-images/fastfood.png',
  '족발·보쌈': '/images/maker-images/pork_feet.png',
  '돈까스·회': '/images/maker-images/cutlet_sashimi.png',
  '피자': '/images/maker-images/pizza.png',
  '찜·탕': '/images/maker-images/stew.png',
  '야식': '/images/maker-images/late_night.png',
  '도시락': '/images/maker-images/lunch_box.png',
};

/**
 * 카테고리 이미지 경로 가져오기
 */
const getCategoryIsImage = (category: string): string => {
  return CATEGORY_IMAGES[category] || '/images/maker-images/korean.png';
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
  const imagePath = getCategoryIsImage(displayCategory);

  // 개수에 따라 크기 동적 조정 (32px ~ 72px) - 이미지에 맞춰 조정
  let size: number;
  if (count < 3) {
    size = 32;
  } else if (count < 5) {
    size = 36;
  } else if (count < 10) {
    size = 42;
  } else if (count < 20) {
    size = 48;
  } else if (count < 50) {
    size = 56;
  } else if (count < 100) {
    size = 64;
  } else {
    size = 72;
  }
  // 아이콘 크기는 컨테이너의 70% 정도
  const iconSize = Math.floor(size * 0.7);

  // z-index 계산: 마커 개수가 많을수록 위에 표시 (100 ~ 200)
  const zIndex = Math.min(100 + Math.floor(count / 5), 200);

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
        z-index: ${zIndex};
      "
    >
      <!-- 카테고리 이미지 (애니메이션) -->
      <div 
        class="cluster-icon"
        style="
          width: ${iconSize}px;
          height: ${iconSize}px;
        "
      >
        <img 
            src="${imagePath}" 
            alt="cluster" 
            style="width: 100%; height: 100%; object-fit: contain;"
            draggable="false" 
        />
      </div>
      
      <!-- 맛집 개수 배지 (우측 하단) -->
      ${count > 0 ? `
      <div
        class="cluster-count-badge"
        style="
          position: absolute;
          bottom: -4px;
          right: -4px;
          background-color: rgba(0, 0, 0, 0.75);
          color: white;
          font-size: 11px;
          font-weight: bold;
          padding: 2px 6px;
          border-radius: 12px;
          min-width: 18px;
          text-align: center;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          z-index: ${zIndex + 1};
          backdrop-filter: blur(2px);
          border: 1px solid rgba(255,255,255,0.2);
        "
      >${count >= 1000 ? '999+' : count}</div>
      ` : ''}
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
  const imagePath = getCategoryIsImage(category);
  // 이미지 마커: 선택 시 42px, 기본 32px
  const size = isSelected ? 42 : 32;

  const dropShadow = isSelected
    ? 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.4)) drop-shadow(0 0 0 2px rgba(255, 255, 255, 0.9))'
    : 'drop-shadow(0 2px 5px rgba(0, 0, 0, 0.3)) drop-shadow(0 0 0 1px rgba(255, 255, 255, 0.8))';

  const transform = isSelected ? 'scale(1.15) translateY(-5px)' : 'scale(1)';
  const animationClass = isSelected ? 'marker-bounce' : '';
  const zIndex = isSelected ? '100' : '1';

  return `
    <div 
      class="${animationClass}"
      style="
        width: ${size}px;
        height: ${size}px;
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
      data-testid="marker"
    >
        <img 
            src="${imagePath}" 
            alt="marker"
            style="
                width: 100%;
                height: 100%;
                object-fit: contain;
            "
            draggable="false"
        />
    </div>
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
    
    .marker-fade-out {
      opacity: 0 !important;
      transition: opacity 0.3s ease-out !important;
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
