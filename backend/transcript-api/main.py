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
sys.path.insert(0, str(BACKEND_ROOT / 'utils'))

from services.youtube import collect_transcripts_for_urls, get_pending_urls
from services.github import commit_and_push_transcripts

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
    
    try:
        # Transcript 수집
        result = collect_transcripts_for_urls(
            date_folder=date_folder,
            max_urls=request.max_urls
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
                commit_result = commit_and_push_transcripts(
                    date_folder=date_folder,
                    transcript_count=result["success_count"]
                )
                response.committed = commit_result["success"]
                response.commit_message = commit_result.get("message")
            except Exception as e:
                response.committed = False
                response.commit_message = f"커밋 실패: {str(e)}"
        
        return response
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/commit", tags=["GitHub"])
async def commit_only(date_folder: Optional[str] = None):
    """
    수집된 Transcript만 GitHub에 커밋
    (이미 수집된 파일을 커밋할 때 사용)
    """
    date_folder = date_folder or datetime.now(KST).strftime("%y-%m-%d")
    
    try:
        result = commit_and_push_transcripts(
            date_folder=date_folder,
            transcript_count=0  # 개수 확인 안 함
        )
        
        return {
            "success": result["success"],
            "message": result.get("message", ""),
            "date_folder": date_folder
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================
# 메인 실행
# ============================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
