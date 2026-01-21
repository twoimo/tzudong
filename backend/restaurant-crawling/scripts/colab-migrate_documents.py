#!/usr/bin/env python3
"""
기존 documents.jsonl을 video_id별 JSONL 파일로 마이그레이션하는 스크립트

입력: documents.jsonl (한 줄에 Document 하나)
    {"id": null, "metadata": {"video_id": "-1OU4tkFJns", "recollect_id": 0, ...}, "page_content": "..."}
    {"id": null, "metadata": {"video_id": "-1OU4tkFJns", "recollect_id": 0, ...}, "page_content": "..."}
    {"id": null, "metadata": {"video_id": "ABC123", "recollect_id": 0, ...}, "page_content": "..."}

출력: {video_id}.jsonl (한 줄에 recollect_id별 Document 리스트)
    # -1OU4tkFJns.jsonl
    [{"id": null, "metadata": {..., "recollect_id": 0}, ...}, {"id": null, ...}]

사용법:
    python migrate_documents.py --input documents.jsonl --output-dir ./transcript-document-with-context
    python migrate_documents.py --input /path/to/documents.jsonl --youtuber tzuyang
"""

import json
import os
import argparse
from collections import defaultdict
from pathlib import Path


def migrate_documents(input_path: str, output_dir: str):
    """
    documents.jsonl을 video_id별로 분리하여 저장

    - 같은 video_id + recollect_id를 가진 문서들을 그룹화
    - 각 그룹을 한 줄로 저장 (JSONL 형식)
    """
    # 1. 모든 문서 읽기
    documents = []
    with open(input_path, "r", encoding="utf-8") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                doc = json.loads(line)
                documents.append(doc)
            except json.JSONDecodeError as e:
                print(f"⚠️ JSON parse error at line {line_num}: {e}")
                continue

    print(f"📄 Read {len(documents)} documents from {input_path}")

    # 2. video_id + recollect_id로 그룹화
    # key: (video_id, recollect_id) -> value: list of documents
    grouped = defaultdict(list)

    for doc in documents:
        metadata = doc.get("metadata", {})
        video_id = metadata.get("video_id")
        recollect_id = metadata.get("recollect_id", 0)

        if not video_id:
            print(f"⚠️ Document without video_id: {doc}")
            continue

        grouped[(video_id, recollect_id)].append(doc)

    print(f"📊 Found {len(set(k[0] for k in grouped.keys()))} unique video_ids")
    print(f"📊 Found {len(grouped)} unique (video_id, recollect_id) groups")

    # 3. video_id별로 저장
    os.makedirs(output_dir, exist_ok=True)

    # video_id별로 recollect_id 순서대로 정렬하여 저장
    video_ids = sorted(set(k[0] for k in grouped.keys()))

    for video_id in video_ids:
        output_path = os.path.join(output_dir, f"{video_id}.jsonl")

        # 해당 video_id의 모든 recollect_id 찾기 (정렬)
        recollect_ids = sorted([k[1] for k in grouped.keys() if k[0] == video_id])

        with open(output_path, "w", encoding="utf-8") as f:
            for recollect_id in recollect_ids:
                docs = grouped[(video_id, recollect_id)]
                # chunk_index로 정렬
                docs_sorted = sorted(
                    docs, key=lambda d: d.get("metadata", {}).get("chunk_index", 0)
                )
                # 키 순서 유지: id → page_content → metadata → type
                ordered_docs = []
                for doc in docs_sorted:
                    ordered_doc = {
                        "id": doc.get("id"),
                        "page_content": doc.get("page_content", ""),
                        "metadata": doc.get("metadata", {}),
                        "type": doc.get("type", "Document"),
                    }
                    ordered_docs.append(ordered_doc)
                f.write(json.dumps(ordered_docs, ensure_ascii=False) + "\n")

        print(
            f"✅ {video_id}.jsonl: {sum(len(grouped[(video_id, r)]) for r in recollect_ids)} docs, {len(recollect_ids)} recollect_ids"
        )

    print(f"\n🎉 Migration complete! Files saved to {output_dir}")


def main():
    parser = argparse.ArgumentParser(
        description="Migrate documents.jsonl to video_id-based JSONL files"
    )
    parser.add_argument(
        "--input", type=str, required=True, help="Path to documents.jsonl"
    )
    parser.add_argument(
        "--output-dir", type=str, help="Output directory for video_id.jsonl files"
    )
    parser.add_argument(
        "--youtuber",
        type=str,
        help="Youtuber name (used to determine output-dir if not specified)",
    )
    args = parser.parse_args()

    # output_dir 결정
    if args.output_dir:
        output_dir = args.output_dir
    elif args.youtuber:
        script_dir = Path(__file__).parent.resolve()
        output_dir = str(
            script_dir / f"../data/{args.youtuber}/transcript-document-with-context"
        )
    else:
        # 입력 파일과 같은 디렉토리에 저장
        output_dir = os.path.dirname(args.input) or "."

    # 입력 파일 확인
    if not os.path.exists(args.input):
        print(f"❌ Input file not found: {args.input}")
        return

    migrate_documents(args.input, output_dir)


if __name__ == "__main__":
    main()
