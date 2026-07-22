#!/usr/bin/env python3
"""G037 single-transaction ordinary-writer fence.

``preflight(conn)`` is read-only except for rolled-back lock probes. ``run``
owns the only transaction and passes its cursor plus a verified, signed active
capability to the callback; callback code must not commit, roll back, or open a
connection. Table locks do not fence sequences, owners, superusers, Dashboard,
provider, or credential holders: the signed producer-stop assertion attests
those residual channels.
"""
from __future__ import annotations
import base64, hashlib, subprocess, time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from g037_hosted_closure_contract import AUTHORIZATION_PUBLIC_KEY_PEM, MANIFEST_SHA256, canonical_bytes, digest, repository_root, terminal_spec as build_terminal_spec, validate_operator_assertion, validate_sources
SCHEMA="g037-write-freeze-v3"
REACHABLE_SCHEMAS=("public","auth","storage","shortener_private","ocr_private","provider_budget_private","privacy_retention")
CREATED_BY_SELECTED=frozenset(REACHABLE_SCHEMAS[3:])
PROVIDER_MANAGED_LOCK_EXCLUSIONS=frozenset((
 ("auth","schema_migrations","supabase_auth_admin"),
 ("storage","buckets_vectors","supabase_storage_admin"),
 ("storage","migrations","supabase_storage_admin"),
 ("storage","vector_indexes","supabase_storage_admin"),
))
PROVIDER_MANAGED_ACL_ALLOWLIST=frozenset((
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
))
CONTROLLER_PUBLIC_KEY_PEM="-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAo4UI52OeuOIAtNilBOmsGuMovYT3mEMgZK3fdAdmrD0=\n-----END PUBLIC KEY-----\n"
CONTROLLER_PUBLIC_KEY_SHA256=hashlib.sha256(CONTROLLER_PUBLIC_KEY_PEM.encode()).hexdigest()
class FreezeError(RuntimeError): pass
_LOCK_TIMEOUT_SETTINGS=("statement_timeout","lock_timeout","idle_in_transaction_session_timeout")
_LOCK_TIMEOUT_MIN_SECONDS=1
_LOCK_TIMEOUT_MAX_SECONDS=900
class RehearsalRollbackError(FreezeError):
 def __init__(self, original_error, rollback_error):
  super().__init__("rollback-failed")
  self.original_error=original_error
  self.rollback_error=rollback_error
class RehearsalRollbackReceiptError(RehearsalRollbackError):
 def __init__(self, original_error, rollback_error, outcome_receipt_error):
  super().__init__(original_error,rollback_error)
  self.args=("rollback-failed-outcome-receipt-failed",)
  self.outcome_receipt_error=outcome_receipt_error
@dataclass(frozen=True)
class Relation:
 schema:str; name:str; oid:int; kind:str; owner:str
 @property
 def key(self): return (self.schema,self.name,self.oid,self.kind,self.owner)
@dataclass(frozen=True)
class Inventory:
 schemas:tuple[str,...]; relations:tuple[Relation,...]; relation_root:str; acl_root:str
def _rows(c,s,p=()): c.execute(s,p); return tuple(tuple(x) for x in c.fetchall())
def _ident(x):
 if not isinstance(x,str) or not x or "\0" in x: raise FreezeError("unsafe identifier")
 return '"'+x.replace('"','""')+'"'
def _unique(rows,what):
 if len(rows)!=len(set(rows)): raise FreezeError("duplicate %s inventory"%what)
 return tuple(sorted(rows))
_TABLE_PRIVILEGES=frozenset(("SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER","MAINTAIN"))
_PUBLIC_READ=("SELECT",)
_PUBLIC_INSERT_READ=("INSERT","SELECT")
_PUBLIC_INSERT_READ_UPDATE=("INSERT","SELECT","UPDATE")
_PUBLIC_WRITE=("DELETE","INSERT","SELECT","UPDATE")
# Frozen from g037-public-acl-evidence-v1; never derive this from pg_catalog.
PUBLIC_ORDINARY_ACL_DECLARATION={
 "ad_banners":{"anon":_PUBLIC_READ,"authenticated":_PUBLIC_WRITE,"service_role":_TABLE_PRIVILEGES},
 "account_deletion_data_classes":{"service_role":_TABLE_PRIVILEGES},
 "account_deletion_policies":{"service_role":_TABLE_PRIVILEGES},
 "account_deletion_request_items":{"service_role":_TABLE_PRIVILEGES},
 "account_deletion_requests":{"service_role":_TABLE_PRIVILEGES},
 "admin_audit_events":{"authenticated":_PUBLIC_READ,"service_role":_TABLE_PRIVILEGES},
 "admin_restaurant_map_overlay_audit_events":{"service_role":_TABLE_PRIVILEGES},
 "admin_restaurant_map_overlay_proposal_review_events":{"service_role":_TABLE_PRIVILEGES},
 "admin_restaurant_map_overlay_proposals":{"service_role":_TABLE_PRIVILEGES},
 "admin_restaurant_map_overlays":{"service_role":_TABLE_PRIVILEGES},
 "admin_user_preferences":{"authenticated":_PUBLIC_INSERT_READ_UPDATE,"service_role":_TABLE_PRIVILEGES},
 "admin_trend_job_requests":{"service_role":_TABLE_PRIVILEGES},
 "admin_trend_signal_observations":{"service_role":_TABLE_PRIVILEGES},
 "admin_trend_signal_runs":{"service_role":_TABLE_PRIVILEGES},
 "admin_workflow_runs":{"authenticated":_PUBLIC_READ,"service_role":_TABLE_PRIVILEGES},
 "admin_workflow_signals":{"authenticated":_PUBLIC_READ,"service_role":_TABLE_PRIVILEGES},
 "admin_workflow_steps":{"authenticated":_PUBLIC_READ,"service_role":_TABLE_PRIVILEGES},
 "announcements":{"anon":_PUBLIC_READ,"authenticated":_PUBLIC_WRITE,"service_role":_TABLE_PRIVILEGES},
 "document_embeddings":{"service_role":_TABLE_PRIVILEGES},
 "documents":{"authenticated":_PUBLIC_WRITE,"service_role":_TABLE_PRIVILEGES},
 "marketing_campaign_batches":{"service_role":_TABLE_PRIVILEGES},
 "marketing_campaign_operations":{"service_role":_TABLE_PRIVILEGES},
 "marketing_campaign_recipients":{"service_role":_TABLE_PRIVILEGES},
 "privacy_age_profiles":{"authenticated":_PUBLIC_READ},
 "privacy_audit_events":{"service_role":_TABLE_PRIVILEGES},
 "privacy_onboarding_challenges":{"service_role":_TABLE_PRIVILEGES},
 "privacy_policy_versions":{"service_role":_TABLE_PRIVILEGES},
 "notifications":{"authenticated":_PUBLIC_WRITE,"service_role":_TABLE_PRIVILEGES},
 "ocr_logs":{"authenticated":_PUBLIC_INSERT_READ,"service_role":_TABLE_PRIVILEGES},
 "profiles":{"anon":_PUBLIC_READ,"authenticated":_PUBLIC_INSERT_READ_UPDATE,"service_role":_TABLE_PRIVILEGES},
 "restaurant_popular_rank_snapshots":{"anon":_PUBLIC_READ,"authenticated":_PUBLIC_READ,"service_role":_TABLE_PRIVILEGES},
 "restaurant_refresh_candidates":{"authenticated":_PUBLIC_INSERT_READ_UPDATE,"service_role":_TABLE_PRIVILEGES},
 "restaurant_refresh_runs":{"authenticated":_PUBLIC_INSERT_READ_UPDATE,"service_role":_TABLE_PRIVILEGES},
 "restaurant_request_review_audit":{"authenticated":_PUBLIC_READ,"service_role":_TABLE_PRIVILEGES},
 "restaurant_requests":{"authenticated":_PUBLIC_INSERT_READ_UPDATE,"service_role":_TABLE_PRIVILEGES},
 "restaurant_admin_destructive_audit_events":{"service_role":_TABLE_PRIVILEGES},
 "restaurant_submission_items":{"authenticated":_PUBLIC_WRITE,"service_role":_TABLE_PRIVILEGES},
 "restaurant_submissions":{"authenticated":_PUBLIC_WRITE,"service_role":_TABLE_PRIVILEGES},
 "restaurants":{"anon":_PUBLIC_READ,"authenticated":("SELECT","UPDATE"),"service_role":_TABLE_PRIVILEGES},
 "restaurants_duplicate":{"service_role":_TABLE_PRIVILEGES},
 "review_likes":{"anon":_PUBLIC_READ,"authenticated":("DELETE","INSERT","SELECT"),"service_role":_TABLE_PRIVILEGES},
 "reviews":{"anon":_PUBLIC_READ,"authenticated":_PUBLIC_WRITE,"service_role":_TABLE_PRIVILEGES},
 "search_logs":{"anon":("INSERT",),"authenticated":_PUBLIC_INSERT_READ,"service_role":_TABLE_PRIVILEGES},
 "short_urls":{"anon":_PUBLIC_READ,"authenticated":_PUBLIC_READ,"service_role":_TABLE_PRIVILEGES},
 "transcript_embeddings_bge":{"anon":_PUBLIC_READ,"authenticated":_PUBLIC_READ,"service_role":_TABLE_PRIVILEGES},
 "user_account_status":{"authenticated":_PUBLIC_READ,"service_role":_TABLE_PRIVILEGES},
 "user_bookmarks":{"anon":_PUBLIC_READ,"authenticated":("DELETE","INSERT","SELECT"),"service_role":_TABLE_PRIVILEGES},
 "user_roles":{"authenticated":_PUBLIC_READ,"service_role":_TABLE_PRIVILEGES},
 "user_stats":{"anon":_PUBLIC_READ,"authenticated":_PUBLIC_READ,"service_role":_TABLE_PRIVILEGES},
 "video_frame_captions":{"anon":_PUBLIC_READ,"authenticated":_PUBLIC_READ,"service_role":_TABLE_PRIVILEGES},
 "videos":{"anon":_PUBLIC_READ,"authenticated":_PUBLIC_READ,"service_role":_TABLE_PRIVILEGES},
 "youtube_channel_kpi_snapshots":{"service_role":_TABLE_PRIVILEGES},
 "youtube_video_kpi_snapshots":{"service_role":_TABLE_PRIVILEGES},
}
PUBLIC_ORDINARY_ACL_ALLOWLIST=frozenset(
 ("public",relation,"postgres",grantee,privilege)
 for relation,grantees in PUBLIC_ORDINARY_ACL_DECLARATION.items()
 for grantee,privileges in grantees.items()
 for privilege in privileges
)
# Frozen from the source-pinned G014 terminal vectors.  This declaration is
# intentionally exact: adding a grantee, relation, privilege, or grant option
# requires a reviewed source-contract change.
_G014_WORKFLOW_FULL_PUBLIC_RELATIONS=(
 "account_deletion_data_classes","account_deletion_policies",
 "account_deletion_request_items","account_deletion_requests",
 "admin_audit_events","marketing_campaign_batches",
 "user_account_status","user_roles",
)
_G014_WORKFLOW_DELETE_READ_PUBLIC_RELATIONS=(
 "admin_user_preferences","documents","marketing_campaign_recipients",
 "notifications","ocr_logs","restaurant_requests",
 "restaurant_submission_items","restaurant_submissions","review_likes",
 "reviews","user_bookmarks","user_stats",
)
_G014_WORKFLOW_READ_UPDATE_PUBLIC_RELATIONS=("marketing_campaign_operations","profiles")
_G014_SERVICE_FULL_PUBLIC_RELATIONS=(
 "admin_restaurant_map_overlay_audit_events",
 "admin_restaurant_map_overlay_proposal_review_events",
 "admin_restaurant_map_overlay_proposals","admin_trend_job_requests",
 "admin_trend_signal_observations","admin_trend_signal_runs",
 "restaurant_admin_destructive_audit_events",
)
_G014_INCIDENT_PUBLIC_RELATIONS=(
 "privacy_incident_actions","privacy_incident_notices",
 "privacy_incident_transition_previews","privacy_incidents",
)
G014_TERMINAL_ORDINARY_ACL_ALLOWLIST=frozenset((
 *(
  ("public",name,"postgres","privacy_workflow_owner",privilege,False)
  for name in _G014_WORKFLOW_FULL_PUBLIC_RELATIONS for privilege in _TABLE_PRIVILEGES
 ),
 *(
  ("public",name,"postgres","privacy_workflow_owner",privilege,False)
  for name in _G014_WORKFLOW_DELETE_READ_PUBLIC_RELATIONS
  for privilege in ("DELETE","SELECT")
 ),
 *(
  ("public",name,"postgres","privacy_workflow_owner",privilege,False)
  for name in _G014_WORKFLOW_READ_UPDATE_PUBLIC_RELATIONS
  for privilege in ("SELECT","UPDATE")
 ),
 ("public","restaurants","postgres","privacy_workflow_owner","SELECT",False),
 *(
  ("public",name,"postgres","service_role",privilege,False)
  for name in _G014_SERVICE_FULL_PUBLIC_RELATIONS for privilege in _TABLE_PRIVILEGES
 ),
 *(
  ("public",name,"supabase_admin",grantee,privilege,False)
  for name in _G014_INCIDENT_PUBLIC_RELATIONS
  for grantee,privileges in (
   ("postgres",_TABLE_PRIVILEGES),
   ("privacy_workflow_owner",_TABLE_PRIVILEGES),
   ("service_role",("SELECT",)),
  )
  for privilege in privileges
 ),
 *(
  ("public",name,"postgres","service_role","SELECT",False)
  for name in ("marketing_campaign_batches","marketing_campaign_operations","marketing_campaign_recipients")
 ),
 ("auth","identities","supabase_auth_admin","privacy_workflow_owner","SELECT",False),
 *(
  ("auth",name,"supabase_auth_admin","privacy_workflow_owner",privilege,False)
  for name in ("refresh_tokens","sessions") for privilege in ("DELETE","SELECT")
 ),
 *(
  ("privacy_retention","retention_adapter_approvals","privacy_workflow_owner",grantee,"INSERT",False)
  for grantee in ("privacy_retention_legal_approver","privacy_retention_operator_approver")
 ),
 ("storage","objects","supabase_storage_admin","privacy_workflow_owner","SELECT",False),
))
PROVIDER_STORAGE_CLIENT_ACL_ALLOWLIST=frozenset(
 ("storage",name,"supabase_storage_admin",privilege)
 for name,privileges in (
  ("buckets",_TABLE_PRIVILEGES),
  ("buckets_analytics",_TABLE_PRIVILEGES),
  ("objects",_TABLE_PRIVILEGES),
  ("buckets_vectors",frozenset(("SELECT",))),
  ("s3_multipart_uploads",frozenset(("SELECT",))),
  ("s3_multipart_uploads_parts",frozenset(("SELECT",))),
  ("vector_indexes",frozenset(("SELECT",))),
 ) for privilege in privileges
)
PROVIDER_GRANT_OPTION_ACL_ALLOWLIST=frozenset(
 (schema,name,owner,"postgres",privilege,True)
 for schema,name,owner in PROVIDER_MANAGED_ACL_ALLOWLIST
 for privilege in (frozenset(("SELECT",)) if schema=="auth" else _TABLE_PRIVILEGES)
)
PROVIDER_AUTH_NON_GRANTABLE_ACL_ALLOWLIST=frozenset(
 ("auth",name,owner)
 for schema,name,owner in PROVIDER_MANAGED_ACL_ALLOWLIST if schema=="auth"
)
PROVIDER_STORAGE_SERVICE_ACL_ALLOWLIST=frozenset(
 ("storage",name,"supabase_storage_admin",privilege)
 for name,privileges in (
  ("buckets",_TABLE_PRIVILEGES),
  ("buckets_analytics",_TABLE_PRIVILEGES),
  ("objects",_TABLE_PRIVILEGES),
  ("buckets_vectors",frozenset(("SELECT",))),
  ("s3_multipart_uploads",_TABLE_PRIVILEGES),
  ("s3_multipart_uploads_parts",_TABLE_PRIVILEGES),
  ("vector_indexes",frozenset(("SELECT",))),
 ) for privilege in privileges
)
def validate_table_acl_rows(rows, relations, *, terminal=False):
 """Reject unsafe ordinary-relation ACLs before their roots become authority."""
 relation_by_acl_key={(r.schema,r.name) if terminal else (r.schema,r.oid):r for r in relations}
 if len(relation_by_acl_key)!=len(relations): raise FreezeError("relation inventory malformed")
 for row in rows:
  if len(row)!=6: raise FreezeError("relation ACL row malformed")
  schema=str(row[0]); relation=row[1]; grantor=row[2]; grantee=row[3]; privilege=row[4]; grantable=row[5]
  relation_record=relation_by_acl_key.get((schema,str(relation)) if terminal else (schema,relation))
  if relation_record is None: raise FreezeError("relation ACL relation missing")
  owner=relation_record.owner
  if not isinstance(grantor,str) or not isinstance(grantee,str) or not isinstance(privilege,str) or type(grantable) is not bool:
   raise FreezeError("relation ACL row malformed")
  if grantee=="PUBLIC" or privilege not in _TABLE_PRIVILEGES:
   raise FreezeError("relation ACL is forbidden")
  provider_key=(relation_record.schema,relation_record.name,owner)
  if grantor==owner and grantee==owner:
   continue
  if (relation_record.schema,relation_record.name,owner,grantee,privilege,grantable) in PROVIDER_GRANT_OPTION_ACL_ALLOWLIST and grantor==owner:
   continue
  if ((relation_record.schema,relation_record.name,owner,privilege) in PROVIDER_STORAGE_CLIENT_ACL_ALLOWLIST
      and grantor==owner and grantee in {"anon","authenticated"} and not grantable):
   continue
  if ((relation_record.schema,relation_record.name,owner,grantee,privilege) in PUBLIC_ORDINARY_ACL_ALLOWLIST
      and grantor==owner and not grantable):
   continue
  if (terminal and grantor==owner
      and (relation_record.schema,relation_record.name,owner,grantee,privilege,grantable)
      in G014_TERMINAL_ORDINARY_ACL_ALLOWLIST):
   continue
  if (provider_key in PROVIDER_AUTH_NON_GRANTABLE_ACL_ALLOWLIST and grantor==owner
      and grantee in {"postgres","dashboard_user"} and not grantable):
   continue
  if ((relation_record.schema,relation_record.name,owner,privilege) in PROVIDER_STORAGE_SERVICE_ACL_ALLOWLIST
      and grantor==owner and grantee=="service_role" and not grantable):
   continue
  raise FreezeError("relation ACL is forbidden")
 return rows
def _lockable_relations(relations):
 excluded=tuple(r for r in relations if (r.schema,r.name,r.owner) in PROVIDER_MANAGED_LOCK_EXCLUSIONS)
 if len(excluded)!=len(PROVIDER_MANAGED_LOCK_EXCLUSIONS) or { (r.schema,r.name,r.owner) for r in excluded }!=PROVIDER_MANAGED_LOCK_EXCLUSIONS:
  raise FreezeError("provider-managed lock exclusion inventory drift")
 return tuple(r for r in relations if r not in excluded)
def _inv(conn):
 c=conn.cursor()
 try:
  schemas=tuple(x[0] for x in _unique(_rows(c,"SELECT nspname FROM pg_namespace WHERE nspname=ANY(%s) ORDER BY 1",(list(REACHABLE_SCHEMAS),)),"schema"))
  if set(REACHABLE_SCHEMAS)-set(schemas)-CREATED_BY_SELECTED: raise FreezeError("required reachable schema missing")
  rs=_unique(_rows(c,"SELECT n.nspname,c.relname,c.oid,c.relkind,pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) AND c.relkind IN ('r','p') ORDER BY 1,2,3",(list(schemas),)),"relation")
  relations=tuple(Relation(str(a),str(b),int(o),str(k),str(owner)) for a,b,o,k,owner in rs)
  if not relations: raise FreezeError("empty reachable relation inventory")
  acl=validate_table_acl_rows(_unique(_rows(c,"SELECT n.nspname,c.oid,COALESCE(grantor.rolname,'PUBLIC'),COALESCE(grantee.rolname,'PUBLIC'),x.privilege_type,x.is_grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) x LEFT JOIN pg_roles grantor ON grantor.oid=x.grantor LEFT JOIN pg_roles grantee ON grantee.oid=x.grantee WHERE n.nspname=ANY(%s) AND c.relkind IN ('r','p') ORDER BY 1,2,3,4,5,6",(list(schemas),)),"acl"),relations)
  return Inventory(schemas,relations,digest([r.key for r in relations]),digest(acl))
 finally: c.close()
def preflight(conn):
 """Probe locks inside an ordinary transaction and always roll it back."""
 answer=_inv(conn); lockable=_lockable_relations(answer.relations); c=conn.cursor()
 try:
  c.execute("BEGIN")
  for r in lockable: c.execute("LOCK TABLE %s.%s IN SHARE ROW EXCLUSIVE MODE NOWAIT"%(_ident(r.schema),_ident(r.name)))
  conn.rollback(); return answer
 except Exception as e:
  conn.rollback(); raise FreezeError("all non-provider-managed reachable relations must be lockable") from e
 finally: c.close()
def _root_source():
 root=repository_root(Path(__file__).resolve()); manifest=validate_sources(root)
 try: commit=subprocess.run(["git","-C",str(root),"rev-parse","HEAD"],capture_output=True,text=True,check=True).stdout.strip()
 except Exception as e: raise FreezeError("checked-out HEAD unavailable") from e
 if len(commit)!=40 or any(c not in "0123456789abcdef" for c in commit): raise FreezeError("checked-out HEAD invalid")
 source_root=digest([(m.path,m.sha256) for m in manifest.migrations])
 terminal_spec=build_terminal_spec(manifest)
 return root,commit,source_root,terminal_spec
def _locks(c,rs,seconds):
 if (not isinstance(seconds,int) or isinstance(seconds,bool)
     or not _LOCK_TIMEOUT_MIN_SECONDS<=seconds<=_LOCK_TIMEOUT_MAX_SECONDS):
  raise FreezeError("lock timeout seconds must be between 1 and 900")
 for key in _LOCK_TIMEOUT_SETTINGS: c.execute("SET LOCAL %s = '%ds'"%(key,seconds))
 lockable=_lockable_relations(rs)
 for r in lockable: c.execute("LOCK TABLE %s.%s IN SHARE ROW EXCLUSIVE MODE"%(_ident(r.schema),_ident(r.name)))
 held=_rows(c,"SELECT n.nspname,c.relname,c.oid FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace WHERE l.pid=pg_backend_pid() AND l.granted AND l.mode='ShareRowExclusiveLock' ORDER BY 1,2,3")
 expected=tuple((r.schema,r.name,r.oid) for r in lockable)
 if held!=expected or _rows(c,"SELECT count(*) FROM pg_locks WHERE NOT granted")[0][0]!=0: raise FreezeError("held lock set drift")
 return digest(held)
_CAPABILITY_TOKEN=object()
_CAPTURE_TOKEN=object()
class _VerifiedMapping(Mapping):
 __slots__=("_values",)
 def __init__(self, values, token):
  if token not in (_CAPABILITY_TOKEN,_CAPTURE_TOKEN): raise TypeError("verified handoff construction is internal")
  self._values=dict(values)
 def __getitem__(self,key): return self._values[key]
 def __iter__(self): return iter(self._values)
 def __len__(self): return len(self._values)
 def __reduce__(self): raise TypeError("verified handoff serialization is forbidden")
class VerifiedControllerCapability(_VerifiedMapping):
 __slots__=()
 def __init__(self, values, token=None):
  if token is not _CAPABILITY_TOKEN: raise TypeError("controller capability must be verifier-produced")
  super().__init__(values,token)
class VerifiedRecoveryCapture(_VerifiedMapping):
 __slots__=()
 def __init__(self, values, token=None):
  if token is not _CAPTURE_TOKEN: raise TypeError("recovery capture must be verifier-produced")
  super().__init__(values,token)
def _verified_controller_capability(value): return VerifiedControllerCapability(value,_CAPABILITY_TOKEN)
def verified_recovery_capture(value):
 """Brand already-authenticated exact recovery evidence for executor handoff."""
 if not isinstance(value,dict) or set(value)!=_SHORT_URL_CAPTURE_FIELDS: raise FreezeError("recovery capture fields invalid")
 if (any(not isinstance(value[key],str) or len(value[key])!=64 or any(ch not in "0123456789abcdef" for ch in value[key]) for key in ("selection_spec_sha256","short_urls_catalog_sha256","short_urls_rowset_sha256","duplicate_victims_sha256","victim_descriptors_sha256"))
     or any(not isinstance(value[key],int) or isinstance(value[key],bool) or value[key]<0 for key in ("short_urls_row_count","duplicate_group_count","duplicate_victim_count","victim_descriptor_count"))
     or value["duplicate_victim_count"]!=value["victim_descriptor_count"] or value["duplicate_victims_sha256"]!=value["victim_descriptors_sha256"]):
  raise FreezeError("recovery capture evidence invalid")
 return VerifiedRecoveryCapture(value,_CAPTURE_TOKEN)
def _verify_active(value, expected):
 if not isinstance(value,dict) or set(value)!={*expected,"signature"} or value.get("controller_public_key_sha256")!=CONTROLLER_PUBLIC_KEY_SHA256: raise FreezeError("active capability fields mismatch")
 signature=value["signature"]; payload={k:v for k,v in value.items() if k!="signature"}
 if (value.get("schema")!=SCHEMA or value.get("state")!="active-provisional"
     or not isinstance(value.get("origin"),str) or not value["origin"]
     or value.get("scope")!={"schemas":list(REACHABLE_SCHEMAS),"ordinary_relations":"all"}
     or any(not isinstance(value.get(key),str) or len(value[key])!=64 for key in ("source_root","terminal_spec","relation_root","acl_root","held_lock_root"))
     or any(not isinstance(value.get(key),int) or isinstance(value[key],bool) for key in ("not_before_unix","not_after_unix"))
     or value["not_before_unix"]>value["not_after_unix"]): raise FreezeError("active capability binding invalid")
 if not isinstance(signature,str): raise FreezeError("active capability signature missing")
 try:
  from cryptography.hazmat.primitives.serialization import load_pem_public_key
  load_pem_public_key(CONTROLLER_PUBLIC_KEY_PEM.encode()).verify(base64.b64decode(signature,validate=True),canonical_bytes(payload))
 except Exception as e: raise FreezeError("active capability signature invalid") from e
 return _verified_controller_capability(value)
CAPTURE_ROOT_KEYS=frozenset(("auth_storage_catalog_root","auth_storage_metadata_root","storage_blob_root","short_urls_catalog_root","short_urls_rowset_root","short_urls_victim_descriptors_root","short_urls_row_count","duplicate_group_count","duplicate_victim_count","recipient_fingerprint","logical_ciphertext_sha256","blob_ciphertext_sha256","recovery_receipt_sha256","object_count","total_bytes"))
def validate_capture_roots(value):
 if not isinstance(value,dict) or set(value)!=CAPTURE_ROOT_KEYS: raise FreezeError("capture roots fields invalid")
 if any(not isinstance(value[k],str) or len(value[k])!=64 or any(c not in "0123456789abcdef" for c in value[k]) for k in CAPTURE_ROOT_KEYS-{"object_count","total_bytes","short_urls_row_count","duplicate_group_count","duplicate_victim_count"}): raise FreezeError("capture roots hash invalid")
 if any(not isinstance(value[k],int) or isinstance(value[k],bool) or value[k]<0 or value[k]>(2**34) for k in ("object_count","total_bytes","short_urls_row_count","duplicate_group_count","duplicate_victim_count")): raise FreezeError("capture roots size invalid")
 return value
REMEDIATION_EVIDENCE_KEYS=frozenset(("schema","authorization_id","policy","execution_authorization_sha256","execution_authorization_signature_sha256","attempt_marker_sha256","legacy_repository_commit","legacy_authorization_sha256","legacy_authorization_signature_sha256","legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256","recovery_receipt_sha256","capture_short_urls_rowset_sha256","pre_short_urls_rowset_sha256","survivor_short_urls_rowset_sha256","deleted_count","duplicate_group_count_before","duplicate_group_count_after","remediation_sha256"))
def validate_remediation_evidence(value):
 if not isinstance(value,dict) or set(value)!=REMEDIATION_EVIDENCE_KEYS or value.get("schema")!="g037-short-url-remediation-evidence-v1" or value.get("policy")!="exact-baseline-to-terminal-ledger-single-commit-v1" or not isinstance(value.get("authorization_id"),str): raise FreezeError("remediation evidence fields invalid")
 hashes=("execution_authorization_sha256","execution_authorization_signature_sha256","attempt_marker_sha256","legacy_authorization_sha256","legacy_authorization_signature_sha256","legacy_capture_receipt_sha256","legacy_restore_receipt_sha256","legacy_inspection_receipt_sha256","recovery_receipt_sha256","capture_short_urls_rowset_sha256","pre_short_urls_rowset_sha256","survivor_short_urls_rowset_sha256","remediation_sha256")
 if (not isinstance(value.get("legacy_repository_commit"),str) or len(value["legacy_repository_commit"])!=40 or any(ch not in "0123456789abcdef" for ch in value["legacy_repository_commit"]) or any(not isinstance(value[key],str) or len(value[key])!=64 or any(ch not in "0123456789abcdef" for ch in value[key]) for key in hashes) or any(not isinstance(value[key],int) or isinstance(value[key],bool) or value[key]<0 for key in ("deleted_count","duplicate_group_count_before","duplicate_group_count_after")) or value["duplicate_group_count_after"]!=0): raise FreezeError("remediation evidence invalid")
 unsigned=dict(value); claimed=unsigned.pop("remediation_sha256")
 if digest(unsigned)!=claimed: raise FreezeError("remediation evidence digest invalid")
 return value
_SHORT_URL_CAPTURE_FIELDS=frozenset(("selection_spec_sha256","short_urls_catalog_sha256","short_urls_rowset_sha256","short_urls_row_count","duplicate_group_count","duplicate_victim_count","victim_descriptor_count","duplicate_victims_sha256","victim_descriptors_sha256"))
def run(conn, *, origin, freeze_id, expected, assertion, callback, provisional_writer,
        precommit_receipt_writer, final_receipt_writer, terminal_assert):
 root,head,source_root,terminal_spec=_root_source()
 validate_operator_assertion(assertion,freeze_id=freeze_id,origin=origin,relation_root=expected.relation_root,acl_root=expected.acl_root,commit=head,source_root=source_root,terminal_spec=terminal_spec)
 now=int(time.time()); expires=assertion["expires_at"]; seconds=expires-now
 if seconds<=0: raise FreezeError("assertion window expired")
 c=conn.cursor(); status="failed-rolled-back"; lock_root=""; captures={}; remediation={}; terminal={}; commit_started=False; precommit_hash=""
 try:
  c.execute("BEGIN"); current=_inv(conn)
  if (current.schemas!=expected.schemas or current.relations!=expected.relations
      or current.relation_root!=expected.relation_root or current.acl_root!=expected.acl_root):
   raise FreezeError("inventory drift")
  lock_root=_locks(c,expected.relations,seconds)
  current=_inv(conn)
  if (current.schemas!=expected.schemas or current.relations!=expected.relations
      or current.relation_root!=expected.relation_root or current.acl_root!=expected.acl_root):
   raise FreezeError("post-lock inventory drift")
  payload={"schema":SCHEMA,"state":"active-provisional","freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"scope":{"schemas":list(REACHABLE_SCHEMAS),"ordinary_relations":"all"},"relation_root":expected.relation_root,"acl_root":expected.acl_root,"held_lock_root":lock_root,"not_before_unix":now,"not_after_unix":expires,"controller_public_key_sha256":CONTROLLER_PUBLIC_KEY_SHA256}
  signed=_verify_active(provisional_writer(payload),set(payload))
  c.execute("SAVEPOINT g037_closure")
  try:
   output=callback(c,signed)
   if not isinstance(output,dict) or set(output)!={"capture_roots","remediation_evidence"}: raise FreezeError("callback remediation output invalid")
   captures=output["capture_roots"]; remediation=output["remediation_evidence"]; validate_capture_roots(captures); validate_remediation_evidence(remediation)
   terminal=terminal_assert(c,terminal_spec)
   if (not isinstance(terminal,dict) or set(terminal)!={"catalog_root","acl_root","ledger_root","terminal_spec"}
       or terminal["terminal_spec"]!=terminal_spec or any(not isinstance(terminal[k],str) or len(terminal[k])!=64 for k in ("catalog_root","acl_root","ledger_root"))):
    raise FreezeError("immutable terminal assertion missing")
   intent={"schema":SCHEMA,"status":"prepared-not-committed","freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"before_relation_root":expected.relation_root,"before_acl_root":expected.acl_root,"held_lock_root":lock_root,"capture_roots":captures,"remediation_evidence":remediation,"terminal":terminal}
   intent["receipt_sha256"]=digest(intent)
   precommit_hash=precommit_receipt_writer(intent)
   if precommit_hash != intent["receipt_sha256"]: raise FreezeError("precommit receipt persistence failed")
   c.execute("RELEASE SAVEPOINT g037_closure"); commit_started=True; conn.commit(); status="committed"; result=output
  except Exception:
   if commit_started: status="commit-ambiguous"
   else:
    try: conn.rollback()
    except Exception: status="rollback-failed"
 except Exception:
  if not commit_started and status!="rollback-failed":
   try: conn.rollback()
   except Exception: status="rollback-failed"
 finally: c.close()
 receipt={"schema":SCHEMA,"status":status,"freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"before_relation_root":expected.relation_root,"before_acl_root":expected.acl_root,"held_lock_root":lock_root,"capture_roots":captures,"remediation_evidence":remediation,"terminal":terminal,"precommit_receipt_sha256":precommit_hash,"residual_channels":"sequence-owner-superuser-dashboard-provider-credential-holder-attested-not-fenced"}; receipt["receipt_sha256"]=digest(receipt)
 try: final_receipt_writer(receipt)
 except Exception as e:
  if status=="committed": raise FreezeError("committed-unfinalized") from e
  raise FreezeError("final receipt persistence failed") from e
 if status!="committed": raise FreezeError(status)
 return result
def rehearse(conn, *, origin, freeze_id, expected, assertion, callback, provisional_writer,
             rehearsal_receipt_writer, outcome_receipt_writer, terminal_assert, baseline_assert):
 """Run the complete closure cursor path, then unconditionally roll it back."""
 root,head,source_root,terminal_spec=_root_source()
 validate_operator_assertion(assertion,freeze_id=freeze_id,origin=origin,relation_root=expected.relation_root,acl_root=expected.acl_root,commit=head,source_root=source_root,terminal_spec=terminal_spec)
 now=int(time.time()); expires=assertion["expires_at"]; seconds=expires-now
 if seconds<=0: raise FreezeError("assertion window expired")
 c=conn.cursor(); lock_root=""; captures={}; remediation={}; terminal={}; receipt=None; stage="begin"
 try:
  c.execute("BEGIN"); current=_inv(conn)
  if (current.schemas!=expected.schemas or current.relations!=expected.relations or current.relation_root!=expected.relation_root or current.acl_root!=expected.acl_root): raise FreezeError("inventory drift")
  lock_root=_locks(c,expected.relations,seconds)
  current=_inv(conn)
  if (current.schemas!=expected.schemas or current.relations!=expected.relations or current.relation_root!=expected.relation_root or current.acl_root!=expected.acl_root): raise FreezeError("post-lock inventory drift")
  payload={"schema":SCHEMA,"state":"active-provisional","freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"scope":{"schemas":list(REACHABLE_SCHEMAS),"ordinary_relations":"all"},"relation_root":expected.relation_root,"acl_root":expected.acl_root,"held_lock_root":lock_root,"not_before_unix":now,"not_after_unix":expires,"controller_public_key_sha256":CONTROLLER_PUBLIC_KEY_SHA256}
  signed=_verify_active(provisional_writer(payload),set(payload))
  stage="callback-running"
  output=callback(c,signed)
  if not isinstance(output,dict) or set(output)!={"capture_roots","remediation_evidence"}: raise FreezeError("callback remediation output invalid")
  captures=output["capture_roots"]; remediation=output["remediation_evidence"]; validate_capture_roots(captures); validate_remediation_evidence(remediation); stage="capture-validated"
  terminal=terminal_assert(c,terminal_spec)
  if (not isinstance(terminal,dict) or set(terminal)!={"catalog_root","acl_root","ledger_root","terminal_spec"} or terminal["terminal_spec"]!=terminal_spec or any(not isinstance(terminal[k],str) or len(terminal[k])!=64 for k in ("catalog_root","acl_root","ledger_root"))): raise FreezeError("immutable terminal assertion missing")
  stage="terminal-observed"
  receipt={"schema":"g037-rehearsal-v1","status":"terminal-observed-before-rollback","freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"before_relation_root":expected.relation_root,"before_acl_root":expected.acl_root,"held_lock_root":lock_root,"capture_roots":captures,"remediation_evidence":remediation,"terminal":terminal}
  receipt["receipt_sha256"]=digest(receipt)
  if rehearsal_receipt_writer(receipt)!=receipt["receipt_sha256"]: raise FreezeError("rehearsal receipt persistence failed")
  stage="rehearsal-receipt-persisted"
  try: conn.rollback()
  except Exception as rollback_error:
   outcome={"schema":"g037-rehearsal-v1","status":"rollback-failed","freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"rehearsal_receipt_sha256":receipt["receipt_sha256"],"failure_stage":stage,"rollback_state":"ambiguous"}
   outcome["receipt_sha256"]=digest(outcome)
   try: outcome_receipt_writer(outcome)
   except Exception as outcome_receipt_error:
    raise RehearsalRollbackReceiptError(FreezeError("rollback required"),rollback_error,outcome_receipt_error) from None
   raise RehearsalRollbackError(FreezeError("rollback required"),rollback_error) from None
  stage="rolled-back"
  baseline=baseline_assert()
  if baseline != {"relation_root":expected.relation_root,"acl_root":expected.acl_root}: raise FreezeError("baseline readback drift")
  outcome={"schema":"g037-rehearsal-v1","status":"rehearsed-rolled-back","freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"rehearsal_receipt_sha256":receipt["receipt_sha256"],"baseline":baseline}
  outcome["receipt_sha256"]=digest(outcome)
  if outcome_receipt_writer(outcome)!=outcome["receipt_sha256"]: raise FreezeError("rehearsal outcome persistence failed")
  return outcome
 except RehearsalRollbackError:
  raise
 except Exception as original_error:
  try: conn.rollback()
  except Exception as rollback_error:
   outcome={"schema":"g037-rehearsal-v1","status":"rollback-failed","freeze_id":freeze_id,"origin":origin,"commit":head,"manifest_sha256":MANIFEST_SHA256,"source_root":source_root,"terminal_spec":terminal_spec,"rehearsal_receipt_sha256":receipt["receipt_sha256"] if receipt else "","failure_stage":stage,"rollback_state":"ambiguous"}
   outcome["receipt_sha256"]=digest(outcome)
   try: outcome_receipt_writer(outcome)
   except Exception as outcome_receipt_error:
    raise RehearsalRollbackReceiptError(original_error,rollback_error,outcome_receipt_error) from None
   raise RehearsalRollbackError(original_error,rollback_error) from None
  raise
 finally: c.close()
