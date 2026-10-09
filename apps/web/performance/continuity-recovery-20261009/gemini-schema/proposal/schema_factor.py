"""Offline-only proposal for factoring the long-form Gemini response schema."""

from __future__ import annotations

import copy
import json


FACTORS = (
    ("/properties/summary", "#/properties/claims"),
    ("/properties/restaurants/items/properties/menus", "#/properties/claims"),
    ("/properties/restaurants/items/properties/claims", "#/properties/claims"),
    (
        "/properties/restaurants/items/properties/evidence",
        "#/properties/claims/items/properties/evidence",
    ),
    ("/properties/coverage/properties/limitations", "#/properties/uncertainty"),
    ("/properties/claims/items/properties/uncertainty", "#/properties/uncertainty"),
    (
        "/properties/restaurants/items/properties/uncertainty",
        "#/properties/uncertainty",
    ),
    (
        "/properties/claims/items/properties/evidence/items/properties/endSeconds",
        "#/properties/claims/items/properties/evidence/items/properties/startSeconds",
    ),
)


def canonical(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _decode(token):
    return token.replace("~1", "/").replace("~0", "~")


def pointer_get(document, pointer):
    if not pointer.startswith("/"):
        raise ValueError("local_pointer_required")
    value = document
    for token in pointer.split("/")[1:]:
        key = _decode(token)
        value = value[int(key)] if isinstance(value, list) else value[key]
    return value


def pointer_set(document, pointer, value):
    tokens = [_decode(token) for token in pointer.split("/")[1:]]
    parent = document
    for token in tokens[:-1]:
        parent = parent[int(token)] if isinstance(parent, list) else parent[token]
    final = tokens[-1]
    if isinstance(parent, list):
        parent[int(final)] = value
    else:
        parent[final] = value


def factor_schema(original):
    """Return the equivalent local-ref representation without mutating input."""
    candidate = copy.deepcopy(original)
    for replacement_pointer, reference in FACTORS:
        original_node = pointer_get(original, replacement_pointer)
        reference_node = {"$ref": reference}
        if len(canonical(reference_node)) >= len(canonical(original_node)):
            raise ValueError("reference_not_smaller")
        pointer_set(candidate, replacement_pointer, reference_node)
    return candidate
