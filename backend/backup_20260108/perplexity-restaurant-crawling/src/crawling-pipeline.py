#!/usr/bin/env python3
"""
크롤링 파이프라인 통합 실행 스크립트
1. YouTube URL 수집 (api-tzuyang-youtubeVideo-urls.py)
2. Perplexity 레스토랑 데이터 수집 (index.ts - TypeScript)
3. YouTube 메타데이터 추가 (api-youtube-meta.py)
"""

import sys
import subprocess
from pathlib import Path
from datetime import datetime


def print_header(title: str):
    """예쁜 헤더 출력"""
    print("\n" + "=" * 80)
    print(f"  {title}")
    print("=" * 80 + "\n")


def print_step(step_num: int, total: int, description: str):
    """단계 표시"""
    print(f"\n{'🔹' * 40}")
    print(f"  STEP {step_num}/{total}: {description}")
    print(f"{'🔹' * 40}\n")


def run_command(command: list, description: str, cwd: Path = None) -> bool:
    """
    명령어 실행 및 결과 처리
    
    Args:
        command: 실행할 명령어 리스트
        description: 작업 설명
        cwd: 작업 디렉토리 (None이면 현재 디렉토리)
    
    Returns:
        성공 여부 (True/False)
    """
    print(f"🚀 실행: {' '.join(command)}")
    print(f"📂 작업 디렉토리: {cwd or Path.cwd()}\n")
    
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            check=True,
            capture_output=False,  # 실시간 출력
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
        print(f"필요한 도구가 설치되어 있는지 확인하세요.")
        return False
        
    except KeyboardInterrupt:
        print(f"\n\n⚠️  사용자에 의해 중단되었습니다.")
        return False


def check_files(files: list, description: str) -> bool:
    """
    필요한 파일들이 존재하는지 확인
    
    Args:
        files: 확인할 파일 경로 리스트
        description: 파일 그룹 설명
    
    Returns:
        모든 파일 존재 여부
    """
    print(f"📋 {description} 확인 중...")
    all_exist = True
    
    for file_path in files:
        if file_path.exists():
            print(f"   ✅ {file_path.name}")
        else:
            print(f"   ❌ {file_path.name} (없음)")
            all_exist = False
    
    print()
    return all_exist


def main():
    """파이프라인 메인 실행"""
    start_time = datetime.now()
    
    print_header("🍜 쯔양 레스토랑 데이터 크롤링 파이프라인")
    print(f"⏰ 시작 시간: {start_time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    # 경로 설정
    script_dir = Path(__file__).parent
    project_dir = script_dir.parent
    
    # 스크립트 파일들
    youtube_urls_script = script_dir / "api-tzuyang-youtubeVideo-urls.py"
    perplexity_script = script_dir / "index.ts"
    youtube_meta_script = script_dir / "api-youtube-meta.py"
    
    # 출력 파일들
    urls_file = project_dir / "tzuyang_youtubeVideo_urls.txt"
    results_file = project_dir / "tzuyang_restaurant_results.jsonl"
    results_with_meta_file = project_dir / "tzuyang_restaurant_results_with_meta.jsonl"
    
    # 1. 필수 스크립트 파일 확인
    print_step(0, 3, "필수 파일 확인")
    
    required_scripts = [youtube_urls_script, perplexity_script, youtube_meta_script]
    if not check_files(required_scripts, "실행 스크립트"):
        print("❌ 필수 스크립트 파일이 없습니다. 파이프라인을 중단합니다.")
        sys.exit(1)
    
    print("✅ 모든 스크립트 파일 확인 완료!\n")
    
    # 파이프라인 자동 실행
    print("📌 다음 단계를 순차적으로 자동 실행합니다:")
    print("   1️⃣  YouTube URL 수집 (Python)")
    print("   2️⃣  Perplexity 레스토랑 데이터 수집 (TypeScript)")
    print("   3️⃣  YouTube 메타데이터 추가 (Python)")
    print()
    
    # 단계별 실행
    success_count = 0
    total_steps = 3
    
    # STEP 1: YouTube URL 수집
    print_step(1, total_steps, "YouTube URL 수집")
    if run_command(
        [sys.executable, str(youtube_urls_script)],
        "YouTube URL 수집",
        cwd=script_dir
    ):
        success_count += 1
        
        # 결과 파일 확인
        if urls_file.exists():
            with open(urls_file, 'r', encoding='utf-8') as f:
                url_count = sum(1 for line in f if line.strip())
            print(f"📊 수집된 URL: {url_count}개\n")
    else:
        print("❌ STEP 1 실패. 파이프라인을 중단합니다.")
        sys.exit(1)
    
    # STEP 2: Perplexity 레스토랑 데이터 수집
    print_step(2, total_steps, "Perplexity 레스토랑 데이터 수집")
    print("⚠️  이 단계는 TypeScript/Node.js를 사용합니다.\n")
    
    # npm run start 자동 실행
    if run_command(
        ["npm", "run", "start"],
        "Perplexity 레스토랑 데이터 수집",
        cwd=project_dir
    ):
        success_count += 1
        
        # 결과 파일 확인
        if results_file.exists():
            with open(results_file, 'r', encoding='utf-8') as f:
                record_count = sum(1 for line in f if line.strip())
            print(f"📊 수집된 레스토랑 레코드: {record_count}개\n")
    else:
        print("❌ STEP 2 실패. 파이프라인을 중단합니다.")
        sys.exit(1)
    
    # STEP 3: YouTube 메타데이터 추가
    print_step(3, total_steps, "YouTube 메타데이터 추가")
    
    # 입력 파일 확인
    if not results_file.exists():
        print(f"❌ 입력 파일이 없습니다: {results_file}")
        print("STEP 2가 완료되어야 STEP 3를 실행할 수 있습니다.")
        sys.exit(1)
    
    if run_command(
        [sys.executable, str(youtube_meta_script)],
        "YouTube 메타데이터 추가",
        cwd=script_dir
    ):
        success_count += 1
        
        # 결과 파일 확인
        if results_with_meta_file.exists():
            with open(results_with_meta_file, 'r', encoding='utf-8') as f:
                final_count = sum(1 for line in f if line.strip())
            print(f"📊 최종 레코드 (메타데이터 포함): {final_count}개\n")
    else:
        print("❌ STEP 3 실패.")
        sys.exit(1)
    
    # 최종 결과
    end_time = datetime.now()
    duration = end_time - start_time
    
    print_header("✅ 파이프라인 실행 완료")
    print(f"⏰ 종료 시간: {end_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"⏱️  소요 시간: {duration}")
    print(f"📊 완료된 단계: {success_count}/{total_steps}")
    print()
    
    if success_count == total_steps:
        print("🎉 모든 단계가 성공적으로 완료되었습니다!")
        print()
        print("📁 생성된 파일:")
        print(f"   1. {urls_file.name} - YouTube URL 목록")
        print(f"   2. {results_file.name} - 레스토랑 데이터")
        print(f"   3. {results_with_meta_file.name} - 최종 데이터 (메타데이터 포함)")
    else:
        print("⚠️  일부 단계가 실패했습니다. 위의 로그를 확인하세요.")
    
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
