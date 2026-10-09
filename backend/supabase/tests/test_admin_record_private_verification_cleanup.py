"""Forward-only coverage for guarded admin cleanup across both review buckets."""
import hashlib
import json
import os
from pathlib import Path
import unittest
import uuid

from backend.supabase.tests.test_restaurant_review_identity import ReviewIdentityTests, ROOT


MIGRATIONS = ROOT / "backend/supabase/migrations"
PREDECESSOR = MIGRATIONS / "20261004190259_admin_record_guarded_actions.sql"
FORWARD = MIGRATIONS / "20261009091342_admin_record_private_verification_cleanup.sql"
PREDECESSOR_BYTES = 60166
PREDECESSOR_SHA256 = "b373b7ea472c0352a33a4d4043cf8d6aa8474c04cc1ca5778805edfa77ac9c95"


class AdminRecordPrivateCleanupSourceContract(unittest.TestCase):
    def test_forward_migration_is_bucket_aware_and_predecessor_is_immutable(self):
        predecessor = PREDECESSOR.read_bytes()
        self.assertEqual(len(predecessor), PREDECESSOR_BYTES)
        self.assertEqual(hashlib.sha256(predecessor).hexdigest(), PREDECESSOR_SHA256)

        source = FORWARD.read_text()
        self.assertIn("CHECK (bucket IN ('review-photos', 'review-verifications'))", source)
        self.assertIn("admin_record_storage_snapshot(p_bucket text, p_path text)", source)
        self.assertIn("admin_record_review_media(row_value jsonb)", source)
        self.assertIn("Every verification", source)
        self.assertIn("('review-verifications'::text), ('review-photos'::text)", source)
        self.assertIn("('pending', 'inflight', 'uncertain', 'done')", source)
        self.assertIn("pipeline_control.admin_record_storage_snapshot(job.bucket,job.object_name)", source)
        self.assertIn("'review-media:' || media.bucket || ':' || media.object_name", source)
        self.assertIn("ADMIN_PRIVATE_CLEANUP_ACTION_SOURCE_DRIFT", source)
        self.assertIn("FROM PUBLIC, anon, authenticated, service_role", source)
        self.assertNotIn("admin_record_media_retirement", source)
        self.assertNotIn("DELETE FROM storage.objects", source)
        self.assertNotIn("RAISE NOTICE", source)


@unittest.skipUnless(
    os.environ.get("TZUDONG_ADMIN_RECORD_LOCAL_PG") == "1",
    "owned PG17 fixture opt-in required",
)
class AdminRecordPrivateCleanupPostgreSQL(unittest.TestCase):
    """Apply the immutable predecessor then the forward migration on owned PG17."""

    cleanup = classmethod(ReviewIdentityTests.cleanup.__func__)
    scalar = ReviewIdentityTests.scalar
    good = ReviewIdentityTests.good
    @classmethod
    def setUpClass(cls):
        from backend.supabase.tests.test_admin_record_actions import AdminRecordActions

        AdminRecordActions.setUpClass.__func__(cls)
        with cls.conn.cursor() as cursor:
            cursor.execute(FORWARD.read_text())

    def setUp(self):
        self.actor = str(uuid.uuid4())
        with self.conn.cursor() as cursor:
            cursor.execute(
                "TRUNCATE pipeline_control.admin_record_media_cleanup,"
                "pipeline_control.admin_record_audit,pipeline_control.admin_record_operations,"
                "public.restaurant_request_review_audit,public.restaurant_requests,"
                "public.restaurant_submission_items,public.restaurant_submissions,public.reviews,"
                "storage.objects,public.restaurants,public.user_roles,public.user_account_status CASCADE"
            )
            cursor.execute(
                "INSERT INTO public.user_roles VALUES(%s,'admin');"
                "INSERT INTO public.user_account_status VALUES(%s,'active')",
                (self.actor, self.actor),
            )

    def call(self, phase, action=None, ids=None, payload=None, op=None, preview=None,
             actor=None, conn=None, role="service_role"):
        from psycopg2.extras import Json

        connection = conn or self.conn
        with connection.cursor() as cursor:
            cursor.execute("SET ROLE " + role)
            cursor.execute(
                "SET request.jwt.claim.role=''; "
                "SET request.jwt.claims='{\"role\":\"service_role\"}'"
            )
            try:
                cursor.execute(
                    "SELECT public.admin_record_action(%s,%s,%s,%s,%s::uuid[],%s,%s)",
                    (
                        actor or self.actor,
                        phase,
                        op or str(uuid.uuid4()),
                        action,
                        ids or [],
                        Json(payload or {}),
                        preview,
                    ),
                )
                return cursor.fetchone()[0]
            finally:
                cursor.execute("RESET ROLE")

    def preview(self, action, row=None, payload=None, ids=None):
        return self.call("preview", action, ids if ids is not None else [row["id"]], payload)

    def apply(self, ticket, payload=None):
        return self.call(
            "apply", ticket["action"], ticket["targetIds"], payload,
            ticket["operationId"], ticket["previewHash"],
        )

    def row(self, row_id):
        return self.scalar("SELECT to_jsonb(r) FROM public.restaurants r WHERE id=%s", (row_id,))

    def insert(self, row=None):
        from psycopg2.extras import Json

        row = row or self.good()
        with self.conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO public.restaurants "
                "SELECT * FROM jsonb_populate_record(NULL::public.restaurants,%s)",
                (Json(row),),
            )
        return row

    def review_with_media(self, restaurant, verification_buckets=("review-verifications",), with_food=True):
        from psycopg2.extras import Json

        review_id = str(uuid.uuid4())
        owner_id = str(uuid.uuid4())
        base = f"{owner_id}/reviews/{review_id}"
        verification = f"{base}/verification/fixture.jpg"
        food = f"{base}/food/fixture.webp"
        food_photos = [food] if with_food else []
        with self.conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO public.reviews"
                "(id,user_id,restaurant_id,title,content,visited_at,verification_photo,food_photos) "
                "VALUES(%s,%s,%s,'fixture','synthetic review content',now(),%s,%s)",
                (review_id, owner_id, restaurant["id"], verification, food_photos),
            )
            for bucket in verification_buckets:
                cursor.execute(
                    "INSERT INTO storage.objects(bucket_id,name,metadata) VALUES(%s,%s,%s)",
                    (bucket, verification, Json({"etag": f"{bucket}-v1"})),
                )
            if with_food:
                cursor.execute(
                    "INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('review-photos',%s,%s)",
                    (food, Json({"etag": "food-v1"})),
                )
        return review_id, verification, food

    def complete_absent_job(self, operation_id, job):
        self.assertIsNone(
            self.scalar(
                "SELECT pipeline_control.admin_record_storage_snapshot(%s,%s)",
                (job["bucket"], job["objectName"]),
            )
        )
        claimed = self.call(
            "cleanup_claim", op=operation_id, payload={"jobId": job["id"]}
        )
        self.assertTrue(claimed["claimed"])
        self.call("cleanup_absent", op=operation_id, payload={"jobId": job["id"]})

    def test_private_and_public_jobs_have_independent_cas_readback_and_fences(self):
        from psycopg2.extras import Json

        restaurant = self.insert()
        review_id, verification, food = self.review_with_media(restaurant)
        payload = {"reason": "privacy cleanup"}

        stale = self.preview("review.delete", payload=payload, ids=[review_id])
        with self.conn.cursor() as cursor:
            cursor.execute(
                "UPDATE storage.objects SET metadata=%s "
                "WHERE bucket_id='review-verifications' AND name=%s",
                (Json({"etag": "private-v2"}), verification),
            )
        with self.assertRaisesRegex(self.driver.Error, "RECORD_ACTION_STALE"):
            self.apply(stale, payload)
        self.assertEqual(self.scalar("SELECT count(*) FROM public.reviews"), 1)
        self.assertEqual(
            self.scalar("SELECT count(*) FROM pipeline_control.admin_record_media_cleanup"), 0
        )

        preview = self.preview("review.delete", payload=payload, ids=[review_id])
        applied = self.apply(preview, payload)
        self.assertTrue(applied["mediaCleanupPending"])
        self.assertEqual(self.apply(preview, payload), applied)
        jobs = self.call("cleanup_read", op=preview["operationId"])["jobs"]
        self.assertEqual(
            sorted((job["bucket"], job["objectName"]) for job in jobs),
            sorted([
                ("review-verifications", verification),
                ("review-photos", verification),
                ("review-photos", food),
            ]),
        )
        self.assertEqual(
            self.scalar(
                "SELECT count(*) FROM pipeline_control.admin_record_media_cleanup "
                "WHERE operation_id=%s",
                (preview["operationId"],),
            ),
            3,
        )

        private_job = next(job for job in jobs if job["bucket"] == "review-verifications")
        claimed = self.call(
            "cleanup_claim", op=preview["operationId"], payload={"jobId": private_job["id"]}
        )
        self.assertTrue(claimed["claimed"])
        with self.conn.cursor() as cursor:
            with self.assertRaisesRegex(self.driver.Error, "RECORD_ACTION_MEDIA_RETIRED"):
                cursor.execute(
                    "UPDATE storage.objects SET metadata=%s "
                    "WHERE bucket_id='review-verifications' AND name=%s",
                    (Json({"etag": "forbidden-replacement"}), verification),
                )
            with self.assertRaisesRegex(self.driver.Error, "RECORD_ACTION_MEDIA_RETIRED"):
                cursor.execute(
                    "INSERT INTO public.reviews"
                    "(id,user_id,restaurant_id,title,content,visited_at,verification_photo,food_photos) "
                    "VALUES(%s,%s,%s,'fixture','synthetic review content',now(),%s,'{}')",
                    (str(uuid.uuid4()), verification.split("/")[0], restaurant["id"], verification),
                )
        self.call(
            "cleanup_uncertain", op=preview["operationId"], payload={"jobId": private_job["id"]}
        )
        self.assertTrue(self.call("readback", op=preview["operationId"])["mediaCleanupPending"])

        food_job = next(job for job in jobs if job["objectName"] == food)
        food_claimed = self.call(
            "cleanup_claim", op=preview["operationId"], payload={"jobId": food_job["id"]}
        )
        self.assertTrue(food_claimed["claimed"])
        self.call(
            "cleanup_uncertain", op=preview["operationId"], payload={"jobId": food_job["id"]}
        )
        self.assertTrue(self.call("readback", op=preview["operationId"])["mediaCleanupPending"])
        absent_public_verification = next(
            job for job in jobs
            if job["bucket"] == "review-photos" and job["objectName"] == verification
        )
        self.complete_absent_job(preview["operationId"], absent_public_verification)
        self.assertTrue(self.call("readback", op=preview["operationId"])["mediaCleanupPending"])
        self.assertEqual(
            self.scalar(
                "SELECT jsonb_object_agg(bucket || ':' || object_name,state) "
                "FROM pipeline_control.admin_record_media_cleanup WHERE operation_id=%s",
                (preview["operationId"],),
            ),
            {
                f"review-verifications:{verification}": "uncertain",
                f"review-photos:{verification}": "done",
                f"review-photos:{food}": "uncertain",
            },
        )

        audit = self.scalar(
            "SELECT to_jsonb(a) FROM pipeline_control.admin_record_audit a WHERE operation_id=%s",
            (preview["operationId"],),
        )
        serialized_audit = json.dumps(audit)
        self.assertNotIn(verification, serialized_audit)
        self.assertNotIn(food, serialized_audit)
        self.assertEqual(self.scalar("SELECT count(*) FROM pipeline_control.admin_record_audit"), 1)

    def test_legacy_public_and_duplicate_verification_objects_are_both_managed(self):
        from psycopg2.extras import Json

        restaurant = self.insert()
        payload = {"reason": "privacy cleanup"}

        legacy_id, legacy_path, _ = self.review_with_media(
            restaurant, verification_buckets=("review-photos",), with_food=False
        )
        legacy = self.preview("review.delete", payload=payload, ids=[legacy_id])
        self.apply(legacy, payload)
        legacy_jobs = self.call("cleanup_read", op=legacy["operationId"])["jobs"]
        self.assertEqual(
            sorted((job["bucket"], job["objectName"]) for job in legacy_jobs),
            [("review-photos", legacy_path), ("review-verifications", legacy_path)],
        )
        absent_private = next(
            job for job in legacy_jobs if job["bucket"] == "review-verifications"
        )
        self.complete_absent_job(legacy["operationId"], absent_private)
        self.assertTrue(self.call("readback", op=legacy["operationId"])["mediaCleanupPending"])

        duplicate_id, duplicate_path, _ = self.review_with_media(
            restaurant,
            verification_buckets=("review-verifications", "review-photos"),
            with_food=False,
        )
        duplicate = self.preview("review.delete", payload=payload, ids=[duplicate_id])
        self.apply(duplicate, payload)
        duplicate_jobs = self.call("cleanup_read", op=duplicate["operationId"])["jobs"]
        self.assertEqual(
            sorted((job["bucket"], job["objectName"]) for job in duplicate_jobs),
            [("review-photos", duplicate_path), ("review-verifications", duplicate_path)],
        )

        changed = next(job for job in duplicate_jobs if job["bucket"] == "review-photos")
        with self.conn.cursor() as cursor:
            with self.assertRaisesRegex(self.driver.Error, "RECORD_ACTION_MEDIA_RETIRED"):
                cursor.execute(
                    "UPDATE storage.objects SET metadata=%s "
                    "WHERE bucket_id='review-photos' AND name=%s",
                    (Json({"etag": "public-v2"}), duplicate_path),
                )
        self.assertFalse(self.call("readback", op=duplicate["operationId"])["mediaCleanupUnmanaged"])
        self.assertEqual(
            self.scalar(
                "SELECT count(*) FROM pipeline_control.admin_record_media_cleanup "
                "WHERE operation_id=%s AND object_name=%s",
                (duplicate["operationId"], duplicate_path),
            ),
            2,
        )

    def test_admin_mutation_and_service_role_boundary_are_preserved(self):
        restaurant = self.insert()
        review_id, _, _ = self.review_with_media(restaurant)
        approved = self.preview("review.approve", payload={"note": "reviewed"}, ids=[review_id])
        receipt = self.apply(approved, {"note": "reviewed"})
        self.assertEqual(receipt["state"], "applied")
        self.assertTrue(self.scalar("SELECT is_verified FROM public.reviews WHERE id=%s", (review_id,)))
        self.assertEqual(
            self.scalar("SELECT count(*) FROM pipeline_control.admin_record_media_cleanup"), 0
        )
        for role in ("anon", "authenticated"):
            with self.assertRaises(self.driver.Error):
                self.call("readback", op=approved["operationId"], role=role)
        with self.conn.cursor() as cursor:
            cursor.execute(
                "SELECT has_function_privilege('anon',%s::regprocedure,'EXECUTE'),"
                "has_function_privilege('authenticated',%s::regprocedure,'EXECUTE'),"
                "has_function_privilege('service_role',%s::regprocedure,'EXECUTE')",
                (
                    "pipeline_control.admin_record_storage_snapshot(text,text)",
                    "pipeline_control.admin_record_storage_snapshot(text,text)",
                    "pipeline_control.admin_record_storage_snapshot(text,text)",
                ),
            )
            self.assertEqual(cursor.fetchone(), (False, False, True))


if __name__ == "__main__":
    unittest.main()
