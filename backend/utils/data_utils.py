#!/usr/bin/env python3
"""
데이터 폴더 관리 유틸리티
- 날짜별 폴더 (yy-mm-dd) 관리
- 최신 폴더 탐색
- 파일 경로 생성
"""

import os
import re
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Tuple

# 한국 시간대 (KST, UTC+9)
KST = timezone(timedelta(hours=9))


# 날짜 폴더 패턴 (yy-mm-dd)
DATE_FOLDER_PATTERN = re.compile(r'^(\d{2})-(\d{2})-(\d{2})$')


def get_today_folder_name() -> str:
    """
    오늘 날짜의 폴더명 반환 (yy-mm-dd)
    PIPELINE_DATE 환경변수가 있으면 우선 사용 (GitHub Actions에서 설정)
    """
    import os
    pipeline_date = os.environ.get('PIPELINE_DATE')
    if pipeline_date:
        return pipeline_date
    return datetime.now(KST).strftime('%y-%m-%d')


def parse_folder_date(folder_name: str) -> Optional[datetime]:
    """폴더명에서 날짜 파싱. 유효하지 않으면 None 반환"""
    match = DATE_FOLDER_PATTERN.match(folder_name)
    if not match:
        return None
    
    try:
        year = int(match.group(1)) + 2000  # yy -> 20yy
        month = int(match.group(2))
        day = int(match.group(3))
        return datetime(year, month, day)
    except ValueError:
        return None


def get_all_date_folders(data_dir: Path) -> List[Tuple[str, datetime]]:
    """
    data 디렉토리에서 모든 날짜 폴더 목록 반환
    Returns: [(폴더명, 날짜객체), ...] 날짜 오름차순 정렬
    """
    if not data_dir.exists():
        return []
    
    folders = []
    for item in data_dir.iterdir():
        if item.is_dir():
            date = parse_folder_date(item.name)
            if date:
                folders.append((item.name, date))
    
    # 날짜 오름차순 정렬
    folders.sort(key=lambda x: x[1])
    return folders


def get_latest_folder(data_dir: Path) -> Optional[str]:
    """
    가장 최근 날짜의 폴더명 반환
    없으면 None 반환
    """
    folders = get_all_date_folders(data_dir)
    if not folders:
        return None
    return folders[-1][0]  # 마지막이 가장 최근


def get_latest_folder_path(data_dir: Path) -> Optional[Path]:
    """
    가장 최근 날짜 폴더의 전체 경로 반환
    없으면 None 반환
    """
    latest = get_latest_folder(data_dir)
    if latest:
        return data_dir / latest
    return None


def get_today_folder_path(data_dir: Path) -> Path:
    """
    오늘 날짜 폴더의 전체 경로 반환 (없으면 생성)
    """
    today = get_today_folder_name()
    folder_path = data_dir / today
    folder_path.mkdir(parents=True, exist_ok=True)
    return folder_path


def ensure_data_folder(base_dir: Path) -> Path:
    """
    base_dir 아래에 data 폴더가 있는지 확인하고, 없으면 생성
    Returns: data 폴더 경로
    """
    data_dir = base_dir / 'data'
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def get_log_folder_path(log_base_dir: Path, date_folder: Optional[str] = None) -> Path:
    """
    로그 폴더 경로 반환 (날짜별 폴더)
    
    Args:
        log_base_dir: 로그 기본 디렉토리 (예: backend/log/geminiCLI-restaurant)
        date_folder: 날짜 폴더명 (yy-mm-dd). None이면 오늘 날짜 사용
    
    Returns:
        로그 폴더 경로 (예: backend/log/geminiCLI-restaurant/25-12-01)
    """
    if date_folder is None:
        date_folder = get_today_folder_name()
    
    log_path = Path(log_base_dir) / date_folder
    log_path.mkdir(parents=True, exist_ok=True)
    return log_path


def print_log_folder_path(log_base_dir: str, date_folder: Optional[str] = None) -> None:
    """로그 폴더 경로 출력 (bash에서 호출용)"""
    log_path = get_log_folder_path(Path(log_base_dir), date_folder)
    print(str(log_path))


class DataPathManager:
    """
    크롤링/평가 데이터 경로 관리자
    
    사용 예:
        manager = DataPathManager(base_dir)
        
        # 오늘 폴더에 저장
        today_path = manager.get_today_output_path("tzuyang_results.jsonl")
        
        # 최신 폴더에서 읽기 (중복 검사용)
        latest_path = manager.get_latest_input_path("tzuyang_urls.txt")
    """
    
    def __init__(self, base_dir: Path):
        """
        Args:
            base_dir: geminiCLI-restaurant-crawling 또는 geminiCLI-restaurant-evaluation 경로
        """
        self.base_dir = Path(base_dir)
        self.data_dir = ensure_data_folder(self.base_dir)
    
    def get_today_folder(self) -> Path:
        """오늘 날짜 폴더 경로 (없으면 생성)"""
        return get_today_folder_path(self.data_dir)
    
    def get_latest_folder(self) -> Optional[Path]:
        """가장 최근 날짜 폴더 경로"""
        return get_latest_folder_path(self.data_dir)
    
    def get_all_folders(self) -> List[Path]:
        """모든 날짜 폴더 경로 (날짜순)"""
        folders = get_all_date_folders(self.data_dir)
        return [self.data_dir / name for name, _ in folders]
    
    def get_today_output_path(self, filename: str) -> Path:
        """
        오늘 폴더에 저장할 파일 경로
        폴더가 없으면 자동 생성
        """
        return self.get_today_folder() / filename
    
    def get_latest_input_path(self, filename: str) -> Optional[Path]:
        """
        최신 폴더에서 읽을 파일 경로
        폴더나 파일이 없으면 None
        """
        latest = self.get_latest_folder()
        if not latest:
            return None
        
        file_path = latest / filename
        if file_path.exists():
            return file_path
        return None
    
    def get_all_file_paths(self, filename: str) -> List[Path]:
        """
        모든 날짜 폴더에서 특정 파일 경로 목록
        실제 존재하는 파일만 반환
        """
        paths = []
        for folder in self.get_all_folders():
            file_path = folder / filename
            if file_path.exists():
                paths.append(file_path)
        return paths
    
    def load_all_existing_data(self, filename: str) -> set:
        """
        모든 날짜 폴더에서 특정 파일의 내용을 합쳐서 Set으로 반환
        중복 검사용 (URL, unique_id 등)
        
        Args:
            filename: 파일명 (예: "tzuyang_youtubeVideo_urls.txt")
        
        Returns:
            모든 라인을 합친 Set
        """
        all_data = set()
        
        for file_path in self.get_all_file_paths(filename):
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        stripped = line.strip()
                        if stripped:
                            all_data.add(stripped)
            except Exception as e:
                print(f"⚠️ 파일 읽기 실패 ({file_path}): {e}")
        
        return all_data
    
    def load_latest_file_lines(self, filename: str) -> List[str]:
        """
        최신 폴더의 파일 내용을 라인 리스트로 반환
        
        Args:
            filename: 파일명
        
        Returns:
            라인 리스트 (빈 라인 제외)
        """
        latest_path = self.get_latest_input_path(filename)
        if not latest_path:
            return []
        
        try:
            with open(latest_path, 'r', encoding='utf-8') as f:
                return [line.strip() for line in f if line.strip()]
        except Exception as e:
            print(f"⚠️ 파일 읽기 실패 ({latest_path}): {e}")
            return []


# ============================================================
# Bash 스크립트용 헬퍼 함수들
# ============================================================

def print_today_folder(data_dir: str) -> None:
    """오늘 날짜 폴더명 출력 (bash에서 호출용)"""
    print(get_today_folder_name())


def print_latest_folder(data_dir: str) -> None:
    """최신 폴더명 출력 (bash에서 호출용)"""
    data_path = Path(data_dir)
    latest = get_latest_folder(data_path)
    if latest:
        print(latest)
    else:
        # 없으면 오늘 날짜 반환
        print(get_today_folder_name())


def print_today_folder_path(data_dir: str) -> None:
    """오늘 날짜 폴더 전체 경로 출력 (bash에서 호출용)"""
    data_path = Path(data_dir)
    today_path = get_today_folder_path(data_path)
    print(str(today_path))


def print_latest_folder_path(data_dir: str) -> None:
    """최신 폴더 전체 경로 출력 (bash에서 호출용)"""
    data_path = Path(data_dir)
    latest = get_latest_folder_path(data_path)
    if latest:
        print(str(latest))
    else:
        # 없으면 오늘 폴더 생성 후 경로 반환
        print(str(get_today_folder_path(data_path)))


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python data_utils.py <command> [args...]")
        print("Commands:")
        print("  today_folder      - 오늘 날짜 폴더명 (yy-mm-dd)")
        print("  latest_folder     - 최신 폴더명")
        print("  today_path        - 오늘 폴더 전체 경로")
        print("  latest_path       - 최신 폴더 전체 경로")
        print("  log_path <dir>    - 로그 폴더 경로 (날짜별)")
        sys.exit(1)
    
    command = sys.argv[1]
    data_dir = sys.argv[2] if len(sys.argv) > 2 else "."
    
    if command == "today_folder":
        print_today_folder(data_dir)
    elif command == "latest_folder":
        print_latest_folder(data_dir)
    elif command == "today_path":
        print_today_folder_path(data_dir)
    elif command == "latest_path":
        print_latest_folder_path(data_dir)
    elif command == "log_path":
        # python data_utils.py log_path <log_base_dir> [date_folder]
        log_base_dir = sys.argv[2] if len(sys.argv) > 2 else "."
        date_folder = sys.argv[3] if len(sys.argv) > 3 else None
        print_log_folder_path(log_base_dir, date_folder)
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)
