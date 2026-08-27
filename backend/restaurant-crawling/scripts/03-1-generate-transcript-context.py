#!/usr/bin/env python3
"""
YouTube 자막 문맥 생성 스크립트

transcript/{video_id}.jsonl 파일들을 읽어서 문맥을 생성하고,
transcript-document-with-context/{video_id}.jsonl로 저장합니다.

저장 형식:
- 한 줄에 recollect_id별 Document 리스트 (JSONL append 방식)
- 기존 문서가 있으면 recollect_id가 더 높은 경우에만 추가

사용법:
    python 03-1-generate-transcript-context.py
    python 03-1-generate-transcript-context.py --model Qwen3.6-35B-A3B-4bit
    TRANSCRIPT_CONTEXT_BACKEND=openai TRANSCRIPT_CONTEXT_BASE_URL=http://127.0.0.1:8080/v1 \\
        python 03-1-generate-transcript-context.py --check-connection-only
"""

import json
import time
import os
import re
import glob
import argparse
import concurrent.futures
import requests
from tqdm import tqdm
import sys
from pathlib import Path
from langchain_core.output_parsers import StrOutputParser
from langchain_core.documents import Document
from langchain_core.prompts import load_prompt
from langchain_ollama import ChatOllama

# Shared backend utilities must be imported through the repository root to
# avoid colliding with restaurant-crawling/src/utils.
SCRIPT_DIR = Path(__file__).parent.resolve()
BACKEND_ROOT = SCRIPT_DIR.parents[1]
REPO_ROOT = BACKEND_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.utils.privacy_log import safe_error_name

SRC_PATH = (SCRIPT_DIR / "../src").resolve()
if str(SRC_PATH) not in sys.path:
    sys.path.insert(0, str(SRC_PATH))

from utils.chunk_utils import create_chunks_with_overlap

DEFAULT_OLLAMA_MODEL = "cookieshake/a.x-4.0-light-imatrix:Q8_0"
DEFAULT_OMLX_MODEL = "Qwen3.6-35B-A3B-4bit"
DEFAULT_OMLX_BASE_URL = "http://127.0.0.1:8080/v1"
DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"
OPENAI_COMPATIBLE_BACKENDS = {"openai", "omlx"}


def read_jsonl(data_path: str) -> dict | None:
    """JSONL 파일에서 가장 마지막(최신) 라인 읽기"""
    try:
        with open(data_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
            if lines:
                return json.loads(lines[-1])
    except Exception as error:
        print(f"op=transcript_jsonl_read_failed error={safe_error_name(error)}")
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
    except Exception as error:
        print(f"op=metadata_jsonl_read_failed error={safe_error_name(error)}")
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
                    if isinstance(last_docs, dict):
                        metadata = last_docs.get("metadata")
                        if not isinstance(metadata, dict):
                            metadata = {}
                        rec = metadata.get("recollect_id", last_docs.get("recollect_id"))
                        return rec
                    if last_docs and len(last_docs) > 0:
                        first = last_docs[0]
                        if isinstance(first, dict):
                            metadata = first.get("metadata")
                            if not isinstance(metadata, dict):
                                metadata = {}
                            return metadata.get("recollect_id", first.get("recollect_id"))
    except Exception as error:
        print(f"op=document_jsonl_read_failed error={safe_error_name(error)}")
    return None


def resolve_transcript_context_backend() -> str:
    raw = (os.environ.get("TRANSCRIPT_CONTEXT_BACKEND") or "").strip().lower()
    if raw in OPENAI_COMPATIBLE_BACKENDS or raw == "ollama":
        return raw
    if (os.environ.get("TRANSCRIPT_CONTEXT_BASE_URL") or "").strip():
        return "openai"
    return "openai"


def resolve_transcript_context_base_url(backend: str) -> str:
    explicit = (os.environ.get("TRANSCRIPT_CONTEXT_BASE_URL") or "").strip().rstrip("/")
    if explicit:
        return explicit
    if backend in OPENAI_COMPATIBLE_BACKENDS:
        return DEFAULT_OMLX_BASE_URL
    return (os.environ.get("OLLAMA_HOST") or DEFAULT_OLLAMA_BASE_URL).rstrip("/")


def resolve_transcript_context_model(backend: str, requested: str | None) -> str:
    if requested and requested.strip():
        return requested.strip()
    env_model = (os.environ.get("TRANSCRIPT_CONTEXT_MODEL") or "").strip()
    if env_model:
        return env_model
    if backend in OPENAI_COMPATIBLE_BACKENDS:
        return DEFAULT_OMLX_MODEL
    return DEFAULT_OLLAMA_MODEL


def openai_compatible_root(base_url: str) -> str:
    return base_url[:-3] if base_url.endswith("/v1") else base_url


def ollama_num_ctx() -> int | None:
    raw = (os.environ.get("OLLAMA_NUM_CTX") or os.environ.get("OLLAMA_CONTEXT_LENGTH") or "").strip()
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return None


def ollama_num_predict() -> int:
    raw = (os.environ.get("OLLAMA_NUM_PREDICT") or "").strip()
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return 128


def build_context_llm(backend: str, model: str, base_url: str):
    if backend in OPENAI_COMPATIBLE_BACKENDS:
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=model,
            base_url=base_url,
            api_key=os.environ.get("TRANSCRIPT_CONTEXT_API_KEY") or "omlx",
            temperature=0,
            timeout=120,
        )
    kwargs = {
        "model": model,
        "base_url": base_url,
        "temperature": 0,
        "timeout": 120,
    }
    num_ctx = ollama_num_ctx()
    if num_ctx is not None:
        kwargs["num_ctx"] = num_ctx
    kwargs["num_predict"] = ollama_num_predict()
    return ChatOllama(**kwargs)


def parse_error_context(
    model: str,
    error_context: str,
    max_retries: int = 3,
    *,
    backend: str,
    base_url: str,
) -> str:
    """문맥을 파싱하여 마크다운 형식으로 변환 (재시도 포함)"""
    prompts_dir = SCRIPT_DIR / "../prompts"
    parse_error_prompt = load_prompt(str(prompts_dir / "parse_error_context.yaml"))
    parse_error_chain = (
        parse_error_prompt | build_context_llm(backend, model, base_url) | StrOutputParser()
    )
    error_context_result = error_context

    for _attempt in range(max_retries):
        error_context_result = parse_error_chain.invoke(
            {"error_context": error_context}
        )

        if is_valid_context(error_context_result):
            return error_context_result

    return error_context_result.strip()


def is_valid_context(text: str) -> bool:
    """문맥이 유효한지 확인 (마크다운 형식 포함 여부)"""
    invalid_patterns = [
        r"^\s*[-*•]\s",
        r"\*\*.*?\*\*",
        r"^#",
        r":\s*$",
        r"^\d+\.\s",
    ]
    for pattern in invalid_patterns:
        if re.search(pattern, text, re.MULTILINE):
            return False
    return True


def check_openai_compatible_connection(base_url: str, model: str) -> bool:
    try:
        resp = requests.get(f"{openai_compatible_root(base_url)}/v1/models", timeout=5)
        if resp.status_code != 200:
            print("op=openai_connection_http_failed")
            return False

        models = resp.json().get("data", [])
        found = any(m.get("id") == model for m in models)
        if not found:
            print("op=openai_model_unavailable")
            return False

        print("op=openai_connection_succeeded")
        return True
    except requests.exceptions.RequestException as error:
        print(f"op=openai_connection_failed error={safe_error_name(error)}")
        return False


def check_ollama_connection(base_url: str, model: str) -> bool:
    """Ollama 서버 연결 및 모델 확인"""
    try:
        resp = requests.get(f"{base_url}/api/tags", timeout=5)
        if resp.status_code != 200:
            print("op=ollama_connection_http_failed")
            return False

        models = resp.json().get("models", [])
        found = any(m.get("name") == model for m in models)
        if not found:
            print("op=ollama_model_unavailable")
            return False

        print("op=ollama_connection_succeeded")
        return True
    except requests.exceptions.RequestException as error:
        print(f"op=ollama_connection_failed error={safe_error_name(error)}")
        return False


def check_context_backend_connection(backend: str, base_url: str, model: str) -> bool:
    if backend in OPENAI_COMPATIBLE_BACKENDS:
        return check_openai_compatible_connection(base_url, model)
    return check_ollama_connection(base_url, model)


def run_chain(
    model: str,
    base_url: str,
    title: str,
    full_transcript: str,
    chunk_transcript: str,
    prompt,
    *,
    backend: str,
) -> str:
    """문맥 생성"""
    llm = build_context_llm(backend, model, base_url)

    # chain 구성
    chain = prompt | llm | StrOutputParser()

    # 실행
    timeout_raw = (os.environ.get("OLLAMA_INVOKE_TIMEOUT") or "").strip()
    timeout_s = float(timeout_raw) if timeout_raw.replace(".", "", 1).isdigit() else 45.0
    bounded = bool((os.environ.get("TRANSCRIPT_CONTEXT_MAX_CHUNKS") or "").strip())
    prompt_full = full_transcript[:1200] if bounded else full_transcript
    prompt_chunk = chunk_transcript[:1200] if bounded else chunk_transcript

    def _invoke() -> str:
        result = chain.invoke(
            {
                "title": title,
                "full_transcript": prompt_full,
                "chunk": prompt_chunk,
            }
        )
        return result.strip()

    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        future = pool.submit(_invoke)
        return future.result(timeout=timeout_s)
    except concurrent.futures.TimeoutError:
        print("op=llm_context_generation_timeout", flush=True)
        return ""
    except Exception as error:
        print(f"op=llm_context_generation_failed error={safe_error_name(error)}")
        return ""
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def run_chain_with_retry(
    model: str,
    base_url: str,
    title: str,
    full_transcript: str,
    chunk: str,
    prompt,
    max_retries: int = 1,
    max_chars: int = 300,
    *,
    backend: str,
) -> str:
    """재시도 로직이 포함된 문맥 생성"""
    result = ""
    for attempt in range(max_retries + 1):
        result = run_chain(
            model,
            base_url,
            title,
            full_transcript,
            chunk,
            prompt,
            backend=backend,
        )

        if not result:
            continue

        if is_valid_context(result) and len(result) <= max_chars:
            return result

        if attempt < max_retries:
            time.sleep(1)

    if result:
        result = parse_error_context(
            model,
            error_context=result,
            backend=backend,
            base_url=base_url,
        ).strip()
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

    print(f"op=transcript_context_saved documents={len(documents)}")


def process_video(
    video_id: str,
    transcript_data: dict,
    metadata: dict,
    model: str,
    base_url: str,
    prompt,
    output_dir: str,
    *,
    backend: str,
):
    """단일 비디오 처리"""
    transcript = transcript_data.get("transcript", [])
    recollect_id = transcript_data.get("recollect_id", 0)

    if not transcript:
        print("op=transcript_missing")
        return

    full_transcript = "\n".join([str(seg.get("text", "") or "") for seg in transcript])
    title = metadata["title"]
    channel_name = metadata.get("channel_name", "tzuyang")  # 기본값 tzuyang
    video_duration = metadata.get("duration")  # 영상 전체 길이 (초)

    # 자막 구간별 청크에서 새로운 청크 생성 (video_duration 전달)
    new_chunks = create_chunks_with_overlap(transcript, video_duration=video_duration)

    documents = []
    max_chunks_raw = (os.environ.get("TRANSCRIPT_CONTEXT_MAX_CHUNKS") or "").strip()
    max_chunks = int(max_chunks_raw) if max_chunks_raw.isdigit() and int(max_chunks_raw) > 0 else 0

    # 문맥 생성
    for chunk in new_chunks:
        if max_chunks > 0 and len(documents) >= max_chunks:
            print(f"op=transcript_context_chunk_limit max_chunks={max_chunks}", flush=True)
            break
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
            backend=backend,
        )

        # [후처리] LLM 생성 문맥에서 이름 오타 수정
        if gen_context:
            gen_context = gen_context.replace("쯔위", "쯔양")
            gen_context = re.sub(r"tzuyu", "tzuyang", gen_context, flags=re.IGNORECASE)

        contextualized_chunk = f"문맥: {gen_context}\n\n{chunk_transcript}"

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


def main() -> int:
    parser = argparse.ArgumentParser(
        description="YouTube 자막 문맥 생성 스크립트 (tzuyang 전용)"
    )
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="로컬 문맥 생성 모델 ID. 기본값은 TRANSCRIPT_CONTEXT_MODEL 또는 백엔드 기본 모델.",
    )
    parser.add_argument(
        "--video-id",
        type=str,
        default="",
        help="쉼표 구분 비디오 ID 화이트리스트. 지정 시 해당 영상만 처리 대상에 남긴다.",
    )
    parser.add_argument(
        "--prompt", type=str, default="generate_context_en.yaml", help="프롬프트 파일명"
    )
    parser.add_argument(
        "--max-videos", type=int, default=0, help="최대 처리 영상 수 (0: 제한 없음)"
    )
    parser.add_argument(
        "--max-duration", type=int, default=2400, help="최대 처리 영상 길이(초). 이보다 긴 영상은 스킵 (기본: 2400초/40분)"
    )
    parser.add_argument(
        "--check-connection-only", action="store_true", help="연결 확인 후 종료"
    )
    args = parser.parse_args()
    if args.max_videos > 0 and not (os.environ.get("TRANSCRIPT_CONTEXT_MAX_CHUNKS") or "").strip():
        os.environ["TRANSCRIPT_CONTEXT_MAX_CHUNKS"] = "1"

    backend = resolve_transcript_context_backend()
    base_url = resolve_transcript_context_base_url(backend)
    model = resolve_transcript_context_model(backend, args.model)
    print(f"op=transcript_context_backend backend={backend} model={model}")

    if args.check_connection_only:
        if not check_context_backend_connection(backend, base_url, model):
            print("op=transcript_context_backend_unavailable")
            return 1
        return 0

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
    requested_ids = {
        video_id.strip()
        for video_id in args.video_id.split(",")
        if video_id.strip()
    }
    if requested_ids:
        transcript_paths = [
            data_path
            for data_path in transcript_paths
            if os.path.basename(data_path).rsplit(".", 1)[0] in requested_ids
        ]
        print(f"op=transcript_context_video_filter ids={len(requested_ids)}")

    print(f"op=transcript_context_scan files={len(transcript_paths)}")
    if args.max_videos > 0:
        print(f"op=transcript_context_limit max_videos={args.max_videos}")

    processed_count = 0
    skipped_count = 0
    error_count = 0

    # [Smart Filter] 처리 대상 영상 미리 선별
    print("op=transcript_context_filter_started", flush=True)
    pending_paths = []
    
    # 0. 삭제된 영상 목록 로드 (deleted_urls.txt) - 1번 스크립트 연동
    deleted_ids = set()
    deleted_urls_path = data_dir / "deleted_urls.txt"
    if deleted_urls_path.exists():
        try:
            with open(deleted_urls_path, "r", encoding="utf-8") as f:
                for line in f:
                    parts = line.strip().split('\t')
                    if parts and parts[0]:
                        vid = parts[0].split("v=")[-1]  # Extract ID from URL
                        deleted_ids.add(vid)
            print(f"op=deleted_video_list_loaded count={len(deleted_ids)}")
        except Exception as error:
            print(f"op=deleted_video_list_load_failed error={safe_error_name(error)}")

    for data_path in tqdm(transcript_paths, desc="Scanning"):
        video_id = os.path.basename(data_path).split(".")[0]
        
        # 0.1 삭제된 영상 필터링
        if video_id in deleted_ids:
            skipped_count += 1
            continue

        # 1. 트랜스크립트 데이터 확인
        t_data = read_jsonl(data_path)
        if not t_data:
            continue
        t_recollect_id = t_data.get("recollect_id", 0)

        # 2. 메타데이터 (Shorts 및 비공개 필터링)
        meta_path = meta_dir / f"{video_id}.jsonl"
        
        # [Mod] 메타데이터 없으면 스킵 (메타데이터 누락 파일)
        if not meta_path.exists():
            # 메타데이터가 없다는 건, 수집 단계에서 걸러졌거나 식별되지 않은 파일
            # 실행 목록에 추가하지 않음
            continue
            
        try:
            m_data = read_jsonl(str(meta_path))
            if m_data:
                title = m_data.get("title", "")
                
                # 2.1 Shorts 필터링
                if m_data.get("is_shorts"):
                    skipped_count += 1
                    continue
                
                # 2.2 비공개 영상 필터링 (제목 예: "Private video", "비공개 동영상")
                if "비공개" in title or "Private" in title:
                    skipped_count += 1
                    continue

                # 2.3 듀레이션 필터링
                m_duration = m_data.get("duration", 0)
                if args.max_duration > 0 and m_duration > args.max_duration:
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

    print(
        f"op=transcript_context_scan_complete total={len(transcript_paths)} "
        f"pending={len(pending_paths)} skipped={len(transcript_paths) - len(pending_paths)}"
    )

    if args.max_videos > 0:
        pending_paths = pending_paths[: args.max_videos]
        print(
            f"op=transcript_context_pending_capped max_videos={args.max_videos} "
            f"pending={len(pending_paths)}",
            flush=True,
        )

    if not pending_paths:
        print(
            f"op=transcript_context_complete processed=0 skipped={skipped_count} "
            f"errors=0 total={len(transcript_paths)}",
            flush=True,
        )
        return 0

    if not check_context_backend_connection(backend, base_url, model):
        print("op=transcript_context_backend_unavailable")
        return 1

    print(f"op=transcript_context_start pending={len(pending_paths)}", flush=True)

    # pending_paths만 순회
    # [Improve] tqdm 객체 사용하여 동적 설명 업데이트
    pbar = tqdm(pending_paths, desc="Generating context")
    for idx, data_path in enumerate(pbar):
        video_id = os.path.basename(data_path).split(".")[0]
        pbar.set_description("Generating context")
        # 최대 처리 수 제한 체크
        if args.max_videos > 0 and processed_count >= args.max_videos:
            print(f"op=transcript_context_limit_reached max_videos={args.max_videos}", flush=True)
            break
        
        # [CI-Log] 진행상황 강제 출력 (tqdm 버퍼링 문제 해결)
        print(
            f"op=transcript_context_progress current={idx + 1} total={len(pending_paths)} "
            f"processed={processed_count} skipped={skipped_count} errors={error_count}",
            flush=True,
        )

        video_id = os.path.basename(data_path).split(".")[0]

        # 트랜스크립트 읽기
        transcript_data = read_jsonl(data_path)
        if not transcript_data:
            print("op=transcript_read_failed", flush=True)
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
                print("op=transcript_context_update", flush=True)

        # 메타데이터 읽기
        meta_path = meta_dir / f"{video_id}.jsonl"
        metadata = get_matching_metadata(str(meta_path), transcript_recollect_id)
        if not metadata:
            print("op=metadata_missing", flush=True)

            # [Fix] 메타데이터가 없으면 트랜스크립트 파일 삭제 (재수집 유도)
            try:
                os.remove(data_path)
                print("op=orphan_transcript_removed", flush=True)
            except Exception as error:
                print(
                    f"op=orphan_transcript_remove_failed error={safe_error_name(error)}",
                    flush=True,
                )

            error_count += 1
            continue

        # [Filter] Shorts 영상 필터링
        if metadata.get("is_shorts"):
            skipped_count += 1
            continue

        # [Filter] 듀레이션 필터링
        m_duration = metadata.get("duration", 0)
        if args.max_duration > 0 and m_duration > args.max_duration:
            print("op=video_duration_limit_exceeded", flush=True)
            skipped_count += 1
            continue

        # 문맥 생성 처리
        try:
            process_video(
                video_id=video_id,
                transcript_data=transcript_data,
                metadata=metadata,
                model=model,
                base_url=base_url,
                prompt=prompt,
                output_dir=str(output_dir),
                backend=backend,
            )
            processed_count += 1
        except Exception as error:
            print(
                f"op=transcript_context_processing_failed error={safe_error_name(error)}",
                flush=True,
            )
            error_count += 1

    print(
        f"op=transcript_context_complete processed={processed_count} "
        f"skipped={skipped_count} errors={error_count} total={len(transcript_paths)}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"op=transcript_context_failed error={safe_error_name(error)}", file=sys.stderr)
        sys.exit(1)
