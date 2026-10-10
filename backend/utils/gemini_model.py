"""Model redirect compatibility shared by Python CLI callers and cache keys."""

DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"


def migrate_deprecated_gemini_model(value: str) -> str:
    model = value.strip().removeprefix("models/")
    return DEFAULT_GEMINI_MODEL if model == "gemini-3.7-flash" else value
