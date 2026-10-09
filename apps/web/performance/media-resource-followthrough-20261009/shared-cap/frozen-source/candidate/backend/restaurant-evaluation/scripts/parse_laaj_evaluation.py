#!/usr/bin/env python3
"""
Gemini LAAJ 평가 결과 파서
09-laaj-evaluation.sh에서 호출되어 Gemini 응답을 파싱하고 laaj_results에 저장
"""
import argparse
import ast
import json
import re
import sys
from pathlib import Path

REQUIRED_LAAJ_KEYS = {
    "visit_authenticity",
    "rb_inference_score",
    "rb_grounding_TF",
    "review_faithfulness_score",
    "category_TF",
}

WRAPPER_KEYS = (
    "evaluation_results",
    "laaj_results",
    "result",
    "results",
    "output",
    "data",
)


def is_laaj_payload(data) -> bool:
    """LAAJ 결과로 병합 가능한 최소 필수 키 보유 여부."""
    return isinstance(data, dict) and REQUIRED_LAAJ_KEYS.issubset(data.keys())


def normalize_laaj_payload(data):
    """모델/CLI 래퍼 안쪽의 실제 LAAJ 결과 객체 추출."""
    if is_laaj_payload(data):
        return data

    if isinstance(data, dict):
        for key in WRAPPER_KEYS:
            if key in data:
                normalized = normalize_laaj_payload(data[key])
                if normalized:
                    return normalized

    if isinstance(data, list):
        for item in data:
            normalized = normalize_laaj_payload(item)
            if normalized:
                return normalized

    return None


def strip_code_fences(text: str) -> str:
    """JSON 코드 펜스를 벗긴 텍스트 반환."""
    text = re.sub(r"```(?:json|JSON)?\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    return text.strip()


def json_loads_lenient(text: str):
    """일반 JSON 우선, 흔한 LLM 출력 흔들림은 제한적으로 보정."""
    candidates = [text.strip()]
    without_trailing_commas = re.sub(r",\s*([}\]])", r"\1", candidates[0])
    if without_trailing_commas != candidates[0]:
        candidates.append(without_trailing_commas)

    for candidate in candidates:
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    # 일부 CLI/모델은 Python dict처럼 작은따옴표를 반환한다.
    # 코드 실행 없이 literal만 허용하는 ast.literal_eval로 마지막 보수 파싱을 시도한다.
    try:
        parsed = ast.literal_eval(candidates[-1])
        if isinstance(parsed, (dict, list)):
            return parsed
    except (SyntaxError, ValueError):
        pass

    return None


def iter_balanced_json_objects(text: str):
    """텍스트 안의 균형 잡힌 JSON 객체 후보를 순서대로 추출."""
    start = None
    depth = 0
    in_string = False
    escape = False

    for index, char in enumerate(text):
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue
        if char == "{":
            if depth == 0:
                start = index
            depth += 1
        elif char == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start is not None:
                yield text[start : index + 1]
                start = None


def extract_text_fragments(data):
    """Gemini/agy CLI 응답 래퍼에서 실제 모델 텍스트 후보를 우선순위대로 수집."""
    if isinstance(data, str):
        yield data
        return

    if isinstance(data, list):
        for item in data:
            yield from extract_text_fragments(item)
        return

    if not isinstance(data, dict):
        return

    priority_keys = (
        "response",
        "text",
        "content",
        "output",
        "message",
        "stdout",
    )
    for key in priority_keys:
        if key in data:
            yield from extract_text_fragments(data[key])

    # Gemini SDK/CLI 계열: candidates[].content.parts[].text
    if "candidates" in data:
        yield from extract_text_fragments(data["candidates"])
    if "parts" in data:
        yield from extract_text_fragments(data["parts"])


def extract_json(text: str) -> dict:
    """텍스트에서 LAAJ JSON payload 추출."""
    text = strip_code_fences(text)

    direct = json_loads_lenient(text)
    normalized = normalize_laaj_payload(direct)
    if normalized:
        return normalized

    for candidate in iter_balanced_json_objects(text):
        parsed = json_loads_lenient(candidate)
        normalized = normalize_laaj_payload(parsed)
        if normalized:
            return normalized
    return None


def parse_gemini_response(response_file: Path) -> dict:
    """Gemini 응답 파일 파싱"""
    if not response_file.exists():
        raise FileNotFoundError(f"응답 파일 없음: {response_file}")

    content = response_file.read_text(encoding="utf-8")

    # JSON 파싱 시도
    data = None
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        pass

    normalized = normalize_laaj_payload(data)
    if normalized:
        return normalized

    if data is not None:
        for fragment in extract_text_fragments(data):
            extracted = extract_json(fragment)
            if extracted:
                return extracted

    # 전체 파일이 일반 텍스트/마크다운인 경우
    extracted = extract_json(content)
    if extracted:
        return extracted

    snippet = strip_code_fences(content)[:500].replace("\n", "\\n")
    if len(content) > 500:
        snippet += "..."
    raise ValueError(f"평가 결과 파싱 실패: response snippet={snippet!r}")


def main():
    parser = argparse.ArgumentParser(description="LAAJ 평가 결과 파서")
    parser.add_argument("--channel", "-c", required=True, help="채널 이름")
    parser.add_argument("--evaluation-path", required=True, help="평가 데이터 경로")
    parser.add_argument("--video-id", required=True, help="비디오 ID")
    parser.add_argument("--response-file", required=True, help="Gemini 응답 파일")
    parser.add_argument("--rule-file", required=True, help="rule_results 파일")
    args = parser.parse_args()

    # 경로 설정
    script_dir = Path(__file__).parent
    project_root = script_dir.parents[2]
    evaluation_path = project_root / args.evaluation_path
    laaj_results_dir = evaluation_path / "evaluation" / "laaj_results"
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

    # evaluation_name_source 생성: 각 음식점의 name 출처 추적
    # location_match_TF에서 naver_name 유무로 판단
    evaluation_name_source = {}
    loc_match_list = existing_eval.get("location_match_TF", [])
    for item in loc_match_list:
        origin_name = item.get("origin_name")
        naver_name = item.get("naver_name")
        if origin_name:
            if naver_name:
                evaluation_name_source[origin_name] = "naver_name"
            else:
                evaluation_name_source[origin_name] = "origin_name"

    # evaluation_name_source를 맨 앞에 배치
    from collections import OrderedDict

    ordered_eval = OrderedDict()
    ordered_eval["evaluation_name_source"] = evaluation_name_source
    for key, value in merged_eval.items():
        if key != "evaluation_name_source":
            ordered_eval[key] = value
    merged_eval = dict(ordered_eval)

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

    print(f"[OK] LAAJ 결과 저장: {output_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
