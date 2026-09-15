#!/usr/bin/env python3
"""Bootstrap a local working catalog from an allowlisted, GET-only hosted source.

Import refuses to overwrite existing working changes. The review command compares
selected local records with a retained import baseline; it never publishes data.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import uuid
from collections import Counter
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

from hosted_data_plane import HOSTED_URL, HOSTED_PROJECT_REF, assert_hosted_target

FIELDS = tuple("id approved_name categories lat lng road_address jibun_address english_address youtube_meta trace_id source_type geocoding_success geocoding_false_stage status is_missing is_not_selected created_at updated_at tzuyang_review youtube_link origin_name naver_name google_name trace_id_name_source channel_name".split())
META_FIELDS = {"title", "duration", "is_shorts", "publishedAt", "viewCount", "likeCount", "commentCount"}
SEEDS = {"00000000-0000-4000-8000-000000000101": ("nightly-trace-1", "정원분식"), "00000000-0000-4000-8000-000000000102": ("nightly-trace-2", "명동칼국수")}
MAX_ROWS = 50000
REVIEW_FIELDS = tuple("approved_name categories lat lng road_address jibun_address english_address status tzuyang_review youtube_link".split())


class CatalogError(Exception):
    pass


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def sha(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def quote(value):
    return "'" + value.replace("'", "''") + "'"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise CatalogError("source_redirect_denied")


def credentials(path):
    values = {}
    for line in path.read_text().splitlines():
        key, sep, value = line.strip().removeprefix("export ").partition("=")
        if sep and key in {"SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"}:
            values[key] = value.strip().strip("\"'")
    assert_hosted_target(values.get("SUPABASE_URL", ""))
    if not values.get("SUPABASE_SERVICE_ROLE_KEY"):
        raise CatalogError("source_credentials_missing")
    return values["SUPABASE_SERVICE_ROLE_KEY"]


def normalize(rows):
    result = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != set(FIELDS):
            raise CatalogError("source_shape_invalid")
        item = dict(row)
        identifier = str(uuid.UUID(item["id"]))
        if identifier != item["id"] or identifier in seen or item["status"] not in {"approved", "pending", "deleted"}:
            raise CatalogError("source_identity_invalid")
        seen.add(identifier)
        meta = item["youtube_meta"]
        if meta is not None:
            if not isinstance(meta, dict):
                raise CatalogError("source_metadata_invalid")
            item["youtube_meta"] = {k: v for k, v in meta.items() if k in META_FIELDS and (v is None or isinstance(v, (str, int, float, bool)))}
        result.append(item)
    if not result or len(result) > MAX_ROWS:
        raise CatalogError("source_count_invalid")
    return sorted(result, key=lambda r: r["id"])


def fetch(key):
    rows = []
    total = None
    opener = build_opener(NoRedirect)
    while total is None or len(rows) < total:
        query = urlencode({"select": ",".join(FIELDS), "order": "id.asc", "offset": len(rows), "limit": 500})
        req = Request(HOSTED_URL + "/rest/v1/restaurants?" + query, headers={"apikey": key, "Authorization": "Bearer " + key, "Prefer": "count=exact"}, method="GET")
        with opener.open(req, timeout=30) as response:
            current_total = int(response.headers["Content-Range"].split("/")[-1])
            if current_total > MAX_ROWS or (total is not None and total != current_total):
                raise CatalogError("source_changed")
            total = current_total
            body = response.read(8 * 1024 * 1024 + 1)
            if len(body) > 8 * 1024 * 1024:
                raise CatalogError("source_page_too_large")
            page = json.loads(body)
        if not isinstance(page, list) or not page:
            raise CatalogError("source_page_missing")
        rows.extend(page)
    if len(rows) != total:
        raise CatalogError("source_count_mismatch")
    return normalize(rows)


def executor():
    spec = importlib.util.spec_from_file_location("local_catalog_migrate", Path(__file__).with_name("local-migrate.py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    project = "tzudong-local-" + hashlib.sha256(str(module.repository_root()).encode()).hexdigest()[:12]
    return module.PsqlExecutor("docker", project + "-db-1", "postgres"), module


DIGEST_SQL = "SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'[]')) FROM public.restaurants r"


def local_state(ex):
    projection = ",".join(FIELDS)
    query = f"BEGIN READ ONLY; SELECT json_build_object('digest',({DIGEST_SQL}),'rows',(SELECT COALESCE(json_agg(r ORDER BY id),'[]') FROM (SELECT {projection} FROM public.restaurants) r)); COMMIT;"
    return json.loads(ex.capture(query.encode()))


def mode(local, source):
    rows = local["rows"]
    if rows and canonical(normalize(rows)) == canonical(source):
        return "unchanged"
    if not rows:
        return "bootstrap"
    if len(rows) == 2 and {r["id"] for r in rows} == set(SEEDS) and all((r["trace_id"], r["approved_name"]) == SEEDS[r["id"]] and r["status"] == "approved" and r["youtube_link"] is None for r in rows):
        return "replace_verified_fixtures"
    raise CatalogError("local_working_changes_preserved")


def summary(rows):
    return {"rows": len(rows), "status_counts": dict(sorted(Counter(r["status"] for r in rows).items())), "approved_with_coordinates": sum(r["status"] == "approved" and r["lat"] is not None and r["lng"] is not None for r in rows), "projection_sha256": sha(rows)}


def review_changes(baseline, current, selected_ids=None):
    before = {row["id"]: row for row in normalize(baseline)}
    if not isinstance(current, list) or len(current) > MAX_ROWS:
        raise CatalogError("review_rows_invalid")
    after = {}
    for row in current:
        if not isinstance(row, dict) or set(row) != set(FIELDS):
            raise CatalogError("review_rows_invalid")
        identifier = str(uuid.UUID(row["id"]))
        if identifier != row["id"] or identifier in after:
            raise CatalogError("review_rows_invalid")
        after[identifier] = row
    identifiers = set(before) | set(after)
    if selected_ids is not None:
        selected = set(selected_ids)
        if not selected or selected - identifiers:
            raise CatalogError("review_selection_invalid")
        identifiers = selected
    changes = []
    for identifier in sorted(identifiers):
        old, new = before.get(identifier), after.get(identifier)
        if old is None or new is None:
            # Membership differences are review items, never inferred INSERT/DELETE.
            changes.append({"id": identifier, "kind": "local_only" if old is None else "missing_locally", "fields": {}})
            continue
        fields = {field: {"before": old[field], "after": new[field]}
                  for field in REVIEW_FIELDS if old[field] != new[field]}
        if fields:
            changes.append({"id": identifier, "kind": "changed_fields", "fields": fields})
    return changes


def read_private_json(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise CatalogError("preview_permissions_invalid")
    return json.loads(path.read_bytes())


def load_baseline(directory, digest, project):
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise CatalogError("preview_hash_invalid")
    plan = read_private_json(directory / (digest + ".preview.json"))
    if (sha(plan) != digest or plan.get("project") != project
            or plan.get("source") != HOSTED_PROJECT_REF
            or plan.get("schema") != "local-working-catalog-v1"):
        raise CatalogError("preview_binding_invalid")
    receipt = read_private_json(directory / (digest + ".receipt.json"))
    expected = {"schema": plan["schema"], "preview_sha256": digest,
                "project": project, "result": "applied_and_read_back", **summary(plan["rows"])}
    if any(receipt.get(key) != value for key, value in expected.items()):
        raise CatalogError("baseline_receipt_invalid")
    return plan


def discover_baseline(directory, project):
    candidates = [path.name.removesuffix('.receipt.json')
                  for path in directory.glob('*.receipt.json')
                  if len(path.name.removesuffix('.receipt.json')) == 64
                  and all(c in '0123456789abcdef' for c in path.name.removesuffix('.receipt.json'))]
    if len(candidates) != 1:
        raise CatalogError('baseline_selection_required')
    digest = candidates[0]
    load_baseline(directory, digest, project)
    return digest


def identity_preflight(ex, rows):
    payload = quote(canonical(rows).decode())
    sql = f"""BEGIN READ ONLY;
    WITH source AS (SELECT * FROM jsonb_populate_recordset(NULL::public.restaurants,{payload}::jsonb)),
    identities AS (SELECT public.extract_youtube_video_id(youtube_link) video,
      public.normalize_restaurant_identity_name(public.resolve_restaurant_identity_name(approved_name,origin_name,naver_name,google_name)) name
      FROM source WHERE status <> 'deleted'),
    video_duplicates AS (SELECT count(*) n FROM identities WHERE video <> '' GROUP BY video HAVING count(*)>1),
    composite_duplicates AS (SELECT count(*) n FROM identities WHERE video <> '' AND name IS NOT NULL GROUP BY video,name HAVING count(*)>1)
    SELECT json_build_object(
      'video_only_index_present', EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='restaurants'
        AND indexname='idx_restaurants_active_candidate_identity'
        AND indexdef LIKE '%UNIQUE%extract_youtube_video_id(youtube_link)%'
        AND indexdef NOT LIKE '%normalize_restaurant_identity_name%'),
      'multi_restaurant_videos', (SELECT count(*) FROM video_duplicates),
      'affected_active_rows', (SELECT COALESCE(sum(n),0) FROM video_duplicates),
      'composite_duplicate_groups',(SELECT count(*) FROM composite_duplicates)); COMMIT;"""
    return json.loads(ex.capture(sql.encode()))


def identity_blocked(preflight):
    return preflight["composite_duplicate_groups"] > 0 or (preflight["video_only_index_present"] and preflight["multi_restaurant_videos"] > 0)


def apply_sql(plan):
    # Full-table lock closes the preview/apply race. Refuse every reference to a
    # fixture before deletion, including CASCADE and SET NULL foreign keys.
    rows = quote(canonical(plan["rows"]).decode())
    fields = ",".join(FIELDS)
    seed_ids = ",".join(quote(x) for x in SEEDS)
    cleanup = ""
    if plan["mode"] == "replace_verified_fixtures":
        cleanup = f"""
        FOR ref IN SELECT conrelid::regclass AS relation, a.attname AS column_name
          FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
          WHERE c.confrelid='public.restaurants'::regclass AND c.contype='f' LOOP
          EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE %I::text IN (%s))', ref.relation, ref.column_name, {quote(seed_ids)}) INTO referenced;
          IF referenced THEN RAISE EXCEPTION 'fixture_referenced'; END IF;
        END LOOP;
        DELETE FROM public.restaurants WHERE id IN ({seed_ids});
        """
    return f"""BEGIN;
    SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='5s';
    LOCK TABLE public.restaurants IN EXCLUSIVE MODE;
    DO $catalog$ DECLARE ref record; referenced boolean; BEGIN
      IF ({DIGEST_SQL}) <> {quote(plan['local_digest'])} THEN RAISE EXCEPTION 'local_changed'; END IF;
      {cleanup}
    END $catalog$;
    INSERT INTO public.restaurants ({fields}) SELECT {fields} FROM jsonb_populate_recordset(NULL::public.restaurants, {rows}::jsonb);
    COMMIT;
    """.encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    preview = sub.add_parser("preview")
    preview.add_argument("--source-env", type=Path, required=True)
    apply = sub.add_parser("apply")
    apply.add_argument("--preview-sha256", required=True)
    review = sub.add_parser("review", help="Compare local working changes with an applied import; no hosted access or writes")
    review.add_argument("--baseline-sha256", help="Applied import hash; auto-selected only when exactly one verified receipt exists")
    review.add_argument("--restaurant-id", action="append", help="Limit review to selected IDs; repeat for multiple restaurants")
    args = parser.parse_args()
    ex, module = executor()
    _, state, _ = ex._binding()
    directory = state / "working-catalog"
    directory.mkdir(mode=0o700, exist_ok=True)
    if directory.is_symlink() or directory.stat().st_mode & 0o077:
        raise CatalogError("workspace_permissions_invalid")
    if args.command == "review":
        if args.baseline_sha256 is None:
            args.baseline_sha256 = discover_baseline(directory, ex._expected_project())
        baseline = load_baseline(directory, args.baseline_sha256, ex._expected_project())
        local = local_state(ex)
        changes = review_changes(baseline["rows"], local["rows"], args.restaurant_id)
        if local_state(ex)["digest"] != local["digest"]:
            raise CatalogError("local_changed")
        review_plan = {"schema": "local-working-catalog-review-v1", "project": ex._expected_project(),
                      "source": HOSTED_PROJECT_REF, "baseline_sha256": args.baseline_sha256,
                      "local_digest": local["digest"], "review_fields": list(REVIEW_FIELDS),
                      "selected_ids": sorted(set(args.restaurant_id)) if args.restaurant_id else None,
                      "changes": changes, "safe_to_apply": False, "hosted_revalidation_required": True}
        digest = sha(review_plan)
        destination = directory / (digest + ".review.json")
        if destination.exists():
            if read_private_json(destination) != review_plan:
                raise CatalogError("review_file_conflict")
        else:
            private_write(destination, review_plan)
        print(json.dumps({"schema": review_plan["schema"], "review_sha256": digest,
                          "review_file": str(destination), "baseline_sha256": args.baseline_sha256,
                          "changed_records": len(changes),
                          "kinds": dict(sorted(Counter(change["kind"] for change in changes).items())),
                          "safe_to_apply": False, "hosted_revalidation_required": True}))
        return
    if args.command == "preview":
        key = credentials(args.source_env)
        rows = fetch(key)
        if sha(rows) != sha(fetch(key)):
            raise CatalogError("source_changed")
        local = local_state(ex)
        action = mode(local, rows)
        if action == "replace_verified_fixtures":
            # Existing canonical verifier checks the complete deterministic seed,
            # including non-projected columns, before permitting fixture removal.
            ex.capture((Path(__file__).with_name("local_catalog_readback.sql")).read_bytes())
        preflight = identity_preflight(ex, rows)
        plan = {"schema": "local-working-catalog-v1", "source": HOSTED_PROJECT_REF, "project": ex._expected_project(), "mode": action, "local_digest": local["digest"], "rows": rows, "identity_preflight": preflight}
        digest = sha(plan)
        path = directory / (digest + ".preview.json")
        if not path.exists():
            private_write(path, plan)
        print(json.dumps({"mode": action, "ready": not identity_blocked(preflight), "identity_preflight": preflight, "preview_sha256": digest, **summary(rows)}))
        return
    digest = args.preview_sha256
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise CatalogError("preview_hash_invalid")
    path = directory / (digest + ".preview.json")
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise CatalogError("preview_permissions_invalid")
    plan = json.loads(path.read_bytes())
    if sha(plan) != digest or plan["project"] != ex._expected_project() or plan["source"] != HOSTED_PROJECT_REF or plan["schema"] != "local-working-catalog-v1":
        raise CatalogError("preview_binding_invalid")
    current = local_state(ex)
    if current["rows"] and canonical(normalize(current["rows"])) == canonical(plan["rows"]):
        print(json.dumps({"result": "already_present", **summary(plan["rows"])}))
        return
    if current["digest"] != plan["local_digest"] or mode(current, plan["rows"]) != plan["mode"]:
        raise CatalogError("local_changed")
    if identity_blocked(identity_preflight(ex, plan["rows"])):
        raise CatalogError("source_identity_constraint_conflict")
    ex.run(apply_sql(plan))
    readback = local_state(ex)
    if canonical(normalize(readback["rows"])) != canonical(plan["rows"]):
        raise CatalogError("readback_mismatch")
    receipt = {"schema": plan["schema"], "preview_sha256": digest, "project": plan["project"], "local_readback_digest": readback["digest"], "result": "applied_and_read_back", **summary(plan["rows"])}
    private_write(directory / (digest + ".receipt.json"), receipt)
    print(json.dumps(receipt))


def private_write(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        output.write(canonical(value) + b"\n")
        output.flush()
        os.fsync(output.fileno())


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # No source rows, provider diagnostics, or credential-bearing URLs.
        code = str(error) if isinstance(error, CatalogError) else "catalog_operation_failed"
        print(json.dumps({"error": code}), file=sys.stderr)
        sys.exit(1)
