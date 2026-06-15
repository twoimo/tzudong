import importlib.util
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "parse_laaj_evaluation.py"
spec = importlib.util.spec_from_file_location("parse_laaj_evaluation", SCRIPT_PATH)
parse_laaj_evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parse_laaj_evaluation)


def laaj_payload(**overrides):
    payload = {
        "visit_authenticity": {"values": []},
        "rb_inference_score": [],
        "rb_grounding_TF": [],
        "review_faithfulness_score": [],
        "category_TF": [],
    }
    payload.update(overrides)
    return payload


class ParseLaajEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.base = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def write_response(self, data, *, raw=False):
        path = self.base / "response.json"
        if raw:
            path.write_text(data, encoding="utf-8")
        else:
            path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return path

    def test_parses_direct_required_payload(self):
        path = self.write_response(laaj_payload(rb_inference_score=[{"name": "A"}]))

        parsed = parse_laaj_evaluation.parse_gemini_response(path)

        self.assertEqual([{"name": "A"}], parsed["rb_inference_score"])

    def test_parses_gemini_candidates_content_parts_text(self):
        payload = laaj_payload(category_TF=[{"name": "칼국수"}])
        path = self.write_response(
            {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": "설명입니다.\n```json\n"
                                    + json.dumps(payload, ensure_ascii=False)
                                    + "\n```"
                                }
                            ]
                        }
                    }
                ]
            }
        )

        parsed = parse_laaj_evaluation.parse_gemini_response(path)

        self.assertEqual([{"name": "칼국수"}], parsed["category_TF"])

    def test_parses_wrapped_evaluation_results_payload(self):
        payload = laaj_payload(review_faithfulness_score=[{"score": 4}])
        path = self.write_response({"evaluation_results": payload})

        parsed = parse_laaj_evaluation.parse_gemini_response(path)

        self.assertEqual([{"score": 4}], parsed["review_faithfulness_score"])

    def test_parses_response_text_with_trailing_commas(self):
        raw_payload = """
        응답:
        ```json
        {
          "evaluation_results": {
            "visit_authenticity": {"values": []},
            "rb_inference_score": [],
            "rb_grounding_TF": [],
            "review_faithfulness_score": [],
            "category_TF": [],
          },
        }
        ```
        """
        path = self.write_response({"response": raw_payload})

        parsed = parse_laaj_evaluation.parse_gemini_response(path)

        self.assertEqual([], parsed["rb_grounding_TF"])

    def test_failure_message_includes_response_snippet(self):
        path = self.write_response("이 응답은 JSON이 아닙니다", raw=True)

        with self.assertRaisesRegex(ValueError, "response snippet='이 응답은 JSON이 아닙니다'"):
            parse_laaj_evaluation.parse_gemini_response(path)


if __name__ == "__main__":
    unittest.main()
