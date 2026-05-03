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
 * 카테고리별 CSS 마커 토큰.
 * Lighthouse에서 25~50px로 표시되는 마커가 90~128KB PNG를 여러 개 내려받는 문제가 있어,
 * 지도 위 마커는 네트워크 이미지 대신 텍스트/그라디언트 기반 glyph로 렌더링한다.
 */
type CategoryMarkerVisual = {
  glyph: string;
  label: string;
  gradient: string;
};

const CATEGORY_MARKER_VISUALS: Record<string, CategoryMarkerVisual> = {
  '고기': { glyph: '고', label: '고기', gradient: 'linear-gradient(135deg, #ef4444, #b91c1c)' },
  '치킨': { glyph: '치', label: '치킨', gradient: 'linear-gradient(135deg, #f97316, #c2410c)' },
  '한식': { glyph: '한', label: '한식', gradient: 'linear-gradient(135deg, #22c55e, #15803d)' },
  '중식': { glyph: '중', label: '중식', gradient: 'linear-gradient(135deg, #dc2626, #991b1b)' },
  '일식': { glyph: '일', label: '일식', gradient: 'linear-gradient(135deg, #0ea5e9, #0369a1)' },
  '양식': { glyph: '양', label: '양식', gradient: 'linear-gradient(135deg, #6366f1, #4338ca)' },
  '분식': { glyph: '분', label: '분식', gradient: 'linear-gradient(135deg, #f59e0b, #b45309)' },
  '카페·디저트': { glyph: '카', label: '카페 디저트', gradient: 'linear-gradient(135deg, #ec4899, #be185d)' },
  '아시안': { glyph: '아', label: '아시안', gradient: 'linear-gradient(135deg, #14b8a6, #0f766e)' },
  '패스트푸드': { glyph: '패', label: '패스트푸드', gradient: 'linear-gradient(135deg, #eab308, #a16207)' },
  '족발·보쌈': { glyph: '족', label: '족발 보쌈', gradient: 'linear-gradient(135deg, #92400e, #78350f)' },
  '돈까스·회': { glyph: '회', label: '돈까스 회', gradient: 'linear-gradient(135deg, #38bdf8, #075985)' },
  '피자': { glyph: '피', label: '피자', gradient: 'linear-gradient(135deg, #fb7185, #be123c)' },
  '찜·탕': { glyph: '탕', label: '찜 탕', gradient: 'linear-gradient(135deg, #f97316, #9a3412)' },
  '야식': { glyph: '야', label: '야식', gradient: 'linear-gradient(135deg, #8b5cf6, #5b21b6)' },
  '도시락': { glyph: '도', label: '도시락', gradient: 'linear-gradient(135deg, #84cc16, #4d7c0f)' },
  '기타': { glyph: '맛', label: '맛집', gradient: 'linear-gradient(135deg, #64748b, #334155)' },
};

const DEFAULT_MARKER_VISUAL = CATEGORY_MARKER_VISUALS['기타'];

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const getCategoryMarkerVisual = (category: string): CategoryMarkerVisual => {
  return CATEGORY_MARKER_VISUALS[category] || DEFAULT_MARKER_VISUAL;
};

const createCategoryMarkerGlyphHTML = ({
  category,
  fontSize,
}: {
  category: string;
  fontSize: number;
}): string => {
  const visual = getCategoryMarkerVisual(category);
  return `
    <span
      aria-hidden="true"
      title="${escapeHtml(visual.label)}"
      style="
        width: 100%;
        height: 100%;
        border-radius: 9999px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${visual.gradient};
        color: white;
        font-size: ${fontSize}px;
        font-weight: 800;
        line-height: 1;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.35);
      "
    >${escapeHtml(visual.glyph)}</span>
  `;
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
      <!-- 카테고리 CSS glyph (애니메이션) -->
      <div 
        class="cluster-icon"
        style="
          width: ${iconSize}px;
          height: ${iconSize}px;
        "
      >
        ${createCategoryMarkerGlyphHTML({
          category: displayCategory,
          fontSize: Math.max(13, Math.floor(iconSize * 0.46)),
        })}
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
  // CSS 마커: 선택 시 42px, 기본 32px
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
        ${createCategoryMarkerGlyphHTML({
          category,
          fontSize: isSelected ? 17 : 14,
        })}
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
