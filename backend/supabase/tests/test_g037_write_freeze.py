"""Fake-connection boundary tests for the G037 single-transaction fence."""
from __future__ import annotations
import importlib.util, sys, time, unittest
from pathlib import Path
from unittest.mock import patch
MODULE=Path(__file__).parents[1]/"scripts"/"g037_write_freeze.py"; sys.path.insert(0,str(MODULE.parent))
spec=importlib.util.spec_from_file_location("freeze",MODULE); freeze=importlib.util.module_from_spec(spec); assert spec.loader; sys.modules[spec.name]=freeze; spec.loader.exec_module(freeze)
class Cursor:
 def __init__(self,fail_lock=None): self.sql=[]; self.fail_lock=fail_lock
 def execute(self,s,p=()):
  self.sql.append((s,p))
  if self.fail_lock and self.fail_lock in s: raise RuntimeError("lock denied")
 def fetchall(self): return []
 def close(self): pass
class Conn:
 def __init__(self,commit_error=False,rollback_error=False,fail_lock=None): self.c=Cursor(fail_lock); self.commits=0; self.rollbacks=0; self.commit_error=commit_error; self.rollback_error=rollback_error
 def cursor(self): return self.c
 def commit(self):
  self.commits+=1
  if self.commit_error: raise RuntimeError("network after commit")
 def rollback(self):
  self.rollbacks+=1
  if self.rollback_error: raise RuntimeError("rollback transport failure")
def inv(acl="a"):
 rs=tuple(freeze.Relation(s,n,o,"r",owner) for s,n,o,owner in (
  ("auth","schema_migrations",1,"supabase_auth_admin"),
  ("auth","users",2,"owner"),
  ("public","x",3,"owner"),
  ("storage","buckets_vectors",4,"supabase_storage_admin"),
  ("storage","migrations",5,"supabase_storage_admin"),
  ("storage","objects",6,"supabase_storage_admin"),
  ("storage","vector_indexes",7,"supabase_storage_admin"),
  ("storage","buckets",9,"supabase_storage_admin"),
  ("shortener_private","limits",8,"owner"),
  ("storage","buckets_analytics",10,"supabase_storage_admin"),
  ("storage","s3_multipart_uploads",11,"supabase_storage_admin"),
  ("storage","s3_multipart_uploads_parts",12,"supabase_storage_admin"),
 ))
 return freeze.Inventory(("auth","public","storage","shortener_private"),rs,freeze.digest([r.key for r in rs]),acl*64)
def terminal(_,spec): return {"catalog_root":"c"*64,"acl_root":"a"*64,"ledger_root":"l"*64,"terminal_spec":spec}
def capture():
 roots={"auth_storage_catalog_root":"1"*64,"auth_storage_metadata_root":"2"*64,"storage_blob_root":"3"*64,"short_urls_catalog_root":"8"*64,"short_urls_rowset_root":"9"*64,"short_urls_victim_descriptors_root":"a"*64,"short_urls_row_count":2,"duplicate_group_count":1,"duplicate_victim_count":1,"recipient_fingerprint":"4"*64,"logical_ciphertext_sha256":"5"*64,"blob_ciphertext_sha256":"6"*64,"recovery_receipt_sha256":"7"*64,"object_count":2,"total_bytes":1024}
 evidence={"schema":"g037-short-url-remediation-evidence-v1","authorization_id":"11111111-1111-4111-8111-111111111111","policy":"exact-baseline-to-terminal-ledger-single-commit-v1","execution_authorization_sha256":"b"*64,"execution_authorization_signature_sha256":"c"*64,"attempt_marker_sha256":"a"*64,"legacy_repository_commit":"0"*40,"legacy_authorization_sha256":"d"*64,"legacy_authorization_signature_sha256":"e"*64,"legacy_capture_receipt_sha256":"f"*64,"legacy_restore_receipt_sha256":"1"*64,"legacy_inspection_receipt_sha256":"2"*64,"recovery_receipt_sha256":"7"*64,"capture_short_urls_rowset_sha256":"9"*64,"pre_short_urls_rowset_sha256":"9"*64,"survivor_short_urls_rowset_sha256":"d"*64,"deleted_count":1,"duplicate_group_count_before":1,"duplicate_group_count_after":0}
 evidence["remediation_sha256"]=freeze.digest(evidence)
 return {"capture_roots":roots,"remediation_evidence":evidence}
def patches(inventory):
 return (patch.object(freeze,"_root_source",return_value=(Path("."),"a"*40,"s"*64,"t"*64)),patch.object(freeze,"validate_operator_assertion"),patch.object(freeze,"_inv",return_value=inventory),patch.object(freeze,"_locks",return_value="l"*64),patch.object(freeze,"_verify_active",side_effect=lambda v,e:freeze._verified_controller_capability({**v,"signature":"ok"})))
def precommit(receipt): return receipt["receipt_sha256"]
class FenceTests(unittest.TestCase):
 def test_remediation_evidence_requires_marker_digest_and_rehashing(self):
  evidence=capture()["remediation_evidence"]
  freeze.validate_remediation_evidence(evidence)
  missing=dict(evidence); missing.pop("attempt_marker_sha256"); missing["remediation_sha256"]=freeze.digest({key:value for key,value in missing.items() if key!="remediation_sha256"})
  with self.assertRaises(freeze.FreezeError): freeze.validate_remediation_evidence(missing)
  mutated={**evidence,"attempt_marker_sha256":"b"*64}
  with self.assertRaises(freeze.FreezeError): freeze.validate_remediation_evidence(mutated)
  extra={**evidence,"unexpected":"value"}
  extra["remediation_sha256"]=freeze.digest({key:value for key,value in extra.items() if key!="remediation_sha256"})
  with self.assertRaises(freeze.FreezeError): freeze.validate_remediation_evidence(extra)
 def test_verified_handoffs_are_immutable_and_reject_direct_construction(self):
  capability={"schema":freeze.SCHEMA,"state":"active-provisional","freeze_id":"freeze-0001","origin":"https://x","commit":"a"*40,"manifest_sha256":freeze.MANIFEST_SHA256,"source_root":"s"*64,"terminal_spec":"t"*64,"scope":{"schemas":list(freeze.REACHABLE_SCHEMAS),"ordinary_relations":"all"},"relation_root":"r"*64,"acl_root":"l"*64,"held_lock_root":"h"*64,"not_before_unix":1,"not_after_unix":2,"controller_public_key_sha256":freeze.CONTROLLER_PUBLIC_KEY_SHA256,"signature":"AA=="}
  with self.assertRaises(TypeError): freeze.VerifiedControllerCapability(capability)
  branded=freeze._verified_controller_capability(capability)
  with self.assertRaises(TypeError): branded["origin"]="https://attacker"
  with self.assertRaises(TypeError): freeze.VerifiedRecoveryCapture({})
  capture_evidence={"selection_spec_sha256":"1"*64,"short_urls_catalog_sha256":"2"*64,"short_urls_rowset_sha256":"3"*64,"short_urls_row_count":2,"duplicate_group_count":1,"duplicate_victim_count":1,"victim_descriptor_count":1,"duplicate_victims_sha256":"4"*64,"victim_descriptors_sha256":"4"*64}
  branded_capture=freeze.verified_recovery_capture(capture_evidence)
  with self.assertRaises(TypeError): branded_capture["short_urls_row_count"]=0
 def test_provider_managed_acl_allowlist_is_exact(self):
  self.assertEqual(freeze.PROVIDER_MANAGED_ACL_ALLOWLIST,frozenset((
   ("auth","audit_log_entries","supabase_auth_admin"),
   ("auth","custom_oauth_providers","supabase_auth_admin"),
   ("auth","flow_state","supabase_auth_admin"),
   ("auth","identities","supabase_auth_admin"),
   ("auth","instances","supabase_auth_admin"),
   ("auth","mfa_amr_claims","supabase_auth_admin"),
   ("auth","mfa_challenges","supabase_auth_admin"),
   ("auth","mfa_factors","supabase_auth_admin"),
   ("auth","oauth_authorizations","supabase_auth_admin"),
   ("auth","oauth_client_states","supabase_auth_admin"),
   ("auth","oauth_clients","supabase_auth_admin"),
   ("auth","oauth_consents","supabase_auth_admin"),
   ("auth","one_time_tokens","supabase_auth_admin"),
   ("auth","refresh_tokens","supabase_auth_admin"),
   ("auth","saml_providers","supabase_auth_admin"),
   ("auth","saml_relay_states","supabase_auth_admin"),
   ("auth","schema_migrations","supabase_auth_admin"),
   ("auth","sessions","supabase_auth_admin"),
   ("auth","sso_domains","supabase_auth_admin"),
   ("auth","sso_providers","supabase_auth_admin"),
   ("auth","users","supabase_auth_admin"),
   ("auth","webauthn_challenges","supabase_auth_admin"),
   ("auth","webauthn_credentials","supabase_auth_admin"),
   ("storage","buckets","supabase_storage_admin"),
   ("storage","objects","supabase_storage_admin"),
  )))
 def test_acl_inventory_uses_same_ordinary_relation_kinds_as_catalog(self):
  queries=[]
  schemas=tuple((schema,) for schema in freeze.REACHABLE_SCHEMAS)
  relations=(
   ("auth","schema_migrations",1,"r","supabase_auth_admin"),
   ("storage","buckets_vectors",2,"r","supabase_storage_admin"),
   ("storage","migrations",3,"r","supabase_storage_admin"),
   ("storage","vector_indexes",4,"r","supabase_storage_admin"),
   ("public","table_row",5,"r","owner"),
   ("public","partition_row",6,"p","owner"),
  )
  acl=(("public",5,"owner","owner","SELECT",False),("public",6,"owner","owner","SELECT",False))
  def rows(_,sql,params=()):
   queries.append(sql)
   if "pg_get_userbyid" in sql: return relations
   if "aclexplode" in sql: return acl
   return schemas
  with patch.object(freeze,"_rows",side_effect=rows):
   inventory=freeze._inv(Conn())
  acl_query=next(sql for sql in queries if "aclexplode" in sql)
  self.assertIn("c.relkind IN ('r','p')",acl_query)
  self.assertEqual({relation.kind for relation in inventory.relations},{"r","p"})
  self.assertEqual(inventory.acl_root,freeze.digest(tuple(sorted(acl))))
 def test_public_ordinary_acl_allowlist_is_exact_and_fail_closed(self):
  all_privileges=freeze._TABLE_PRIVILEGES
  expected_projection={
   "ad_banners":{"anon":("SELECT",),"authenticated":("DELETE","INSERT","SELECT","UPDATE"),"service_role":all_privileges},
   "admin_audit_events":{"authenticated":("SELECT",),"service_role":all_privileges},
   "admin_restaurant_map_overlays":{"service_role":all_privileges},
   "admin_user_preferences":{"authenticated":("INSERT","SELECT","UPDATE"),"service_role":all_privileges},
   "admin_workflow_runs":{"authenticated":("SELECT",),"service_role":all_privileges},
   "admin_workflow_signals":{"authenticated":("SELECT",),"service_role":all_privileges},
   "admin_workflow_steps":{"authenticated":("SELECT",),"service_role":all_privileges},
   "announcements":{"anon":("SELECT",),"authenticated":("DELETE","INSERT","SELECT","UPDATE"),"service_role":all_privileges},
   "document_embeddings":{"service_role":all_privileges},"documents":{"authenticated":("DELETE","INSERT","SELECT","UPDATE"),"service_role":all_privileges},
   "notifications":{"authenticated":("DELETE","INSERT","SELECT","UPDATE"),"service_role":all_privileges},"ocr_logs":{"authenticated":("INSERT","SELECT"),"service_role":all_privileges},
   "profiles":{"anon":("SELECT",),"authenticated":("INSERT","SELECT","UPDATE"),"service_role":all_privileges},
   "restaurant_popular_rank_snapshots":{"anon":("SELECT",),"authenticated":("SELECT",),"service_role":all_privileges},
   "restaurant_refresh_candidates":{"authenticated":("INSERT","SELECT","UPDATE"),"service_role":all_privileges},
   "restaurant_refresh_runs":{"authenticated":("INSERT","SELECT","UPDATE"),"service_role":all_privileges},
   "restaurant_request_review_audit":{"authenticated":("SELECT",),"service_role":all_privileges},
   "restaurant_requests":{"authenticated":("INSERT","SELECT","UPDATE"),"service_role":all_privileges},
   "restaurant_submission_items":{"authenticated":("DELETE","INSERT","SELECT","UPDATE"),"service_role":all_privileges},
   "restaurant_submissions":{"authenticated":("DELETE","INSERT","SELECT","UPDATE"),"service_role":all_privileges},
   "restaurants":{"anon":("SELECT",),"authenticated":("SELECT","UPDATE"),"service_role":all_privileges},
   "restaurants_duplicate":{"service_role":all_privileges},"review_likes":{"anon":("SELECT",),"authenticated":("DELETE","INSERT","SELECT"),"service_role":all_privileges},
   "reviews":{"anon":("SELECT",),"authenticated":("DELETE","INSERT","SELECT","UPDATE"),"service_role":all_privileges},
   "search_logs":{"anon":("INSERT",),"authenticated":("INSERT","SELECT"),"service_role":all_privileges},
   "short_urls":{"anon":("SELECT",),"authenticated":("SELECT",),"service_role":all_privileges},
   "transcript_embeddings_bge":{"anon":("SELECT",),"authenticated":("SELECT",),"service_role":all_privileges},
   "user_account_status":{"authenticated":("SELECT",),"service_role":all_privileges},
   "user_bookmarks":{"anon":("SELECT",),"authenticated":("DELETE","INSERT","SELECT"),"service_role":all_privileges},
   "user_roles":{"authenticated":("SELECT",),"service_role":all_privileges},"user_stats":{"anon":("SELECT",),"authenticated":("SELECT",),"service_role":all_privileges},
   "video_frame_captions":{"anon":("SELECT",),"authenticated":("SELECT",),"service_role":all_privileges},
   "videos":{"anon":("SELECT",),"authenticated":("SELECT",),"service_role":all_privileges},
   "youtube_channel_kpi_snapshots":{"service_role":all_privileges},"youtube_video_kpi_snapshots":{"service_role":all_privileges},
  }
  self.assertEqual(freeze.PUBLIC_ORDINARY_ACL_DECLARATION,expected_projection)
  expected=frozenset(
   ("public",relation,"postgres",grantee,privilege)
   for relation,grantees in expected_projection.items()
   for grantee,privileges in grantees.items() for privilege in privileges
  )
  self.assertEqual(freeze.PUBLIC_ORDINARY_ACL_ALLOWLIST,expected)
  self.assertEqual(len(expected),362)
  relations=tuple(freeze.Relation("public",name,index,"r","postgres")
                  for index,name in enumerate(expected_projection,1))
  oids={relation.name:relation.oid for relation in relations}
  rows=tuple(("public",oids[name],"postgres",grantee,privilege,False)
             for _,name,_,grantee,privilege in expected)
  self.assertEqual(freeze.validate_table_acl_rows(rows,relations),rows)
  for unsafe in (
   ("public",999,"postgres","anon","SELECT",False),
   ("public",oids["restaurants"],"postgres","authenticated","DELETE",False),
   ("public",oids["restaurants"],"postgres","arbitrary_role","SELECT",False),
   ("public",oids["restaurants"],"other","authenticated","SELECT",False),
   ("public",oids["restaurants"],"postgres","authenticated","SELECT",True),
  ):
   with self.subTest(unsafe=unsafe),self.assertRaisesRegex(freeze.FreezeError,"relation ACL"):
    freeze.validate_table_acl_rows((unsafe,),relations+(freeze.Relation("public","unlisted",999,"r","postgres"),))
  wrong_owner=(freeze.Relation("public","restaurants",oids["restaurants"],"r","other"),)
  with self.assertRaisesRegex(freeze.FreezeError,"relation ACL"):
   freeze.validate_table_acl_rows((("public",oids["restaurants"],"other","authenticated","SELECT",False),),wrong_owner)
 def test_g014_terminal_acl_declaration_is_exact_and_phase_bound(self):
  allowlist=freeze.G014_TERMINAL_ORDINARY_ACL_ALLOWLIST
  self.assertEqual(len(allowlist),228)
  relation_keys=sorted({(schema,name,owner) for schema,name,owner,_,_,_ in allowlist})
  relations=tuple(freeze.Relation(schema,name,index,"r",owner)
                  for index,(schema,name,owner) in enumerate(relation_keys,1))
  rows=tuple(sorted(allowlist))
  self.assertEqual(freeze.validate_table_acl_rows(rows,relations,terminal=True),rows)
  sample=rows[0]
  unsafe=(
   (*sample[:3],"PUBLIC",sample[4],False),
   (*sample[:5],True),
  )
  for row in unsafe:
   with self.subTest(row=row),self.assertRaisesRegex(freeze.FreezeError,"relation ACL"):
    freeze.validate_table_acl_rows((row,),relations,terminal=True)
  with self.assertRaisesRegex(freeze.FreezeError,"relation ACL"):
   freeze.validate_table_acl_rows((sample,),relations,terminal=False)
 def test_provider_storage_client_acl_allowlist_is_exact_and_fail_closed(self):
  expected={
   "buckets":freeze._TABLE_PRIVILEGES,
   "buckets_analytics":freeze._TABLE_PRIVILEGES,
   "objects":freeze._TABLE_PRIVILEGES,
   "buckets_vectors":frozenset(("SELECT",)),
   "s3_multipart_uploads":frozenset(("SELECT",)),
   "s3_multipart_uploads_parts":frozenset(("SELECT",)),
   "vector_indexes":frozenset(("SELECT",)),
  }
  self.assertEqual(freeze.PROVIDER_STORAGE_CLIENT_ACL_ALLOWLIST,frozenset(
   ("storage",name,"supabase_storage_admin",privilege)
   for name,privileges in expected.items() for privilege in privileges
  ))
  relations=(freeze.Relation("auth","schema_migrations",1,"r","supabase_auth_admin"),)+tuple(
   freeze.Relation("storage",name,index,"r","supabase_storage_admin")
   for index,name in enumerate(expected,1))
  rows=tuple(("storage",index,"supabase_storage_admin",grantee,privilege,False)
             for index,(name,privileges) in enumerate(expected.items(),1)
             for grantee in ("anon","authenticated") for privilege in privileges)
  self.assertEqual(freeze.validate_table_acl_rows(rows,relations),rows)
  by_name={relation.name:relation.oid for relation in relations}
  for unsafe in (
   ("storage",by_name["buckets_vectors"],"supabase_storage_admin","anon","UPDATE",False),
   ("storage",by_name["buckets"],"supabase_storage_admin","anon","SELECT",True),
   ("storage",by_name["buckets"],"other","anon","SELECT",False),
   ("auth",1,"supabase_auth_admin","anon","SELECT",False),
  ):
   with self.subTest(unsafe=unsafe),self.assertRaisesRegex(freeze.FreezeError,"relation ACL"):
    freeze.validate_table_acl_rows((unsafe,),relations)
  extra=relations+(freeze.Relation("storage","unlisted",99,"r","supabase_storage_admin"),)
  with self.assertRaisesRegex(freeze.FreezeError,"relation ACL"):
   freeze.validate_table_acl_rows((("storage",99,"supabase_storage_admin","anon","SELECT",False),),extra)
 def test_provider_storage_service_acl_allowlist_is_exact_and_non_grantable(self):
  expected=frozenset((
   ("storage","buckets","supabase_storage_admin","SELECT"),
   ("storage","buckets","supabase_storage_admin","INSERT"),
   ("storage","buckets","supabase_storage_admin","UPDATE"),
   ("storage","buckets","supabase_storage_admin","DELETE"),
   ("storage","buckets","supabase_storage_admin","TRUNCATE"),
   ("storage","buckets","supabase_storage_admin","REFERENCES"),
   ("storage","buckets","supabase_storage_admin","TRIGGER"),
   ("storage","buckets","supabase_storage_admin","MAINTAIN"),
   ("storage","buckets_analytics","supabase_storage_admin","SELECT"),
   ("storage","buckets_analytics","supabase_storage_admin","INSERT"),
   ("storage","buckets_analytics","supabase_storage_admin","UPDATE"),
   ("storage","buckets_analytics","supabase_storage_admin","DELETE"),
   ("storage","buckets_analytics","supabase_storage_admin","TRUNCATE"),
   ("storage","buckets_analytics","supabase_storage_admin","REFERENCES"),
   ("storage","buckets_analytics","supabase_storage_admin","TRIGGER"),
   ("storage","buckets_analytics","supabase_storage_admin","MAINTAIN"),
   ("storage","objects","supabase_storage_admin","SELECT"),
   ("storage","objects","supabase_storage_admin","INSERT"),
   ("storage","objects","supabase_storage_admin","UPDATE"),
   ("storage","objects","supabase_storage_admin","DELETE"),
   ("storage","objects","supabase_storage_admin","TRUNCATE"),
   ("storage","objects","supabase_storage_admin","REFERENCES"),
   ("storage","objects","supabase_storage_admin","TRIGGER"),
   ("storage","objects","supabase_storage_admin","MAINTAIN"),
   ("storage","buckets_vectors","supabase_storage_admin","SELECT"),
   ("storage","s3_multipart_uploads","supabase_storage_admin","SELECT"),
   ("storage","s3_multipart_uploads","supabase_storage_admin","INSERT"),
   ("storage","s3_multipart_uploads","supabase_storage_admin","UPDATE"),
   ("storage","s3_multipart_uploads","supabase_storage_admin","DELETE"),
   ("storage","s3_multipart_uploads","supabase_storage_admin","TRUNCATE"),
   ("storage","s3_multipart_uploads","supabase_storage_admin","REFERENCES"),
   ("storage","s3_multipart_uploads","supabase_storage_admin","TRIGGER"),
   ("storage","s3_multipart_uploads","supabase_storage_admin","MAINTAIN"),
   ("storage","s3_multipart_uploads_parts","supabase_storage_admin","SELECT"),
   ("storage","s3_multipart_uploads_parts","supabase_storage_admin","INSERT"),
   ("storage","s3_multipart_uploads_parts","supabase_storage_admin","UPDATE"),
   ("storage","s3_multipart_uploads_parts","supabase_storage_admin","DELETE"),
   ("storage","s3_multipart_uploads_parts","supabase_storage_admin","TRUNCATE"),
   ("storage","s3_multipart_uploads_parts","supabase_storage_admin","REFERENCES"),
   ("storage","s3_multipart_uploads_parts","supabase_storage_admin","TRIGGER"),
   ("storage","s3_multipart_uploads_parts","supabase_storage_admin","MAINTAIN"),
   ("storage","vector_indexes","supabase_storage_admin","SELECT"),
  ))
  self.assertEqual(freeze.PROVIDER_STORAGE_SERVICE_ACL_ALLOWLIST,expected)
  names=tuple(sorted({name for _,name,_,_ in expected}))
  relations=tuple(freeze.Relation("storage",name,index,"r","supabase_storage_admin")
                  for index,name in enumerate(names,1))
  by_name={relation.name:relation.oid for relation in relations}
  rows=tuple(("storage",by_name[name],owner,"service_role",privilege,False)
             for _,name,owner,privilege in expected)
  self.assertEqual(freeze.validate_table_acl_rows(rows,relations),rows)
  for unsafe in (
   ("storage",by_name["buckets_vectors"],"supabase_storage_admin","service_role","UPDATE",False),
   ("storage",by_name["vector_indexes"],"supabase_storage_admin","service_role","UPDATE",False),
   ("storage",by_name["buckets"],"supabase_storage_admin","service_role","SELECT",True),
  ):
   with self.subTest(unsafe=unsafe),self.assertRaisesRegex(freeze.FreezeError,"relation ACL"):
    freeze.validate_table_acl_rows((unsafe,),relations)
  public_relation=(freeze.Relation("public","application_table",99,"r","application_owner"),)
  for grantee in ("anon","authenticated","service_role"):
   unsafe=("public",99,"application_owner",grantee,"SELECT",False)
   with self.subTest(unsafe=unsafe),self.assertRaisesRegex(freeze.FreezeError,"relation ACL"):
    freeze.validate_table_acl_rows((unsafe,),public_relation)
 def test_relation_acl_policy_rejects_unsafe_rows_before_freeze_callback(self):
  i=inv()
  accepted=(("public",3,"owner","owner","SELECT",True),("auth",1,"supabase_auth_admin","supabase_auth_admin","MAINTAIN",False),("auth",1,"supabase_auth_admin","postgres","SELECT",True),("storage",9,"supabase_storage_admin","postgres","UPDATE",True),("storage",6,"supabase_storage_admin","postgres","INSERT",True))
  self.assertEqual(freeze.validate_table_acl_rows(accepted,i.relations),accepted)
  for unsafe in (
   ("public",3,"owner","other","SELECT",True),
   ("public",3,"other","owner","SELECT",True),
   ("public",3,"owner","PUBLIC","SELECT",False),
   ("public",3,"owner","PUBLIC","SELECT",True),
   ("public",3,"owner","service_role","SELECT",True),
   ("public",3,"owner","owner","UNKNOWN",False),
   ("shortener_private",8,"owner","authenticated","SELECT",False),
   ("public",999,"owner","owner","SELECT",False),
   ("public",3,"owner","postgres","SELECT",True),
   ("auth",2,"owner","postgres","SELECT",True),
   ("auth",1,"owner","postgres","SELECT",True),
   ("auth",1,"supabase_auth_admin","service_role","SELECT",True),
   ("storage",7,"supabase_storage_admin","postgres","SELECT",True),
  ):
   with self.subTest(unsafe=unsafe),self.assertRaisesRegex(freeze.FreezeError,"relation ACL"):
    freeze.validate_table_acl_rows((unsafe,),i.relations)
  wrong_owner=tuple(freeze.Relation(r.schema,r.name,r.oid,r.kind,"other" if r.schema=="auth" and r.name=="schema_migrations" else r.owner) for r in i.relations)
  with self.assertRaisesRegex(freeze.FreezeError,"relation ACL"):
   freeze.validate_table_acl_rows((("auth",1,"other","postgres","SELECT",True),),wrong_owner)
  callback=[]
  def unsafe_inventory(_):
   freeze.validate_table_acl_rows((("public",3,"owner","PUBLIC","SELECT",False),),i.relations)
  with patch.object(freeze,"_root_source",return_value=(Path("."),"a"*40,"s"*64,"t"*64)),patch.object(freeze,"validate_operator_assertion"),patch.object(freeze,"_inv",side_effect=unsafe_inventory):
   with self.assertRaises(freeze.FreezeError):
    freeze.run(Conn(),origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:callback.append(True),provisional_writer=lambda p:p,precommit_receipt_writer=precommit,final_receipt_writer=lambda _:None,terminal_assert=terminal)
  self.assertEqual(callback,[])
 def test_relation_acl_policy_is_closed_world_by_role_and_provider_relation(self):
  relations=(
   freeze.Relation("public","restaurants",1,"r","postgres"),
   freeze.Relation("auth","oauth_clients",2,"r","supabase_auth_admin"),
   freeze.Relation("storage","s3_multipart_uploads",3,"r","supabase_storage_admin"),
   freeze.Relation("storage","unlisted",4,"r","supabase_storage_admin"),
   freeze.Relation("shortener_private","limits",5,"r","owner"),
  )
  accepted=(
   ("public",1,"postgres","service_role","SELECT",False),
   ("auth",2,"supabase_auth_admin","dashboard_user","UPDATE",False),
   ("storage",3,"supabase_storage_admin","service_role","DELETE",False),
   ("storage",3,"supabase_storage_admin","authenticated","SELECT",False),
  )
  self.assertEqual(freeze.validate_table_acl_rows(accepted,relations),accepted)
  for unsafe in (
   ("public",1,"postgres","arbitrary_role","SELECT",False),
   ("public",1,"other","authenticated","SELECT",False),
   ("shortener_private",5,"owner","authenticated","SELECT",False),
   ("auth",2,"supabase_auth_admin","arbitrary_role","SELECT",False),
   ("auth",2,"other","dashboard_user","SELECT",False),
   ("auth",2,"supabase_auth_admin","dashboard_user","SELECT",True),
   ("auth",2,"supabase_auth_admin","dashboard_user","UNKNOWN",False),
   ("storage",4,"supabase_storage_admin","service_role","SELECT",False),
   ("storage",3,"other","service_role","SELECT",False),
   ("storage",3,"supabase_storage_admin","service_role","SELECT",True),
   ("storage",3,"supabase_storage_admin","service_role","UNKNOWN",False),
   ("storage",3,"supabase_storage_admin","authenticated","SELECT",True),
  ):
   with self.subTest(unsafe=unsafe),self.assertRaisesRegex(freeze.FreezeError,"relation ACL"):
    freeze.validate_table_acl_rows((unsafe,),relations)
 def test_active_verifier_rejects_signature_lookalike(self):
  payload={"schema":freeze.SCHEMA,"state":"active-provisional","freeze_id":"freeze-0001","origin":"https://x","commit":"a"*40,"manifest_sha256":freeze.MANIFEST_SHA256,"source_root":"s"*64,"terminal_spec":"t"*64,"scope":{"schemas":list(freeze.REACHABLE_SCHEMAS),"ordinary_relations":"all"},"relation_root":"r"*64,"acl_root":"l"*64,"held_lock_root":"a"*64,"not_before_unix":1,"not_after_unix":2,"controller_public_key_sha256":freeze.CONTROLLER_PUBLIC_KEY_SHA256}
  with self.assertRaisesRegex(freeze.FreezeError,"signature invalid"): freeze._verify_active({**payload,"signature":"AA=="},set(payload))
 def test_exact_provider_managed_exclusions_are_inventory_only(self):
  c=Conn(); i=inv()
  with patch.object(freeze,"_inv",return_value=i): self.assertEqual(freeze.preflight(c),i)
  locks=[sql for sql,_ in c.c.sql if sql.startswith("LOCK TABLE")]
  self.assertTrue(any('"public"."x"' in sql for sql in locks))
  self.assertFalse(any(name in sql for name in ('"schema_migrations"','"buckets_vectors"','"migrations"','"vector_indexes"') for sql in locks))
  self.assertEqual(i.relation_root,freeze.digest([r.key for r in i.relations]))
  self.assertEqual({(r.schema,r.name,r.owner) for r in i.relations if (r.schema,r.name,r.owner) in freeze.PROVIDER_MANAGED_LOCK_EXCLUSIONS},freeze.PROVIDER_MANAGED_LOCK_EXCLUSIONS)
  class HeldCursor(Cursor):
   def fetchall(self):
    if "FROM pg_locks l" in self.sql[-1][0]: return [(r.schema,r.name,r.oid) for r in freeze._lockable_relations(i.relations)]
    if "count(*) FROM pg_locks" in self.sql[-1][0]: return [(0,)]
    return []
  held=HeldCursor()
  self.assertEqual(freeze._locks(held,i.relations,60),freeze.digest([(r.schema,r.name,r.oid) for r in freeze._lockable_relations(i.relations)]))
  self.assertFalse(any(name in sql for name in ('"schema_migrations"','"buckets_vectors"','"migrations"','"vector_indexes"') for sql,_ in held.sql if sql.startswith("LOCK TABLE")))
  self.assertEqual(held.sql[:3],[("SET LOCAL statement_timeout = '60s'",()),("SET LOCAL lock_timeout = '60s'",()),("SET LOCAL idle_in_transaction_session_timeout = '60s'",())])
 def test_lock_timeout_rejects_invalid_values_before_sql(self):
  for seconds in (True,False,0,901,"60","1; SELECT pg_sleep(1)"):
   with self.subTest(seconds=seconds):
    c=Cursor()
    with self.assertRaisesRegex(freeze.FreezeError,"lock timeout seconds must be between 1 and 900"):
     freeze._locks(c,(),seconds)
    self.assertEqual(c.sql,[])
 def test_owner_drift_in_provider_managed_exclusion_rejects(self):
  i=inv(); relations=tuple(freeze.Relation(r.schema,r.name,r.oid,r.kind,"wrong-owner") if r.name=="migrations" else r for r in i.relations)
  drifted=freeze.Inventory(i.schemas,relations,freeze.digest([r.key for r in relations]),i.acl_root)
  with patch.object(freeze,"_inv",return_value=drifted),self.assertRaisesRegex(freeze.FreezeError,"provider-managed lock exclusion inventory drift"):
   freeze.preflight(Conn())
 def test_extra_un_lockable_relation_rejects(self):
  i=inv(); extra=freeze.Relation("public","un_lockable",99,"r","owner")
  expanded=freeze.Inventory(i.schemas,i.relations+(extra,),freeze.digest([r.key for r in i.relations+(extra,)]),i.acl_root)
  with patch.object(freeze,"_inv",return_value=expanded),self.assertRaisesRegex(freeze.FreezeError,"all non-provider-managed reachable relations must be lockable"):
   freeze.preflight(Conn(fail_lock='"un_lockable"'))
 def test_preflight_uses_ordinary_rolled_back_transaction(self):
  c=Conn(); i=inv()
  with patch.object(freeze,"_inv",return_value=i): self.assertEqual(freeze.preflight(c),i)
  self.assertEqual(c.c.sql[0][0],"BEGIN"); self.assertEqual(c.rollbacks,1)
 def test_missing_precommit_persistence_rolls_back_without_commit(self):
  c=Conn(); i=inv(); ps=patches(i)
  with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaisesRegex(freeze.FreezeError,"failed-rolled-back"):
   freeze.run(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:capture(),provisional_writer=lambda p:p,precommit_receipt_writer=lambda _:(_ for _ in ()).throw(RuntimeError()),final_receipt_writer=lambda _:None,terminal_assert=terminal)
  self.assertEqual(c.commits,0); self.assertGreater(c.rollbacks,0)
 def test_prepared_receipt_is_durable_before_single_commit(self):
  c=Conn(); i=inv(); ps=patches(i); events=[]
  def writer(receipt): events.append((receipt["status"],c.commits)); return receipt["receipt_sha256"]
  with ps[0],ps[1],ps[2],ps[3],ps[4]:
   self.assertEqual(freeze.run(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:capture(),provisional_writer=lambda p:p,precommit_receipt_writer=writer,final_receipt_writer=lambda r:events.append((r["status"],r["precommit_receipt_sha256"])),terminal_assert=terminal),capture())
  self.assertEqual(events[0],("prepared-not-committed",0)); self.assertEqual(c.commits,1); self.assertEqual(events[1][0],"committed")
 def test_old_prepared_writer_hashes_payload_with_claim_and_is_rejected(self):
  c=Conn(); i=inv(); ps=patches(i)
  with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaisesRegex(freeze.FreezeError,"failed-rolled-back"):
   freeze.run(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:capture(),provisional_writer=lambda p:p,precommit_receipt_writer=lambda receipt:freeze.digest(receipt),final_receipt_writer=lambda _:None,terminal_assert=terminal)
  self.assertEqual(c.commits,0)
 def test_commit_ambiguity_retains_precommit_hash(self):
  c=Conn(commit_error=True); i=inv(); ps=patches(i); final=[]
  with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaisesRegex(freeze.FreezeError,"commit-ambiguous"):
   freeze.run(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:capture(),provisional_writer=lambda p:p,precommit_receipt_writer=precommit,final_receipt_writer=final.append,terminal_assert=terminal)
  self.assertEqual(final[-1]["status"],"commit-ambiguous"); self.assertTrue(final[-1]["precommit_receipt_sha256"])
 def test_acl_drift_after_locks_denies_capability(self):
  c=Conn(); i=inv(); ps=patches(i)
  with ps[0],ps[1],patch.object(freeze,"_inv",side_effect=(i,inv("b"))),ps[3],ps[4],self.assertRaises(freeze.FreezeError):
   freeze.run(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:capture(),provisional_writer=lambda p:p,precommit_receipt_writer=precommit,final_receipt_writer=lambda _:None,terminal_assert=terminal)
 def test_residual_evidence_requires_exact_fresh_hashed_objects(self):
  now=int(time.time()); channels=("producer_stop","no_owner_write","no_dashboard_write","no_provider_write","no_out_of_band_write")
  value={"schema":"g037-write-freeze-assertion-v1","freeze_id":"freeze-0001","origin":"https://x","commit":"a"*40,"manifest_sha256":freeze.MANIFEST_SHA256,"relation_root":"r"*64,"acl_root":"l"*64,"source_root":"s"*64,"terminal_spec":"t"*64,"issued_at":now-1,"expires_at":now+60,"attestations":{x:{"status":True,"evidence_sha256":"e"*64,"observed_at":now} for x in channels},"signature":"AA=="}
  value["attestations"]["producer_stop"]["status"]=False
  with self.assertRaisesRegex(Exception,"residual"): freeze.validate_operator_assertion(value,freeze_id="freeze-0001",origin="https://x",relation_root="r"*64,acl_root="l"*64,commit="a"*40,source_root="s"*64,terminal_spec="t"*64,now=now)
  value["attestations"]["producer_stop"]={"status":True,"evidence_sha256":"e"*64,"observed_at":now-901}
  with self.assertRaisesRegex(Exception,"residual"): freeze.validate_operator_assertion(value,freeze_id="freeze-0001",origin="https://x",relation_root="r"*64,acl_root="l"*64,now=now)
 def test_operator_assertion_rejects_missing_extra_and_tampered_signature(self):
  now=int(time.time()); channels=("producer_stop","no_owner_write","no_dashboard_write","no_provider_write","no_out_of_band_write")
  value={"schema":"g037-write-freeze-assertion-v1","freeze_id":"freeze-0001","origin":"https://x","commit":"a"*40,"manifest_sha256":freeze.MANIFEST_SHA256,"relation_root":"r"*64,"acl_root":"l"*64,"source_root":"s"*64,"terminal_spec":"t"*64,"issued_at":now-1,"expires_at":now+60,"attestations":{x:{"status":True,"evidence_sha256":"e"*64,"observed_at":now} for x in channels},"signature":"AA=="}
  for invalid in ({k:v for k,v in value.items() if k!="signature"},{**value,"extra":True}):
   with self.assertRaisesRegex(Exception,"fields mismatch"): freeze.validate_operator_assertion(invalid,freeze_id="freeze-0001",origin="https://x",relation_root="r"*64,acl_root="l"*64,commit="a"*40,source_root="s"*64,terminal_spec="t"*64,now=now)
  tampered={**value,"signature":"AQ=="}
  with self.assertRaisesRegex(Exception,"signature invalid"): freeze.validate_operator_assertion(tampered,freeze_id="freeze-0001",origin="https://x",relation_root="r"*64,acl_root="l"*64,commit="a"*40,source_root="s"*64,terminal_spec="t"*64,now=now)
 def test_rehearse_runs_terminal_then_rolls_back_and_never_commits(self):
  c=Conn(); i=inv(); ps=patches(i); events=[]
  def callback(cursor,*_):
   self.assertFalse(any(sql.startswith("SAVEPOINT") for sql,_ in cursor.sql))
   cursor.execute("SELECT pg_export_snapshot()")
   events.append("apply")
   return capture()
  def observed(*_): events.append("terminal"); return terminal(*_)
  with ps[0],ps[1],ps[2],ps[3],ps[4]:
   outcome=freeze.rehearse(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=callback,provisional_writer=lambda p:p,rehearsal_receipt_writer=lambda r:r["receipt_sha256"],outcome_receipt_writer=lambda r:r["receipt_sha256"],terminal_assert=observed,baseline_assert=lambda:events.append("baseline") or {"relation_root":i.relation_root,"acl_root":i.acl_root})
  self.assertEqual(outcome["status"],"rehearsed-rolled-back"); self.assertEqual(c.commits,0)
  self.assertLess(events.index("apply"),events.index("terminal")); self.assertLess(events.index("terminal"),events.index("baseline")); self.assertEqual(c.rollbacks,1)
  self.assertTrue(any(sql=="SELECT pg_export_snapshot()" for sql,_ in c.c.sql))
  self.assertFalse(any(sql.startswith("SAVEPOINT") for sql,_ in c.c.sql))
 def test_rehearse_rejects_malformed_capture_before_rollback_receipt(self):
  c=Conn(); i=inv(); ps=patches(i); receipts=[]
  with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaises(freeze.FreezeError):
   freeze.rehearse(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:{},provisional_writer=lambda p:p,rehearsal_receipt_writer=lambda r:receipts.append(r),outcome_receipt_writer=lambda r:receipts.append(r),terminal_assert=terminal,baseline_assert=lambda:{})
  self.assertEqual(receipts,[]); self.assertEqual(c.commits,0)
 def test_rehearse_callback_failure_rolls_back_without_success_outcome(self):
  c=Conn(); i=inv(); ps=patches(i); outcomes=[]
  with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaisesRegex(RuntimeError,"callback failure"):
   freeze.rehearse(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:(_ for _ in ()).throw(RuntimeError("callback failure")),provisional_writer=lambda p:p,rehearsal_receipt_writer=lambda r:r["receipt_sha256"],outcome_receipt_writer=outcomes.append,terminal_assert=terminal,baseline_assert=lambda:{})
  self.assertEqual(c.commits,0); self.assertEqual(c.rollbacks,1); self.assertEqual(outcomes,[])
 def test_rehearse_terminal_failure_rolls_back_outer_transaction_without_commit(self):
  c=Conn(); i=inv(); ps=patches(i)
  with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaisesRegex(RuntimeError,"terminal failure"):
   freeze.rehearse(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:capture(),provisional_writer=lambda p:p,rehearsal_receipt_writer=lambda r:r["receipt_sha256"],outcome_receipt_writer=lambda r:r["receipt_sha256"],terminal_assert=lambda *_:(_ for _ in ()).throw(RuntimeError("terminal failure")),baseline_assert=lambda:{})
  self.assertEqual(c.commits,0); self.assertEqual(c.rollbacks,1)
 def test_rehearse_receipt_failures_follow_outer_rollback_without_commit(self):
  for receipt_name in ("rehearsal","outcome"):
   with self.subTest(receipt_name=receipt_name):
    c=Conn(); i=inv(); ps=patches(i)
    rehearsal_writer=(lambda _:(_ for _ in ()).throw(RuntimeError("rehearsal receipt failure"))) if receipt_name=="rehearsal" else lambda r:r["receipt_sha256"]
    outcome_writer=(lambda _:(_ for _ in ()).throw(RuntimeError("outcome receipt failure"))) if receipt_name=="outcome" else lambda r:r["receipt_sha256"]
    with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaisesRegex(RuntimeError,"receipt failure"):
     freeze.rehearse(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:capture(),provisional_writer=lambda p:p,rehearsal_receipt_writer=rehearsal_writer,outcome_receipt_writer=outcome_writer,terminal_assert=terminal,baseline_assert=lambda:{"relation_root":i.relation_root,"acl_root":i.acl_root})
    self.assertEqual(c.commits,0); self.assertGreaterEqual(c.rollbacks,1)
 def test_rehearse_rollback_failure_is_ambiguous_and_preserves_original_failure(self):
  c=Conn(rollback_error=True); i=inv(); ps=patches(i); outcomes=[]
  original=RuntimeError("callback failure includes secret")
  with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaises(freeze.RehearsalRollbackError) as raised:
   freeze.rehearse(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:(_ for _ in ()).throw(original),provisional_writer=lambda p:p,rehearsal_receipt_writer=lambda r:r["receipt_sha256"],outcome_receipt_writer=lambda r:outcomes.append(r) or r["receipt_sha256"],terminal_assert=terminal,baseline_assert=lambda:{})
  self.assertIs(raised.exception.original_error,original); self.assertIsInstance(raised.exception.rollback_error,RuntimeError); self.assertIsNone(raised.exception.__cause__)
  self.assertEqual(c.commits,0); self.assertGreaterEqual(c.rollbacks,1); self.assertEqual(len(outcomes),1)
  self.assertEqual(outcomes[0]["status"],"rollback-failed"); self.assertEqual(outcomes[0]["rollback_state"],"ambiguous")
  self.assertEqual(outcomes[0]["failure_stage"],"callback-running"); self.assertNotIn("secret",str(outcomes[0]))
 def test_rehearse_direct_rollback_and_outcome_receipt_failure_are_composite(self):
  c=Conn(rollback_error=True); i=inv(); ps=patches(i); outcomes=[]; writer_error=RuntimeError("outcome receipt secret")
  def outcome_writer(outcome):
   outcomes.append(outcome)
   raise writer_error
  with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaises(freeze.RehearsalRollbackReceiptError) as raised:
   freeze.rehearse(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:capture(),provisional_writer=lambda p:p,rehearsal_receipt_writer=lambda r:r["receipt_sha256"],outcome_receipt_writer=outcome_writer,terminal_assert=terminal,baseline_assert=lambda:{})
  self.assertIsInstance(raised.exception.original_error,freeze.FreezeError); self.assertIsInstance(raised.exception.rollback_error,RuntimeError); self.assertIs(raised.exception.outcome_receipt_error,writer_error)
  self.assertEqual(str(raised.exception),"rollback-failed-outcome-receipt-failed"); self.assertNotIn("secret",str(raised.exception)); self.assertIsNone(raised.exception.__cause__)
  self.assertEqual(len(outcomes),1); self.assertEqual(outcomes[0]["status"],"rollback-failed"); self.assertEqual(outcomes[0]["failure_stage"],"rehearsal-receipt-persisted")
 def test_rehearse_outer_rollback_and_outcome_receipt_failure_are_composite(self):
  c=Conn(rollback_error=True); i=inv(); ps=patches(i); outcomes=[]; original=RuntimeError("callback secret"); writer_error=RuntimeError("outcome receipt secret")
  def outcome_writer(outcome):
   outcomes.append(outcome)
   raise writer_error
  with ps[0],ps[1],ps[2],ps[3],ps[4],self.assertRaises(freeze.RehearsalRollbackReceiptError) as raised:
   freeze.rehearse(c,origin="https://x",freeze_id="freeze-0001",expected=i,assertion={"expires_at":9999999999},callback=lambda *_:(_ for _ in ()).throw(original),provisional_writer=lambda p:p,rehearsal_receipt_writer=lambda r:r["receipt_sha256"],outcome_receipt_writer=outcome_writer,terminal_assert=terminal,baseline_assert=lambda:{})
  self.assertIs(raised.exception.original_error,original); self.assertIsInstance(raised.exception.rollback_error,RuntimeError); self.assertIs(raised.exception.outcome_receipt_error,writer_error)
  self.assertEqual(str(raised.exception),"rollback-failed-outcome-receipt-failed"); self.assertNotIn("secret",str(raised.exception)); self.assertIsNone(raised.exception.__cause__)
  self.assertEqual(len(outcomes),1); self.assertEqual(outcomes[0]["status"],"rollback-failed"); self.assertEqual(outcomes[0]["failure_stage"],"callback-running")
if __name__=="__main__": unittest.main()
