#!/usr/bin/env node
/**
 * YouTube HeatmapMarkers Fetch 기반 수집
 * fetch로 HTML 가져와서 ytInitialPlayerResponse 추출
 * 데이터 구조: 기존과 동일 (svgPathData만 제외)
 */

/**
 * YouTube 페이지에서 heatmapMarkers 추출
 * @param {string} videoId - YouTube 비디오 ID
 * @returns {Promise<object|null>} 히트맵 데이터 또는 null
 */
export async function fetchHeatmapMarkers(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  
  try {
    // HTML 페이지 가져오기
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });
    
    if (!response.ok) {
      console.log(`  ⚠️ HTTP 오류: ${response.status}`);
      return null;
    }
    
    const html = await response.text();
    
    // ytInitialPlayerResponse 추출
    const playerResponseMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:<\/script>|var)/s);
    if (!playerResponseMatch) {
      console.log(`  ⚠️ ytInitialPlayerResponse를 찾을 수 없음`);
      return null;
    }
    
    // ytInitialData 추출 (좋아요, 댓글 수용)
    const initialDataMatch = html.match(/var ytInitialData\s*=\s*(\{.+?\});(?:<\/script>|var)/s);
    
    let ytData, ytInitialData;
    try {
      ytData = JSON.parse(playerResponseMatch[1]);
      ytInitialData = initialDataMatch ? JSON.parse(initialDataMatch[1]) : null;
    } catch (e) {
      console.log(`  ⚠️ JSON 파싱 실패`);
      return null;
    }
    
    // 영상 기본 정보
    const videoDetails = ytData?.videoDetails || {};
    const title = videoDetails.title || '';
    const lengthSeconds = parseInt(videoDetails.lengthSeconds) || 0;
    const viewCount = parseInt(videoDetails.viewCount) || 0;
    
    // 조회수 5만 미만이면 히트맵 없음
    if (viewCount < 50000) {
      console.log(`  ⚠️ 조회수 ${viewCount.toLocaleString()} (5만 미만 - 히트맵 없음)`);
      return null;
    }
    
    // microformat에서 메타 정보
    const microformat = ytData?.microformat?.playerMicroformatRenderer || {};
    const shortDescription = microformat.description?.simpleText || '';
    const category = microformat.category || '';
    const publishDate = microformat.publishDate || '';
    const uploadDate = microformat.uploadDate || '';
    
    // keywords 추출
    let keywords = [];
    if (ytData?.videoDetails?.keywords) {
      keywords = ytData.videoDetails.keywords;
    }
    
    // 좋아요/댓글 수 추출
    let likeCount = null;
    let commentCount = null;
    
    if (ytInitialData) {
      try {
        const contents = ytInitialData?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
        for (const content of contents) {
          const videoPrimaryInfo = content?.videoPrimaryInfoRenderer;
          if (videoPrimaryInfo) {
            const menuRenderer = videoPrimaryInfo?.videoActions?.menuRenderer?.topLevelButtons || [];
            for (const button of menuRenderer) {
              const segmentedButton = button?.segmentedLikeDislikeButtonViewModel;
              if (segmentedButton) {
                const likeButton = segmentedButton?.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel;
                if (likeButton?.accessibilityText) {
                  const match = likeButton.accessibilityText.match(/[\d,]+/);
                  if (match) {
                    likeCount = parseInt(match[0].replace(/,/g, '')) || null;
                  }
                }
              }
            }
          }
          
          // 댓글 수
          const itemSection = content?.itemSectionRenderer;
          if (itemSection?.contents) {
            for (const item of itemSection.contents) {
              const commentsHeader = item?.commentsEntryPointHeaderRenderer;
              if (commentsHeader?.commentCount?.simpleText) {
                const match = commentsHeader.commentCount.simpleText.match(/[\d,]+/);
                if (match) {
                  commentCount = parseInt(match[0].replace(/,/g, '')) || null;
                }
              }
            }
          }
        }
      } catch (e) {}
    }
    
    // heatMarkers 찾기 - 방법 1: frameworkUpdates
    let heatMarkers = null;
    const mutations = ytData?.frameworkUpdates?.entityBatchUpdate?.mutations || [];
    for (const mutation of mutations) {
      const entity = mutation?.payload?.macroMarkersListEntity;
      if (entity?.markersList?.markers) {
        heatMarkers = entity.markersList.markers
          .filter(m => m.heatMarkerRenderer)
          .map(m => {
            const renderer = m.heatMarkerRenderer;
            return {
              startMillis: parseInt(renderer.timeRangeStartMillis) || 0,
              endMillis: (parseInt(renderer.timeRangeStartMillis) || 0) + (parseInt(renderer.markerDurationMillis) || 0),
              intensityScoreNormalized: parseFloat(renderer.heatMarkerIntensityScoreNormalized) || 0
            };
          });
        break;
      }
    }
    
    // 방법 2: ytInitialData의 frameworkUpdates에서 찾기
    if ((!heatMarkers || heatMarkers.length === 0) && ytInitialData) {
      const mutations2 = ytInitialData?.frameworkUpdates?.entityBatchUpdate?.mutations || [];
      for (const mutation of mutations2) {
        const entity = mutation?.payload?.macroMarkersListEntity;
        if (entity?.markersList?.markers) {
          heatMarkers = entity.markersList.markers
            .filter(m => m.heatMarkerRenderer)
            .map(m => {
              const renderer = m.heatMarkerRenderer;
              return {
                startMillis: parseInt(renderer.timeRangeStartMillis) || 0,
                endMillis: (parseInt(renderer.timeRangeStartMillis) || 0) + (parseInt(renderer.markerDurationMillis) || 0),
                intensityScoreNormalized: parseFloat(renderer.heatMarkerIntensityScoreNormalized) || 0
              };
            });
          break;
        }
      }
    }
    
    // 방법 3: playerOverlays에서 찾기
    if (!heatMarkers || heatMarkers.length === 0) {
      const decoratedPlayerBarRenderer = ytData?.playerOverlays?.playerOverlayRenderer
        ?.decoratedPlayerBarRenderer?.decoratedPlayerBarRenderer?.playerBar
        ?.multiMarkersPlayerBarRenderer?.markersMap;
      
      if (decoratedPlayerBarRenderer) {
        for (const markerMap of decoratedPlayerBarRenderer) {
          if (markerMap.key === 'HEATSEEKER') {
            const markers = markerMap.value?.heatmap?.heatmapRenderer?.heatMarkers || [];
            heatMarkers = markers.map(m => {
              const renderer = m.heatMarkerRenderer;
              return {
                startMillis: parseInt(renderer.timeRangeStartMillis) || 0,
                endMillis: (parseInt(renderer.timeRangeStartMillis) || 0) + (parseInt(renderer.markerDurationMillis) || 0),
                intensityScoreNormalized: parseFloat(renderer.heatMarkerIntensityScoreNormalized) || 0
              };
            });
            break;
          }
        }
      }
    }
    
    if (!heatMarkers || heatMarkers.length === 0) {
      console.log(`  ⚠️ heatMarkers 데이터 없음`);
      return null;
    }
    
    // 기존과 동일한 데이터 구조 (svgPathData만 제외)
    return {
      videoId,
      collectedAt: new Date().toISOString().replace('Z', '+09:00'),
      meta: {
        title,
        description: shortDescription,
        keywords,
        category,
        publishDate,
        uploadDate
      },
      stats: {
        viewCount,
        likeCount,
        commentCount
      },
      videoDurationMs: lengthSeconds * 1000,
      heatmapMarkers: heatMarkers
      // svgPathData 제외
    };
    
  } catch (error) {
    console.log(`  ❌ 오류: ${error.message}`);
    return null;
  }
}
