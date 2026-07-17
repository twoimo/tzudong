#!/usr/bin/env python3
"""Fail-closed, local-only encrypted backup/restore/clone rehearsal."""
from __future__ import annotations
import argparse, csv, hashlib, json, os, re, shutil, subprocess, tempfile
from pathlib import Path
from typing import Any, Sequence
from g035_hosted_recovery_contract import APPLICATION_SCHEMAS, BASELINE_PAIRS, BASELINE_SHA256, FORBIDDEN_VERSIONS, MANAGED_METADATA_SCHEMAS, MANIFEST_SHA256, SELF_COMMIT_VERSIONS, ContractError, Manifest, ledger_prefix, repository_root, sha256_file, validate_sources
TIMEOUT_SECONDS=900; RECEIPT_SCHEMA="g035-local-recovery-receipt-v4"; HEX=re.compile(r"^[a-f0-9]{64}$"); AGE_RECIPIENT=re.compile(r"^age1[ac-hj-np-z02-9]{58}$"); ID=re.compile(r"^[A-Za-z0-9._:-]{1,128}$"); SNAPSHOT=re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"); LOCAL_SERVICE="g035-local"; LOCAL_DBNAME="g035_local"; LOCAL_HOSTS={"localhost","127.0.0.1","::1"}; SERVICE_KEYS={"host","port","dbname","application_name","sslmode","user","password","connect_timeout"}; RECOVERY_CONTROL_SCHEMAS=("supabase_migrations",); DUMP_SCHEMAS=APPLICATION_SCHEMAS+RECOVERY_CONTROL_SCHEMAS+MANAGED_METADATA_SCHEMAS; MANAGED_TABLE_DATA_EXCLUSIONS=tuple(f"--exclude-table-data={schema}.*" for schema in MANAGED_METADATA_SCHEMAS); RECOVERY_EXTENSIONS=(("pg_trgm","extensions"),("uuid-ossp","extensions"),("btree_gin","extensions"),("vector","public"),("pgcrypto","extensions")); COMPATIBILITY_HOOKS={"20260627080000":("DROP POLICY IF EXISTS documents_select_own ON public.documents;","DROP POLICY IF EXISTS documents_insert_own ON public.documents;","DROP POLICY IF EXISTS documents_update_own ON public.documents;","DROP POLICY IF EXISTS documents_delete_own ON public.documents;")}; VECTOR_EXTENSION_RELOCATION_HOOK_VERSION="20260627080000"; VECTOR_EXTENSION_RELOCATION_HOOK=("SELECT namespace.nspname FROM pg_catalog.pg_extension AS extension JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=extension.extnamespace WHERE extension.extname='vector'","ALTER EXTENSION vector SET SCHEMA extensions","SELECT namespace.nspname FROM pg_catalog.pg_extension AS extension JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=extension.extnamespace WHERE extension.extname='vector'","SELECT 1 FROM pg_catalog.pg_extension AS extension JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=extension.extnamespace WHERE extension.extname='vector' AND namespace.nspname='public'"); SHORT_URLS_DUPLICATE_TARGET_URL_HOOK_VERSION="20260713000100"; SHORT_URLS_DUPLICATE_TARGET_URL_HOOK=("SELECT 1 FROM public.short_urls WHERE code IS NULL OR target_url IS NULL LIMIT 1","SELECT 1 FROM public.short_urls GROUP BY code HAVING count(*) > 1 LIMIT 1","WITH ranked AS (SELECT id, row_number() OVER (PARTITION BY target_url ORDER BY created_at NULLS LAST, id) AS row_number FROM public.short_urls), deleted AS (DELETE FROM public.short_urls USING ranked WHERE public.short_urls.id=ranked.id AND ranked.row_number>1 RETURNING public.short_urls.id) SELECT count(*) FROM deleted","SELECT 1 FROM public.short_urls WHERE code IS NULL OR target_url IS NULL LIMIT 1","SELECT 1 FROM public.short_urls GROUP BY code HAVING count(*) > 1 LIMIT 1","SELECT 1 FROM public.short_urls GROUP BY target_url HAVING count(*) > 1 LIMIT 1"); AUTH_USER_REFERENCE_COLUMNS=(("public","ad_banners","created_by"),("public","admin_restaurant_map_overlays","created_by_admin_id"),("public","admin_restaurant_map_overlays","updated_by_admin_id"),("public","admin_user_preferences","user_id"),("public","announcements","created_by"),("public","documents","user_id"),("public","notifications","user_id"),("public","ocr_logs","user_id"),("public","profiles","user_id"),("public","restaurant_requests","user_id"),("public","restaurant_submissions","resolved_by_admin_id"),("public","restaurant_submissions","user_id"),("public","review_likes","user_id"),("public","reviews","edited_by_admin_id"),("public","reviews","user_id"),("public","search_logs","user_id"),("public","user_account_status","user_id"),("public","user_bookmarks","user_id"),("public","user_roles","user_id"),("public","user_stats","user_id"))
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
def _require_fingerprint(value):
 if not isinstance(value,str) or not HEX.fullmatch(value): raise RecoveryError("capture evidence mismatch")
 return value
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
 if host not in LOCAL_HOSTS and not host.startswith("/"): raise RecoveryError("invalid local destination")
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
 if not AGE_RECIPIENT.fullmatch(args.recipient): raise RecoveryError("invalid encryption recipient")
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
 if capture["evidence"].get("extension_scope")!=[{"name":name,"schema":schema} for name,schema in RECOVERY_EXTENSIONS] or capture["evidence"].get("managed_metadata_schema_scope")!=list(MANAGED_METADATA_SCHEMAS) or capture["evidence"].get("managed_table_data_exclusions")!=list(MANAGED_TABLE_DATA_EXCLUSIONS): raise RecoveryError("capture managed metadata scope mismatch")
 if dump.is_symlink() or not dump.is_file() or sha256_file(dump)!=capture["evidence"].get("dump_sha256"): raise RecoveryError("ciphertext input mismatch")
 _require_restrictive_regular_file(identity,"identity file")
 decryptor,restore=command_exists(args.decrypt_command),command_exists(args.pg_restore)
 with tempfile.TemporaryDirectory(prefix="g035-restore-") as raw:
  service=_copy_local_service(Path(raw),Path(args.service_file),"g035-local"); env=safe_environment(service); plain=Path(raw)/"database.pgdump"; run([decryptor,"--decrypt","--identity",str(identity),"--output",str(plain),str(dump)],env=safe_environment(service,crypto=True))
  conn=_connect("g035-local",env)
  try:
   for schema in ("public","auth","storage"): _query_conn(conn,f"DROP SCHEMA {schema} CASCADE")
  finally: conn.rollback(); conn.close()
  run([restore,"--section=pre-data","--dbname=service=g035-local",str(plain)],env=env)
  run([restore,"--section=data","--dbname=service=g035-local",str(plain)],env=env)
  conn=_connect("g035-local",env)
  try: _create_auth_user_placeholders(conn)
  finally: conn.rollback(); conn.close()
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
def _ledger_assert(conn,manifest,count):
 actual=_fingerprints(conn)["ledger_pairs"]
 if any(v in FORBIDDEN_VERSIONS for v,_ in actual) or not ledger_prefix(manifest,actual) or len(actual)!=len(BASELINE_PAIRS)+count: raise RecoveryError("ledger prefix mismatch")
def _require_restore_baseline(prior):
 evidence=prior.get("evidence")
 if not isinstance(evidence,dict) or evidence.get("ledger_sha256")!=BASELINE_SHA256 or evidence.get("ledger_count")!=len(BASELINE_PAIRS) or not _ledger_evidence_equal(evidence.get("ledger_pairs"),BASELINE_PAIRS): raise RecoveryError("restore receipt ledger mismatch")
def _compatibility_hook(version):
 return COMPATIBILITY_HOOKS.get(version,())
def _apply_vector_extension_relocation_hook(conn,version):
 if version!=VECTOR_EXTENSION_RELOCATION_HOOK_VERSION: return
 if _query_conn(conn,VECTOR_EXTENSION_RELOCATION_HOOK[0])!=[("public",)]: raise RecoveryError("vector compatibility precondition failed")
 _query_conn(conn,VECTOR_EXTENSION_RELOCATION_HOOK[1])
 if _query_conn(conn,VECTOR_EXTENSION_RELOCATION_HOOK[2])!=[("extensions",)] or _query_conn(conn,VECTOR_EXTENSION_RELOCATION_HOOK[3]): raise RecoveryError("vector compatibility postcondition failed")
 conn.commit()
def _apply_short_urls_duplicate_target_url_hook(conn,version):
 if version!=SHORT_URLS_DUPLICATE_TARGET_URL_HOOK_VERSION: return 0
 if _query_conn(conn,SHORT_URLS_DUPLICATE_TARGET_URL_HOOK[0]) or _query_conn(conn,SHORT_URLS_DUPLICATE_TARGET_URL_HOOK[1]): raise RecoveryError("short_urls compatibility precondition failed")
 rows=_query_conn(conn,SHORT_URLS_DUPLICATE_TARGET_URL_HOOK[2])
 if len(rows)!=1 or not isinstance(rows[0][0],int) or rows[0][0]<0: raise RecoveryError("short_urls compatibility delete result invalid")
 if _query_conn(conn,SHORT_URLS_DUPLICATE_TARGET_URL_HOOK[3]) or _query_conn(conn,SHORT_URLS_DUPLICATE_TARGET_URL_HOOK[4]) or _query_conn(conn,SHORT_URLS_DUPLICATE_TARGET_URL_HOOK[5]): raise RecoveryError("short_urls compatibility postcondition failed")
 conn.commit()
 return rows[0][0]
def apply_manifest(args,manifest):
 require_local(args.service); prior=_require_prior(args.restore_receipt,"restore-verify"); psql=command_exists(args.psql)
 with tempfile.TemporaryDirectory(prefix="g035-clone-") as raw:
  service=_copy_local_service(Path(raw),Path(args.service_file),"g035-local"); env=safe_environment(service); conn=_connect("g035-local",env); self_commit_attempted=False; compatibility_hook_statements=[]; compatibility_hook_deleted_row_count=0
  try:
   _query_conn(conn,"SELECT pg_advisory_lock(35035)")
   _require_restore_baseline(prior)
   _ledger_assert(conn,manifest,0)
   for index,entry in enumerate(manifest.migrations):
    _ledger_assert(conn,manifest,index); source=repository_root(Path(__file__).resolve())/entry.path
    if sha256_file(source)!=entry.sha256: raise RecoveryError("migration source hash mismatch")
    hook=_compatibility_hook(entry.version)
    compatibility_hook_deleted_row_count+=_apply_short_urls_duplicate_target_url_hook(conn,entry.version)
    _apply_vector_extension_relocation_hook(conn,entry.version)
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
 return receipt("clone-apply","applied",{"baseline_pairs_sha256":BASELINE_SHA256,"compatibility_hook_deleted_row_count":compatibility_hook_deleted_row_count,"compatibility_hook_sha256":digest((COMPATIBILITY_HOOKS,VECTOR_EXTENSION_RELOCATION_HOOK_VERSION,VECTOR_EXTENSION_RELOCATION_HOOK,SHORT_URLS_DUPLICATE_TARGET_URL_HOOK_VERSION,SHORT_URLS_DUPLICATE_TARGET_URL_HOOK)),**{k:v for k,v in observed.items() if k!="ledger_pairs"}},[prior["receipt_sha256"]])
def run_postflight(args,manifest):
 require_local(args.service); applied=_require_prior(args.clone_receipt,"clone-apply")
 with tempfile.TemporaryDirectory(prefix="g035-postflight-") as raw:
  service=_copy_local_service(Path(raw),Path(args.service_file),"g035-local"); conn=_connect("g035-local",safe_environment(service))
  try:
   _query_conn(conn,"BEGIN READ ONLY"); observed=_fingerprints(conn)
  finally: conn.rollback(); conn.close()
 if not ledger_prefix(manifest,observed["ledger_pairs"]) or len(observed["ledger_pairs"])!=len(BASELINE_PAIRS)+len(manifest.migrations): raise RecoveryError("local postflight ledger mismatch")
 return receipt("local-postflight","validated",{k:v for k,v in observed.items() if k!="ledger_pairs"},[applied["receipt_sha256"]])
def parser():
 p=argparse.ArgumentParser(); sub=p.add_subparsers(dest="mode",required=True); sub.add_parser("validate")
 c=sub.add_parser("capture"); c.add_argument("--destination",required=True); c.add_argument("--service-file",required=True); c.add_argument("--recipient",required=True); c.add_argument("--g034-artifact",required=True); c.add_argument("--pg-dump",default="pg_dump"); c.add_argument("--encrypt-command",required=True)
 r=sub.add_parser("restore-verify"); r.add_argument("--dump",required=True); r.add_argument("--capture-receipt",required=True); r.add_argument("--service-file",required=True); r.add_argument("--destination-service",required=True); r.add_argument("--identity-file",required=True); r.add_argument("--decrypt-command",required=True); r.add_argument("--pg-restore",default="pg_restore")
 a=sub.add_parser("clone-apply"); a.add_argument("--service",required=True); a.add_argument("--service-file",required=True); a.add_argument("--restore-receipt",required=True); a.add_argument("--psql",default="psql")
 q=sub.add_parser("local-postflight"); q.add_argument("--service",required=True); q.add_argument("--service-file",required=True); q.add_argument("--clone-receipt",required=True)
 return p
def main(argv=None):
 args=parser().parse_args(argv)
 try:
  manifest=validate_sources(repository_root(Path(__file__).resolve())); result=receipt("validate","valid",{"manifest_sha256":MANIFEST_SHA256,"baseline_pairs_sha256":BASELINE_SHA256}) if args.mode=="validate" else {"capture":run_capture,"restore-verify":run_restore_verify,"clone-apply":apply_manifest,"local-postflight":run_postflight}[args.mode](args,manifest); emit(result); return 0
 except (ContractError,RecoveryError): emit(receipt(args.mode,"rejected",{"reason":"policy_rejected"})); return 2
if __name__=="__main__": raise SystemExit(main())
