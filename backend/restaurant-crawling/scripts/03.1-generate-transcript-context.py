#!/usr/bin/env python3
"""
YouTube 자막 문맥 생성 스크립트

transcript/{video_id}.jsonl 파일들을 읽어서 문맥을 생성하고,
transcript-document-with-context/{video_id}.jsonl로 저장합니다.

저장 형식:
- 한 줄에 recollect_id별 Document 리스트 (JSONL append 방식)
- 기존 문서가 있으면 recollect_id가 더 높은 경우에만 추가

사용법:
    python 03.1-generate-transcript-context.py --model cookieshake/a.x-4.0-light-imatrix:Q8_0
"""

import json
import time
import os
import re
import glob
import argparse
import requests
from tqdm import tqdm
import sys
from pathlib import Path
from langchain_core.output_parsers import StrOutputParser
from langchain_core.documents import Document
from langchain_core.prompts import load_prompt
from langchain_ollama import ChatOllama

# src 경로 추가
SCRIPT_DIR = Path(__file__).parent.resolve()
SRC_PATH = (SCRIPT_DIR / "../src").resolve()
if str(SRC_PATH) not in sys.path:
    sys.path.insert(0, str(SRC_PATH))

from utils.chunk_utils import create_chunks_with_overlap


def read_jsonl(data_path: str) -> dict | None:
    """JSONL 파일에서 가장 마지막(최신) 라인 읽기"""
    try:
        with open(data_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
            if lines:
                return json.loads(lines[-1])
    except Exception as e:
        print(f"파일 읽기 오류 {data_path}: {e}")
    return None


def get_matching_metadata(meta_path: str, recollect_id: int) -> dict | None:
    """메타데이터 파일에서 recollect_id가 일치하는 것 중 가장 마지막(최신) 데이터를 반환"""
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
            # recollect_id가 일치하는 라인들 필터링 (뒤에서부터)
            for line in reversed(lines):
                if line.strip():
                    meta = json.loads(line)
                    if meta.get("recollect_id") == recollect_id:
                        return meta
    except Exception as e:
        print(f"메타데이터 읽기 오류 {meta_path}: {e}")
    return None


def get_latest_doc_recollect_id(doc_path: str) -> int | None:
    """기존 document 파일에서 최신 recollect_id 반환"""
    if not os.path.exists(doc_path):
        return None
    try:
        with open(doc_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
            if lines:
                last_line = lines[-1].strip()
                if last_line:
                    last_docs = json.loads(last_line)
                    if last_docs and len(last_docs) > 0:
                        return last_docs[0].get("metadata", {}).get("recollect_id")
    except Exception as e:
        print(f"문서 파일 읽기 오류 {doc_path}: {e}")
    return None


def parse_error_context(model: str, error_context: str, max_retries: int = 3) -> str:
    """문맥을 파싱하여 마크다운 형식으로 변환 (재시도 포함)"""
    prompts_dir = SCRIPT_DIR / "../prompts"
    parse_error_prompt = load_prompt(str(prompts_dir / "parse_error_context.yaml"))
    parse_error_chain = (
        parse_error_prompt | ChatOllama(model=model, temperature=0) | StrOutputParser()
    )
    # print(f"❌ error_context: {error_context}")
    error_context_result = error_context  # 초기값

    for attempt in range(max_retries):
        error_context_result = parse_error_chain.invoke(
            {"error_context": error_context}
        )

        if is_valid_context(error_context_result):
            # print(
            #     f"✅ parsed_context (시도 {attempt + 1}): {error_context_result}",
            #     end="\n\n",
            # )
            return error_context_result

        # print(f"  ⚠️ parse 재시도 {attempt + 1}/{max_retries}")

    # 3회 실패 시 마지막 결과 반환
    # print(f"❌ parse 최종 실패, 마지막 결과 사용")
    return error_context_result.strip()


def is_valid_context(text: str) -> bool:
    """문맥이 유효한지 확인 (마크다운 형식 포함 여부)"""
    # 마크다운 패턴 감지
    invalid_patterns = [
        r"^\s*[-*•]\s",  # 불릿포인트
        r"\*\*.*?\*\*",  # **bold**
        r"^#",  # 헤더
        r":\s*$",  # "상황 설명:" 같은 패턴
        r"^\d+\.\s",  # 숫자 리스트
    ]
    for pattern in invalid_patterns:
        if re.search(pattern, text, re.MULTILINE):
            return False
    return True


def check_ollama_connection(base_url: str, model: str) -> bool:
    """Ollama 서버 연결 및 모델 확인"""
    try:
        resp = requests.get(f"{base_url}/api/tags", timeout=5)
        if resp.status_code != 200:
            print(f"❌ Ollama 서버 응답 오류 ({base_url}): {resp.status_code}")
            return False

        models = resp.json().get("models", [])
        found = any(m.get("name") == model for m in models)
        if not found:
            print(
                f"⚠️ 경고: 모델 '{model}'을 목록에서 찾을 수 없습니다. (Pull 필요할 수 있음)"
            )

        print(f"✅ Ollama 연결 성공: {base_url}")
        return True

    except requests.exceptions.RequestException as e:
        print(f"❌ Ollama 연결 실패 ({base_url}): {e}")
        return False


def run_chain(
    model: str,
    base_url: str,
    title: str,
    full_transcript: str,
    chunk_transcript: str,
    prompt,
) -> str:
    """문맥 생성"""
    # LLM 설정 (base_url 지원)
    llm = ChatOllama(model=model, base_url=base_url, temperature=0, timeout=120)

    # chain 구성
    chain = prompt | llm | StrOutputParser()

    # 실행
    try:
        result = chain.invoke(
            {
                "title": title,
                "full_transcript": full_transcript,
                "chunk": chunk_transcript,
            }
        )
        return result.strip()
    except Exception as e:
        print(f"⚠️ LLM 호출 실패: {e}")
        return ""


def run_chain_with_retry(
    model: str,
    base_url: str,
    title: str,
    full_transcript: str,
    chunk: str,
    prompt,
    max_retries: int = 1,
    max_chars: int = 300,
) -> str:
    """재시도 로직이 포함된 문맥 생성"""
    result = ""
    for attempt in range(max_retries + 1):
        result = run_chain(model, base_url, title, full_transcript, chunk, prompt)

        if not result:
            continue

        # 유효성 검사
        if is_valid_context(result) and len(result) <= max_chars:
            return result

        if attempt < max_retries:
            time.sleep(1)

    # 마지막 시도 실패 시 parse_error_context 시도
    if result:
        result = parse_error_context(model, error_context=result).strip()
    return result


def save_documents_for_video(
    video_id: str, documents: list[Document], output_dir: str, recollect_id: int
):
    """
    video_id.jsonl에 문서 리스트를 한 줄로 추가 (append 모드)

    각 줄은 같은 recollect_id를 가진 Document 리스트
    """
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, f"{video_id}.jsonl")

    docs_data = [doc.model_dump() for doc in documents]

    with open(filepath, "a", encoding="utf-8") as f:
        f.write(json.dumps(docs_data, ensure_ascii=False) + "\n")

    print(
        f"✅ {len(documents)}개 문서 저장 완료: {filepath} (recollect_id={recollect_id})"
    )


def process_video(
    video_id: str,
    transcript_data: dict,
    metadata: dict,
    model: str,
    base_url: str,
    prompt,
    output_dir: str,
):
    """단일 비디오 처리"""
    transcript = transcript_data.get("transcript", [])
    recollect_id = transcript_data.get("recollect_id", 0)

    if not transcript:
        print(f"⚠️ 자막 없음: {video_id}")
        return

    full_transcript = "\n".join([str(seg.get("text", "") or "") for seg in transcript])
    title = metadata["title"]
    channel_name = metadata.get("channel_name", "tzuyang")  # 기본값 tzuyang
    video_duration = metadata.get("duration")  # 영상 전체 길이 (초)

    # 자막 구간별 청크에서 새로운 청크 생성 (video_duration 전달)
    new_chunks = create_chunks_with_overlap(transcript, video_duration=video_duration)

    documents = []

    # 문맥 생성
    for chunk in new_chunks:
        chunk_index = chunk["chunk_index"]
        chunk_transcript = chunk["content"]

        gen_context = run_chain_with_retry(
            model=model,
            base_url=base_url,
            title=title,
            full_transcript=full_transcript,
            chunk=chunk_transcript,
            prompt=prompt,
            max_retries=1,
            max_chars=300,
        )

        # [후처리] LLM 생성 문맥에서 이름 오타 수정
        if gen_context:
            gen_context = gen_context.replace("쯔위", "쯔양")
            gen_context = re.sub(r"tzuyu", "tzuyang", gen_context, flags=re.IGNORECASE)

        contextualized_chunk = f"문맥: {gen_context}\n\n{chunk_transcript}"
        # print(f"상황: {gen_context}\n")
        # print(f"자막: {chunk_transcript[:100]}...")
        # print("============================================\n")

        doc = Document(
            page_content=contextualized_chunk,
            metadata={
                "video_id": video_id,
                "title": title,
                "channel_name": channel_name,
                "duration": video_duration,
                "recollect_id": recollect_id,
                "chunk_index": chunk["chunk_index"],
                "char_count": chunk["char_count"],
                "prev_overlap": chunk["prev_overlap"],
                "next_overlap": chunk["next_overlap"],
                "start_time": chunk["start_time"],
                "end_time": chunk["end_time"],
            },
        )
        documents.append(doc)

    # 저장
    save_documents_for_video(video_id, documents, output_dir, recollect_id)


def main():
    parser = argparse.ArgumentParser(
        description="Generate context for YouTube transcripts (tzuyang only)"
    )
    parser.add_argument(
        "--model",
        type=str,
        default="cookieshake/a.x-4.0-light-imatrix:Q8_0",
        help="Ollama model name",
    )
    parser.add_argument(
        "--prompt", type=str, default="generate_context_en.yaml", help="Prompt filename"
    )
    parser.add_argument(
        "--max-videos", type=int, default=0, help="최대 처리 영상 수 (0: 제한 없음)"
    )
    parser.add_argument(
        "--check-connection-only", action="store_true", help="연결 확인 후 종료"
    )
    args = parser.parse_args()

    # 환경 변수에서 OLLAMA_HOST 가져오기 (없으면 기본값)
    ollama_host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")

    # 연결 확인
    if not check_ollama_connection(ollama_host, args.model):
        print("⛔ Ollama를 사용할 수 없어 스크립트를 종료합니다.")
        print("CI/CD 모드: Ollama 미발견으로 인해 작업을 건너뜁니다.")
        return

    if args.check_connection_only:
        return

    # tzuyang 전용 (다른 유튜버는 이 스크립트 사용 불가)
    YOUTUBER = "tzuyang"

    # 경로 설정
    data_dir = SCRIPT_DIR / f"../data/{YOUTUBER}"
    transcript_dir = data_dir / "transcript"
    meta_dir = data_dir / "meta"
    output_dir = data_dir / "transcript-document-with-context"
    prompts_dir = SCRIPT_DIR / "../prompts"

    # 프롬프트 로드
    prompt = load_prompt(str(prompts_dir / args.prompt), encoding="utf-8")

    # 트랜스크립트 파일 목록 (정렬하여 순서 보장 - 디버깅 용이)
    transcript_paths = sorted(glob.glob(str(transcript_dir / "*.jsonl")))

    print(f"📂 트랜스크립트 파일 {len(transcript_paths)}개 발견")
    print(f"🤖 모델: {args.model} (Host: {ollama_host})")
    print(f"📂 출력 경로: {output_dir}")
    if args.max_videos > 0:
        print(f"⏱️ 최대 처리 영상 수 제한: {args.max_videos}개")
    print("=" * 60)

    processed_count = 0
    skipped_count = 0
    error_count = 0

    # [Smart Filter] 처리 대상 영상 미리 선별
    print("🔍 [Smart Filter] 처리 대상을 선별 중입니다...", flush=True)
    pending_paths = []
    
    for data_path in tqdm(transcript_paths, desc="Scanning"):
        video_id = os.path.basename(data_path).split(".")[0]
        
        # 1. 트랜스크립트 데이터 확인
        t_data = read_jsonl(data_path)
        if not t_data:
            continue
        t_recollect_id = t_data.get("recollect_id", 0)

        # 2. 메타데이터 (Shorts 필터링)
        meta_path = meta_dir / f"{video_id}.jsonl"
        # 메타 없으면 -> 메인 루프에서 자동삭제 처리하므로 pending에 포함시켜야 함 (main 로직 유지)
        if not meta_path.exists():
            pending_paths.append(data_path)
            continue
            
        try:
            m_data = read_jsonl(str(meta_path))
            if m_data and m_data.get("is_shorts"):
                skipped_count += 1
                continue
        except:
             # 읽기 에러 시 메인 로직에 맡김
             pending_paths.append(data_path)
             continue

        # 3. 기존 문맥 확인 (Skip 여부)
        doc_path = output_dir / f"{video_id}.jsonl"
        existing_recollect_id = get_latest_doc_recollect_id(str(doc_path))
        
        if existing_recollect_id is not None:
            if t_recollect_id <= existing_recollect_id:
                skipped_count += 1
                continue # 이미 처리됨
                
        # 여기까지 오면 처리 대상
        pending_paths.append(data_path)

    print(f"✅ 스캔 완료: 총 {len(transcript_paths)}개 중 {len(pending_paths)}개 처리 예정 (이미 완료/Shorts: {len(transcript_paths) - len(pending_paths)}개)")
    print("=" * 60)

    print(f"🚀 총 {len(pending_paths)}개 영상 처리를 시작합니다.", flush=True)

    # pending_paths만 순회
    for idx, data_path in enumerate(tqdm(pending_paths, desc="Generating context")):
        # 최대 처리 수 제한 체크
        if args.max_videos > 0 and processed_count >= args.max_videos:
            print(f"🛑 최대 처리 한도({args.max_videos}개) 도달로 중단합니다.", flush=True)
            break
        
        # [CI-Log] 진행상황 강제 출력 (tqdm 버퍼링 문제 해결)
        print(f"[Progress] {idx + 1}/{len(transcript_paths)} videos processed... (Success: {processed_count}, Skipped: {skipped_count}, Error: {error_count})", flush=True)

        video_id = os.path.basename(data_path).split(".")[0]

        # 트랜스크립트 읽기
        transcript_data = read_jsonl(data_path)
        if not transcript_data:
            print(f"⚠️ 트랜스크립트 읽기 실패: {video_id}", flush=True)
            error_count += 1
            continue

        transcript_recollect_id = transcript_data.get("recollect_id", 0)

        # 기존 문서 확인 - recollect_id 비교
        doc_path = output_dir / f"{video_id}.jsonl"
        existing_recollect_id = get_latest_doc_recollect_id(str(doc_path))

        if existing_recollect_id is not None:
            if transcript_recollect_id <= existing_recollect_id:
                # 이미 처리됨 (조용히 스킵)
                skipped_count += 1
                continue
            else:
                print(
                    f"\n🔄 업데이트 {video_id}: 새 recollect_id ({transcript_recollect_id} > {existing_recollect_id})",
                    flush=True
                )

        # 메타데이터 읽기
        meta_path = meta_dir / f"{video_id}.jsonl"
        metadata = get_matching_metadata(str(meta_path), transcript_recollect_id)
        if not metadata:
            print(
                f"\n⚠️ 메타데이터 없음: {video_id} (id={transcript_recollect_id}) -> https://youtu.be/{video_id}",
                flush=True
            )

            # [Fix] 메타데이터가 없으면 트랜스크립트 파일 삭제 (재수집 유도)
            try:
                os.remove(data_path)
                print(
                    f"🗑️ [Auto-Correction] 고아 트랜스크립트 파일 삭제됨: {video_id} (재수집 대기)",
                    flush=True
                )
            except Exception as e:
                print(f"❌ 파일 삭제 실패: {e}", flush=True)

            error_count += 1
            continue

        # [Filter] Shorts 영상 필터링 (is_shorts=true면 스킵)
        if metadata.get("is_shorts"):
            skipped_count += 1
            continue

        # 처리
        try:
            process_video(
                video_id=video_id,
                transcript_data=transcript_data,
                metadata=metadata,
                model=args.model,
                base_url=ollama_host,
                prompt=prompt,
                output_dir=str(output_dir),
            )
            processed_count += 1
        except Exception as e:
            print(f"\n❌ 처리 중 치명적 오류 {video_id}: {e}", flush=True)
            error_count += 1

    print("\n" + "=" * 60, flush=True)
    print(
        f"✅ 완료: 처리 {processed_count} / 스킵 {skipped_count} / 에러 {error_count}",
        flush=True
    )
    print(
        f"ℹ️ 총 소요된 트랜스크립트 파일: {processed_count + skipped_count + error_count} / 전체 {len(transcript_paths)}",
        flush=True
    )


if __name__ == "__main__":
    main()
