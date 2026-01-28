#!/usr/bin/env python3
"""
transcript-document-with-context 폴더 내 모든 데이터에서
"쯔위" -> "쯔양", "tzuyu" -> "tzuyang" 치환

대상 필드: page_content (그 외 prev_overlap, next_overlap은 boolean이므로 관련 없음)
"""

import json
import re
from pathlib import Path

TARGET_DIR = Path(__file__).parent / "../data/tzuyang/transcript-document-with-context"


def fix_typos(text: str) -> str:
    """오타 수정"""
    if not isinstance(text, str):
        return text
    text = text.replace("쯔위", "쯔양")
    text = re.sub(r"tzuyu", "tzuyang", text, flags=re.IGNORECASE)
    return text


def process_file(file_path: Path) -> tuple[int, int]:
    """파일 처리, (총 문서 수, 수정된 문서 수) 반환"""
    total_docs = 0
    modified_docs = 0
    updated_lines = []

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    updated_lines.append("")
                    continue

                try:
                    docs = json.loads(line)
                    line_modified = False

                    if isinstance(docs, list):
                        for doc in docs:
                            total_docs += 1
                            page_content = doc.get("page_content", "")
                            fixed_content = fix_typos(page_content)
                            if fixed_content != page_content:
                                doc["page_content"] = fixed_content
                                line_modified = True
                                modified_docs += 1
                    else:
                        total_docs += 1
                        page_content = docs.get("page_content", "")
                        fixed_content = fix_typos(page_content)
                        if fixed_content != page_content:
                            docs["page_content"] = fixed_content
                            line_modified = True
                            modified_docs += 1

                    updated_lines.append(json.dumps(docs, ensure_ascii=False))
                except json.JSONDecodeError:
                    updated_lines.append(line)

        # 파일 덮어쓰기
        with open(file_path, "w", encoding="utf-8") as f:
            for uline in updated_lines:
                f.write(uline + "\n")

    except Exception as e:
        print(f"❌ 오류 {file_path.name}: {e}")

    return total_docs, modified_docs


def main():
    target_path = TARGET_DIR.resolve()
    print(f"📂 대상 폴더: {target_path}")

    if not target_path.exists():
        print("❌ 폴더가 존재하지 않습니다.")
        return

    files = list(target_path.glob("*.jsonl"))
    print(f"📄 파일 수: {len(files)}개")
    print("=" * 50)

    total_all = 0
    modified_all = 0

    for f in files:
        total, modified = process_file(f)
        total_all += total
        modified_all += modified
        if modified > 0:
            print(f"  ✅ {f.name}: {modified}개 수정됨")

    print("=" * 50)
    print(f"📊 결과: 총 {total_all}개 문서 중 {modified_all}개 수정됨")


if __name__ == "__main__":
    main()
