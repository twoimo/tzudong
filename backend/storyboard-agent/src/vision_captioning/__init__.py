"""Vision caption provider abstraction for storyboard peak-frame captions.

Importing this package must stay lightweight: heavy ML dependencies such as
`torch` and `transformers` are imported only by the LLaVA provider at runtime.
"""

from .providers import (
    CaptionProviderError,
    CaptionProviderUnavailable,
    CaptionRequest,
    CaptionResult,
    get_provider,
    resolve_provider_id,
)

__all__ = [
    "CaptionProviderError",
    "CaptionProviderUnavailable",
    "CaptionRequest",
    "CaptionResult",
    "get_provider",
    "resolve_provider_id",
]
