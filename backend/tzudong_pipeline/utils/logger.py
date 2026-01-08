"""
로깅 유틸리티

파이프라인 전체에서 일관된 로깅을 제공합니다.
"""

import os
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

import pytz


# 한국 시간대
KST = pytz.timezone("Asia/Seoul")


def get_kst_now() -> datetime:
    """현재 한국 시간 반환"""
    return datetime.now(KST)


def get_today_folder() -> str:
    """오늘 날짜 폴더명 반환 (YY-MM-DD 형식)"""
    return get_kst_now().strftime("%y-%m-%d")


def get_timestamp() -> str:
    """현재 타임스탬프 반환 (YYYYMMDD_HHMMSS 형식)"""
    return get_kst_now().strftime("%Y%m%d_%H%M%S")


def setup_logger(
    name: str,
    log_dir: Optional[str] = None,
    level: int = logging.INFO
) -> logging.Logger:
    """
    로거 설정
    
    Args:
        name: 로거 이름
        log_dir: 로그 디렉토리 (None이면 콘솔만)
        level: 로그 레벨
    
    Returns:
        설정된 로거
    """
    logger = logging.getLogger(name)
    logger.setLevel(level)
    
    # 포맷터
    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    
    # 콘솔 핸들러
    console_handler = logging.StreamHandler()
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    # 파일 핸들러 (log_dir이 지정된 경우)
    if log_dir:
        today = get_today_folder()
        log_path = Path(log_dir) / today
        log_path.mkdir(parents=True, exist_ok=True)
        
        log_file = log_path / f"{name}_{get_timestamp()}.log"
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    
    return logger


class PipelineLogger:
    """
    파이프라인 전용 로거
    
    단계별 진행 상황 및 통계를 기록합니다.
    """
    
    def __init__(self, name: str, log_dir: Optional[str] = None):
        self.logger = setup_logger(name, log_dir)
        self.stats: dict = {}
        self.start_time: Optional[datetime] = None
    
    def start(self, phase: str) -> None:
        """단계 시작"""
        self.start_time = get_kst_now()
        self.logger.info(f"{'='*50}")
        self.logger.info(f"🚀 {phase} 시작")
        self.logger.info(f"{'='*50}")
    
    def end(self, phase: str) -> None:
        """단계 종료"""
        if self.start_time:
            elapsed = get_kst_now() - self.start_time
            self.logger.info(f"{'='*50}")
            self.logger.info(f"✅ {phase} 완료 (소요시간: {elapsed})")
            self.logger.info(f"{'='*50}")
    
    def info(self, message: str) -> None:
        """정보 로그"""
        self.logger.info(message)
    
    def warning(self, message: str) -> None:
        """경고 로그"""
        self.logger.warning(f"⚠️ {message}")
    
    def error(self, message: str) -> None:
        """에러 로그"""
        self.logger.error(f"❌ {message}")
    
    def success(self, message: str) -> None:
        """성공 로그"""
        self.logger.info(f"✅ {message}")
    
    def progress(self, current: int, total: int, item: str = "") -> None:
        """진행 상황 로그"""
        percent = (current / total * 100) if total > 0 else 0
        self.logger.info(f"📊 진행: {current}/{total} ({percent:.1f}%) {item}")
    
    def stat(self, key: str, value: int) -> None:
        """통계 기록"""
        self.stats[key] = value
        self.logger.info(f"📈 {key}: {value}")
    
    def get_stats(self) -> dict:
        """통계 반환"""
        return self.stats


if __name__ == "__main__":
    # 테스트
    logger = PipelineLogger("test", "data/logs")
    logger.start("테스트 단계")
    logger.info("테스트 메시지")
    logger.progress(5, 10, "처리 중")
    logger.stat("processed_count", 5)
    logger.end("테스트 단계")
