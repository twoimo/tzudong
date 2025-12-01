#!/usr/bin/env python3
"""
🍜 GeminiCLI 파이프라인 통합 로깅 모듈

로그 레벨, 시간 측정, JSON 저장 기능을 제공합니다.
모든 스크립트에서 import하여 사용합니다.

사용법:
    from utils.logger import PipelineLogger, LogLevel
    
    logger = PipelineLogger("crawling")
    logger.info("크롤링 시작")
    logger.success("완료", {"count": 100})
    
    with logger.timer("API 호출"):
        response = api.call()
    
    logger.save_summary()
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from enum import Enum
from functools import wraps
import time
from contextlib import contextmanager


# 한국 시간대 (KST, UTC+9)
KST = timezone(timedelta(hours=9))


class LogLevel(Enum):
    """로그 레벨 정의"""
    DEBUG = "DEBUG"
    INFO = "INFO"
    SUCCESS = "SUCCESS"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class Colors:
    """터미널 색상 코드"""
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    GRAY = '\033[90m'


# 로그 레벨별 색상 및 이모지
LOG_STYLES = {
    LogLevel.DEBUG: (Colors.GRAY, "🔍"),
    LogLevel.INFO: (Colors.OKBLUE, "ℹ️"),
    LogLevel.SUCCESS: (Colors.OKGREEN, "✅"),
    LogLevel.WARNING: (Colors.WARNING, "⚠️"),
    LogLevel.ERROR: (Colors.FAIL, "❌"),
    LogLevel.CRITICAL: (Colors.FAIL + Colors.BOLD, "🚨"),
}


class PipelineLogger:
    """파이프라인 통합 로거"""
    
    def __init__(
        self, 
        phase: str,
        log_dir: Optional[Path] = None,
        log_level: LogLevel = LogLevel.INFO,
        save_to_file: bool = True
    ):
        """
        Args:
            phase: 파이프라인 단계 이름 (crawling, evaluation, transform, insert)
            log_dir: 로그 저장 디렉토리 (기본: backend/log/geminiCLI-restaurant)
            log_level: 최소 로그 레벨
            save_to_file: 파일 저장 여부
        """
        self.phase = phase
        self.log_level = log_level
        self.save_to_file = save_to_file
        
        # 시작 시간 (한국 시간)
        self.start_time = datetime.now(KST)
        self.start_timestamp = self.start_time.isoformat()
        
        # 로그 디렉토리 설정
        if log_dir:
            self.log_dir = Path(log_dir)
        else:
            # backend/log/geminiCLI-restaurant 기본 경로
            self.log_dir = Path(__file__).parent.parent / "log" / "geminiCLI-restaurant"
        
        self.log_dir.mkdir(parents=True, exist_ok=True)
        
        # 로그 파일 경로 (날짜_phase.log / .jsonl)
        date_str = self.start_time.strftime("%Y-%m-%d")
        self.log_file = self.log_dir / f"{date_str}_{phase}.log"
        self.json_log_file = self.log_dir / f"{date_str}_{phase}.jsonl"
        self.summary_file = self.log_dir / f"{date_str}_{phase}_summary.json"
        
        # 통계 수집
        self.stats = {
            "phase": phase,
            "start_time": self.start_timestamp,
            "end_time": None,
            "duration_seconds": None,
            "total_processed": 0,
            "success_count": 0,
            "error_count": 0,
            "skip_count": 0,
            "warnings": [],
            "errors": [],
            "timers": {},
            "custom_stats": {}
        }
        
        # 로그 엔트리 저장
        self.log_entries: List[Dict] = []
        
        # 시작 로그
        self._log(LogLevel.INFO, f"{'='*60}")
        self._log(LogLevel.INFO, f"🚀 [{phase.upper()}] 파이프라인 시작")
        self._log(LogLevel.INFO, f"⏰ 시작 시간: {self.start_time.strftime('%Y-%m-%d %H:%M:%S')}")
        self._log(LogLevel.INFO, f"📁 로그 저장: {self.log_dir}")
        self._log(LogLevel.INFO, f"{'='*60}")
    
    def _should_log(self, level: LogLevel) -> bool:
        """로그 레벨 필터링"""
        level_order = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.SUCCESS, 
                      LogLevel.WARNING, LogLevel.ERROR, LogLevel.CRITICAL]
        return level_order.index(level) >= level_order.index(self.log_level)
    
    def _log(
        self, 
        level: LogLevel, 
        message: str, 
        data: Optional[Dict] = None,
        step: Optional[str] = None
    ):
        """내부 로그 처리"""
        if not self._should_log(level):
            return
        
        timestamp = datetime.now(KST)
        color, emoji = LOG_STYLES.get(level, (Colors.ENDC, ""))
        
        # 터미널 출력
        time_str = timestamp.strftime("%H:%M:%S")
        print(f"{Colors.GRAY}[{time_str}]{Colors.ENDC} {color}{emoji} {message}{Colors.ENDC}")
        
        # 로그 엔트리 생성
        entry = {
            "timestamp": timestamp.isoformat(),
            "level": level.value,
            "phase": self.phase,
            "step": step,
            "message": message,
            "data": data
        }
        self.log_entries.append(entry)
        
        # 파일 저장
        if self.save_to_file:
            # 텍스트 로그
            with open(self.log_file, "a", encoding="utf-8") as f:
                log_line = f"[{timestamp.isoformat()}] [{level.value}] {message}"
                if data:
                    log_line += f" | {json.dumps(data, ensure_ascii=False)}"
                f.write(log_line + "\n")
            
            # JSON 로그
            with open(self.json_log_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    
    # === 로그 레벨별 메서드 ===
    
    def debug(self, message: str, data: Optional[Dict] = None, step: Optional[str] = None):
        """DEBUG 레벨 로그"""
        self._log(LogLevel.DEBUG, message, data, step)
    
    def info(self, message: str, data: Optional[Dict] = None, step: Optional[str] = None):
        """INFO 레벨 로그"""
        self._log(LogLevel.INFO, message, data, step)
    
    def success(self, message: str, data: Optional[Dict] = None, step: Optional[str] = None):
        """SUCCESS 레벨 로그"""
        self._log(LogLevel.SUCCESS, message, data, step)
        self.stats["success_count"] += 1
    
    def warning(self, message: str, data: Optional[Dict] = None, step: Optional[str] = None):
        """WARNING 레벨 로그"""
        self._log(LogLevel.WARNING, message, data, step)
        self.stats["warnings"].append({"message": message, "data": data})
    
    def error(self, message: str, data: Optional[Dict] = None, step: Optional[str] = None):
        """ERROR 레벨 로그"""
        self._log(LogLevel.ERROR, message, data, step)
        self.stats["error_count"] += 1
        self.stats["errors"].append({"message": message, "data": data})
    
    def critical(self, message: str, data: Optional[Dict] = None, step: Optional[str] = None):
        """CRITICAL 레벨 로그"""
        self._log(LogLevel.CRITICAL, message, data, step)
        self.stats["errors"].append({"message": message, "data": data, "critical": True})
    
    # === 진행 상황 로그 ===
    
    def progress(self, current: int, total: int, item: str = "", extra: str = ""):
        """진행 상황 출력"""
        percent = (current / total * 100) if total > 0 else 0
        bar_length = 30
        filled = int(bar_length * current / total) if total > 0 else 0
        bar = "=" * filled + ">" + " " * (bar_length - filled - 1)
        
        status = f"[{bar}] {percent:.1f}% ({current}/{total})"
        if item:
            status += f" | {item}"
        if extra:
            status += f" | {extra}"
        
        # 같은 줄에 업데이트 (터미널)
        print(f"\r{Colors.OKCYAN}{status}{Colors.ENDC}", end="", flush=True)
        
        # 10% 단위로 파일에 기록
        if current % max(1, total // 10) == 0 or current == total:
            self._log(LogLevel.INFO, f"진행: {current}/{total} ({percent:.1f}%)", step="progress")
    
    def progress_done(self):
        """진행 상황 완료 (줄바꿈)"""
        print()
    
    # === 시간 측정 ===
    
    @contextmanager
    def timer(self, name: str):
        """시간 측정 컨텍스트 매니저"""
        start = time.time()
        self.debug(f"⏱️ [{name}] 시작...")
        try:
            yield
        finally:
            elapsed = time.time() - start
            self.debug(f"⏱️ [{name}] 완료: {elapsed:.2f}초")
            
            # 타이머 통계 저장
            if name not in self.stats["timers"]:
                self.stats["timers"][name] = {
                    "count": 0,
                    "total_seconds": 0,
                    "min_seconds": float('inf'),
                    "max_seconds": 0
                }
            
            timer = self.stats["timers"][name]
            timer["count"] += 1
            timer["total_seconds"] += elapsed
            timer["min_seconds"] = min(timer["min_seconds"], elapsed)
            timer["max_seconds"] = max(timer["max_seconds"], elapsed)
    
    def measure_time(self, name: str):
        """시간 측정 데코레이터"""
        def decorator(func):
            @wraps(func)
            def wrapper(*args, **kwargs):
                with self.timer(name):
                    return func(*args, **kwargs)
            return wrapper
        return decorator
    
    # === 통계 관리 ===
    
    def add_stat(self, key: str, value: Any):
        """커스텀 통계 추가"""
        self.stats["custom_stats"][key] = value
    
    def increment_stat(self, key: str, amount: int = 1):
        """커스텀 통계 증가"""
        if key not in self.stats["custom_stats"]:
            self.stats["custom_stats"][key] = 0
        self.stats["custom_stats"][key] += amount
    
    def set_processed(self, count: int):
        """처리 개수 설정"""
        self.stats["total_processed"] = count
    
    def increment_success(self, count: int = 1):
        """성공 개수 증가"""
        self.stats["success_count"] += count
    
    def increment_error(self, count: int = 1):
        """에러 개수 증가"""
        self.stats["error_count"] += count
    
    def increment_skip(self, count: int = 1):
        """스킵 개수 증가"""
        self.stats["skip_count"] += count
    
    # === 요약 및 저장 ===
    
    def print_section(self, title: str):
        """섹션 구분선 출력"""
        print()
        print(f"{Colors.BOLD}{Colors.HEADER}{'─'*60}{Colors.ENDC}")
        print(f"{Colors.BOLD}{Colors.HEADER}  {title}{Colors.ENDC}")
        print(f"{Colors.BOLD}{Colors.HEADER}{'─'*60}{Colors.ENDC}")
    
    def print_stats_table(self, title: str, stats: Dict[str, Any]):
        """통계 테이블 출력"""
        print(f"\n{Colors.BOLD}{title}{Colors.ENDC}")
        for key, value in stats.items():
            if isinstance(value, float):
                value_str = f"{value:.2f}"
            elif isinstance(value, dict):
                value_str = json.dumps(value, ensure_ascii=False)
            else:
                value_str = str(value)
            print(f"  {key}: {Colors.OKCYAN}{value_str}{Colors.ENDC}")
    
    def save_summary(self) -> Dict:
        """최종 요약 저장 및 반환"""
        end_time = datetime.now(KST)
        duration = (end_time - self.start_time).total_seconds()
        
        self.stats["end_time"] = end_time.isoformat()
        self.stats["duration_seconds"] = round(duration, 2)
        self.stats["duration_formatted"] = self._format_duration(duration)
        
        # 타이머 평균 계산
        for name, timer in self.stats["timers"].items():
            if timer["count"] > 0:
                timer["avg_seconds"] = round(timer["total_seconds"] / timer["count"], 3)
                timer["total_seconds"] = round(timer["total_seconds"], 2)
                if timer["min_seconds"] == float('inf'):
                    timer["min_seconds"] = 0
                timer["min_seconds"] = round(timer["min_seconds"], 3)
                timer["max_seconds"] = round(timer["max_seconds"], 3)
        
        # 성공률 계산
        total = self.stats["total_processed"]
        if total > 0:
            self.stats["success_rate"] = round(self.stats["success_count"] / total * 100, 2)
            self.stats["error_rate"] = round(self.stats["error_count"] / total * 100, 2)
        
        # 요약 출력
        self.print_section(f"📊 [{self.phase.upper()}] 실행 결과 요약")
        
        print(f"\n⏰ 실행 시간")
        print(f"  시작: {self.start_time.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"  종료: {end_time.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"  소요: {Colors.OKCYAN}{self.stats['duration_formatted']}{Colors.ENDC}")
        
        print(f"\n📈 처리 통계")
        print(f"  총 처리: {Colors.OKCYAN}{self.stats['total_processed']}{Colors.ENDC}개")
        print(f"  성공: {Colors.OKGREEN}{self.stats['success_count']}{Colors.ENDC}개", end="")
        if total > 0:
            print(f" ({self.stats.get('success_rate', 0):.1f}%)")
        else:
            print()
        print(f"  실패: {Colors.FAIL}{self.stats['error_count']}{Colors.ENDC}개", end="")
        if total > 0:
            print(f" ({self.stats.get('error_rate', 0):.1f}%)")
        else:
            print()
        print(f"  스킵: {Colors.WARNING}{self.stats['skip_count']}{Colors.ENDC}개")
        
        # 커스텀 통계 출력
        if self.stats["custom_stats"]:
            self.print_stats_table("📊 상세 통계", self.stats["custom_stats"])
        
        # 타이머 통계 출력
        if self.stats["timers"]:
            print(f"\n⏱️ 시간 측정")
            for name, timer in self.stats["timers"].items():
                avg = timer.get("avg_seconds", 0)
                print(f"  {name}: 평균 {avg:.2f}초 (총 {timer['count']}회)")
        
        # 에러 요약
        if self.stats["errors"]:
            print(f"\n{Colors.FAIL}❌ 에러 목록 ({len(self.stats['errors'])}개){Colors.ENDC}")
            for i, err in enumerate(self.stats["errors"][:5], 1):
                print(f"  {i}. {err['message']}")
            if len(self.stats["errors"]) > 5:
                print(f"  ... 외 {len(self.stats['errors']) - 5}개")
        
        print(f"\n{'='*60}")
        
        # 파일 저장
        if self.save_to_file:
            with open(self.summary_file, "w", encoding="utf-8") as f:
                json.dump(self.stats, f, ensure_ascii=False, indent=2)
            self.info(f"📁 요약 저장됨: {self.summary_file}")
        
        return self.stats
    
    def _format_duration(self, seconds: float) -> str:
        """시간을 읽기 좋은 형태로 포맷"""
        if seconds < 60:
            return f"{seconds:.1f}초"
        elif seconds < 3600:
            minutes = int(seconds // 60)
            secs = int(seconds % 60)
            return f"{minutes}분 {secs}초"
        else:
            hours = int(seconds // 3600)
            minutes = int((seconds % 3600) // 60)
            return f"{hours}시간 {minutes}분"


# === 헬퍼 함수 ===

def get_logger(phase: str, **kwargs) -> PipelineLogger:
    """로거 인스턴스 생성 헬퍼"""
    return PipelineLogger(phase, **kwargs)


def format_number(n: int) -> str:
    """숫자를 천 단위 콤마로 포맷"""
    return f"{n:,}"


def format_percent(value: float, total: float) -> str:
    """백분율 포맷"""
    if total == 0:
        return "0.0%"
    return f"{(value / total * 100):.1f}%"


def format_bytes(size: int) -> str:
    """바이트를 읽기 좋은 형태로 포맷"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024:
            return f"{size:.1f}{unit}"
        size /= 1024
    return f"{size:.1f}TB"
