#!/usr/bin/env python3
"""
Gemini LAAJ 평가 결과 파서
09-laaj-evaluation.sh에서 호출되어 Gemini 응답을 파싱하고 laaj_results에 저장
"""
import argparse
import json
import re
import sys
from pathlib import Path


def extract_json(text: str) -> dict:
    """텍스트에서 JSON 추출"""
    # 코드 블록 제거
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    text = text.strip()

    # JSON 객체 찾기
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return None


def parse_gemini_response(response_file: Path) -> dict:
    """Gemini 응답 파일 파싱"""
    if not response_file.exists():
        raise FileNotFoundError(f"응답 파일 없음: {response_file}")

    content = response_file.read_text(encoding="utf-8")

    # JSON 파싱 시도
    try:
        data = json.loads(content)
        # Gemini CLI 응답 구조에서 실제 내용 추출
        if isinstance(data, list) and len(data) > 0:
            for item in data:
                if isinstance(item, dict):
                    if "text" in item:
                        extracted = extract_json(item["text"])
                        if extracted:
                            return extracted
                    # 직접 평가 결과인 경우
                    if "visit_authenticity" in item:
                        return item
        elif isinstance(data, dict):
            if "visit_authenticity" in data:
                return data
            if "text" in data:
                extracted = extract_json(data["text"])
                if extracted:
                    return extracted
    except json.JSONDecodeError:
        # 텍스트에서 JSON 추출 시도
        extracted = extract_json(content)
        if extracted:
            return extracted

    raise ValueError("평가 결과 파싱 실패")


def main():
    parser = argparse.ArgumentParser(description="LAAJ 평가 결과 파서")
    parser.add_argument("--channel", "-c", required=True, help="채널 이름")
    parser.add_argument("--data-path", required=True, help="데이터 경로")
    parser.add_argument("--video-id", required=True, help="비디오 ID")
    parser.add_argument("--response-file", required=True, help="Gemini 응답 파일")
    parser.add_argument("--rule-file", required=True, help="rule_results 파일")
    args = parser.parse_args()

    # 경로 설정
    script_dir = Path(__file__).parent
    project_root = script_dir.parent.parent
    data_path = project_root / args.data_path
    laaj_results_dir = data_path / "evaluation" / "laaj_results"
    laaj_results_dir.mkdir(parents=True, exist_ok=True)

    response_file = Path(args.response_file)
    rule_file = Path(args.rule_file)
    output_file = laaj_results_dir / f"{args.video_id}.jsonl"

    # rule_results 데이터 로드
    with open(rule_file, "r", encoding="utf-8") as f:
        lines = f.read().strip().split("\n")
        rule_data = json.loads(lines[-1])

    # Gemini 응답 파싱
    laaj_results = parse_gemini_response(response_file)

    # 기존 evaluation_results에 LAAJ 결과 병합
    existing_eval = rule_data.get("evaluation_results", {})
    merged_eval = {**existing_eval, **laaj_results}

    # 출력 데이터 구성
    output_data = {
        "youtube_link": rule_data.get("youtube_link"),
        "channel_name": rule_data.get("channel_name"),
        "evaluation_target": rule_data.get("evaluation_target", {}),
        "restaurants": rule_data.get("restaurants", []),
        "evaluation_results": merged_eval,
        "recollect_version": rule_data.get("recollect_version", {}),
    }

    # 저장
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(json.dumps(output_data, ensure_ascii=False) + "\n")

    print(f"✅ LAAJ 결과 저장: {output_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
