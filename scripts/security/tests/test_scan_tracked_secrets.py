#!/usr/bin/env python3
"""Regression tests for high-confidence repository secret patterns."""
from __future__ import annotations

import importlib.util
import pathlib
import unittest


SCRIPT_PATH = pathlib.Path(__file__).resolve().parents[1] / "scan_tracked_secrets.py"
SPEC = importlib.util.spec_from_file_location("scan_tracked_secrets", SCRIPT_PATH)
assert SPEC and SPEC.loader
scan_tracked_secrets = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scan_tracked_secrets)


def labels_for(value: str) -> set[str]:
    return {
        label
        for label, pattern in scan_tracked_secrets.PATTERNS
        if pattern.search(value)
    }


class SecretPatternTests(unittest.TestCase):
    def test_detects_high_confidence_tokens(self) -> None:
        examples = {
            "GitHub token": "GITHUB_TOKEN=" + "github" + "_pat_" + "a" * 22 + "_" + "b" * 59,
            "JWT-like token": "SUPABASE_SERVICE_ROLE_KEY=" + "ey" + "J" + "a" * 20 + "." + "b" * 20 + "." + "c" * 20,
            "Google API key": "GEMINI_API_KEY=" + "AI" + "za" + "a" * 35,
            "OpenAI API key": "OPENAI_API_KEY=" + "sk" + "-" + "a" * 40,
            "Anthropic API key": "ANTHROPIC_API_KEY=" + "sk" + "-ant-" + "a" * 40,
            "AWS access key": "AWS_ACCESS_KEY_ID=" + "AK" + "IA" + "A" * 16,
            "npm access token": "NPM_TOKEN=" + "npm" + "_" + "a" * 36,
            "Google OAuth client secret": "GOOGLE_CLIENT_SECRET=" + "GOCSPX" + "-" + "a" * 28,
            "SendGrid API key": "SENDGRID_API_KEY=" + "SG" + "." + "a" * 22 + "." + "b" * 43,
            "Slack token": "SLACK_BOT_TOKEN=" + "xox" + "b-" + "1" * 20,
            "Stripe webhook secret": "STRIPE_WEBHOOK_SECRET=" + "wh" + "sec_" + "a" * 24,
            "Private key block": "-----BEGIN " + "PRIVATE KEY-----",
        }

        for label, sample in examples.items():
            with self.subTest(label=label):
                self.assertIn(label, labels_for(sample))

    def test_allows_non_secret_placeholders(self) -> None:
        placeholders = [
            "GITHUB_TOKEN=<github-actions-read-token>",
            "SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key",
            "GEMINI_API_KEY=your_gemini_api_key",
            "OPENAI_API_KEY=<openai-api-key>",
        ]

        for sample in placeholders:
            with self.subTest(sample=sample):
                self.assertEqual(set(), labels_for(sample))


if __name__ == "__main__":
    unittest.main()
