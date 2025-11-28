#!/usr/bin/env python3
"""
Gemini CLI 크롤링 전체 파이프라인
1. YouTube URL 수집 (api-youtube-urls.py)
2. Gemini CLI 레스토랑 데이터 수집 (crawling.sh)
3. YouTube 메타데이터 추가 (api-youtube-meta.py)
"""

import sys
import subprocess
from pathlib import Path
from datetime import datetime


def print_header(title: str):
    """헤더 출력"""
    print("\n" + "=" * 80)
    print(f"  {title}")
    print("=" * 80 + "\n")


def print_step(step_num: int, total: int, description: str):
    """단계 표시"""
    print(f"\n{'🔹' * 40}")
    print(f"  STEP {step_num}/{total}: {description}")
    print(f"{'🔹' * 40}\n")


def run_command(command: list, description: str, cwd: Path = None) -> bool:
    """명령어 실행"""
    print(f"🚀 실행: {' '.join(command)}")
    print(f"📂 작업 디렉토리: {cwd or Path.cwd()}\n")
    
    try:
        subprocess.run(
            command,
            cwd=cwd,
            check=True,
            capture_output=False,
            text=True
        )
        print(f"\n✅ {description} 완료!\n")
        return True
        
    except subprocess.CalledProcessError as e:
        print(f"\n❌ {description} 실패!")
        print(f"오류 코드: {e.returncode}")
        return False
        
    except FileNotFoundError:
        print(f"\n❌ 명령어를 찾을 수 없습니다: {command[0]}")
        return False
        
    except KeyboardInterrupt:
        print(f"\n\n⚠️  사용자에 의해 중단되었습니다.")
        return False


def main():
    """파이프라인 메인 실행"""
    start_time = datetime.now()
    
    print_header("🍜 Gemini CLI 레스토랑 데이터 크롤링 파이프라인")
    print(f"⏰ 시작 시간: {start_time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    # 경로 설정
    script_dir = Path(__file__).parent
    project_dir = script_dir.parent
    
    # 스크립트 파일들
    youtube_urls_script = script_dir / "api-youtube-urls.py"
    crawling_script = script_dir / "crawling.sh"
    
    # 출력 파일들 (crawling.sh와 동일하게)
    urls_file = project_dir / "tzuyang_youtubeVideo_urls.txt"
    results_file = project_dir / "tzuyang_restaurant_results.jsonl"
    results_with_meta_file = project_dir / "tzuyang_restaurant_results_with_meta.jsonl"
    
    # 파이프라인 선택
    # print("📌 실행할 단계를 선택하세요:")
    # print("   1️⃣  전체 파이프라인 (URL 수집 → 크롤링 → 메타데이터)")
    # print("   2️⃣  크롤링만 실행 (기존 URL 사용)")
    # print()
    # choice = input("선택 (1/2): ").strip()
    
    # URL 수집 생략하고 기존 URL로 크롤링만 실행
    choice = "2"
    print("📌 기존 URL 파일로 크롤링 실행 (URL 수집 생략)")
    
    success_count = 0
    
    if choice == "1":
        # STEP 1: YouTube URL 수집
        print_step(1, 3, "YouTube URL 수집")
        if run_command(
            [sys.executable, str(youtube_urls_script)],
            "YouTube URL 수집",
            cwd=script_dir
        ):
            success_count += 1
            if urls_file.exists():
                with open(urls_file, 'r', encoding='utf-8') as f:
                    url_count = sum(1 for line in f if line.strip())
                print(f"📊 수집된 URL: {url_count}개\n")
        else:
            print("❌ STEP 1 실패. 파이프라인을 중단합니다.")
            sys.exit(1)
    
    # STEP 2: Gemini CLI 크롤링 (+ 메타데이터 자동 추가)
    step_num = 2 if choice == "1" else 1
    total_steps = 2 if choice == "1" else 1
    
    print_step(step_num, 3 if choice == "1" else 2, "Gemini CLI 크롤링")
    
    if not urls_file.exists():
        print(f"❌ URL 파일 없음: {urls_file}")
        print("먼저 URL을 수집하거나 data/youtube_urls.txt를 생성하세요.")
        sys.exit(1)
    
    if run_command(
        [str(crawling_script)],
        "Gemini CLI 크롤링",
        cwd=script_dir
    ):
        success_count += 1
        if results_file.exists():
            with open(results_file, 'r', encoding='utf-8') as f:
                record_count = sum(1 for line in f if line.strip())
            print(f"📊 크롤링 레코드: {record_count}개\n")
    else:
        print("❌ 크롤링 실패.")
        sys.exit(1)
    
    # 최종 결과
    end_time = datetime.now()
    duration = end_time - start_time
    
    print_header("✅ 파이프라인 실행 완료")
    print(f"⏰ 종료 시간: {end_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"⏱️  소요 시간: {duration}")
    print()
    
    print("📁 생성된 파일:")
    if urls_file.exists():
        print(f"   1. {urls_file.name} - YouTube URL 목록")
    print(f"   2. {results_file.name} - 레스토랑 데이터")
    if results_with_meta_file.exists():
        print(f"   3. {results_with_meta_file.name} - 최종 데이터 (메타 포함)")
    print()
    print("=" * 80)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  사용자에 의해 중단되었습니다.")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ 예상치 못한 오류 발생: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
