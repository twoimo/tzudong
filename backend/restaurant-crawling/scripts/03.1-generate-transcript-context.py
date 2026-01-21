#!/usr/bin/env python3
"""
YouTube 자막 문맥 생성 스크립트

transcript/{video_id}.jsonl 파일들을 읽어서 문맥을 생성하고,
transcript-document-with-context/{video_id}.jsonl로 저장합니다.

저장 형식:
- 한 줄에 recollect_id별 Document 리스트 (JSONL append 방식)
- 기존 문서가 있으면 recollect_id가 더 높은 경우에만 추가

사용법:
    python 03.5-generate-transcript-context.py --youtuber tzuyang
    python 03.5-generate-transcript-context.py --youtuber tzuyang --model llama3
"""

import json
import time
import os
import re
import glob
import argparse
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
        print(f"Error reading {data_path}: {e}")
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
        print(f"Error reading metadata {meta_path}: {e}")
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
        print(f"Error reading doc file {doc_path}: {e}")
    return None


def parse_error_context(model: str, error_context: str, max_retries: int = 3) -> str:
    """문맥을 파싱하여 마크다운 형식으로 변환 (재시도 포함)"""
    prompts_dir = SCRIPT_DIR / "../prompts"
    parse_error_prompt = load_prompt(str(prompts_dir / "parse_error_context.yaml"))
    parse_error_chain = (
        parse_error_prompt | ChatOllama(model=model, temperature=0) | StrOutputParser()
    )
    print(f"❌ error_context: {error_context}")
    error_context_result = error_context  # 초기값

    for attempt in range(max_retries):
        error_context_result = parse_error_chain.invoke(
            {"error_context": error_context}
        )

        if is_valid_context(error_context_result):
            print(
                f"✅ parsed_context (시도 {attempt + 1}): {error_context_result}",
                end="\n\n",
            )
            return error_context_result

        print(f"  ⚠️ parse 재시도 {attempt + 1}/{max_retries}")

    # 3회 실패 시 마지막 결과 반환
    print(f"❌ parse 최종 실패, 마지막 결과 사용")
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


def run_chain(
    model: str,
    title: str,
    full_transcript: str,
    chunk_transcript: str,
    prompt,
) -> str:
    """문맥 생성"""
    # LLM 설정
    llm = ChatOllama(model=model, temperature=0)

    # chain 구성
    chain = prompt | llm | StrOutputParser()

    # 실행
    result = chain.invoke(
        {
            "title": title,
            "full_transcript": full_transcript,
            "chunk": chunk_transcript,  # 프롬프트 변수명과 일치시킴
        }
    )

    return result.strip()


def run_chain_with_retry(
    model: str,
    title: str,
    full_transcript: str,
    chunk: str,
    prompt,
    max_retries: int = 1,
    max_chars: int = 300,
) -> str:
    """재시도 로직이 포함된 문맥 생성"""
    for attempt in range(max_retries):
        result = run_chain(model, title, full_transcript, chunk, prompt)

        # 유효성 검사
        if is_valid_context(result) and len(result) <= max_chars:
            return result

        print(f"  재시도 {attempt + 1}/{max_retries}: 형식 오류 또는 길이 초과")

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

    docs_data = [doc.dict() for doc in documents]

    with open(filepath, "a", encoding="utf-8") as f:
        f.write(json.dumps(docs_data, ensure_ascii=False) + "\n")

    print(
        f"✅ Saved {len(documents)} documents to {filepath} (recollect_id={recollect_id})"
    )


def process_video(
    video_id: str,
    transcript_data: dict,
    metadata: dict,
    model: str,
    prompt,
    output_dir: str,
):
    """단일 비디오 처리"""
    transcript = transcript_data.get("transcript", [])
    recollect_id = transcript_data.get("recollect_id", 0)

    if not transcript:
        print(f"⚠️ No transcript for {video_id}")
        return

    full_transcript = "\n".join([seg["text"] for seg in transcript])
    title = metadata["title"]
    channel_name = metadata["channel_name"]
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
            title=title,
            full_transcript=full_transcript,
            chunk=chunk_transcript,
            prompt=prompt,
            max_retries=1,
            max_chars=300,
        )

        contextualized_chunk = f"문맥: {gen_context}\n\n{chunk_transcript}"
        print(f"상황: {gen_context}\n")
        print(f"자막: {chunk_transcript[:100]}...")
        print("============================================\n")

        doc = Document(
            page_content=contextualized_chunk,
            metadata={
                "video_id": video_id,
                "title": title,
                "channel_name": channel_name,
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
        "--rest-interval", type=int, default=5, help="Number of videos before rest"
    )
    parser.add_argument(
        "--rest-seconds", type=int, default=150, help="Rest duration in seconds"
    )
    args = parser.parse_args()

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

    # 트랜스크립트 파일 목록
    transcript_paths = glob.glob(str(transcript_dir / "*.jsonl"))

    print(f"Found {len(transcript_paths)} transcript files")
    print(f"Model: {args.model}")
    print(f"Output: {output_dir}")
    print("=" * 60)

    processed_count = 0
    skipped_count = 0

    for idx, data_path in enumerate(tqdm(transcript_paths, desc="Generating context")):
        # 주기적 휴식
        if processed_count > 0 and processed_count % args.rest_interval == 0:
            print(f"🕐 {processed_count}개 영상 완료, {args.rest_seconds}초 휴식...")
            time.sleep(args.rest_seconds)

        video_id = os.path.basename(data_path).split(".")[0]

        # 트랜스크립트 읽기
        transcript_data = read_jsonl(data_path)
        if not transcript_data:
            print(f"⚠️ Failed to read transcript: {video_id}")
            continue

        transcript_recollect_id = transcript_data.get("recollect_id", 0)

        # 기존 문서 확인 - recollect_id 비교
        doc_path = output_dir / f"{video_id}.jsonl"
        existing_recollect_id = get_latest_doc_recollect_id(str(doc_path))

        if existing_recollect_id is not None:
            if transcript_recollect_id <= existing_recollect_id:
                print(
                    f"⏭️ Skipping {video_id}: already processed (transcript recollect_id={transcript_recollect_id} <= doc recollect_id={existing_recollect_id})"
                )
                skipped_count += 1
                continue
            else:
                print(
                    f"🔄 Updating {video_id}: new recollect_id available ({transcript_recollect_id} > {existing_recollect_id})"
                )

        # 메타데이터 읽기
        meta_path = meta_dir / f"{video_id}.jsonl"
        metadata = get_matching_metadata(str(meta_path), transcript_recollect_id)
        if not metadata:
            print(
                f"⚠️ No matching metadata for {video_id} (recollect_id={transcript_recollect_id})"
            )
            continue

        # 처리
        process_video(
            video_id=video_id,
            transcript_data=transcript_data,
            metadata=metadata,
            model=args.model,
            prompt=prompt,
            output_dir=str(output_dir),
        )
        processed_count += 1

    print("\n" + "=" * 60)
    print(f"✅ Completed: {processed_count} videos processed, {skipped_count} skipped")


if __name__ == "__main__":
    main()
