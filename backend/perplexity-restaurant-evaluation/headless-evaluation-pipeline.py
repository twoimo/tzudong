#!/usr/bin/env python3
"""
🍜 Headless 평가 파이프라인

Headless 모드로 수집된 레스토랑 정보를 평가합니다.
GitHub Actions 및 서버 환경에서 자동 실행하기 위한 스크립트입니다.

사용법:
    python headless-evaluation-pipeline.py

전제조건:
    - Python 3.8+
    - Node.js 16+
    - npm install 완료
    - Puppeteer headless 모드 지원
    - 크롤링 완료 (tzuyang_restaurant_results.jsonl)
"""

import sys
import subprocess
import json
from pathlib import Path
from datetime import datetime
from typing import Tuple, Dict, Any


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


def print_header(title: str):
    """메인 헤더 출력"""
    print("\n" + "=" * 80)
    print(f"  {Colors.BOLD}{Colors.HEADER}{title}{Colors.ENDC}")
    print("=" * 80 + "\n")


def print_success(message: str):
    """성공 메시지"""
    print(f"{Colors.OKGREEN}✅ {message}{Colors.ENDC}")


def print_error(message: str):
    """에러 메시지"""
    print(f"{Colors.FAIL}❌ {message}{Colors.ENDC}")


def print_info(message: str):
    """정보 메시지"""
    print(f"{Colors.OKBLUE}ℹ️  {message}{Colors.ENDC}")


def run_command(command: list, description: str, cwd: Path = None) -> Tuple[bool, int]:
    """
    명령어 실행
    
    Args:
        command: 실행할 명령어 리스트
        description: 작업 설명
        cwd: 작업 디렉토리
    
    Returns:
        (성공여부, 종료코드)
    """
    print(f"🚀 {description}")
    print(f"📂 명령어: {' '.join(command)}")
    if cwd:
        print(f"📁 디렉토리: {cwd}")
    print()
    
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            check=True,
            capture_output=False,
            text=True
        )
        print_success(f"{description} 완료")
        return True, result.returncode
    except subprocess.CalledProcessError as e:
        print_error(f"{description} 실패 (코드: {e.returncode})")
        return False, e.returncode
    except FileNotFoundError:
        print_error(f"명령어를 찾을 수 없음: {command[0]}")
        return False, -1


def collect_statistics(evaluation_dir: Path, output_file: Path) -> Dict[str, Any]:
    """
    평가 결과 통계 수집
    
    Args:
        evaluation_dir: 평가 디렉토리
        output_file: 통계 저장 파일
    
    Returns:
        통계 딕셔너리
    """
    stats = {
        "timestamp": datetime.now().isoformat(),
        "total_restaurants": 0,
        "evaluated_restaurants": 0,
        "failed_evaluations": 0,
        "selection_count": 0,
        "output_file": str(output_file)
    }
    
    try:
        # 평가 선정 파일
        selection_file = evaluation_dir / "tzuyang_restaurant_evaluation_selection.jsonl"
        if selection_file.exists():
            with open(selection_file, 'r', encoding='utf-8') as f:
                lines = [line for line in f if line.strip()]
                stats["total_restaurants"] = len(lines)
        
        # 평가 결과 파일
        result_file = evaluation_dir / "tzuyang_restaurant_evaluation_results.jsonl"
        if result_file.exists():
            with open(result_file, 'r', encoding='utf-8') as f:
                lines = [line for line in f if line.strip()]
                stats["evaluated_restaurants"] = len(lines)
                
                # 선정된 레스토랑 개수
                selection_count = 0
                for line in lines:
                    try:
                        data = json.loads(line)
                        if data.get("selection") == True:
                            selection_count += 1
                    except json.JSONDecodeError:
                        pass
                
                stats["selection_count"] = selection_count
        
        stats["failed_evaluations"] = stats["total_restaurants"] - stats["evaluated_restaurants"]
        
        # 성공률 계산
        if stats["total_restaurants"] > 0:
            stats["success_rate"] = (stats["evaluated_restaurants"] / stats["total_restaurants"]) * 100
            stats["selection_rate"] = (stats["selection_count"] / stats["total_restaurants"]) * 100
        else:
            stats["success_rate"] = 0.0
            stats["selection_rate"] = 0.0
        
        return stats
        
    except Exception as e:
        print_error(f"통계 수집 실패: {e}")
        return stats


def save_statistics(stats: Dict[str, Any], stats_dir: Path):
    """통계를 JSON 파일로 저장"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    stats_file = stats_dir / f"evaluation_stats_{timestamp}.json"
    
    try:
        with open(stats_file, 'w', encoding='utf-8') as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)
        print_success(f"통계 저장: {stats_file}")
    except Exception as e:
        print_error(f"통계 저장 실패: {e}")


def main():
    """메인 실행 함수"""
    print_header("🤖 HEADLESS EVALUATION PIPELINE")
    
    # 경로 설정
    evaluation_dir = Path(__file__).parent.absolute()
    backend_dir = evaluation_dir.parent
    stats_dir = backend_dir / "headless_stats"
    
    # 디렉토리 존재 확인
    if not evaluation_dir.exists():
        print_error(f"평가 디렉토리를 찾을 수 없습니다: {evaluation_dir}")
        return 1
    
    if not stats_dir.exists():
        stats_dir.mkdir(parents=True, exist_ok=True)
        print_info(f"통계 디렉토리 생성: {stats_dir}")
    
    start_time = datetime.now()
    print_info(f"시작 시간: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    # 1단계: Headless 평가 실행
    print_header("STEP 1: Headless Evaluation")
    
    success, code = run_command(
        ["npx", "tsx", "headless_index.ts"],
        "Headless 모드로 레스토랑 평가",
        cwd=evaluation_dir
    )
    
    if not success:
        print_error("평가 실패!")
        return 1
    
    print()
    
    # 2단계: 결과 통계 수집
    print_header("STEP 2: Statistics Collection")
    
    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()
    
    stats = collect_statistics(
        evaluation_dir=evaluation_dir,
        output_file=evaluation_dir / "tzuyang_restaurant_evaluation_results.jsonl"
    )
    
    stats["start_time"] = start_time.isoformat()
    stats["end_time"] = end_time.isoformat()
    stats["duration_seconds"] = duration
    
    # 평균 평가 시간 계산
    if stats["evaluated_restaurants"] > 0:
        stats["average_evaluation_time"] = duration / stats["evaluated_restaurants"]
    else:
        stats["average_evaluation_time"] = 0.0
    
    # 통계 출력
    print()
    print(f"{Colors.BOLD}📊 평가 통계{Colors.ENDC}")
    print(f"  총 레스토랑 수: {stats['total_restaurants']}")
    print(f"  평가 완료: {stats['evaluated_restaurants']}")
    print(f"  실패: {stats['failed_evaluations']}")
    print(f"  선정 레스토랑: {stats['selection_count']}")
    print(f"  평가 성공률: {stats['success_rate']:.2f}%")
    print(f"  선정률: {stats['selection_rate']:.2f}%")
    print(f"  평균 평가 시간: {stats['average_evaluation_time']:.2f}초")
    print(f"  총 소요 시간: {duration:.2f}초 ({duration/60:.2f}분)")
    print()
    
    # 통계 저장
    save_statistics(stats, stats_dir)
    
    # 최종 성공 메시지
    print_header("✅ EVALUATION PIPELINE 완료!")
    print_success(f"총 {stats['evaluated_restaurants']}개의 레스토랑 평가 완료")
    print_success(f"선정된 레스토랑: {stats['selection_count']}개")
    print_success(f"소요 시간: {duration/60:.2f}분")
    
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print_error("\n사용자에 의해 중단되었습니다.")
        sys.exit(130)
    except Exception as e:
        print_error(f"예기치 않은 오류 발생: {e}")
        sys.exit(1)
