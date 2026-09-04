#!/usr/bin/env python3
"""Recover nine current invoker definitions for disposable catalog replay only.

The older reconstruction archive lacks these functions. This supplements that
archive from the tracked local prerequisite, without replaying a database dump,
changing a canonical migration, or claiming historical/hosted application.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

SOURCE_PATH = "backend/supabase/baselines/local/application-prerequisites.sql"
SOURCE_SHA256 = "34e7904a4dfb271d811d433102e92c94aceff6528c751bf5b02f94c2a56f3d15"
SIGNATURES = (
    "get_all_approved_restaurant_names()",
    "get_categories_by_restaurant_name_or_youtube_url(text,text)",
    "get_video_captions_for_range(text,integer,integer,integer)",
    "get_video_metadata_filtered(integer,integer,text)",
    "match_documents_bge(extensions.vector,double precision,integer,jsonb)",
    "match_documents_hybrid(extensions.vector,jsonb,double precision,double precision,integer)",
    "search_restaurants_by_category(text,integer)",
    "search_restaurants_by_name(text,integer)",
    "search_video_ids_by_query(extensions.vector,jsonb,double precision,double precision,integer)",
)


def recover(source: bytes) -> tuple[bytes, dict]:
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError("advisor_replay_prerequisite_source_drift")
    text = source.decode("utf-8")
    blocks = ["SET LOCAL search_path = pg_catalog, public, extensions;\n"]
    entries = []
    for signature in SIGNATURES:
        name = signature.split("(", 1)[0]
        matches = list(re.finditer(
            rf"^CREATE FUNCTION public\.{re.escape(name)}\(.*?^\$\$;\n",
            text, re.MULTILINE | re.DOTALL,
        ))
        if signature == "search_restaurants_by_name(text,integer)":
            matches = [match for match in matches if match.group().startswith(
                "CREATE FUNCTION public.search_restaurants_by_name(keyword text, p_limit integer DEFAULT 5)"
            )]
        if len(matches) != 1 or "SECURITY DEFINER" in matches[0].group():
            raise ValueError("advisor_replay_prerequisite_definition_drift")
        block = matches[0].group()
        # CREATE (not CREATE OR REPLACE) rejects any overlapping definition.
        blocks.extend((
            block,
            f"ALTER FUNCTION public.{signature} OWNER TO postgres;\n",
            f"REVOKE ALL ON FUNCTION public.{signature} FROM PUBLIC, anon, authenticated, service_role;\n",
        ))
        entries.append({
            "signature": f"public.{signature}",
            "definitionSha256": hashlib.sha256(block.encode()).hexdigest(),
            "definitionBytes": len(block.encode()),
        })
    sql = "\n".join(blocks).encode()
    return sql, {
        "schemaVersion": 1,
        "scope": "current source-only replay prerequisite; not historical or hosted application evidence",
        "sourcePath": SOURCE_PATH,
        "sourceSha256": SOURCE_SHA256,
        "outputSha256": hashlib.sha256(sql).hexdigest(),
        "functions": entries,
        "dataRowsCopied": 0,
        "canonicalMigrationsChanged": False,
        "publicExecutionGranted": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    sql, receipt = recover(args.source.read_bytes())
    args.output.write_bytes(sql)
    args.receipt.write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n")


if __name__ == "__main__":
    main()
