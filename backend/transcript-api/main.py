#!/usr/bin/env python3
"""
🎬 Transcript API - YouTube 자막 수집 및 GitHub 커밋 서버

로컬에서 실행하여 YouTube 자막을 수집하고 GitHub에 자동 커밋합니다.
GitHub Actions의 IP 차단 문제를 우회합니다.

실행 방법:
    cd backend/transcript-api
    uvicorn main:app --reload --port 8000

API 문서:
    http://localhost:8000/docs
"""

import os
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# 프로젝트 루트 경로 설정
PROJECT_ROOT = Path(__file__).parent.parent.parent
BACKEND_ROOT = Path(__file__).parent.parent
LOG_DIR = BACKEND_ROOT / 'log' / 'geminiCLI-restaurant'
sys.path.insert(0, str(BACKEND_ROOT / 'utils'))

from services.youtube import collect_transcripts_for_urls, get_pending_urls
from services.github import commit_and_push_transcripts

# 로거 임포트
try:
    from logger import PipelineLogger
except ImportError:
    # 로거를 찾지 못하면 간단한 대체 로거 사용
    class PipelineLogger:
        def __init__(self, phase, log_dir=None, **kwargs): 
            self.phase = phase
            self._timers = {}
        def info(self, msg, data=None, step=None): print(f"ℹ️ {msg}")
        def success(self, msg, data=None, step=None): print(f"✅ {msg}")
        def warning(self, msg, data=None, step=None): print(f"⚠️ {msg}")
        def error(self, msg, data=None, step=None): print(f"❌ {msg}")
        def debug(self, msg, data=None, step=None): print(f"🔍 {msg}")
        def add_stat(self, key, value): pass
        def add_statistic(self, key, value): pass
        def increment_stat(self, key, amount=1): pass
        def set_processed(self, count): pass
        def increment_success(self, count=1): pass
        def increment_error(self, count=1): pass
        def increment_skip(self, count=1): pass
        def timer(self, name): 
            from contextlib import contextmanager
            import time
            @contextmanager
            def _timer():
                start = time.time()
                try:
                    yield
                finally:
                    elapsed = time.time() - start
                    self._timers[name] = elapsed
            return _timer()
        def start_stage(self): pass
        def end_stage(self): pass
        def save_summary(self): return {}
        def save_json_log(self): pass
        def get_summary(self): return {}

# 한국 시간대 (KST, UTC+9)
KST = timezone(timedelta(hours=9))

# FastAPI 앱 생성
app = FastAPI(
    title="🎬 Transcript API",
    description="YouTube 자막 수집 및 GitHub 자동 커밋 서버",
    version="1.0.0"
)

# CORS 설정 (프론트엔드에서 접근 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "https://tzudong.vercel.app",
        "https://*.vercel.app"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================
# 데이터 모델
# ============================

class TranscriptRequest(BaseModel):
    """Transcript 수집 요청"""
    date_folder: Optional[str] = None  # 날짜 폴더 (없으면 오늘 날짜)
    max_urls: Optional[int] = None  # 최대 처리할 URL 수 (없으면 전체)
    auto_commit: bool = True  # 수집 후 자동 커밋 여부


class TranscriptResponse(BaseModel):
    """Transcript 수집 응답"""
    success: bool
    message: str
    date_folder: str
    total_urls: int
    processed: int
    success_count: int
    failed_count: int
    skipped_count: int
    output_file: str
    committed: bool = False
    commit_message: Optional[str] = None


class StatusResponse(BaseModel):
    """상태 확인 응답"""
    status: str
    date_folder: str
    pending_urls: int
    existing_transcripts: int
    message: str


# ============================
# API 엔드포인트
# ============================

@app.get("/", tags=["Health"])
async def root():
    """서버 상태 확인"""
    return {
        "status": "running",
        "service": "Transcript API",
        "time": datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S KST")
    }


@app.get("/health", tags=["Health"])
async def health_check():
    """헬스 체크"""
    return {"status": "healthy"}


@app.get("/status", response_model=StatusResponse, tags=["Transcript"])
async def get_status(date_folder: Optional[str] = None):
    """
    현재 상태 확인
    - 수집 대기 중인 URL 수
    - 이미 수집된 transcript 수
    """
    if date_folder is None:
        date_folder = datetime.now(KST).strftime("%y-%m-%d")
    
    try:
        pending_urls, existing_transcripts = get_pending_urls(date_folder)
        
        return StatusResponse(
            status="ready",
            date_folder=date_folder,
            pending_urls=len(pending_urls),
            existing_transcripts=len(existing_transcripts),
            message=f"{len(pending_urls)}개 URL 수집 대기 중, {len(existing_transcripts)}개 이미 수집됨"
        )
    except Exception as e:
        return StatusResponse(
            status="error",
            date_folder=date_folder,
            pending_urls=0,
            existing_transcripts=0,
            message=str(e)
        )


@app.post("/collect", response_model=TranscriptResponse, tags=["Transcript"])
async def collect_transcripts(request: TranscriptRequest, background_tasks: BackgroundTasks):
    """
    YouTube 자막 수집
    
    1. URL 파일에서 영상 목록 읽기
    2. youtube-transcript-api로 자막 수집
    3. JSON 파일로 저장
    4. (선택) GitHub에 자동 커밋
    """
    # 날짜 폴더 설정
    date_folder = request.date_folder or datetime.now(KST).strftime("%y-%m-%d")
    
    # 로거 생성
    logger = PipelineLogger(
        phase="transcript-api",
        log_dir=LOG_DIR
    )
    logger.info(f"🚀 /collect 엔드포인트 호출 - date_folder: {date_folder}, max_urls: {request.max_urls}, auto_commit: {request.auto_commit}")
    
    try:
        # Transcript 수집
        with logger.timer("transcript_collect"):
            result = collect_transcripts_for_urls(
                date_folder=date_folder,
                max_urls=request.max_urls,
                logger=logger
            )
        
        response = TranscriptResponse(
            success=result["success"],
            message=result["message"],
            date_folder=date_folder,
            total_urls=result["total_urls"],
            processed=result["processed"],
            success_count=result["success_count"],
            failed_count=result["failed_count"],
            skipped_count=result["skipped_count"],
            output_file=result["output_file"]
        )
        
        # 자동 커밋
        if request.auto_commit and result["success_count"] > 0:
            try:
                logger.info("📤 자동 커밋 시작...")
                with logger.timer("git_commit"):
                    commit_result = commit_and_push_transcripts(
                        date_folder=date_folder,
                        transcript_count=result["success_count"],
                        logger=logger
                    )
                response.committed = commit_result["success"]
                response.commit_message = commit_result.get("message")
                if commit_result["success"]:
                    logger.success(f"자동 커밋 성공: {commit_result.get('message')}")
                else:
                    logger.warning(f"자동 커밋 실패: {commit_result.get('message')}")
            except Exception as e:
                response.committed = False
                response.commit_message = f"커밋 실패: {str(e)}"
                logger.error(f"자동 커밋 예외 발생: {str(e)}")
        
        # 통계 저장
        logger.add_stat("endpoint", "/collect")
        logger.add_stat("date_folder", date_folder)
        logger.add_stat("total_urls", result["total_urls"])
        logger.add_stat("success_count", result["success_count"])
        logger.add_stat("failed_count", result["failed_count"])
        logger.add_stat("skipped_count", result["skipped_count"])
        logger.add_stat("committed", response.committed if hasattr(response, 'committed') else None)
        
        logger.success(f"/collect 요청 완료 - 성공: {result['success_count']}, 실패: {result['failed_count']}")
        logger.save_summary()
        
        return response
        
    except Exception as e:
        logger.error(f"/collect 요청 실패: {str(e)}")
        logger.save_summary()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/commit", tags=["GitHub"])
async def commit_only(date_folder: Optional[str] = None):
    """
    수집된 Transcript만 GitHub에 커밋
    (이미 수집된 파일을 커밋할 때 사용)
    """
    date_folder = date_folder or datetime.now(KST).strftime("%y-%m-%d")
    
    # 로거 생성
    logger = PipelineLogger(
        phase="transcript-api-commit",
        log_dir=LOG_DIR
    )
    logger.info(f"🚀 /commit 엔드포인트 호출 - date_folder: {date_folder}")
    
    try:
        with logger.timer("git_commit"):
            result = commit_and_push_transcripts(
                date_folder=date_folder,
                transcript_count=0,  # 개수 확인 안 함
                logger=logger
            )
        
        if result["success"]:
            logger.success(f"/commit 요청 완료 - 메시지: {result.get('message')}")
        else:
            logger.warning(f"/commit 요청 완료 (실패) - 메시지: {result.get('message')}")
        
        logger.add_stat("endpoint", "/commit")
        logger.add_stat("date_folder", date_folder)
        logger.add_stat("success", result["success"])
        logger.save_summary()
        
        return {
            "success": result["success"],
            "message": result.get("message", ""),
            "date_folder": date_folder
        }
        
    except Exception as e:
        logger.error(f"/commit 요청 실패: {str(e)}")
        logger.save_summary()
        raise HTTPException(status_code=500, detail=str(e))


# ============================
# 메인 실행
# ============================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
