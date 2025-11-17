#!/usr/bin/env python3
"""
🍜 Headless 통합 파이프라인

Headless 모드로 전체 프로세스를 자동 실행합니다:
1. 크롤링 파이프라인 (URL → 레스토랑 정보 수집)
2. 평가 파이프라인 (레스토랑 평가 및 선정)

GitHub Actions 및 서버 환경에서 자동 실행하기 위한 스크립트입니다.

사용법:
    python headless-restaurant-pipeline.py

전제조건:
    - Python 3.8+
    - Node.js 16+
    - npm install 완료 (crawling, evaluation)
    - Puppeteer headless 모드 지원
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
    print("\n" + "=" * 90)
    print(f"  {Colors.BOLD}{Colors.HEADER}{title}{Colors.ENDC}")
    print("=" * 90 + "\n")


def print_phase(phase_num: int, total: int, title: str):
    """Phase 헤더 출력"""
    print(f"\n{Colors.BOLD}{Colors.OKCYAN}{'▶' * 45}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  PHASE {phase_num}/{total}: {title}{Colors.ENDC}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}{'▶' * 45}{Colors.ENDC}\n")


def print_success(message: str):
    """성공 메시지"""
    print(f"{Colors.OKGREEN}✅ {message}{Colors.ENDC}")


def print_error(message: str):
    """에러 메시지"""
    print(f"{Colors.FAIL}❌ {message}{Colors.ENDC}")


def print_info(message: str):
    """정보 메시지"""
    print(f"{Colors.OKBLUE}ℹ️  {message}{Colors.ENDC}")


def install_python_packages():
    """필요한 Python 패키지 자동 설치"""
    print_info("Python 패키지 확인 중...")
    
    required_packages = ['requests']
    missing_packages = []
    
    for package in required_packages:
        try:
            __import__(package)
        except ImportError:
            missing_packages.append(package)
    
    if missing_packages:
        print_info(f"누락된 패키지 발견: {', '.join(missing_packages)}")
        print_info("자동으로 패키지를 설치합니다...")
        
        try:
            subprocess.run(
                [sys.executable, "-m", "pip", "install"] + missing_packages,
                check=True,
                capture_output=True,
                text=True
            )
            print_success(f"패키지 설치 완료: {', '.join(missing_packages)}")
        except subprocess.CalledProcessError as e:
            print_error(f"패키지 설치 실패: {e.stderr}")
            return False
    else:
        print_success("모든 필수 Python 패키지가 설치되어 있습니다")
    
    return True


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


def load_statistics(stats_dir: Path, prefix: str) -> Dict[str, Any]:
    """가장 최근 통계 파일 로드"""
    try:
        stats_files = sorted(
            stats_dir.glob(f"{prefix}_stats_*.json"),
            key=lambda x: x.stat().st_mtime,
            reverse=True
        )
        
        if stats_files:
            with open(stats_files[0], 'r', encoding='utf-8') as f:
                return json.load(f)
        
        return {}
    except Exception as e:
        print_error(f"통계 로드 실패: {e}")
        return {}


def save_pipeline_statistics(
    crawling_stats: Dict[str, Any],
    evaluation_stats: Dict[str, Any],
    total_duration: float,
    stats_dir: Path
):
    """전체 파이프라인 통계 저장"""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    stats_file = stats_dir / f"pipeline_stats_{timestamp}.json"
    
    pipeline_stats = {
        "timestamp": datetime.now().isoformat(),
        "total_duration_seconds": total_duration,
        "total_duration_minutes": total_duration / 60,
        "crawling": {
            "duration_seconds": crawling_stats.get("duration_seconds", 0),
            "success_rate": crawling_stats.get("success_rate", 0),
            "total_restaurants": crawling_stats.get("total_restaurants", 0),
            "processed_urls": crawling_stats.get("processed_urls", 0),
            "failed_urls": crawling_stats.get("failed_urls", 0)
        },
        "evaluation": {
            "duration_seconds": evaluation_stats.get("duration_seconds", 0),
            "success_rate": evaluation_stats.get("success_rate", 0),
            "evaluated_count": evaluation_stats.get("evaluated_restaurants", 0),
            "selection_count": evaluation_stats.get("selection_count", 0),
            "selection_rate": evaluation_stats.get("selection_rate", 0)
        }
    }
    
    # 전체 성공률 계산
    if (pipeline_stats["crawling"]["success_rate"] and 
        pipeline_stats["evaluation"]["success_rate"]):
        pipeline_stats["overall_success_rate"] = (
            pipeline_stats["crawling"]["success_rate"] + 
            pipeline_stats["evaluation"]["success_rate"]
        ) / 2
    else:
        pipeline_stats["overall_success_rate"] = 0.0
    
    try:
        with open(stats_file, 'w', encoding='utf-8') as f:
            json.dump(pipeline_stats, f, ensure_ascii=False, indent=2)
        print_success(f"통합 통계 저장: {stats_file}")
        return pipeline_stats
    except Exception as e:
        print_error(f"통계 저장 실패: {e}")
        return pipeline_stats


def main():
    """메인 실행 함수"""
    print_header("🤖 HEADLESS RESTAURANT PIPELINE")
    print_info("수집 → 평가 전체 프로세스를 Headless 모드로 자동 실행합니다.")
    
    # Python 패키지 자동 설치
    if not install_python_packages():
        print_error("Python 패키지 설치 실패로 파이프라인을 중단합니다.")
        return 1
    
    print()
    
    # 경로 설정
    backend_dir = Path(__file__).parent.absolute()
    crawling_dir = backend_dir / "perplexity-restaurant-crawling"
    evaluation_dir = backend_dir / "perplexity-restaurant-evaluation"
    stats_dir = backend_dir / "headless_stats"
    
    # 디렉토리 존재 확인
    if not crawling_dir.exists():
        print_error(f"크롤링 디렉토리를 찾을 수 없습니다: {crawling_dir}")
        return 1
    
    if not evaluation_dir.exists():
        print_error(f"평가 디렉토리를 찾을 수 없습니다: {evaluation_dir}")
        return 1
    
    if not stats_dir.exists():
        stats_dir.mkdir(parents=True, exist_ok=True)
        print_info(f"통계 디렉토리 생성: {stats_dir}")
    
    start_time = datetime.now()
    print_info(f"시작 시간: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    # ========================================
    # PHASE 1: 크롤링 파이프라인
    # ========================================
    print_phase(1, 2, "CRAWLING PIPELINE")
    
    success, _ = run_command(
        ["python3", "src/headless-crawling-pipeline.py"],
        "Headless 크롤링 파이프라인 실행",
        cwd=crawling_dir
    )
    
    if not success:
        print_error("크롤링 파이프라인 실패!")
        return 1
    
    print()
    
    # ========================================
    # PHASE 2: 평가 파이프라인
    # ========================================
    print_phase(2, 2, "EVALUATION PIPELINE")
    
    success, _ = run_command(
        ["python3", "src/headless-evaluation-pipeline.py"],
        "Headless 평가 파이프라인 실행",
        cwd=evaluation_dir
    )
    
    if not success:
        print_error("평가 파이프라인 실패!")
        return 1
    
    print()
    
    # ========================================
    # 최종 통계 집계
    # ========================================
    print_header("📊 FINAL STATISTICS")
    
    end_time = datetime.now()
    total_duration = (end_time - start_time).total_seconds()
    
    # 개별 통계 로드
    crawling_stats = load_statistics(stats_dir, "crawling")
    evaluation_stats = load_statistics(stats_dir, "evaluation")
    
    # 통합 통계 저장
    pipeline_stats = save_pipeline_statistics(
        crawling_stats,
        evaluation_stats,
        total_duration,
        stats_dir
    )
    
    # 최종 통계 출력
    print()
    print(f"{Colors.BOLD}🎯 전체 파이프라인 통계{Colors.ENDC}")
    print()
    print(f"{Colors.BOLD}📥 크롤링{Colors.ENDC}")
    print(f"  처리 URL: {pipeline_stats['crawling']['processed_urls']}")
    print(f"  실패 URL: {pipeline_stats['crawling']['failed_urls']}")
    print(f"  레스토랑 수: {pipeline_stats['crawling']['total_restaurants']}")
    print(f"  성공률: {pipeline_stats['crawling']['success_rate']:.2f}%")
    print(f"  소요 시간: {pipeline_stats['crawling']['duration_seconds']/60:.2f}분")
    print()
    print(f"{Colors.BOLD}🎨 평가{Colors.ENDC}")
    print(f"  평가 완료: {pipeline_stats['evaluation']['evaluated_count']}")
    print(f"  선정 레스토랑: {pipeline_stats['evaluation']['selection_count']}")
    print(f"  선정률: {pipeline_stats['evaluation']['selection_rate']:.2f}%")
    print(f"  성공률: {pipeline_stats['evaluation']['success_rate']:.2f}%")
    print(f"  소요 시간: {pipeline_stats['evaluation']['duration_seconds']/60:.2f}분")
    print()
    print(f"{Colors.BOLD}🏆 전체{Colors.ENDC}")
    print(f"  전체 성공률: {pipeline_stats['overall_success_rate']:.2f}%")
    print(f"  총 소요 시간: {total_duration:.2f}초 ({total_duration/60:.2f}분)")
    print()
    
    # 최종 성공 메시지
    print_header("✅ PIPELINE 완료!")
    print_success(f"총 {pipeline_stats['crawling']['total_restaurants']}개 레스토랑 수집")
    print_success(f"{pipeline_stats['evaluation']['selection_count']}개 레스토랑 선정")
    print_success(f"소요 시간: {total_duration/60:.2f}분")
    
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
