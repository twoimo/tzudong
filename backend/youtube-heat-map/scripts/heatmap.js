/**
 * YouTube Heatmap Scraper Service
 * Puppeteer를 이용하여 YouTube Most Replayed 히트맵 데이터를 수집합니다.
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Stealth 플러그인 적용 (YouTube 봇 감지 우회)
puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const HEATMAPS_DIR = path.join(DATA_DIR, 'heatMaps');
const URLS_FILE = path.join(DATA_DIR, 'urls', 'youtube-urls.txt');

/**
 * YouTube URL에서 video_id 추출
 * @param {string} url - YouTube URL
 * @returns {string|null} - video_id 또는 null
 */
export function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * 단일 영상의 히트맵 데이터 수집
 * @param {import('puppeteer').Browser} browser - Puppeteer 브라우저 인스턴스
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<object|null>} - 히트맵 데이터 또는 null
 */
export async function collectHeatmap(browser, videoId) {
  const page = await browser.newPage();
  
  try {
    // YouTube 페이지 접속
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`📺 수집 시작: ${videoId}`);
    
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    // 페이지 로드 대기
    await new Promise(r => setTimeout(r, 3000));
    
    // 광고 처리 - 광고가 있으면 건너뛰기 버튼이 나올 때까지 대기 후 클릭
    const maxAdWait = 60000; // 최대 60초 대기
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxAdWait) {
      // 광고가 재생 중인지 확인
      const isAdPlaying = await page.$('.ad-showing');
      
      if (!isAdPlaying) {
        // 광고가 없으면 바로 진행
        break;
      }
      
      // 광고가 재생 중이면 건너뛰기 버튼 확인
      const skipButton = await page.$('.ytp-skip-ad-button, .ytp-ad-skip-button, button[id^="skip-button"]');
      if (skipButton) {
        // 버튼이 보이면 잠시 대기 후 클릭 (버튼이 활성화될 때까지)
        await new Promise(r => setTimeout(r, 500));
        try {
          console.log(`  📢 광고 건너뛰기 버튼 클릭`);
          await skipButton.click();
          await new Promise(r => setTimeout(r, 1000));
          break;
        } catch (clickErr) {
          // 클릭 실패하면 다시 시도
          await new Promise(r => setTimeout(r, 500));
        }
      }
      
      // 1초 대기 후 다시 확인
      await new Promise(r => setTimeout(r, 1000));
    }
    
    // 광고 종료 후 추가 대기 (본 영상 로드)
    await new Promise(r => setTimeout(r, 3000));
    
    // 동영상 플레이어에 호버하여 히트맵이 표시되도록 함
    try {
      await page.hover('.ytp-progress-bar');
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.log(`  ⚠️ 프로그레스 바 호버 실패 (영상이 없거나 비공개일 수 있음)`);
    }
    
    // 히트맵 데이터 추출
    const heatmapData = await page.evaluate(() => {
      // ytInitialPlayerResponse에서 데이터 추출
      const ytData = window.ytInitialPlayerResponse;
      const ytInitialData = window.ytInitialData;
      
      // 영상 기본 정보
      const videoDetails = ytData?.videoDetails || {};
      const title = videoDetails.title || '';
      const lengthSeconds = parseInt(videoDetails.lengthSeconds) || 0;
      const viewCount = parseInt(videoDetails.viewCount) || 0;
      const channelId = videoDetails.channelId || '';
      const author = videoDetails.author || '';
      const shortDescription = videoDetails.shortDescription || '';
      const keywords = videoDetails.keywords || [];
      const publishDate = ytData?.microformat?.playerMicroformatRenderer?.publishDate || '';
      const uploadDate = ytData?.microformat?.playerMicroformatRenderer?.uploadDate || '';
      const category = ytData?.microformat?.playerMicroformatRenderer?.category || '';
      
      // 좋아요, 댓글 수 추출 (ytInitialData에서)
      let likeCount = null;
      let commentCount = null;
      
      try {
        // 좋아요 수
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
      } catch (e) {
        console.log('메타데이터 추출 오류:', e);
      }
      
      // heatMarkers 찾기
      let heatMarkers = null;
      
      // 방법 1: ytInitialPlayerResponse의 frameworkUpdates에서 찾기
      const mutations1 = ytData?.frameworkUpdates?.entityBatchUpdate?.mutations || [];
      for (const mutation of mutations1) {
        const entity = mutation?.payload?.macroMarkersListEntity;
        if (entity?.markersList?.markers) {
          heatMarkers = entity.markersList.markers
            .filter(m => m.heatMarkerRenderer)
            .map(m => {
              const renderer = m.heatMarkerRenderer;
              return {
                startMillis: parseInt(renderer.timeRangeStartMillis) || 0,
                endMillis: parseInt(renderer.markerDurationMillis) 
                  ? (parseInt(renderer.timeRangeStartMillis) || 0) + parseInt(renderer.markerDurationMillis)
                  : parseInt(renderer.timeRangeStartMillis) || 0,
                intensityScoreNormalized: parseFloat(renderer.heatMarkerIntensityScoreNormalized) || 0
              };
            });
          break;
        }
      }
      
      // 방법 2: ytInitialData의 frameworkUpdates에서 찾기
      if (!heatMarkers || heatMarkers.length === 0) {
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
                  endMillis: parseInt(renderer.markerDurationMillis) 
                    ? (parseInt(renderer.timeRangeStartMillis) || 0) + parseInt(renderer.markerDurationMillis)
                    : parseInt(renderer.timeRangeStartMillis) || 0,
                  intensityScoreNormalized: parseFloat(renderer.heatMarkerIntensityScoreNormalized) || 0
                };
              });
            break;
          }
        }
      }
      
      // 방법 2: playerOverlayRenderer에서 찾기 (대안)
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
                  endMillis: (parseInt(renderer.timeRangeStartMillis) || 0) + 
                    (parseInt(renderer.markerDurationMillis) || 0),
                  intensityScoreNormalized: parseFloat(renderer.heatMarkerIntensityScoreNormalized) || 0
                };
              });
              break;
            }
          }
        }
      }
      
      // SVG path 데이터 추출 (항상 수집 - raw 데이터)
      let svgPathData = null;
      const modernHeatMap = document.querySelector('.ytp-modern-heat-map');
      if (modernHeatMap) {
        svgPathData = modernHeatMap.getAttribute('d');
      } else {
        const legacyPath = document.querySelector('.ytp-heat-map-path');
        if (legacyPath) {
          svgPathData = legacyPath.getAttribute('d');
        }
      }
      
      return {
        hasHeatmap: (heatMarkers && heatMarkers.length > 0) || !!svgPathData,
        // 메타데이터
        meta: {
          title,
          description: shortDescription,
          keywords,
          category,
          publishDate,
          uploadDate
        },
        // 통계
        stats: {
          viewCount,
          likeCount,
          commentCount
        },
        videoDurationMs: lengthSeconds * 1000,
        heatmapMarkers: heatMarkers || [],
        svgPathData: svgPathData
      };
    });
    
    if (!heatmapData.hasHeatmap) {
      console.log(`  ⚠️ 히트맵 없음 (조회수 5만 미만이거나 짧은 영상일 수 있음)`);
      return null;
    }
    
    console.log(`  ✅ 수집 완료: ${heatmapData.heatmapMarkers.length}개 마커, 조회수: ${heatmapData.stats.viewCount}, 좋아요: ${heatmapData.stats.likeCount || 'N/A'}`);
    
    return {
      videoId,
      collectedAt: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
      meta: heatmapData.meta,
      stats: heatmapData.stats,
      videoDurationMs: heatmapData.videoDurationMs,
      heatmapMarkers: heatmapData.heatmapMarkers,
      svgPathData: heatmapData.svgPathData
    };
    
  } catch (error) {
    console.error(`  ❌ 수집 실패: ${error.message}`);
    return null;
  } finally {
    await page.close();
  }
}

/**
 * 히트맵 데이터를 JSONL 파일에 저장 (append)
 * @param {string} videoId - video ID
 * @param {object} data - 히트맵 데이터
 */
export async function saveHeatmapData(videoId, data) {
  const filePath = path.join(HEATMAPS_DIR, `${videoId}.jsonl`);
  const jsonLine = JSON.stringify(data) + '\n';
  
  await fs.mkdir(HEATMAPS_DIR, { recursive: true });
  await fs.appendFile(filePath, jsonLine, 'utf-8');
  
  console.log(`  💾 저장 완료: ${filePath}`);
}

/**
 * URL 파일에서 수집 대상 목록 읽기
 * @returns {Promise<string[]>} - URL 배열
 */
export async function getUrlsFromFile() {
  try {
    const content = await fs.readFile(URLS_FILE, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * 모든 등록된 URL의 히트맵 수집
 * @returns {Promise<object>} - 수집 결과
 */
export async function collectAllHeatmaps() {
  const urls = await getUrlsFromFile();
  
  if (urls.length === 0) {
    return {
      success: true,
      message: '수집할 URL이 없습니다.',
      total: 0,
      collected: 0,
      failed: 0,
      skipped: 0
    };
  }
  
  console.log(`\n🚀 히트맵 수집 시작: ${urls.length}개 URL\n`);
  
  const browser = await puppeteer.launch({
    headless: true,  // GitHub Actions용
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,720'
    ]
  });
  
  const results = {
    total: urls.length,
    collected: 0,
    failed: 0,
    skipped: 0,
    details: []
  };
  
  try {
    let processedCount = 0;
    
    for (const url of urls) {
      const videoId = extractVideoId(url);
      if (!videoId) {
        console.log(`⚠️ 스킵: 잘못된 URL - ${url}`);
        results.skipped++;
        results.details.push({ url, status: 'skipped', reason: 'invalid_url' });
        continue;
      }
      
      const data = await collectHeatmap(browser, videoId);
      
      if (data) {
        await saveHeatmapData(videoId, data);
        results.collected++;
        results.details.push({ url, videoId, status: 'collected' });
      } else {
        results.failed++;
        results.details.push({ url, videoId, status: 'failed', reason: 'no_heatmap' });
      }
      
      processedCount++;
      
      // Rate limiting
      const randomMs = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
      
      // 50개마다 3-5분 대기
      if (processedCount % 50 === 0) {
        const wait = randomMs(180000, 300000);
        console.log(`  ⏳ 50개 처리 완료 - ${Math.floor(wait/1000)}초 대기...`);
        await new Promise(r => setTimeout(r, wait));
      }
      // 10개마다 30-40초 대기
      else if (processedCount % 10 === 0) {
        const wait = randomMs(30000, 40000);
        console.log(`  ⏳ 10개 처리 완료 - ${Math.floor(wait/1000)}초 대기...`);
        await new Promise(r => setTimeout(r, wait));
      }
      // 5개마다 10-15초 대기
      else if (processedCount % 5 === 0) {
        const wait = randomMs(10000, 15000);
        console.log(`  ⏳ 5개 처리 완료 - ${Math.floor(wait/1000)}초 대기...`);
        await new Promise(r => setTimeout(r, wait));
      }
      // 매 영상 2-5초 대기
      else {
        const wait = randomMs(2000, 5000);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  } finally {
    await browser.close();
  }
  
  console.log(`\n✅ 수집 완료: 성공 ${results.collected}, 실패 ${results.failed}, 스킵 ${results.skipped}\n`);
  
  return {
    success: true,
    message: `수집 완료: ${results.collected}/${results.total}`,
    ...results
  };
}

/**
 * 특정 영상의 히트맵 히스토리 조회
 * @param {string} videoId - video ID
 * @returns {Promise<object[]>} - 히트맵 히스토리 배열
 */
export async function getHeatmapHistory(videoId) {
  const filePath = path.join(HEATMAPS_DIR, `${videoId}.jsonl`);
  
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
