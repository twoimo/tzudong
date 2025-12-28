#!/usr/bin/env node
/**
 * YouTube HeatmapMarkers Collection using yt-dlp
 * yt-dlp를 사용하여 히트맵 데이터 수집
 */

import { execSync, spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const URLS_FILE = path.join(PROJECT_DIR, 'data', 'urls', 'youtube-urls.txt');
const HEATMAPS_DIR = path.join(PROJECT_DIR, 'data', 'heatmapMarkers');
const BRANCH = 'feat/crawling-youtube-heat-map';
const COMMIT_INTERVAL = 10;
const MAX_URLS_PER_RUN = parseInt(process.env.MAX_URLS_PER_RUN) || 50;
const MAX_INTERVAL_WEEKS = 12;

/**
 * 랜덤 대기 시간 (ms)
 */
function randomDelay(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1) + minMs);
}

/**
 * URL에서 비디오 ID 추출
 */
function extractVideoId(url) {
  const match = url.match(/(?:v=|\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

/**
 * yt-dlp로 히트맵 데이터 수집
 */
async function collectHeatmapWithYtDlp(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  
  try {
    // yt-dlp로 info.json 추출 (다운로드 없이)
    const result = execSync(
      `yt-dlp --skip-download --dump-json "${url}"`,
      { encoding: 'utf-8', timeout: 60000, maxBuffer: 50 * 1024 * 1024 }
    );
    
    const info = JSON.parse(result);
    
    // 히트맵 데이터 확인
    if (!info.heatmap || info.heatmap.length === 0) {
      console.log(`  ⚠️ 히트맵 데이터 없음 (조회수 5만 미만이거나 짧은 영상)`);
      return null;
    }
    
    // 데이터 정리
    const heatmapMarkers = info.heatmap.map(h => ({
      startTime: h.start_time,
      endTime: h.end_time,
      value: h.value
    }));
    
    return {
      videoId,
      collectedAt: new Date().toISOString().replace('Z', '+09:00'),
      meta: {
        title: info.title || '',
        description: info.description || '',
        channel: info.channel || info.uploader || '',
        channelId: info.channel_id || '',
        uploadDate: info.upload_date || '',
        duration: info.duration || 0,
        categories: info.categories || [],
        tags: info.tags || []
      },
      stats: {
        viewCount: info.view_count || 0,
        likeCount: info.like_count || null,
        commentCount: info.comment_count || null
      },
      videoDurationMs: (info.duration || 0) * 1000,
      heatmapMarkers
    };
    
  } catch (error) {
    if (error.message?.includes('Video unavailable')) {
      console.log(`  ⚠️ 영상 사용 불가`);
    } else if (error.message?.includes('Private video')) {
      console.log(`  ⚠️ 비공개 영상`);
    } else {
      console.log(`  ❌ 오류: ${error.message?.substring(0, 100)}`);
    }
    return null;
  }
}

/**
 * 점진적 스케줄링: 수집해야 하는지 확인
 */
async function shouldCollect(videoId) {
  const filePath = path.join(HEATMAPS_DIR, `${videoId}.jsonl`);
  
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    
    if (lines.length === 0) return true;
    
    if (lines.length === 1) {
      const lastEntry = JSON.parse(lines[lines.length - 1]);
      const lastDate = new Date(lastEntry.collectedAt);
      const weeksSince = (Date.now() - lastDate.getTime()) / (7 * 24 * 60 * 60 * 1000);
      return weeksSince >= 1;
    }
    
    const lastEntry = JSON.parse(lines[lines.length - 1]);
    const prevEntry = JSON.parse(lines[lines.length - 2]);
    
    const lastDate = new Date(lastEntry.collectedAt);
    const prevDate = new Date(prevEntry.collectedAt);
    
    const gapWeeks = (lastDate.getTime() - prevDate.getTime()) / (7 * 24 * 60 * 60 * 1000);
    const requiredWeeks = Math.min(gapWeeks + 1, MAX_INTERVAL_WEEKS);
    
    const weeksSinceLastCollection = (Date.now() - lastDate.getTime()) / (7 * 24 * 60 * 60 * 1000);
    
    return weeksSinceLastCollection >= requiredWeeks;
    
  } catch (error) {
    return true;
  }
}

/**
 * 데이터 저장
 */
async function saveData(videoId, data) {
  await fs.mkdir(HEATMAPS_DIR, { recursive: true });
  const filePath = path.join(HEATMAPS_DIR, `${videoId}.jsonl`);
  const jsonLine = JSON.stringify(data) + '\n';
  await fs.appendFile(filePath, jsonLine);
  console.log(`  💾 저장 완료`);
}

/**
 * Git 커밋 및 푸시
 */
function gitCommitAndPush(message) {
  try {
    execSync('git add -A', { stdio: 'inherit' });
    const status = execSync('git status --porcelain').toString();
    
    if (status.trim()) {
      execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
      execSync(`git fetch origin ${BRANCH}`, { stdio: 'inherit' });
      
      try {
        execSync(`git rebase origin/${BRANCH}`, { stdio: 'inherit' });
      } catch (rebaseError) {
        console.log('⚠️ Rebase 충돌 - abort');
        execSync('git rebase --abort', { stdio: 'inherit' });
      }
      
      execSync(`git push origin ${BRANCH}`, { stdio: 'inherit' });
      console.log(`✅ Git 커밋/푸시 완료: ${message}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`⚠️ Git 작업 실패: ${error.message}`);
    return false;
  }
}

/**
 * 메인 실행
 */
async function main() {
  console.log('\n🎬 YouTube HeatmapMarkers Collector (yt-dlp 기반)');
  console.log(`📊 설정: 최대 ${MAX_URLS_PER_RUN}개 URL, 점진적 스케줄링 적용\n`);
  
  // yt-dlp 버전 확인
  try {
    const version = execSync('yt-dlp --version', { encoding: 'utf-8' }).trim();
    console.log(`📦 yt-dlp 버전: ${version}\n`);
  } catch (e) {
    console.error('❌ yt-dlp가 설치되어 있지 않습니다.');
    console.error('   설치: pip install yt-dlp');
    process.exit(1);
  }
  
  // URL 파일 읽기
  let allUrls = [];
  try {
    const content = await fs.readFile(URLS_FILE, 'utf-8');
    allUrls = content.trim().split('\n').filter(url => url.trim() && !url.startsWith('#'));
  } catch (error) {
    console.error('❌ URL 파일을 읽을 수 없습니다:', error.message);
    process.exit(1);
  }
  
  // 수집 대상 필터링
  console.log(`🔍 ${allUrls.length}개 URL 중 수집 대상 확인 중...`);
  const urlsToCollect = [];
  
  for (const url of allUrls) {
    if (urlsToCollect.length >= MAX_URLS_PER_RUN) break;
    
    const videoId = extractVideoId(url);
    if (!videoId) continue;
    
    if (await shouldCollect(videoId)) {
      urlsToCollect.push(url);
    }
  }
  
  console.log(`✅ 이번 실행 대상: ${urlsToCollect.length}개 URL\n`);
  
  if (urlsToCollect.length === 0) {
    console.log('📅 이번에 수집할 URL이 없습니다 (스케줄 미도래)');
    process.exit(0);
  }
  
  const results = { total: urlsToCollect.length, collected: 0, failed: 0 };
  let processedCount = 0;
  
  for (const url of urlsToCollect) {
    const videoId = extractVideoId(url);
    console.log(`📺 수집 시작: ${videoId}`);
    
    try {
      const data = await collectHeatmapWithYtDlp(videoId);
      
      if (data && data.heatmapMarkers && data.heatmapMarkers.length > 0) {
        await saveData(videoId, data);
        results.collected++;
        console.log(`  ✅ 수집 완료: 조회수 ${data.stats.viewCount.toLocaleString()}, 마커 ${data.heatmapMarkers.length}개`);
      } else {
        results.failed++;
      }
    } catch (error) {
      console.error(`  ❌ 오류: ${error.message}`);
      results.failed++;
    }
    
    processedCount++;
    
    // 10개마다 커밋
    if (processedCount % COMMIT_INTERVAL === 0 && results.collected > 0) {
      const timestamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      gitCommitAndPush(`📊 chore: collect ${processedCount} heatmapMarkers (${timestamp})`);
    }
    
    // 랜덤 대기 - Rate limiting
    if (processedCount % 10 === 0) {
      // 10개마다 30-60초 대기
      const wait = randomDelay(30000, 60000);
      console.log(`  ⏳ 10개 처리 완료 - ${Math.floor(wait/1000)}초 대기...`);
      await new Promise(r => setTimeout(r, wait));
    } else if (processedCount % 5 === 0) {
      // 5개마다 10-20초 대기
      const wait = randomDelay(10000, 20000);
      console.log(`  ⏳ 5개 처리 완료 - ${Math.floor(wait/1000)}초 대기...`);
      await new Promise(r => setTimeout(r, wait));
    } else {
      // 매 영상 3-8초 랜덤 대기
      const wait = randomDelay(3000, 8000);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  
  // 최종 커밋
  if (results.collected > 0) {
    const timestamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    gitCommitAndPush(`📊 chore: collect heatmapMarkers final (${timestamp})`);
  }
  
  console.log('\n📊 수집 완료');
  console.log(`  ✅ 성공: ${results.collected}개`);
  console.log(`  ❌ 실패: ${results.failed}개`);
}

main().catch(console.error);
