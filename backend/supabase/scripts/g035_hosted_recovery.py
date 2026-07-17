#!/usr/bin/env python3
"""Fail-closed, local-only encrypted backup/restore/clone rehearsal."""
from __future__ import annotations
import argparse, csv, hashlib, ipaddress, json, os, re, shutil, subprocess, tempfile, uuid
from pathlib import Path
from typing import Any, Sequence
from g035_hosted_recovery_contract import APPLICATION_SCHEMAS, APPROVED_AGE_RECIPIENT_SHA256, BASELINE_PAIRS, BASELINE_SHA256, FORBIDDEN_VERSIONS, MANAGED_METADATA_SCHEMAS, MANIFEST_SHA256, REMEDIATION_AUTHORIZATION_SCHEMA, REMEDIATION_PUBLIC_KEY_PEM, REMEDIATION_PUBLIC_KEY_SHA256, SELF_COMMIT_VERSIONS, ContractError, Manifest, ledger_prefix, repository_root, sha256_file, validate_sources
TIMEOUT_SECONDS=900; RECEIPT_SCHEMA="g035-local-recovery-receipt-v4"; HEX=re.compile(r"^[a-f0-9]{64}$"); AGE_RECIPIENT=re.compile(r"^age1[ac-hj-np-z02-9]{58}$"); SNAPSHOT=re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"); LOCAL_SERVICE="g035-local"; LOCAL_DBNAME="g035_local"; LOCAL_HOSTS=frozenset({"127.0.0.1","::1"}); SERVICE_KEYS={"host","port","dbname","application_name","sslmode","user","password","connect_timeout"}; RECOVERY_CONTROL_SCHEMAS=("supabase_migrations",); DUMP_SCHEMAS=APPLICATION_SCHEMAS+RECOVERY_CONTROL_SCHEMAS+MANAGED_METADATA_SCHEMAS; MANAGED_TABLE_DATA_EXCLUSIONS=tuple(f"--exclude-table-data={schema}.*" for schema in MANAGED_METADATA_SCHEMAS); RECOVERY_EXTENSIONS=(("pg_trgm","extensions"),("uuid-ossp","extensions"),("btree_gin","extensions"),("vector","public"),("pgcrypto","extensions")); COMPATIBILITY_HOOKS={"20260627080000":("DROP POLICY IF EXISTS documents_select_own ON public.documents;","DROP POLICY IF EXISTS documents_insert_own ON public.documents;","DROP POLICY IF EXISTS documents_update_own ON public.documents;","DROP POLICY IF EXISTS documents_delete_own ON public.documents;")}; VECTOR_EXTENSION_RELOCATION_HOOK_VERSION="20260627080000"; VECTOR_EXTENSION_RELOCATION_HOOK=("SELECT namespace.nspname FROM pg_catalog.pg_extension AS extension JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=extension.extnamespace WHERE extension.extname='vector'","ALTER EXTENSION vector SET SCHEMA extensions","SELECT namespace.nspname FROM pg_catalog.pg_extension AS extension JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=extension.extnamespace WHERE extension.extname='vector'","SELECT 1 FROM pg_catalog.pg_extension AS extension JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=extension.extnamespace WHERE extension.extname='vector' AND namespace.nspname='public'"); LOCAL_REMEDIATION_SCHEMA="g035_recovery_control"; SHORT_URL_SELECTION_SPEC="row_number() over (partition by target_url order by created_at nulls last, id)"; AUTH_USER_REFERENCE_COLUMNS=(("public","ad_banners","created_by"),("public","admin_restaurant_map_overlays","created_by_admin_id"),("public","admin_restaurant_map_overlays","updated_by_admin_id"),("public","admin_user_preferences","user_id"),("public","announcements","created_by"),("public","documents","user_id"),("public","notifications","user_id"),("public","ocr_logs","user_id"),("public","profiles","user_id"),("public","restaurant_requests","user_id"),("public","restaurant_submissions","resolved_by_admin_id"),("public","restaurant_submissions","user_id"),("public","review_likes","user_id"),("public","reviews","edited_by_admin_id"),("public","reviews","user_id"),("public","search_logs","user_id"),("public","user_account_status","user_id"),("public","user_bookmarks","user_id"),("public","user_roles","user_id"),("public","user_stats","user_id"))
SHORT_URLS_CATALOG=(
 {"name":"id","type":"uuid","nullable":"NO","position":1,"character_maximum_length":None,"column_default":"uuid_generate_v4()","is_generated":"NEVER","is_identity":"NO","identity_generation":None},
 {"name":"code","type":"character varying","nullable":"NO","position":2,"character_maximum_length":10,"column_default":None,"is_generated":"NEVER","is_identity":"NO","identity_generation":None},
 {"name":"target_url","type":"text","nullable":"NO","position":3,"character_maximum_length":None,"column_default":None,"is_generated":"NEVER","is_identity":"NO","identity_generation":None},
 {"name":"restaurant_id","type":"uuid","nullable":"YES","position":4,"character_maximum_length":None,"column_default":None,"is_generated":"NEVER","is_identity":"NO","identity_generation":None},
 {"name":"restaurant_name","type":"text","nullable":"YES","position":5,"character_maximum_length":None,"column_default":None,"is_generated":"NEVER","is_identity":"NO","identity_generation":None},
 {"name":"created_at","type":"timestamp with time zone","nullable":"YES","position":6,"character_maximum_length":None,"column_default":"now()","is_generated":"NEVER","is_identity":"NO","identity_generation":None},
)
CROSS_SCHEMA_OWNER_HOOK_VERSION="20260713002000"; CROSS_SCHEMA_OWNER_FUNCTIONS=("public.account_deletion_require_service_role()","public.account_deletion_is_active_admin(uuid)","public.account_deletion_write_audit(public.account_deletion_requests,text,text)","public.preview_account_deletion(uuid,uuid,timestamptz)","public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz)","public.apply_account_deletion_database_cleanup(uuid,uuid)","public.list_account_deletion_storage_objects(uuid,uuid)","public.finalize_account_deletion_storage(uuid,uuid,boolean)","public.finalize_account_deletion_auth(uuid,uuid,boolean)","public.fail_account_deletion(uuid,uuid,text)","privacy_retention.require_service_role()","privacy_retention.write_run_audit(privacy_retention.privacy_retention_runs,text,text)"); CROSS_SCHEMA_OWNER_RESOLVE_SQL="SELECT procedure.oid FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid=pg_catalog.to_regprocedure(%s)"; CROSS_SCHEMA_OWNER_VERIFY_SQL="SELECT role.rolname FROM pg_catalog.pg_proc AS procedure JOIN pg_catalog.pg_roles AS role ON role.oid=procedure.proowner WHERE procedure.oid=pg_catalog.to_regprocedure(%s)"
OBSOLETE_NOTIFICATION_OVERLOAD_HOOK_VERSION="20260713002000"; OBSOLETE_NOTIFICATION_OVERLOAD="public.create_user_notification(uuid,public.notification_type,text,text,jsonb)"; CANONICAL_NOTIFICATION_FUNCTION="public.create_user_notification(uuid,text,text,text,jsonb)"
PUBLIC_FUNCTION_OWNERS_HOOK_VERSION="20260713002000"; PUBLIC_FUNCTION_OWNERS_SQL="SELECT procedure.oid::regprocedure::text, role.rolname FROM pg_catalog.pg_proc AS procedure JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace JOIN pg_catalog.pg_roles AS role ON role.oid=procedure.proowner WHERE namespace.nspname='public' ORDER BY procedure.oid"; PUBLIC_FUNCTION_OWNERS_ALLOWED=frozenset(("supabase_admin","postgres","privacy_workflow_owner")); PUBLIC_FUNCTION_OWNERS_POSTCONDITION=frozenset(("postgres","privacy_workflow_owner"))
class RecoveryError(RuntimeError): pass
def _pairs(pairs):
 result={}
 for k,v in pairs:
  if k in result: raise RecoveryError("duplicate JSON object key")
  result[k]=v
 return result
def _canonical_ledger_pairs(value):
 try: raw=tuple(value)
 except TypeError as exc: raise RecoveryError("invalid ledger pairs") from exc
 if any(not isinstance(pair,(list,tuple)) or len(pair)!=2 or not all(isinstance(item,str) and item for item in pair) for pair in raw): raise RecoveryError("invalid ledger pairs")
 return tuple((pair[0],pair[1]) for pair in raw)
def _ledger_evidence_equal(expected,observed):
 try: return _canonical_ledger_pairs(expected)==_canonical_ledger_pairs(observed)
 except RecoveryError: return False
def _managed_metadata_schemas_equal(expected,observed):
 if not isinstance(expected,(list,tuple)) or not isinstance(observed,(list,tuple)): return False
 return all(isinstance(schema,str) for schema in (*expected,*observed)) and tuple(expected)==tuple(observed)
def canonical_bytes(value): return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode("ascii")
def digest(value): return hashlib.sha256(canonical_bytes(value)).hexdigest()
def receipt(mode,status,evidence,prior=None):
 item={"schema":RECEIPT_SCHEMA,"mode":mode,"status":status,"manifest_sha256":MANIFEST_SHA256,"prior_receipt_sha256":prior or [],"evidence":evidence}; item["receipt_sha256"]=digest(item); return item
def emit(value): print(canonical_bytes(value).decode("ascii"))
def read_json_receipt(path):
 try:
  if path.is_symlink() or not path.is_file(): raise OSError()
  data=json.loads(path.read_text(encoding="utf-8"),object_pairs_hook=_pairs)
 except (OSError,json.JSONDecodeError,RecoveryError) as exc: raise RecoveryError("receipt unreadable") from exc
 copy=dict(data); got=copy.pop("receipt_sha256",None)
 if not isinstance(data,dict) or data.get("schema")!=RECEIPT_SCHEMA or not isinstance(got,str) or not HEX.fullmatch(got) or got!=digest(copy): raise RecoveryError("receipt binding invalid")
 if data.get("manifest_sha256")!=MANIFEST_SHA256: raise RecoveryError("receipt binding invalid")
 return data
def _require_prior(path,mode):
 item=read_json_receipt(Path(path))
 if item.get("mode")!=mode or item.get("status") not in {"valid","captured","restored","applied","validated"}: raise RecoveryError("prior receipt transition invalid")
 return item
def run(argv,*,env,timeout=TIMEOUT_SECONDS,stdin=subprocess.DEVNULL):
 try:return subprocess.run(list(argv),stdin=stdin,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=timeout,check=True)
 except (OSError,subprocess.TimeoutExpired,subprocess.CalledProcessError) as exc: raise RecoveryError("external command failed") from exc
def command_exists(name):
 found=shutil.which(name)
 if not found: raise RecoveryError("required external command unavailable")
 return found
def safe_environment(service_file,*,crypto=False):
 env={k:os.environ[k] for k in ("PATH","SYSTEMROOT","WINDIR","HOME","USERPROFILE","TEMP","TMP") if k in os.environ}
 if not crypto: env["PGSERVICEFILE"]=str(service_file)
 return env
_WINDOWS_ALLOWED_SIDS={"S-1-5-18","S-1-5-32-544"}
_WINDOWS_SID=re.compile(r"^S-\d+(?:-\d+)+$",re.IGNORECASE)
def _windows_current_sid():
 try:
  completed=subprocess.run(["whoami","/user","/fo","csv","/nh"],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8",timeout=10,check=True)
  rows=list(csv.reader(completed.stdout.splitlines(),strict=True))
  if len(rows)!=1 or len(rows[0])!=2 or not _WINDOWS_SID.fullmatch(rows[0][1]): return None
  return rows[0][1].upper()
 except (OSError,subprocess.TimeoutExpired,subprocess.CalledProcessError,csv.Error): return None
def _windows_saved_sddl(export):
 try:
  raw=Path(export).read_bytes()
  if raw.startswith(b"\xff\xfe"): text=raw[2:].decode("utf-16-le")
  elif raw.startswith(b"\xfe\xff"): return None
  elif len(raw)%2==0 and raw[1::2].count(0)*4>=len(raw) and raw[::2].count(0)*8<len(raw): text=raw.decode("utf-16-le")
  else: text=raw.decode("utf-8")
  if "\x00" in text: return None
  lines=text.splitlines()
 except (OSError,UnicodeDecodeError): return None
 values=[]
 for line in lines:
  match=re.search(r"(?:^|\s)(D:[^\r\n]+)$",line)
  if match: values.append(match.group(1))
 return values[0] if len(values)==1 else None
def _windows_dacl_restrictive(path):
 """Windows ACL inspection has no POSIX mode-bit fallback."""
 if path.is_symlink() or not path.is_file(): return False
 current=_windows_current_sid()
 if not current: return False
 try:
  with tempfile.TemporaryDirectory(prefix="g035-acl-") as raw:
   export=Path(raw)/"acl.txt"
   completed=subprocess.run(["icacls",str(path),"/save",str(export),"/c"],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8",timeout=10,check=True)
   sddl=_windows_saved_sddl(export)
  if completed.returncode or not sddl or not sddl.startswith("D:"): return False
  dacl=sddl[2:]
  controls=re.match(r"(?:(?:P|AR|AI))*(?=\()",dacl)
  if not controls: return False
  aces_text=dacl[controls.end():]
  aces=re.findall(r"\(([^()]*)\)",aces_text)
  if not aces or "".join(f"({ace})" for ace in aces)!=aces_text: return False
  allowed={current,"SY","BA",*_WINDOWS_ALLOWED_SIDS}
  found_current=False
  for ace in aces:
   fields=ace.split(";")
   if len(fields)!=6 or fields[0]!="A" or fields[1] or not fields[2] or fields[3] or fields[4]: return False
   sid=fields[5].upper()
   if sid not in allowed: return False
   found_current |= sid==current
  return found_current
 except (OSError,subprocess.TimeoutExpired,subprocess.CalledProcessError): return False
def _restrictive(path):
 try:
  if path.is_symlink() or not path.is_file(): return False
  if os.name=="nt": return _windows_dacl_restrictive(path)
  return not bool(path.stat().st_mode & 0o077)
 except OSError:return False
def _require_restrictive_regular_file(path, label):
 if path.is_symlink() or not path.is_file() or not _restrictive(path): raise RecoveryError(f"{label} must be restrictive regular file")
def _parse_service_entries(source,section):
 try:
  raw=source.read_bytes(); text=raw.decode("utf8")
 except (OSError,UnicodeDecodeError) as exc: raise RecoveryError("service file unreadable") from exc
 if "\x00" in text: raise RecoveryError("invalid service file")
 entries={}; headers=0
 for line in text.splitlines():
  line=line.strip()
  if not line or line.startswith(("#",";")): continue
  if line.startswith("[") and line.endswith("]"):
   headers+=1
   if line[1:-1]!=section: raise RecoveryError("invalid service section")
   continue
  if headers != 1 or "=" not in line: raise RecoveryError("invalid service file")
  key,value=(part.strip() for part in line.split("=",1))
  if not key or key in entries or key not in SERVICE_KEYS or not value or "://" in value or value.startswith(("postgres:","postgresql:")): raise RecoveryError("invalid service file")
  entries[key]=value
 if headers != 1 or not entries: raise RecoveryError("invalid service file")
 return raw,entries
def _parse_local_service(source,section):
 raw,entries=_parse_service_entries(source,section)
 if section != LOCAL_SERVICE: raise RecoveryError("invalid service file")
 required={"host","port","dbname","application_name","sslmode"}
 if not required.issubset(entries) or entries["dbname"]!=LOCAL_DBNAME or LOCAL_SERVICE not in entries["application_name"] or entries["sslmode"]!="disable": raise RecoveryError("invalid local destination")
 host=entries["host"]
 try: numeric_host=ipaddress.ip_address(host)
 except ValueError as exc: raise RecoveryError("invalid local destination") from exc
 if str(numeric_host) not in LOCAL_HOSTS or not numeric_host.is_loopback: raise RecoveryError("invalid local destination")
 if not entries["port"].isdigit() or not 1<=int(entries["port"])<=65535: raise RecoveryError("invalid local destination")
 return raw
def _copy_service(tempdir,source,section):
 if source.is_symlink() or not source.is_file() or not _restrictive(source): raise RecoveryError("service file must be restrictive regular file")
 try: raw=source.read_bytes()
 except OSError as exc: raise RecoveryError("service file unreadable") from exc
 if b"\x00" in raw: raise RecoveryError("invalid service file")
 target=tempdir/"pg_service.conf"; target.write_bytes(raw); target.chmod(0o600); return target
def _copy_local_service(tempdir,source,section):
 if source.is_symlink() or not source.is_file() or not _restrictive(source): raise RecoveryError("service file must be restrictive regular file")
 raw=_parse_local_service(source,section)
 target=tempdir/"pg_service.conf"; target.write_bytes(raw); target.chmod(0o600); return target
def require_local(service):
 if service != LOCAL_SERVICE: raise RecoveryError("operation is limited to g035-local")
def _connect(service, env):
 try:
  import psycopg
  servicefile=env.get("PGSERVICEFILE")
  if not servicefile: raise RecoveryError("database connection unavailable")
  _,entries=_parse_service_entries(Path(servicefile),service)
  return psycopg.connect(**entries,autocommit=True)
 except RecoveryError: raise
 except Exception as exc: raise RecoveryError("database connection unavailable") from exc
def _query_conn(conn,sql,params=None):
 try:
  with conn.cursor() as cur:
   cur.execute(sql,params); return cur.fetchall() if cur.description is not None else []
 except Exception as exc: raise RecoveryError("database query unavailable") from exc
def _fingerprints(conn):
 rows=_query_conn(conn,"SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version, name")
 pairs=_canonical_ledger_pairs(rows); raw=json.dumps(pairs,separators=(",",":"))
 restorable_catalog=_query_conn(conn,"SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) ORDER BY 1,2",(list(DUMP_SCHEMAS),))
 managed_catalog=_query_conn(conn,"SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) ORDER BY 1,2",(list(MANAGED_METADATA_SCHEMAS),))
 managed_schemas=tuple(str(row[0]) for row in _query_conn(conn,"SELECT nspname FROM pg_namespace WHERE nspname=ANY(%s) ORDER BY 1",(list(MANAGED_METADATA_SCHEMAS),)))
 return {"ledger_pairs":pairs,"ledger_sha256":hashlib.sha256(raw.encode()).hexdigest(),"ledger_count":len(pairs),"restorable_catalog_sha256":hashlib.sha256(json.dumps(restorable_catalog,default=str,separators=(",",":")).encode()).hexdigest(),"managed_catalog_sha256":hashlib.sha256(json.dumps(managed_catalog,default=str,separators=(",",":")).encode()).hexdigest(),"managed_metadata_schemas_present":managed_schemas}
def _repository_commit(root):
 try:
  value=subprocess.run(["git","-C",str(root),"rev-parse","HEAD"],check=True,capture_output=True,text=True).stdout.strip()
 except Exception as exc: raise RecoveryError("repository commit unavailable") from exc
 if not re.fullmatch(r"[0-9a-f]{40}",value): raise RecoveryError("repository commit unavailable")
 return value
def _preflight_receipt(data):
 return digest({key:data[key] for key in ("catalogFingerprint","hostedLedgerFingerprint","manifestHash","repositoryCommit","sourceFingerprint")})
def _source_fingerprint(manifest):
 return digest([entry.sha256 for entry in manifest.migrations])
def _g034_live_fingerprints(conn,artifact):
 try:
  data=json.loads(Path(artifact).read_text(encoding="utf8"),object_pairs_hook=_pairs)
  terminal=data["ledgerExpectedTerminal"]
  if not isinstance(terminal,str) or not re.fullmatch(r"20\d{12}",terminal): raise RecoveryError("g034 artifact unreadable")
 except (OSError,json.JSONDecodeError,RecoveryError,KeyError,TypeError) as exc: raise RecoveryError("g034 artifact unreadable") from exc
 ledger=[str(row[0]) for row in _query_conn(conn,"SELECT version FROM supabase_migrations.schema_migrations ORDER BY version")]
 prerequisites={"ledgerTerminalMatches":bool(ledger) and ledger[-1]==terminal and not any(version>terminal for version in ledger)}
 relations=(("public.restaurants","public","restaurants","publicRestaurants"),("public.restaurants_backup","public","restaurants_backup","publicRestaurantsBackup"),("storage.objects","storage","objects","storageObjects"))
 for lookup,namespace,name,key in relations:
  prerequisites[key]=bool(_query_conn(conn,"SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS class JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace WHERE class.oid = pg_catalog.to_regclass(%s) AND namespace.nspname = %s AND class.relname = %s AND class.relkind = 'r')",(lookup,namespace,name))[0][0])
 procedures=(("public.approve_submission_item(uuid,uuid,jsonb)","public","approve_submission_item","2950 2950 3802","publicApproveSubmissionItem"),("public.approve_edit_submission_item(uuid,uuid,jsonb)","public","approve_edit_submission_item","2950 2950 3802","publicApproveEditSubmissionItem"))
 for lookup,namespace,name,input_type_oids,key in procedures:
  prerequisites[key]=bool(_query_conn(conn,"SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS procedure JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace WHERE procedure.oid = pg_catalog.to_regprocedure(%s) AND namespace.nspname = %s AND procedure.proname = %s AND procedure.proargtypes = %s::pg_catalog.oidvector AND procedure.prokind = 'f')",(lookup,namespace,name,input_type_oids))[0][0])
 prerequisites["noWaitingLocks"]=int(_query_conn(conn,"SELECT count(*) FROM pg_catalog.pg_locks WHERE NOT granted")[0][0])==0
 prerequisites["requiredRolesPresent"]=int(_query_conn(conn,"SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname = ANY(%s)",(["postgres","service_role","authenticated"],))[0][0])==3
 return {"ledger_sha256":digest(ledger),"catalog_sha256":digest(prerequisites)}
def _g034_adapter(path, root, manifest, observed):
 try:
  data=json.loads(Path(path).read_text(encoding="utf8"),object_pairs_hook=_pairs)
 except (OSError,json.JSONDecodeError,RecoveryError) as exc: raise RecoveryError("g034 artifact unreadable") from exc
 required={"artifactVersion","blockers","catalogChecked","catalogFingerprint","cloneApplyRisks","cloneBackupRecoveryRequired","hostedLedgerFingerprint","manifestHash","preflightReceiptId","prerequisites","repositoryCommit","requiredLaterPromotionGate","safeToApply","sourceFingerprint","sourceValid","schemaVersion","ledgerExpectedTerminal","closureTerminalVersion"}
 allowed={"clone-required","clone-backup-recovery-required","catalog-prerequisite"}
 fatal_prefixes=("manifest","database-url","catalog-read","catalog-rollback")
 if not isinstance(data,dict) or set(data)!=required or data["artifactVersion"]!=2 or data["ledgerExpectedTerminal"]!=manifest.ledger_terminal_version or not isinstance(data["blockers"],list) or len(data["blockers"])!=len(set(data["blockers"])) or any(not isinstance(code,str) for code in data["blockers"]) or not set(data["blockers"]).issubset(allowed) or any(code.startswith(fatal_prefixes) for code in data["blockers"]) or data["manifestHash"]!=MANIFEST_SHA256 or data["repositoryCommit"]!=_repository_commit(root) or data["sourceFingerprint"]!=_source_fingerprint(manifest) or not data["sourceValid"] or not data["catalogChecked"] or data["safeToApply"] is not False or data["preflightReceiptId"]!=_preflight_receipt(data) or data["hostedLedgerFingerprint"]!=observed["ledger_sha256"] or data["catalogFingerprint"]!=observed["catalog_sha256"]:
  raise RecoveryError("g034 capture readiness is not satisfied")
 return {"g034_preflight_receipt_id":data["preflightReceiptId"],"commit_sha256":data["repositoryCommit"],"catalog_sha256":data["catalogFingerprint"],"ledger_sha256":data["hostedLedgerFingerprint"],"source_sha256":data["sourceFingerprint"],"capture_readiness_sha256":digest({"artifact_sha256":sha256_file(Path(path)),"preflight_receipt_id":data["preflightReceiptId"],"live_catalog_sha256":observed["catalog_sha256"],"live_ledger_sha256":observed["ledger_sha256"]})}
def _dump_to_encrypted(pg_dump,encryptor,recipient,snapshot,env,destination):
 if not isinstance(snapshot,str) or not SNAPSHOT.fullmatch(snapshot): raise RecoveryError("invalid snapshot")
 output=destination/"g035-dump.enc"; argv=[pg_dump,"--format=custom","--snapshot="+snapshot,"--blobs",*["--schema="+schema for schema in DUMP_SCHEMAS],*MANAGED_TABLE_DATA_EXCLUSIONS,*["--extension="+name for name,_ in RECOVERY_EXTENSIONS],"--dbname=service=g035"]
 try:
  with output.open("xb") as sink:
   crypt=subprocess.Popen([encryptor,"--recipient",recipient],stdin=subprocess.PIPE,stdout=sink,stderr=subprocess.PIPE,env=safe_environment(Path("."),crypto=True)); dump=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=crypt.stdin,stderr=subprocess.PIPE,env=env); crypt.stdin.close()
   if dump.wait(TIMEOUT_SECONDS) or crypt.wait(TIMEOUT_SECONDS): raise RecoveryError("database capture failed")
 except (OSError,subprocess.TimeoutExpired,RecoveryError) as exc:
  output.unlink(missing_ok=True); raise RecoveryError("database capture failed") from exc
 return argv
def run_capture(args,manifest):
 destination=Path(args.destination).resolve(); root=repository_root(Path(__file__).resolve())
 if not destination.is_dir() or root==destination or root in destination.parents: raise RecoveryError("destination must be an existing directory outside repository")
 if not AGE_RECIPIENT.fullmatch(args.recipient) or hashlib.sha256(args.recipient.encode("utf-8")).hexdigest()!=APPROVED_AGE_RECIPIENT_SHA256: raise RecoveryError("invalid encryption recipient")
 readiness=None; pg_dump=command_exists(args.pg_dump); encryptor=command_exists(args.encrypt_command)
 with tempfile.TemporaryDirectory(prefix="g035-",dir=str(destination)) as raw:
  service=_copy_service(Path(raw),Path(args.service_file),"g035"); env=safe_environment(service); conn=_connect("g035",env)
  try:
   _query_conn(conn,"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); snapshot=_query_conn(conn,"SELECT pg_export_snapshot()")[0][0]
   observed=_fingerprints(conn); readiness=_g034_adapter(args.g034_artifact,root,manifest,_g034_live_fingerprints(conn,args.g034_artifact)); argv=_dump_to_encrypted(pg_dump,encryptor,args.recipient,snapshot,env,destination)
  finally: conn.rollback(); conn.close()
 evidence={**readiness,"recipient_fingerprint":hashlib.sha256(args.recipient.encode("utf-8")).hexdigest(),"dump_sha256":sha256_file(destination/"g035-dump.enc"),"dump_bytes":(destination/"g035-dump.enc").stat().st_size,"schema_scope":list(APPLICATION_SCHEMAS),"recovery_control_schema_scope":list(RECOVERY_CONTROL_SCHEMAS),"extension_scope":[{"name":name,"schema":schema} for name,schema in RECOVERY_EXTENSIONS],"managed_metadata_schema_scope":list(MANAGED_METADATA_SCHEMAS),"managed_table_data_exclusions":list(MANAGED_TABLE_DATA_EXCLUSIONS),"snapshot_consumer_argv":argv,**observed}
 return receipt("capture","captured",evidence)
def run_restore_verify(args,manifest):
 require_local(args.destination_service); capture=_require_prior(args.capture_receipt,"capture"); dump=Path(args.dump); identity=Path(args.identity_file)
 if capture["evidence"].get("recipient_fingerprint")!=APPROVED_AGE_RECIPIENT_SHA256: raise RecoveryError("capture recipient binding mismatch")
 if capture["evidence"].get("extension_scope")!=[{"name":name,"schema":schema} for name,schema in RECOVERY_EXTENSIONS] or capture["evidence"].get("managed_metadata_schema_scope")!=list(MANAGED_METADATA_SCHEMAS) or capture["evidence"].get("managed_table_data_exclusions")!=list(MANAGED_TABLE_DATA_EXCLUSIONS): raise RecoveryError("capture managed metadata scope mismatch")
 if dump.is_symlink() or not dump.is_file() or sha256_file(dump)!=capture["evidence"].get("dump_sha256"): raise RecoveryError("ciphertext input mismatch")
 _require_restrictive_regular_file(identity,"identity file")
 decryptor,restore=command_exists(args.decrypt_command),command_exists(args.pg_restore)
 with tempfile.TemporaryDirectory(prefix="g035-restore-") as raw:
  service=_copy_local_service(Path(raw),Path(args.service_file),"g035-local"); env=safe_environment(service); plain=Path(raw)/"database.pgdump"; run([decryptor,"--decrypt","--identity",str(identity),"--output",str(plain),str(dump)],env=safe_environment(service,crypto=True))
  conn=_connect("g035-local",env)
  try:
   for schema in (LOCAL_REMEDIATION_SCHEMA,"public","auth","storage"): _query_conn(conn,f"DROP SCHEMA IF EXISTS {schema} CASCADE")
   conn.commit()
  except Exception:
   conn.rollback()
   raise
  finally: conn.close()
  run([restore,"--section=pre-data","--dbname=service=g035-local",str(plain)],env=env)
  run([restore,"--section=data","--dbname=service=g035-local",str(plain)],env=env)
  conn=_connect("g035-local",env)
  try:
   _create_auth_user_placeholders(conn); conn.commit()
  except Exception:
   conn.rollback()
   raise
  finally: conn.close()
  run([restore,"--section=post-data","--dbname=service=g035-local",str(plain)],env=env)
  conn=_connect("g035-local",env)
  try: observed=_fingerprints(conn)
  finally: conn.rollback(); conn.close()
 expected=capture["evidence"]
 if not _ledger_evidence_equal(expected.get("ledger_pairs"),observed["ledger_pairs"]): raise RecoveryError("restore evidence mismatch")
 for key in ("ledger_sha256","ledger_count","restorable_catalog_sha256","managed_catalog_sha256"):
  if expected.get(key)!=observed.get(key): raise RecoveryError("restore evidence mismatch")
 if tuple(observed.get("managed_metadata_schemas_present",()))!=tuple(MANAGED_METADATA_SCHEMAS): raise RecoveryError("managed metadata structure mismatch")
 return receipt("restore-verify","restored",{**observed,"managed_metadata_coherence":"managed schema DDL restored with hosted catalog parity; managed table data excluded",**_auth_placeholder_evidence()},[capture["receipt_sha256"]])
def _validate_auth_user_reference_columns(conn):
 for schema,table,column in AUTH_USER_REFERENCE_COLUMNS:
  rows=_query_conn(conn,"SELECT namespace.nspname, class.relname, attribute.attname, type.typname, type_namespace.nspname FROM pg_catalog.pg_attribute AS attribute JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace JOIN pg_catalog.pg_type AS type ON type.oid = attribute.atttypid JOIN pg_catalog.pg_namespace AS type_namespace ON type_namespace.oid = type.typnamespace WHERE namespace.nspname = %s AND class.relname = %s AND attribute.attname = %s AND class.relkind IN ('r','p') AND attribute.attnum > 0 AND NOT attribute.attisdropped",(schema,table,column))
  if rows!=[(schema,table,column,"uuid","pg_catalog")]: raise RecoveryError("auth placeholder mapping drift")
def _create_auth_user_placeholders(conn):
 _validate_auth_user_reference_columns(conn)
 if _query_conn(conn,"SELECT NOT EXISTS (SELECT 1 FROM auth.users)")!=[(True,)]: raise RecoveryError("auth placeholder target is not empty")
 references=" UNION ALL ".join(f"SELECT {table}.{column} AS id FROM {schema}.{table} WHERE {table}.{column} IS NOT NULL" for schema,table,column in AUTH_USER_REFERENCE_COLUMNS)
 _query_conn(conn,f"INSERT INTO auth.users (id) SELECT DISTINCT id FROM ({references}) AS auth_user_references")
def _auth_placeholder_evidence():
 return {"auth_placeholder_mapping_count":len(AUTH_USER_REFERENCE_COLUMNS),"auth_placeholder_mapping_sha256":digest(AUTH_USER_REFERENCE_COLUMNS)}
def _ledger_sha256(pairs):
 raw=json.dumps(_canonical_ledger_pairs(pairs),separators=(",",":"))
 return hashlib.sha256(raw.encode()).hexdigest()
def _manifest_ledger_pairs(manifest):
 return BASELINE_PAIRS+tuple((entry.version,entry.name) for entry in manifest.migrations)
def _ledger_assert(conn,manifest,count):
 actual=_fingerprints(conn)["ledger_pairs"]
 if any(v in FORBIDDEN_VERSIONS for v,_ in actual) or not ledger_prefix(manifest,actual) or len(actual)!=len(BASELINE_PAIRS)+count: raise RecoveryError("ledger prefix mismatch")
def _initial_ledger_state(conn,manifest):
 actual=_fingerprints(conn)["ledger_pairs"]; full=_manifest_ledger_pairs(manifest)
 if any(v in FORBIDDEN_VERSIONS for v,_ in actual): raise RecoveryError("ledger initial state mismatch")
 if actual==BASELINE_PAIRS: return "baseline"
 if actual==full: return "full"
 raise RecoveryError("ledger initial state mismatch")
def _require_restore_initial_ledger(prior,manifest):
 evidence=prior.get("evidence")
 if not isinstance(evidence,dict): raise RecoveryError("restore receipt ledger mismatch")
 for state,pairs in (("baseline",BASELINE_PAIRS),("full",_manifest_ledger_pairs(manifest))):
  if evidence.get("ledger_sha256")==_ledger_sha256(pairs) and evidence.get("ledger_count")==len(pairs) and _ledger_evidence_equal(evidence.get("ledger_pairs"),pairs): return state
 raise RecoveryError("restore receipt ledger mismatch")
def _compatibility_hook(version):
 return COMPATIBILITY_HOOKS.get(version,())
def _self_terminated_sql(statement):
 normalized=statement.rstrip()
 while normalized.endswith(";"): normalized=normalized[:-1].rstrip()
 if not normalized: raise RecoveryError("empty compatibility statement")
 return f"{normalized};"
def _compatibility_sql(version):
 statements=list(_compatibility_hook(version))
 if version==VECTOR_EXTENSION_RELOCATION_HOOK_VERSION: statements.extend(("DO $$ BEGIN IF (SELECT n.nspname FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector') <> 'public' THEN RAISE EXCEPTION 'vector compatibility precondition failed'; END IF; END $$;","ALTER EXTENSION vector SET SCHEMA extensions","DO $$ BEGIN IF (SELECT n.nspname FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector') <> 'extensions' THEN RAISE EXCEPTION 'vector compatibility postcondition failed'; END IF; END $$;"))
 if version==OBSOLETE_NOTIFICATION_OVERLOAD_HOOK_VERSION: statements.extend((f"DO $$ BEGIN IF pg_catalog.to_regprocedure('{OBSOLETE_NOTIFICATION_OVERLOAD}') IS NULL OR pg_catalog.to_regprocedure('{CANONICAL_NOTIFICATION_FUNCTION}') IS NULL THEN RAISE EXCEPTION 'notification overload compatibility precondition failed'; END IF; END $$;",f"DROP FUNCTION {OBSOLETE_NOTIFICATION_OVERLOAD}",f"DO $$ BEGIN IF pg_catalog.to_regprocedure('{OBSOLETE_NOTIFICATION_OVERLOAD}') IS NOT NULL OR pg_catalog.to_regprocedure('{CANONICAL_NOTIFICATION_FUNCTION}') IS NULL THEN RAISE EXCEPTION 'notification overload compatibility postcondition failed'; END IF; END $$;"))
 if version==PUBLIC_FUNCTION_OWNERS_HOOK_VERSION: statements.append("DO $$ DECLARE function_row record; BEGIN IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND r.rolname NOT IN ('supabase_admin','postgres','privacy_workflow_owner')) THEN RAISE EXCEPTION 'public function owner compatibility precondition failed'; END IF; FOR function_row IN SELECT p.oid::regprocedure signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND r.rolname='supabase_admin' LOOP EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',function_row.signature); END LOOP; IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND r.rolname NOT IN ('postgres','privacy_workflow_owner')) THEN RAISE EXCEPTION 'public function owner compatibility postcondition failed'; END IF; END $$;")
 if version==CROSS_SCHEMA_OWNER_HOOK_VERSION:
  for signature in CROSS_SCHEMA_OWNER_FUNCTIONS: statements.append(f"DO $$ BEGIN IF pg_catalog.to_regprocedure('{signature}') IS NULL THEN RAISE EXCEPTION 'cross-schema owner compatibility precondition failed'; END IF; ALTER FUNCTION {signature} OWNER TO postgres; IF (SELECT r.rolname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid=p.proowner WHERE p.oid=pg_catalog.to_regprocedure('{signature}')) <> 'postgres' THEN RAISE EXCEPTION 'cross-schema owner compatibility postcondition failed'; END IF; END $$;")
 return tuple(_self_terminated_sql(statement) for statement in statements)
def _short_url_snapshot(conn):
 catalog=_query_conn(conn,"SELECT COALESCE(json_agg(json_build_object('name',column_name,'type',data_type,'nullable',is_nullable,'position',ordinal_position,'character_maximum_length',character_maximum_length,'column_default',column_default,'is_generated',is_generated,'is_identity',is_identity,'identity_generation',identity_generation) ORDER BY ordinal_position),'[]')::text FROM information_schema.columns WHERE table_schema='public' AND table_name='short_urls'")[0][0]
 rows=_query_conn(conn,"SELECT COALESCE(json_agg(to_jsonb(s) ORDER BY s.id),'[]')::text FROM public.short_urls s")[0][0]
 victims=_query_conn(conn,"WITH r AS (SELECT id,target_url,first_value(id) OVER (PARTITION BY target_url ORDER BY created_at NULLS LAST,id) keeper_id,row_number() OVER (PARTITION BY target_url ORDER BY created_at NULLS LAST,id) rank,to_jsonb(short_urls) row_json FROM public.short_urls) SELECT COALESCE(json_agg(json_build_object('source_id',id::text,'keeper_id',keeper_id::text,'target_url_sha256',encode(digest(target_url,'sha256'),'hex'),'rank',rank,'source_row_sha256',encode(digest(row_json::text,'sha256'),'hex')) ORDER BY id),'[]')::text FROM r WHERE rank>1")[0][0]
 if _query_conn(conn,"SELECT EXISTS (SELECT 1 FROM public.short_urls WHERE code IS NULL OR target_url IS NULL) OR EXISTS (SELECT 1 FROM public.short_urls GROUP BY code HAVING count(*)>1)")[0][0]: raise RecoveryError("short_urls inspection precondition failed")
 catalog_value=json.loads(catalog)
 if catalog_value!=list(SHORT_URLS_CATALOG): raise RecoveryError("short_urls catalog drift")
 descriptors=json.loads(victims); return {"selection_spec_sha256":digest(SHORT_URL_SELECTION_SPEC),"short_urls_catalog_sha256":digest(catalog_value),"pre_short_urls_rowset_sha256":digest(json.loads(rows)),"duplicate_group_count":len({item["keeper_id"] for item in descriptors}),"duplicate_victim_count":len(descriptors),"duplicate_victims_sha256":digest(descriptors),"victim_descriptors_sha256":digest(descriptors),"_victims":descriptors}
def run_short_url_inspect(args,manifest):
 require_local(args.service); restored=_require_prior(args.restore_receipt,"restore-verify")
 with tempfile.TemporaryDirectory(prefix="g035-inspect-") as raw:
  service=_copy_local_service(Path(raw),Path(args.service_file),"g035-local"); conn=_connect("g035-local",safe_environment(service))
  try: _query_conn(conn,"BEGIN READ ONLY"); evidence=_short_url_snapshot(conn)
  finally: conn.rollback(); conn.close()
 return receipt("short-url-remediation-inspect","validated",{k:v for k,v in evidence.items() if not k.startswith("_")},[restored["receipt_sha256"]])
def _id_digest(values): return digest(sorted(values))
def _canonical_uuid(value):
 try:
  parsed=uuid.UUID(value)
 except (ValueError,TypeError,AttributeError) as exc: raise RecoveryError("authorization batch invalid") from exc
 if not isinstance(value,str) or str(parsed)!=value: raise RecoveryError("authorization batch invalid")
 return value
def _authorization_digest_fields(auth):
 hex_fields=("inspection_receipt_sha256","restore_receipt_sha256","capture_receipt_sha256","manifest_sha256","selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_victims_sha256","victim_descriptors_sha256")
 if any(not isinstance(auth.get(key),str) or not HEX.fullmatch(auth[key]) for key in hex_fields): raise RecoveryError("authorization digest invalid")
 if not isinstance(auth.get("repository_commit"),str) or not re.fullmatch(r"[0-9a-f]{40,64}",auth["repository_commit"]): raise RecoveryError("authorization repository invalid")
 for key in ("duplicate_group_count","duplicate_victim_count"):
  if not isinstance(auth.get(key),int) or isinstance(auth[key],bool) or auth[key] < 0: raise RecoveryError("authorization count invalid")
 _canonical_uuid(auth.get("batch_id"))
def _authorization(args,inspection,restored):
 path=Path(args.authorization); signature=Path(args.authorization_signature); _require_restrictive_regular_file(path,"authorization file"); _require_restrictive_regular_file(signature,"authorization signature")
 try:
  raw=path.read_bytes(); auth=json.loads(raw.decode("utf8"),object_pairs_hook=_pairs)
 except (OSError,UnicodeDecodeError,json.JSONDecodeError,RecoveryError): raise RecoveryError("authorization JSON invalid")
 if raw!=canonical_bytes(auth): raise RecoveryError("authorization JSON noncanonical")
 required={"schema","inspection_receipt_sha256","restore_receipt_sha256","capture_receipt_sha256","manifest_sha256","repository_commit","selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_group_count","duplicate_victim_count","duplicate_victims_sha256","victim_descriptors_sha256","batch_id"}
 if set(auth)!=required or auth.get("schema")!=REMEDIATION_AUTHORIZATION_SCHEMA: raise RecoveryError("authorization schema invalid")
 _authorization_digest_fields(auth)
 capture=restored.get("prior_receipt_sha256",[])
 expected={"inspection_receipt_sha256":inspection["receipt_sha256"],"restore_receipt_sha256":restored["receipt_sha256"],"capture_receipt_sha256":capture[0] if len(capture)==1 else None,"manifest_sha256":MANIFEST_SHA256,"repository_commit":_repository_commit(repository_root(Path(__file__).resolve()))}
 if any(auth.get(key)!=value for key,value in expected.items()): raise RecoveryError("authorization binding invalid")
 for key in ("selection_spec_sha256","short_urls_catalog_sha256","pre_short_urls_rowset_sha256","duplicate_group_count","duplicate_victim_count","duplicate_victims_sha256","victim_descriptors_sha256"):
  if auth[key]!=inspection["evidence"][key]: raise RecoveryError("authorization inspection invalid")
 fd,key_name=tempfile.mkstemp(prefix="g035-key-"); os.close(fd); key=Path(key_name)
 try:
  key.write_bytes(REMEDIATION_PUBLIC_KEY_PEM.encode("ascii"))
  if hashlib.sha256(key.read_bytes()).hexdigest()!=REMEDIATION_PUBLIC_KEY_SHA256: raise RecoveryError("pinned key mismatch")
  run(["openssl","pkeyutl","-verify","-pubin","-inkey",str(key),"-rawin","-in",str(path),"-sigfile",str(signature)],env=safe_environment(Path("."),crypto=True))
 finally: key.unlink(missing_ok=True)
 return auth
def _quarantine_catalog_expected():
 metadata=(("batch_id","uuid"),("duplicate_rank","bigint"),("keeper_id","uuid"),("source_row_jsonb","jsonb"),("source_row_sha256","text"))
 return [*SHORT_URLS_CATALOG,*({"name":name,"type":kind,"nullable":"NO","position":len(SHORT_URLS_CATALOG)+index,"character_maximum_length":None,"column_default":None,"is_generated":"NEVER","is_identity":"NO","identity_generation":None} for index,(name,kind) in enumerate(metadata,1))]
def _quarantine_catalog(conn):
 raw=_query_conn(conn,"SELECT COALESCE(json_agg(json_build_object('name',column_name,'type',data_type,'nullable',is_nullable,'position',ordinal_position,'character_maximum_length',character_maximum_length,'column_default',column_default,'is_generated',is_generated,'is_identity',is_identity,'identity_generation',identity_generation) ORDER BY ordinal_position),'[]')::text FROM information_schema.columns WHERE table_schema='g035_recovery_control' AND table_name='short_url_duplicate_quarantine'")[0][0]
 catalog=json.loads(raw)
 if catalog!=_quarantine_catalog_expected(): raise RecoveryError("quarantine catalog drift")
 return digest(catalog)
def _durable_descriptors(conn,batch):
 raw=_query_conn(conn,"SELECT COALESCE(json_agg(json_build_object('source_id',id::text,'keeper_id',keeper_id::text,'target_url_sha256',encode(digest(source_row_jsonb->>'target_url','sha256'),'hex'),'rank',duplicate_rank,'source_row_sha256',source_row_sha256) ORDER BY id),'[]')::text FROM g035_recovery_control.short_url_duplicate_quarantine WHERE batch_id=%s",(batch,))[0][0]
 descriptors=json.loads(raw)
 bad=_query_conn(conn,"SELECT count(*) FROM g035_recovery_control.short_url_duplicate_quarantine WHERE batch_id=%s AND source_row_sha256<>encode(digest(source_row_jsonb::text,'sha256'),'hex')",(batch,))[0][0]
 if bad: raise RecoveryError("quarantine row hash drift")
 return descriptors
def _quarantine_acl_valid(conn):
 schema=_query_conn(conn,"SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace AS namespace CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))) AS acl WHERE namespace.nspname='g035_recovery_control' AND (acl.grantee=0 OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS role WHERE role.oid=acl.grantee AND role.rolname IN ('anon','authenticated','service_role'))))")[0][0]
 table=_query_conn(conn,"SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS class JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=class.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(class.relacl,pg_catalog.acldefault('r',class.relowner))) AS acl WHERE namespace.nspname='g035_recovery_control' AND class.relname IN ('short_url_duplicate_quarantine','short_url_duplicate_quarantine_batches') AND (acl.grantee=0 OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS role WHERE role.oid=acl.grantee AND role.rolname IN ('anon','authenticated','service_role'))))")[0][0]
 defaults=_query_conn(conn,"SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl AS default_acl LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=default_acl.defaclnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) AS acl WHERE default_acl.defaclobjtype IN ('r','S') AND (default_acl.defaclnamespace=0 OR namespace.nspname='g035_recovery_control') AND (acl.grantee=0 OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS role WHERE role.oid=acl.grantee AND role.rolname IN ('anon','authenticated','service_role'))))")[0][0]
 return bool(schema and table and defaults)
def _recovered_apply_evidence(conn,auth,restored,inspected):
 objects=_query_conn(conn,"SELECT pg_catalog.to_regnamespace('g035_recovery_control'),pg_catalog.to_regclass('g035_recovery_control.short_url_duplicate_quarantine_batches'),pg_catalog.to_regclass('g035_recovery_control.short_url_duplicate_quarantine')")[0]
 if not any(objects): return None
 if not all(objects): raise RecoveryError("partial remediation control state")
 catalog=_quarantine_catalog(conn)
 binding=_query_conn(conn,"SELECT restore_receipt_sha256,inspection_receipt_sha256,authorization_sha256,manifest_sha256,repository_commit,selection_spec_sha256,short_urls_catalog_sha256,duplicate_group_count,victim_count,pre_rowset_sha256,victim_descriptors_sha256,quarantine_catalog_sha256,quarantined_ids_sha256,deleted_ids_sha256,survivor_rowset_sha256 FROM g035_recovery_control.short_url_duplicate_quarantine_batches WHERE batch_id=%s",(auth["batch_id"],))
 if len(binding)!=1: raise RecoveryError("remediation batch binding mismatch")
 row=binding[0]; expected=(restored["receipt_sha256"],inspected["receipt_sha256"],digest(auth),MANIFEST_SHA256,auth["repository_commit"],auth["selection_spec_sha256"],auth["short_urls_catalog_sha256"],auth["duplicate_group_count"],auth["duplicate_victim_count"],auth["pre_short_urls_rowset_sha256"],auth["victim_descriptors_sha256"],catalog)
 if row[:12]!=expected or not all(isinstance(value,str) and HEX.fullmatch(value) for value in row[12:]): raise RecoveryError("remediation batch binding mismatch")
 evidence={"local_only":True,"batch_id":auth["batch_id"],"restore_receipt_sha256":row[0],"inspection_receipt_sha256":row[1],"authorization_sha256":row[2],"manifest_sha256":row[3],"repository_commit":row[4],"selection_spec_sha256":row[5],"short_urls_catalog_sha256":row[6],"duplicate_group_count":row[7],"quarantined_row_count":row[8],"pre_short_urls_rowset_sha256":row[9],"victim_descriptors_sha256":row[10],"quarantine_catalog_sha256":row[11],"quarantined_ids_sha256":row[12],"deleted_ids_sha256":row[13],"survivor_short_urls_rowset_sha256":row[14]}
 batch,count,_=_verify_remediation_state(conn,evidence)
 if batch!=auth["batch_id"] or count!=evidence["quarantined_row_count"]: raise RecoveryError("remediation recovery verification failed")
 evidence["quarantined_row_sha256"]=digest(_durable_descriptors(conn,batch))
 return evidence
def _batch_values(auth,restored,inspected,state,catalog):
 return (auth["batch_id"],restored["receipt_sha256"],inspected["receipt_sha256"],digest(auth),MANIFEST_SHA256,auth["repository_commit"],state["selection_spec_sha256"],state["short_urls_catalog_sha256"],state["duplicate_group_count"],state["duplicate_victim_count"],state["pre_short_urls_rowset_sha256"],state["victim_descriptors_sha256"],catalog)
def run_short_url_apply(args,manifest):
 require_local(args.service); restored=_require_prior(args.restore_receipt,"restore-verify"); inspected=_require_prior(args.inspect_receipt,"short-url-remediation-inspect"); auth=_authorization(args,inspected,restored)
 with tempfile.TemporaryDirectory(prefix="g035-remediate-") as raw:
  service=_copy_local_service(Path(raw),Path(args.service_file),"g035-local"); conn=_connect("g035-local",safe_environment(service))
  try:
   _query_conn(conn,"BEGIN ISOLATION LEVEL SERIALIZABLE"); _query_conn(conn,"LOCK TABLE public.short_urls IN SHARE ROW EXCLUSIVE MODE"); recovered=_recovered_apply_evidence(conn,auth,restored,inspected)
   if recovered is not None:
    conn.commit()
    return receipt("short-url-remediation-apply","applied",recovered,[restored["receipt_sha256"],inspected["receipt_sha256"]])
   state=_short_url_snapshot(conn)
   if any(state[k]!=inspected["evidence"][k] for k in inspected["evidence"]): raise RecoveryError("inspection stale")
   _query_conn(conn,"CREATE SCHEMA g035_recovery_control"); _query_conn(conn,"CREATE TABLE g035_recovery_control.short_url_duplicate_quarantine_batches (batch_id uuid PRIMARY KEY, restore_receipt_sha256 text NOT NULL, inspection_receipt_sha256 text NOT NULL, authorization_sha256 text NOT NULL, manifest_sha256 text NOT NULL, repository_commit text NOT NULL, selection_spec_sha256 text NOT NULL, short_urls_catalog_sha256 text NOT NULL, duplicate_group_count bigint NOT NULL, victim_count bigint NOT NULL, pre_rowset_sha256 text NOT NULL, victim_descriptors_sha256 text NOT NULL, quarantine_catalog_sha256 text NOT NULL, quarantined_ids_sha256 text, deleted_ids_sha256 text, survivor_rowset_sha256 text)"); _query_conn(conn,"CREATE TABLE g035_recovery_control.short_url_duplicate_quarantine (LIKE public.short_urls INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY INCLUDING STORAGE, batch_id uuid NOT NULL REFERENCES g035_recovery_control.short_url_duplicate_quarantine_batches(batch_id), duplicate_rank bigint NOT NULL, keeper_id uuid NOT NULL, source_row_jsonb jsonb NOT NULL, source_row_sha256 text NOT NULL, UNIQUE (batch_id,id))"); _query_conn(conn,"REVOKE ALL ON SCHEMA g035_recovery_control FROM PUBLIC, anon, authenticated, service_role"); _query_conn(conn,"REVOKE ALL ON ALL TABLES IN SCHEMA g035_recovery_control FROM PUBLIC, anon, authenticated, service_role"); _query_conn(conn,"REVOKE ALL ON ALL SEQUENCES IN SCHEMA g035_recovery_control FROM PUBLIC, anon, authenticated, service_role"); _query_conn(conn,"ALTER DEFAULT PRIVILEGES IN SCHEMA g035_recovery_control REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role"); _query_conn(conn,"ALTER DEFAULT PRIVILEGES IN SCHEMA g035_recovery_control REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role")
   catalog=_quarantine_catalog(conn)
   _query_conn(conn,"INSERT INTO g035_recovery_control.short_url_duplicate_quarantine_batches (batch_id,restore_receipt_sha256,inspection_receipt_sha256,authorization_sha256,manifest_sha256,repository_commit,selection_spec_sha256,short_urls_catalog_sha256,duplicate_group_count,victim_count,pre_rowset_sha256,victim_descriptors_sha256,quarantine_catalog_sha256) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",_batch_values(auth,restored,inspected,state,catalog))
   for victim in state["_victims"]: _query_conn(conn,"INSERT INTO g035_recovery_control.short_url_duplicate_quarantine SELECT s.*, %s::uuid,%s,%s::uuid,to_jsonb(s),encode(digest(to_jsonb(s)::text,'sha256'),'hex') FROM public.short_urls s WHERE s.id=%s::uuid",(auth["batch_id"],victim["rank"],victim["keeper_id"],victim["source_id"]))
   descriptors=_durable_descriptors(conn,auth["batch_id"]); quarantine_ids=[item["source_id"] for item in descriptors]; expected_ids=[victim["source_id"] for victim in state["_victims"]]
   if descriptors!=state["_victims"] or digest(descriptors)!=inspected["evidence"]["victim_descriptors_sha256"] or quarantine_ids!=expected_ids or not _quarantine_acl_valid(conn): raise RecoveryError("quarantine incomplete")
   deleted=_query_conn(conn,"DELETE FROM public.short_urls s USING g035_recovery_control.short_url_duplicate_quarantine q WHERE q.batch_id=%s AND q.id=s.id RETURNING s.id::text",(auth["batch_id"],)); deleted_ids=sorted(row[0] for row in deleted); survivor=_short_url_snapshot(conn)
   if deleted_ids!=expected_ids or survivor["duplicate_victim_count"] or survivor["pre_short_urls_rowset_sha256"]==state["pre_short_urls_rowset_sha256"]: raise RecoveryError("remediation postcondition failed")
   _query_conn(conn,"UPDATE g035_recovery_control.short_url_duplicate_quarantine_batches SET quarantined_ids_sha256=%s,deleted_ids_sha256=%s,survivor_rowset_sha256=%s WHERE batch_id=%s",(_id_digest(quarantine_ids),_id_digest(deleted_ids),survivor["pre_short_urls_rowset_sha256"],auth["batch_id"]))
   conn.commit()
  except Exception: conn.rollback(); raise
  finally: conn.close()
 return receipt("short-url-remediation-apply","applied",{"local_only":True,"batch_id":auth["batch_id"],"restore_receipt_sha256":restored["receipt_sha256"],"inspection_receipt_sha256":inspected["receipt_sha256"],"authorization_sha256":digest(auth),"manifest_sha256":MANIFEST_SHA256,"repository_commit":auth["repository_commit"],"short_urls_catalog_sha256":state["short_urls_catalog_sha256"],"selection_spec_sha256":state["selection_spec_sha256"],"duplicate_group_count":state["duplicate_group_count"],"quarantined_row_count":len(quarantine_ids),"quarantined_row_sha256":digest(descriptors),"quarantined_ids_sha256":_id_digest(quarantine_ids),"deleted_ids_sha256":_id_digest(deleted_ids),"victim_descriptors_sha256":state["victim_descriptors_sha256"],"pre_short_urls_rowset_sha256":state["pre_short_urls_rowset_sha256"],"survivor_short_urls_rowset_sha256":survivor["pre_short_urls_rowset_sha256"],"quarantine_catalog_sha256":catalog},[restored["receipt_sha256"],inspected["receipt_sha256"]])
def _verify_remediation_state(conn,evidence):
 batch=evidence.get("batch_id")
 if evidence.get("local_only") is not True or not isinstance(batch,str): raise RecoveryError("remediation verification invalid")
 binding=_query_conn(conn,"SELECT restore_receipt_sha256,inspection_receipt_sha256,authorization_sha256,manifest_sha256,repository_commit,selection_spec_sha256,short_urls_catalog_sha256,duplicate_group_count,victim_count,pre_rowset_sha256,victim_descriptors_sha256,quarantine_catalog_sha256,quarantined_ids_sha256,deleted_ids_sha256,survivor_rowset_sha256 FROM g035_recovery_control.short_url_duplicate_quarantine_batches WHERE batch_id=%s",(batch,))
 descriptors=_durable_descriptors(conn,batch); ids=[item["source_id"] for item in descriptors]; state=_short_url_snapshot(conn); catalog=_quarantine_catalog(conn)
 overlap=_query_conn(conn,"SELECT EXISTS (SELECT 1 FROM public.short_urls s JOIN g035_recovery_control.short_url_duplicate_quarantine q ON q.id=s.id WHERE q.batch_id=%s)",(batch,))[0][0]
 expected=tuple(evidence.get(key) for key in ("restore_receipt_sha256","inspection_receipt_sha256","authorization_sha256","manifest_sha256","repository_commit","selection_spec_sha256","short_urls_catalog_sha256","duplicate_group_count","quarantined_row_count","pre_short_urls_rowset_sha256","victim_descriptors_sha256","quarantine_catalog_sha256","quarantined_ids_sha256","deleted_ids_sha256","survivor_short_urls_rowset_sha256"))
 if len(binding)!=1 or binding[0]!=expected or digest(descriptors)!=evidence.get("victim_descriptors_sha256") or _id_digest(ids)!=evidence.get("quarantined_ids_sha256") or evidence.get("quarantined_ids_sha256")!=evidence.get("deleted_ids_sha256") or catalog!=evidence.get("quarantine_catalog_sha256") or not _quarantine_acl_valid(conn) or overlap or state["duplicate_victim_count"] or state["pre_short_urls_rowset_sha256"]!=evidence.get("survivor_short_urls_rowset_sha256"): raise RecoveryError("durable remediation verification failed")
 return batch,len(descriptors),state
def run_short_url_verify(args,manifest):
 require_local(args.service); applied=_require_prior(args.apply_receipt,"short-url-remediation-apply")
 with tempfile.TemporaryDirectory(prefix="g035-verify-") as raw:
  service=_copy_local_service(Path(raw),Path(args.service_file),"g035-local"); conn=_connect("g035-local",safe_environment(service))
  try:
   _query_conn(conn,"BEGIN READ ONLY"); batch,count,state=_verify_remediation_state(conn,applied["evidence"])
  finally: conn.rollback(); conn.close()
 return receipt("short-url-remediation-verify","validated",{**applied["evidence"],"apply_receipt_sha256":applied["receipt_sha256"],"batch_id":batch,"quarantined_row_count":count,"survivor_short_urls_rowset_sha256":state["pre_short_urls_rowset_sha256"]},[applied["receipt_sha256"]])
def apply_manifest(args,manifest):
 require_local(args.service); prior=_require_prior(args.restore_receipt,"restore-verify"); psql=command_exists(args.psql)
 with tempfile.TemporaryDirectory(prefix="g035-clone-") as raw:
  service=_copy_local_service(Path(raw),Path(args.service_file),"g035-local"); env=safe_environment(service); conn=_connect("g035-local",env); self_commit_attempted=False; compatibility_hook_statements=[]; compatibility_hook_owner_function_count=0; compatibility_hook_obsolete_function_count=0; compatibility_hook_public_function_signatures=()
  try:
   _query_conn(conn,"SELECT pg_advisory_lock(35035)")
   receipt_initial_state=_require_restore_initial_ledger(prior,manifest)
   initial_state=_initial_ledger_state(conn,manifest)
   if initial_state!=receipt_initial_state: raise RecoveryError("restore receipt ledger mismatch")
   if initial_state=="baseline":
    verified=_require_prior(args.short_url_remediation_receipt,"short-url-remediation-verify")
    if verified.get("prior_receipt_sha256")!=[verified["evidence"].get("apply_receipt_sha256")] or verified["evidence"].get("restore_receipt_sha256")!=prior["receipt_sha256"]: raise RecoveryError("remediation verification chain invalid")
    _query_conn(conn,"BEGIN READ ONLY"); _verify_remediation_state(conn,verified["evidence"]); conn.rollback()
   if initial_state=="baseline":
    for index,entry in enumerate(manifest.migrations):
     _ledger_assert(conn,manifest,index); source=repository_root(Path(__file__).resolve())/entry.path
     if sha256_file(source)!=entry.sha256: raise RecoveryError("migration source hash mismatch")
     hook=_compatibility_sql(entry.version)
     if entry.version in SELF_COMMIT_VERSIONS:
      try:
       self_commit_attempted=True
       if hook:
        script=Path(raw)/f"{entry.version}.sql"; script.write_text(f"{chr(10).join(hook)}\n\\i {source.as_posix()}\n",encoding="utf8")
        run([psql,"service=g035-local","--set","ON_ERROR_STOP=1","--file",str(script)],env=env)
       else: run([psql,"service=g035-local","--set","ON_ERROR_STOP=1","--file",str(source)],env=env)
       _query_conn(conn,"INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES (%s,%s)",(entry.version,entry.name)); conn.commit()
       compatibility_hook_statements.extend(hook)
       _ledger_assert(conn,manifest,index+1)
      except Exception as exc: raise RecoveryError("self_commit_ambiguous") from exc
     else:
      script=Path(raw)/f"{entry.version}.sql"
      script.write_text(f"BEGIN;\n{chr(10).join(hook)}\n\\i {source.as_posix()}\nINSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('{entry.version}','{entry.name}');\nCOMMIT;\n",encoding="utf8")
      run([psql,"service=g035-local","--set","ON_ERROR_STOP=1","--file",str(script)],env=env)
      compatibility_hook_statements.extend(hook)
      _ledger_assert(conn,manifest,index+1)
   else:
    for entry in manifest.migrations:
     source=repository_root(Path(__file__).resolve())/entry.path
     if sha256_file(source)!=entry.sha256: raise RecoveryError("migration source hash mismatch")
   _ledger_assert(conn,manifest,len(manifest.migrations)); runtime=repository_root(Path(__file__).resolve())/"backend/supabase/tests/g035_hosted_clone_runtime.sql"
   run([psql,"service=g035-local","--set","ON_ERROR_STOP=1","--file",str(runtime)],env=env)
   observed=_fingerprints(conn)
  except Exception as exc:
   if self_commit_attempted: raise RecoveryError("self_commit_ambiguous") from exc
   raise
  finally:
   try:
    _query_conn(conn,"SELECT pg_advisory_unlock(35035)"); conn.commit()
   except Exception as exc:
    if self_commit_attempted: raise RecoveryError("self_commit_ambiguous") from exc
    raise
   finally: conn.close()
 return receipt("clone-apply","applied",{"clone_state":"transformed_local_clone_not_exact_restore","hosted_mutations":0,"baseline_pairs_sha256":BASELINE_SHA256,"initial_ledger_state":initial_state,"migrations_applied_in_invocation":len(manifest.migrations) if initial_state=="baseline" else 0,"migrations_already_present":len(manifest.migrations) if initial_state=="full" else 0,"short_url_remediation_verify_receipt_sha256":verified["receipt_sha256"] if initial_state=="baseline" else None,"compatibility_hook_owner_function_count":compatibility_hook_owner_function_count,"compatibility_hook_obsolete_function_count":compatibility_hook_obsolete_function_count,"compatibility_hook_public_function_count":len(compatibility_hook_public_function_signatures),"compatibility_hook_public_function_sha256":digest(compatibility_hook_public_function_signatures),"compatibility_hook_sha256":digest((COMPATIBILITY_HOOKS,VECTOR_EXTENSION_RELOCATION_HOOK_VERSION,VECTOR_EXTENSION_RELOCATION_HOOK,OBSOLETE_NOTIFICATION_OVERLOAD_HOOK_VERSION,OBSOLETE_NOTIFICATION_OVERLOAD,CANONICAL_NOTIFICATION_FUNCTION,PUBLIC_FUNCTION_OWNERS_HOOK_VERSION,PUBLIC_FUNCTION_OWNERS_SQL,CROSS_SCHEMA_OWNER_HOOK_VERSION,CROSS_SCHEMA_OWNER_FUNCTIONS)),**{k:v for k,v in observed.items() if k!="ledger_pairs"}},[prior["receipt_sha256"]])
def run_postflight(args,manifest):
 require_local(args.service); applied=_require_prior(args.clone_receipt,"clone-apply"); evidence=applied.get("evidence")
 required={"clone_state":"transformed_local_clone_not_exact_restore","hosted_mutations":0,"baseline_pairs_sha256":BASELINE_SHA256}
 if not isinstance(evidence,dict) or any(evidence.get(key)!=value for key,value in required.items()) or len(applied.get("prior_receipt_sha256",()))!=1: raise RecoveryError("clone receipt evidence mismatch")
 psql=command_exists(args.psql)
 with tempfile.TemporaryDirectory(prefix="g035-postflight-") as raw:
  service=_copy_local_service(Path(raw),Path(args.service_file),"g035-local"); env=safe_environment(service); conn=_connect("g035-local",env)
  try:
   _query_conn(conn,"BEGIN READ ONLY"); observed=_fingerprints(conn)
   runtime=repository_root(Path(__file__).resolve())/"backend/supabase/tests/g035_hosted_clone_runtime.sql"
   run([psql,"service=g035-local","--set","ON_ERROR_STOP=1","--file",str(runtime)],env=env)
  finally: conn.rollback(); conn.close()
 if not ledger_prefix(manifest,observed["ledger_pairs"]) or len(observed["ledger_pairs"])!=len(BASELINE_PAIRS)+len(manifest.migrations): raise RecoveryError("local postflight ledger mismatch")
 for key in ("ledger_sha256","ledger_count","restorable_catalog_sha256","managed_catalog_sha256"):
  if evidence.get(key)!=observed.get(key): raise RecoveryError("clone receipt evidence mismatch")
 if not _managed_metadata_schemas_equal(evidence.get("managed_metadata_schemas_present"),observed.get("managed_metadata_schemas_present")): raise RecoveryError("clone receipt evidence mismatch")
 return receipt("local-postflight","validated",{k:v for k,v in observed.items() if k!="ledger_pairs"},[applied["receipt_sha256"]])
def parser():
 p=argparse.ArgumentParser(); sub=p.add_subparsers(dest="mode",required=True); sub.add_parser("validate")
 c=sub.add_parser("capture"); c.add_argument("--destination",required=True); c.add_argument("--service-file",required=True); c.add_argument("--recipient",required=True); c.add_argument("--g034-artifact",required=True); c.add_argument("--pg-dump",default="pg_dump"); c.add_argument("--encrypt-command",required=True)
 r=sub.add_parser("restore-verify"); r.add_argument("--dump",required=True); r.add_argument("--capture-receipt",required=True); r.add_argument("--service-file",required=True); r.add_argument("--destination-service",required=True); r.add_argument("--identity-file",required=True); r.add_argument("--decrypt-command",required=True); r.add_argument("--pg-restore",default="pg_restore")
 i=sub.add_parser("short-url-remediation-inspect"); i.add_argument("--service",required=True); i.add_argument("--service-file",required=True); i.add_argument("--restore-receipt",required=True)
 a=sub.add_parser("short-url-remediation-apply"); a.add_argument("--service",required=True); a.add_argument("--service-file",required=True); a.add_argument("--restore-receipt",required=True); a.add_argument("--inspect-receipt",required=True); a.add_argument("--authorization",required=True); a.add_argument("--authorization-signature",required=True)
 v=sub.add_parser("short-url-remediation-verify"); v.add_argument("--service",required=True); v.add_argument("--service-file",required=True); v.add_argument("--apply-receipt",required=True)
 a=sub.add_parser("clone-apply"); a.add_argument("--service",required=True); a.add_argument("--service-file",required=True); a.add_argument("--restore-receipt",required=True); a.add_argument("--short-url-remediation-receipt"); a.add_argument("--psql",default="psql")
 q=sub.add_parser("local-postflight"); q.add_argument("--service",required=True); q.add_argument("--service-file",required=True); q.add_argument("--clone-receipt",required=True); q.add_argument("--psql",default="psql")
 return p
def main(argv=None):
 args=parser().parse_args(argv)
 try:
  manifest=validate_sources(repository_root(Path(__file__).resolve())); result=receipt("validate","valid",{"manifest_sha256":MANIFEST_SHA256,"baseline_pairs_sha256":BASELINE_SHA256}) if args.mode=="validate" else {"capture":run_capture,"restore-verify":run_restore_verify,"short-url-remediation-inspect":run_short_url_inspect,"short-url-remediation-apply":run_short_url_apply,"short-url-remediation-verify":run_short_url_verify,"clone-apply":apply_manifest,"local-postflight":run_postflight}[args.mode](args,manifest); emit(result); return 0
 except (ContractError,RecoveryError): emit(receipt(args.mode,"rejected",{"reason":"policy_rejected"})); return 2
if __name__=="__main__": raise SystemExit(main())
