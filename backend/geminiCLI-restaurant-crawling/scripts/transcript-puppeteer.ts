#!/usr/bin/env npx ts-node
/**
 * Puppeteer 기반 YouTube 자막 수집 스크립트
 * 
 * 1차: maestra.ai에서 수집 시도
 * 2차: tubetranscript.com으로 fallback
 * 
 * 사용법:
 *   npx ts-node transcript-puppeteer.ts --date 25-12-03
 *   npx ts-node transcript-puppeteer.ts --date 25-12-03 --max 50
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ============================================================
// 설정
// ============================================================

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'backend', 'geminiCLI-restaurant-crawling', 'data');
const NO_TRANSCRIPT_DIR = path.join(DATA_DIR, 'no_transcript_link');
const NO_TRANSCRIPT_PERMANENT = path.join(NO_TRANSCRIPT_DIR, 'no_transcript_permanent.json');

const COMMIT_INTERVAL = 30;  // 30개마다 커밋
const REST_INTERVAL = 100;   // 100개마다 휴식
const REST_DURATION = 180000; // 3분 (180초)
const DELAY_MIN = 1000;      // 1초
const DELAY_MAX = 3000;      // 3초
const PAGE_TIMEOUT = 60000;  // 60초 (페이지 로드)

// ============================================================
// 타입 정의
// ============================================================

interface TranscriptSegment {
  start: number;
  text: string;
}

interface TranscriptData {
  youtube_link: string;
  language: string;
  collected_at: string;
  transcript: TranscriptSegment[];
}

interface NoTranscriptEntry {
  youtube_link: string;
  retry_num: number;
}

// ============================================================
// 유틸리티 함수
// ============================================================

/**
 * 시간 문자열을 초 단위로 변환
 * "01:04" → 64
 * "1:08:40" → 4120
 * "14:26 - 14:40" → 866 (앞부분만)
 */
function parseTime(timeStr: string): number {
  // "14:26 - 14:40" 형태면 앞부분만 추출
  const cleaned = timeStr.split('-')[0].trim();
  const parts = cleaned.split(':').map(Number);
  
  if (parts.length === 2) {
    // mm:ss
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    // h:mm:ss
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

/**
 * YouTube URL에서 비디오 ID 추출
 */
function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * 랜덤 딜레이
 */
function randomDelay(min: number = DELAY_MIN, max: number = DELAY_MAX): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * 현재 시간 (KST)
 */
function getCurrentTime(): string {
  return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

/**
 * 로그 출력
 */
function log(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') {
  const timestamp = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' });
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
  console.log(`[${timestamp}] ${icons[type]} ${message}`);
}

/**
 * no_transcript_permanent.json 업데이트
 * 자막 수집 실패한 URL을 기록 (재시도 횟수 포함)
 */
function updateNoTranscriptPermanent(youtubeUrl: string): void {
  try {
    // 디렉토리 확인
    if (!fs.existsSync(NO_TRANSCRIPT_DIR)) {
      fs.mkdirSync(NO_TRANSCRIPT_DIR, { recursive: true });
    }

    // 기존 데이터 로드
    let entries: NoTranscriptEntry[] = [];
    if (fs.existsSync(NO_TRANSCRIPT_PERMANENT)) {
      const content = fs.readFileSync(NO_TRANSCRIPT_PERMANENT, 'utf-8');
      entries = JSON.parse(content);
    }

    // 이미 존재하는지 확인
    const existingIndex = entries.findIndex(e => e.youtube_link === youtubeUrl);
    if (existingIndex >= 0) {
      // 재시도 횟수 증가
      entries[existingIndex].retry_num += 1;
      log(`no_transcript_permanent 업데이트: ${youtubeUrl} (retry: ${entries[existingIndex].retry_num})`, 'warning');
    } else {
      // 새로 추가
      entries.push({
        youtube_link: youtubeUrl,
        retry_num: 1
      });
      log(`no_transcript_permanent 추가: ${youtubeUrl}`, 'warning');
    }

    // 저장
    fs.writeFileSync(NO_TRANSCRIPT_PERMANENT, JSON.stringify(entries, null, 2), 'utf-8');
  } catch (error) {
    log(`no_transcript_permanent 업데이트 실패: ${error}`, 'error');
  }
}

// ============================================================
// Maestra.ai 파싱
// ============================================================

async function collectFromMaestra(page: Page, videoId: string): Promise<{ transcript: TranscriptSegment[], language: string } | null> {
  const url = `https://maestra.ai/tools/video-to-text/youtube-transcript-generator?v=${videoId}`;
  
  try {
    log(`Maestra.ai 접속: ${videoId}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    
    // mode-toggle 버튼 또는 "텍스트 변환하기" 버튼 대기 (최대 60초)
    let modeToggleFound = false;
    const startTime = Date.now();
    const maxWait = 60000; // 60초
    
    while (Date.now() - startTime < maxWait) {
      // mode-toggle 버튼 체크
      const hasModeToggle = await page.evaluate(() => {
        return document.querySelector('button.mode-toggle') !== null;
      });
      
      if (hasModeToggle) {
        modeToggleFound = true;
        break;
      }
      
      // "텍스트 변환하기" 또는 "Get Transcript" 버튼 체크
      const submitButton = await page.evaluate(() => {
        const btn = document.querySelector('input.search-button[type="submit"]') as HTMLInputElement;
        if (btn && (btn.value === '텍스트 변환하기' || btn.value === 'Get Transcript')) {
          return true;
        }
        return false;
      });
      
      if (submitButton) {
        log(`Maestra.ai: 변환 버튼 클릭 - ${videoId}`);
        await page.click('input.search-button[type="submit"]');
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
    }
    
    if (!modeToggleFound) {
      log(`Maestra.ai: mode-toggle 버튼 없음 (60초 초과) - ${videoId}`, 'warning');
      return null;
    }
    
    // 현재 모드 확인 후 caption 모드로 전환
    const currentMode = await page.evaluate(() => {
      const btn = document.querySelector('button.mode-toggle');
      return btn?.getAttribute('data-mode') || '';
    });
    
    if (currentMode !== 'caption') {
      // caption 버튼 클릭해서 caption 모드로 전환
      await page.click('button.mode-toggle svg[data-icon="caption"]');
      
      // data-mode="caption"이 될 때까지 대기 (최대 10초)
      let captionModeReady = false;
      const modeStartTime = Date.now();
      while (Date.now() - modeStartTime < 10000) {
        const mode = await page.evaluate(() => {
          const btn = document.querySelector('button.mode-toggle');
          return btn?.getAttribute('data-mode') || '';
        });
        if (mode === 'caption') {
          captionModeReady = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      if (!captionModeReady) {
        log(`Maestra.ai: caption 모드 전환 실패 - ${videoId}`, 'warning');
        return null;
      }
    }
    
    // 자막 라인(.caption-line)이 나타날 때까지 대기 (최대 30초)
    let captionLinesFound = false;
    const captionStartTime = Date.now();
    const captionMaxWait = 30000;
    
    while (Date.now() - captionStartTime < captionMaxWait) {
      const count = await page.evaluate(() => {
        return document.querySelectorAll('.transcript-content samp.caption-line').length;
      });
      
      if (count > 0) {
        captionLinesFound = true;
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (!captionLinesFound) {
      log(`Maestra.ai: 자막 라인 없음 (30초 초과) - ${videoId}`, 'warning');
      return null;
    }
    
    // 언어 추출
    const language = await page.evaluate(() => {
      const langOption = document.querySelector('.language-selector select option:checked');
      if (langOption) {
        return langOption.textContent?.toLowerCase() || 'korean';
      }
      return 'korean';
    });
    
    // 자막 파싱
    const transcript = await page.evaluate(() => {
      const segments: { start: number; text: string }[] = [];
      const captionLines = document.querySelectorAll('.transcript-content samp.caption-line');
      
      captionLines.forEach(line => {
        const textEl = line.querySelector('.caption-text');
        
        if (textEl) {
          // data-start 속성에서 시간 추출 (더 정확함)
          const dataStart = line.getAttribute('data-start');
          const startSeconds = dataStart ? parseFloat(dataStart) : 0;
          
          segments.push({
            start: startSeconds,
            text: textEl.textContent?.trim() || ''
          });
        }
      });
      
      return segments;
    });
    
    if (transcript.length === 0) {
      log(`Maestra.ai: 파싱 결과 없음 - ${videoId}`, 'warning');
      return null;
    }
    
    log(`Maestra.ai: ${transcript.length}개 세그먼트 수집 - ${videoId}`, 'success');
    return { transcript, language };
    
  } catch (error) {
    log(`Maestra.ai 오류: ${videoId} - ${error}`, 'error');
    return null;
  }
}

// ============================================================
// TubeTranscript.com Fallback
// ============================================================

async function collectFromTubeTranscript(page: Page, videoId: string): Promise<{ transcript: TranscriptSegment[], language: string } | null> {
  const url = `https://www.tubetranscript.com/ko/watch?v=${videoId}`;
  
  try {
    log(`TubeTranscript.com fallback: ${videoId}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
    
    // main-transcript-content가 나타날 때까지 대기 (최대 60초)
    log(`TubeTranscript 자막 대기 중: ${videoId}`);
    try {
      await page.waitForFunction(
        () => document.querySelector('#main-transcript-content') !== null,
        { timeout: 60000, polling: 1000 }
      );
    } catch {
      log(`TubeTranscript: 자막 컨테이너 없음 (60초 초과) - ${videoId}`, 'warning');
      return null;
    }
    
    // 실제 자막 콘텐츠(.transcript-group-box)가 나타날 때까지 대기 (최대 60초)
    try {
      await page.waitForFunction(
        () => document.querySelector('#main-transcript-content .transcript-group-box') !== null,
        { timeout: 60000, polling: 1000 }
      );
    } catch {
      log(`TubeTranscript: 자막 콘텐츠 없음 (60초 초과) - ${videoId}`, 'warning');
      return null;
    }
    
    // 자막 파싱
    const transcript = await page.evaluate(() => {
      const segments: { start: number; text: string }[] = [];
      const groups = document.querySelectorAll('#main-transcript-content .transcript-group-box');
      
      groups.forEach(group => {
        const timeEl = group.querySelector('.transcript-time a[target="_blank"]');
        const textEl = group.querySelector('.transcript-text');
        
        if (timeEl && textEl) {
          const timeStr = timeEl.textContent?.trim() || '';
          const parts = timeStr.split(':').map(Number);
          
          let startSeconds = 0;
          if (parts.length === 2) {
            startSeconds = parts[0] * 60 + parts[1];
          } else if (parts.length === 3) {
            startSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
          }
          
          segments.push({
            start: startSeconds,
            text: textEl.textContent?.trim() || ''
          });
        }
      });
      
      return segments;
    });
    
    if (transcript.length === 0) {
      log(`TubeTranscript: 파싱 결과 없음 - ${videoId}`, 'warning');
      return null;
    }
    
    log(`TubeTranscript: ${transcript.length}개 세그먼트 수집 - ${videoId}`, 'success');
    return { transcript, language: 'korean' }; // TubeTranscript은 항상 korean
    
  } catch (error) {
    log(`TubeTranscript 오류: ${videoId} - ${error}`, 'error');
    return null;
  }
}

// ============================================================
// 메인 수집 로직
// ============================================================

async function collectTranscript(page: Page, videoId: string): Promise<TranscriptData | null> {
  // 1차: Maestra.ai 시도
  let result = await collectFromMaestra(page, videoId);
  
  // 2차: TubeTranscript fallback
  if (!result) {
    result = await collectFromTubeTranscript(page, videoId);
  }
  
  if (!result) {
    return null;
  }
  
  // KST ISO 문자열 생성 (2025-12-04T01:37:01.799+09:00 형식)
  const now = new Date();
  const kstISOString = now.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(' ', 'T') + 
    '.' + String(now.getMilliseconds()).padStart(3, '0') + '+09:00';
  
  return {
    youtube_link: `https://www.youtube.com/watch?v=${videoId}`,
    language: result.language,
    collected_at: kstISOString,
    transcript: result.transcript
  };
}

// ============================================================
// Git 커밋
// ============================================================

function gitCommitAndPush(dateFolder: string, count: number): boolean {
  const transcriptPath = `backend/geminiCLI-restaurant-crawling/data/${dateFolder}/tzuyang_restaurant_transcripts.json`;
  const MAX_RETRIES = 3;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Git 설정
      execSync('git config user.name "Transcript Puppeteer"', { cwd: PROJECT_ROOT, stdio: 'pipe' });
      execSync('git config user.email "transcript@local"', { cwd: PROJECT_ROOT, stdio: 'pipe' });
      
      // Pull 먼저 (원격 변경사항 가져오기)
      try {
        execSync('git pull --rebase origin github-actions-restaurant', { cwd: PROJECT_ROOT, stdio: 'pipe' });
        log('Git pull 완료', 'info');
      } catch {
        // pull 실패해도 계속 진행 (첫 커밋일 수 있음)
        log('Git pull 스킵 (새 브랜치일 수 있음)', 'warning');
      }
      
      // Add
      execSync(`git add "${transcriptPath}"`, { cwd: PROJECT_ROOT, stdio: 'pipe' });
      
      // 변경사항 확인
      try {
        execSync('git diff --staged --quiet', { cwd: PROJECT_ROOT, stdio: 'pipe' });
        log('변경사항 없음 - 커밋 스킵', 'warning');
        return true;
      } catch {
        // 변경사항 있음 - 계속 진행
      }
      
      // Commit
      const message = `📝 Transcript 수집 (Puppeteer): ${dateFolder} (+${count}개)`;
      execSync(`git commit -m "${message}"`, { cwd: PROJECT_ROOT, stdio: 'pipe' });
      
      // Push 전에 다시 pull (커밋 중 원격 변경이 있을 수 있음)
      try {
        execSync('git pull --rebase origin github-actions-restaurant', { cwd: PROJECT_ROOT, stdio: 'pipe' });
      } catch {
        // pull 실패해도 push 시도
      }
      
      // Push
      execSync('git push origin github-actions-restaurant', { cwd: PROJECT_ROOT, stdio: 'pipe' });
      
      log(`Git push 완료: +${count}개`, 'success');
      return true;
      
    } catch (error) {
      log(`Git 커밋/푸시 실패 (시도 ${attempt}/${MAX_RETRIES}): ${error}`, 'error');
      
      if (attempt < MAX_RETRIES) {
        log(`5초 후 재시도...`, 'warning');
        // 동기 sleep (5초)
        execSync('sleep 5');
        
        // 충돌 해결 시도: stash → pull → stash pop
        try {
          execSync('git stash', { cwd: PROJECT_ROOT, stdio: 'pipe' });
          execSync('git pull --rebase origin github-actions-restaurant', { cwd: PROJECT_ROOT, stdio: 'pipe' });
          execSync('git stash pop', { cwd: PROJECT_ROOT, stdio: 'pipe' });
          log('Git 충돌 해결 시도 완료', 'info');
        } catch {
          // stash 실패해도 다음 시도에서 처리
        }
      }
    }
  }
  
  log(`Git 커밋/푸시 최종 실패 (${MAX_RETRIES}회 시도)`, 'error');
  return false;
}

// ============================================================
// URL 로드 및 중복 체크
// ============================================================

function loadUrls(dateFolder: string): string[] {
  const allUrls: Set<string> = new Set();
  
  // 모든 날짜 폴더에서 URL 수집
  if (fs.existsSync(DATA_DIR)) {
    const folders = fs.readdirSync(DATA_DIR).filter(f => {
      const stat = fs.statSync(path.join(DATA_DIR, f));
      return stat.isDirectory();
    });
    
    for (const folder of folders) {
      const urlFile = path.join(DATA_DIR, folder, 'tzuyang_youtubeVideo_urls.txt');
      if (fs.existsSync(urlFile)) {
        const content = fs.readFileSync(urlFile, 'utf-8');
        content.split('\n').forEach(line => {
          const url = line.trim();
          if (url) allUrls.add(url);
        });
      }
    }
  }
  
  return Array.from(allUrls);
}

function loadExistingTranscripts(dateFolder: string): Map<string, TranscriptData> {
  const existing = new Map<string, TranscriptData>();
  
  // 모든 날짜 폴더에서 기존 transcript 로드
  if (fs.existsSync(DATA_DIR)) {
    const folders = fs.readdirSync(DATA_DIR).filter(f => {
      const stat = fs.statSync(path.join(DATA_DIR, f));
      return stat.isDirectory();
    });
    
    for (const folder of folders) {
      const transcriptFile = path.join(DATA_DIR, folder, 'tzuyang_restaurant_transcripts.json');
      if (fs.existsSync(transcriptFile)) {
        try {
          const data: TranscriptData[] = JSON.parse(fs.readFileSync(transcriptFile, 'utf-8'));
          data.forEach(item => {
            existing.set(item.youtube_link, item);
          });
        } catch {
          // JSON 파싱 오류 무시
        }
      }
    }
  }
  
  return existing;
}

function saveTranscripts(dateFolder: string, transcripts: TranscriptData[]) {
  const outputDir = path.join(DATA_DIR, dateFolder);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const outputFile = path.join(outputDir, 'tzuyang_restaurant_transcripts.json');
  fs.writeFileSync(outputFile, JSON.stringify(transcripts, null, 2), 'utf-8');
  log(`저장 완료: ${outputFile} (${transcripts.length}개)`);
}

// ============================================================
// Git Pull (최신 상태 동기화)
// ============================================================

function gitPullLatest(): void {
  try {
    log('🔄 Git pull (최신 상태 동기화)...');
    execSync('git pull --rebase origin github-actions-restaurant', { 
      cwd: PROJECT_ROOT, 
      stdio: 'pipe' 
    });
    log('Git pull 완료', 'success');
  } catch (error) {
    log('Git pull 실패 (새 브랜치일 수 있음)', 'warning');
  }
}

// ============================================================
// 메인 함수
// ============================================================

/**
 * 오늘 날짜 폴더명 반환 (yy-mm-dd 형식)
 * PIPELINE_DATE 환경변수가 있으면 우선 사용 (GitHub Actions에서 설정)
 */
function getTodayFolder(): string {
  const pipelineDate = process.env.PIPELINE_DATE;
  if (pipelineDate) {
    return pipelineDate;
  }
  
  // KST 기준 오늘 날짜 계산
  const now = new Date();
  const kstDateStr = now.toLocaleDateString('ko-KR', { 
    timeZone: 'Asia/Seoul',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit'
  }); // "25. 12. 04."
  
  // "25. 12. 04." → "25-12-04"
  const parts = kstDateStr.replace(/\./g, '').trim().split(' ');
  return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
}

async function main() {
  // 인자 파싱
  const args = process.argv.slice(2);
  let dateFolder = getTodayFolder(); // PIPELINE_DATE 환경변수 우선 사용
  let maxUrls = 300;
  let autoCommit = true;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      dateFolder = args[i + 1];
    } else if (args[i] === '--max' && args[i + 1]) {
      maxUrls = parseInt(args[i + 1], 10);
    } else if (args[i] === '--no-commit') {
      autoCommit = false;
    }
  }
  
  log('============================================================');
  log(`🚀 Transcript 수집 시작 (Puppeteer)`);
  log(`📅 날짜 폴더: ${dateFolder}`);
  log(`📊 최대 URL: ${maxUrls}개`);
  log(`🔄 자동 커밋: ${autoCommit ? 'ON' : 'OFF'}`);
  log('============================================================');
  
  // GitHub 최신 상태로 동기화 (중복 방지)
  if (autoCommit) {
    gitPullLatest();
  }
  
  // URL 로드
  const allUrls = loadUrls(dateFolder);
  log(`📁 전체 URL: ${allUrls.length}개`);
  
  // 기존 transcript 로드
  const existingTranscripts = loadExistingTranscripts(dateFolder);
  log(`📂 기존 transcript: ${existingTranscripts.size}개`);
  
  // 대기 URL 필터링
  const pendingUrls = allUrls.filter(url => !existingTranscripts.has(url));
  log(`⏳ 대기 URL: ${pendingUrls.length}개`);
  
  if (pendingUrls.length === 0) {
    log('수집할 신규 URL이 없습니다', 'warning');
    return;
  }
  
  // 최대 URL 제한
  const urlsToProcess = pendingUrls.slice(0, maxUrls);
  log(`🔢 처리할 URL: ${urlsToProcess.length}개`);
  
  // 현재 날짜 폴더의 transcript 로드 (append용)
  const currentTranscripts: TranscriptData[] = [];
  const currentFile = path.join(DATA_DIR, dateFolder, 'tzuyang_restaurant_transcripts.json');
  if (fs.existsSync(currentFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(currentFile, 'utf-8'));
      currentTranscripts.push(...data);
    } catch {
      // 무시
    }
  }
  
  // Puppeteer 브라우저 시작
  const browser = await puppeteer.launch({
    headless: true,  // GitHub Actions에서는 headless 필수
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  
  let successCount = 0;
  let failedCount = 0;
  let sinceLastCommit = 0;
  
  try {
    for (let i = 0; i < urlsToProcess.length; i++) {
      const url = urlsToProcess[i];
      const videoId = extractVideoId(url);
      
      if (!videoId) {
        log(`[${i + 1}/${urlsToProcess.length}] 비디오 ID 추출 실패: ${url}`, 'error');
        failedCount++;
        continue;
      }
      
      log(`[${i + 1}/${urlsToProcess.length}] 처리 중: ${videoId}`);
      
      const result = await collectTranscript(page, videoId);
      
      if (result) {
        currentTranscripts.push(result);
        successCount++;
        sinceLastCommit++;
        log(`[${i + 1}/${urlsToProcess.length}] ${videoId} ✅ (${result.transcript.length} segments, ${result.language})`, 'success');
      } else {
        failedCount++;
        // no_transcript_permanent.json에 실패 기록 추가/업데이트
        updateNoTranscriptPermanent(url);
        log(`[${i + 1}/${urlsToProcess.length}] ${videoId} ❌ 자막 없음`, 'error');
      }
      
      // 저장
      saveTranscripts(dateFolder, currentTranscripts);
      
      // 30개마다 커밋
      if (autoCommit && sinceLastCommit >= COMMIT_INTERVAL) {
        gitCommitAndPush(dateFolder, sinceLastCommit);
        sinceLastCommit = 0;
      }
      
      // 100개마다 3분 휴식 (rate limit 방지)
      if ((i + 1) % REST_INTERVAL === 0 && i < urlsToProcess.length - 1) {
        log(`🛑 ${i + 1}개 완료 - ${REST_DURATION / 60000}분 휴식 시작...`, 'warning');
        await new Promise(resolve => setTimeout(resolve, REST_DURATION));
        log(`🚀 휴식 끝 - 수집 재개`, 'success');
      }
      
      // 딜레이
      if (i < urlsToProcess.length - 1) {
        await randomDelay();
      }
    }
    
    // 최종 커밋 (남은 것)
    if (autoCommit && sinceLastCommit > 0) {
      gitCommitAndPush(dateFolder, sinceLastCommit);
    }
    
  } finally {
    await browser.close();
  }
  
  log('============================================================');
  log(`🏁 수집 완료`);
  log(`✅ 성공: ${successCount}개`);
  log(`❌ 실패: ${failedCount}개`);
  log(`📁 총 transcript: ${currentTranscripts.length}개`);
  log('============================================================');
}

// 실행
main().catch(console.error);
