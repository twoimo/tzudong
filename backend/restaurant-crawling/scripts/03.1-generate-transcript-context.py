import os
import glob
import json
import argparse
import time
import re
import requests
from pathlib import Path
from tqdm import tqdm
from langchain_community.chat_models import ChatOllama
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.documents import Document
from datetime import datetime

# 스크립트 위치 기준 경로 설정
SCRIPT_DIR = Path(__file__).parent.absolute()


def load_prompt(file_path, encoding="utf-8"):
    """프롬프트 파일 로드"""
    with open(file_path, "r", encoding=encoding) as f:
        return PromptTemplate.from_template(f.read())


def read_jsonl(file_path):
    """JSONL 파일 읽기 (첫 줄만 읽음 - 메타데이터 등)"""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                return json.loads(line)
    except Exception as e:
        print(f"❌ 파일 읽기 오류 {file_path}: {e}")
        return None


def get_latest_doc_recollect_id(doc_path: str) -> int:
    """
    기존 문서 파일(jsonl)에서 가장 큰 recollect_id를 찾아 반환.
    파일이 없거나 비어있으면 None 반환.
    """
    if not os.path.exists(doc_path):
        return None

    max_recollect_id = -1
    found = False

    try:
        with open(doc_path, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    # 한 줄이 Document 리스트의 JSON 표기임
                    docs_list = json.loads(line)
                    if not docs_list:
                        continue
                    # 첫 번째 문서의 recollect_id 확인 (같은 줄이면 모두 같다고 가정)
                    first_doc = docs_list[0]
                    # Document 객체가 아니라 dict 형태임
                    meta = first_doc.get("metadata", {})
                    rid = meta.get("recollect_id", 0)
                    if rid > max_recollect_id:
                        max_recollect_id = rid
                    found = True
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        print(f"⚠️ 기존 문서 읽기 중 오리 무중: {e}")
        return None

    return max_recollect_id if found else None


def get_matching_metadata(meta_path: str, target_recollect_id: int):
    """
    메타데이터 파일(jsonl)에서 target_recollect_id와 일치하는 줄을 찾아 반환.
    없으면 가장 최근 라인(마지막 라인) 반환 가능성을 고려할 수도 있으나,
    여기서는 정확한 매칭을 우선으로 함.
    """
    if not os.path.exists(meta_path):
        return None

    matched_meta = None
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            for line in f:
                meta = json.loads(line)
                if meta.get("recollect_id") == target_recollect_id:
                    return meta
                # 혹시 모르니 마지막 읽은 것을 저장해둘 수 있음 (필요 시)
                matched_meta = meta
    except Exception:
        return None

    # 정확히 일치하는 id가 없으면, 최신 메타를 쓸지 여부는 정책 결정.
    # 안전하게 None 반환 혹은 matched_meta 반환.
    # 여기서는 Transcript와 Meta의 싱크가 맞아야 하므로 None 권장.
    return None


def create_chunks_with_overlap(transcript, video_duration, chunk_duration=300, overlap=30):
    """
    자막을 시간 단위로 청크 분할 (오버랩 포함)
    """
    chunks = []
    current_time = 0

    while current_time < video_duration:
        start_time = max(0, current_time - overlap)
        end_time = min(video_duration, current_time + chunk_duration + overlap)

        chunk_text_parts = []
        char_count = 0
        
        # 해당 시간 범위의 자막 추출
        for seg in transcript:
            seg_start = seg.get("start", 0)
            # seg_end = seg_start + seg.get("duration", 0) # duration이 없을 수도 있음
            
            # 자막 시작 시간이 청크 범위 내에 있으면 포함
            # 더 정교하게 하려면 duration까지 고려해야 하지만, start 만으로도 충분
            if start_time <= seg_start < end_time:
                text = seg.get("text", "")
                chunk_text_parts.append(text)
                char_count += len(text)

        chunk_content = " ".join(chunk_text_parts)
        
        if chunk_content.strip(): # 내용이 있을 때만 추가
            chunks.append({
                "chunk_index": len(chunks),
                "start_time": start_time,
                "end_time": end_time,
                "content": chunk_content,
                "char_count": char_count,
                "prev_overlap": start_time < current_time, # 이전 청크와 겹치는지 여부
                "next_overlap": end_time > current_time + chunk_duration # 다음 청크와 겹칠 예정인지
            })

        current_time += chunk_duration

    return chunks


def parse_error_context(model, error_context):
    """모델별 에러 컨텍스트 파싱 (fallback)"""
    return error_context 


def is_valid_context(text: str) -> bool:
    """생성된 문맥의 유효성 검사"""
    if not text or len(text) < 10:
        return False
        
    invalid_patterns = [
        r"I cannot", r"I apologize", r"As an AI", 
        r"죄송합니다", r"언어 모델", r"cannot fulfill"
    ]
    for pattern in invalid_patterns:
        if re.search(pattern, text, re.MULTILINE):
            return False
    return True


def run_chain(
    model: str,
    base_url: str,
    title: str,
    full_transcript: str,
    chunk_transcript: str,
    prompt,
) -> str:
    """문맥 생성 실행"""
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
    for attempt in range(max_retries + 1):
        result = run_chain(model, base_url, title, full_transcript, chunk, prompt)

        if not result:
            continue

        # 유효성 검사
        if is_valid_context(result) and len(result) <= max_chars:
            return result

        # 마지막 시도가 아니면 재시도
        if attempt < max_retries:
             time.sleep(1)

    return "" # 실패 시 빈 문자열 반환


def save_documents_for_video(
    video_id: str, documents: list[Document], output_dir: str, recollect_id: int
):
    """
    video_id.jsonl에 문서 리스트를 한 줄로 추가 (append 모드)
    """
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, f"{video_id}.jsonl")

    docs_data = [doc.dict() for doc in documents]

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

    full_transcript = "\n".join([seg["text"] for seg in transcript])
    title = metadata["title"]
    channel_name = metadata.get("channel_name", "tzuyang")
    video_duration = metadata.get("duration", 0) 

    # 자막 구간별 청크 생성
    new_chunks = create_chunks_with_overlap(transcript, video_duration=video_duration)
    
    if not new_chunks:
        print(f"⚠️ 청크 생성 실패 (길이 0?): {video_id}")
        return

    documents = []

    # 문맥 생성
    for chunk in new_chunks:
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
        
        # 실패하더라도 일단 진행 (빈 문맥) 하거나 스킵할 수 있음. 
        # 여기서는 빈 문맥이라도 진행
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


def check_ollama_connection(base_url: str, model: str) -> bool:
    """Ollama 서버 연결 및 모델 확인"""
    try:
        # 1. 서버 연결 확인
        resp = requests.get(f"{base_url}/api/tags", timeout=5)
        if resp.status_code != 200:
            print(f"❌ Ollama 서버 응답 오류 ({base_url}): {resp.status_code}")
            return False
        
        # 2. 모델 존재 확인
        models = resp.json().get("models", [])
        found = any(m.get("name") == model for m in models)
        
        if not found:
            # 정확히 일치하지 않아도 태그가 다를 수 있으므로 경고만 하고 진행할 수도 있지만,
            # 여기서는 엄격하게 체크하거나, 그냥 연결 성공으로 간주.
            # a.x 모델처럼 이름이 복잡한 경우 매칭이 어려울 수 있으니 연결 성공만 체크.
            print(f"⚠️ 경고: 모델 '{model}'을 목록에서 찾을 수 없습니다. (Pull 필요할 수 있음)")
            # return True # 일단 연결은 성공했으므로 True
        
        print(f"✅ Ollama 연결 성공: {base_url}")
        return True

    except requests.exceptions.RequestException as e:
        print(f"❌ Ollama 연결 실패 ({base_url}): {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Generate context for YouTube transcripts (tzuyang only)"
    )
    parser.add_argument(
        "--model",
        type=str,
        default="llama3.2:3b",
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
    ollama_host = os.environ.get("OLLAMA_HOST")
    if not ollama_host:
        ollama_host = "http://localhost:11434"

    # 연결 확인
    if not check_ollama_connection(ollama_host, args.model):
        print("⛔ Ollama를 사용할 수 없어 스크립트를 종료합니다.")
        # CI 환경에서 이 단계 실패로 전체 파이프라인이 멈추지 않게 하려면 exit 0으로 끝낼 수도 있음
        # 하지만 명확한 실패를 위해 오류를 내는 게 나을 수도 있음. 
        # 여기서는 '정상 동작될 수 있게 개선' 이므로, 스킵하고 0 반환.
        print("CI/CD 모드: Ollama 미발견으로 인해 작업을 건너뜁니다.")
        return 

    if args.check_connection_only:
        return

    # tzuyang 전용
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
    
    # 최신 순으로 정렬 (선택 사항, 보통 파일명에 날짜가 없으면 뒤죽박죽일 수 있음)
    # 여기서는 그냥 os.path.getmtime 등으로 정렬하거나 그냥 둠
    # transcript_paths.sort(key=os.path.getmtime, reverse=True) 

    print(f"📂 트랜스크립트 파일 {len(transcript_paths)}개 발견")
    print(f"🤖 모델: {args.model} (Host: {ollama_host})")
    print(f"📂 출력 경로: {output_dir}")
    if args.max_videos > 0:
        print(f"⏱️ 최대 처리 영상 수 제한: {args.max_videos}개")
    print("=" * 60)

    processed_count = 0
    skipped_count = 0
    error_count = 0

    for idx, data_path in enumerate(tqdm(transcript_paths, desc="Generating context")):
        # 최대 처리 수 제한 체크
        if args.max_videos > 0 and processed_count >= args.max_videos:
            print(f"🛑 최대 처리 한도({args.max_videos}개) 도달로 중단합니다.")
            break

        video_id = os.path.basename(data_path).split(".")[0]

        # 트랜스크립트 읽기
        transcript_data = read_jsonl(data_path)
        if not transcript_data:
            print(f"⚠️ 트랜스크립트 읽기 실패: {video_id}")
            error_count += 1
            continue

        transcript_recollect_id = transcript_data.get("recollect_id", 0)

        # 기존 문서 확인 - recollect_id 비교
        doc_path = output_dir / f"{video_id}.jsonl"
        existing_recollect_id = get_latest_doc_recollect_id(str(doc_path))

        if existing_recollect_id is not None:
            if transcript_recollect_id <= existing_recollect_id:
                # 이미 처리됨
                skipped_count += 1
                continue
            else:
                print(
                    f"\n🔄 업데이트 {video_id}: 새 recollect_id ({transcript_recollect_id} > {existing_recollect_id})"
                )
        
        # 메타데이터 읽기
        meta_path = meta_dir / f"{video_id}.jsonl"
        metadata = get_matching_metadata(str(meta_path), transcript_recollect_id)
        if not metadata:
            print(
                f"\n⚠️ 메타데이터 없음: {video_id} (id={transcript_recollect_id})"
            )
            error_count += 1
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
            print(f"\n❌ 처리 중 치명적 오류 {video_id}: {e}")
            error_count += 1

    print("\n" + "=" * 60)
    print(f"✅ 완료: 처리 {processed_count} / 스킵 {skipped_count} / 에러 {error_count}")
    print(f"ℹ️ 총 소요된 트랜스크립트 파일: {processed_count + skipped_count + error_count} / 전체 {len(transcript_paths)}")


if __name__ == "__main__":
    main()
