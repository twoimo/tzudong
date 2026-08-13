#!/usr/bin/env python3
"""Fail-closed, local-only encrypted backup/restore/clone rehearsal."""
from __future__ import annotations
import sys

if __name__ == "__main__":
 try:
  _recovery_source=sys.modules["g040_recovery_source"]
  _recovery_source.assert_isolated_bootstrap()
 except Exception:
  raise SystemExit("protected recovery source verification failed") from None

import argparse, contextlib, csv, hashlib, ipaddress, json, os, re, shutil, stat, subprocess, tempfile, threading, time, uuid
from pathlib import Path
from typing import Any, Sequence
from g035_hosted_recovery_contract import APPLICATION_SCHEMAS, APPROVED_AGE_RECIPIENT_SHA256, BASELINE_PAIRS, BASELINE_SHA256, FORBIDDEN_VERSIONS, MANAGED_METADATA_SCHEMAS, MANIFEST_SHA256, REMEDIATION_AUTHORIZATION_SCHEMA, REMEDIATION_PUBLIC_KEY_PEM, REMEDIATION_PUBLIC_KEY_SHA256, SELF_COMMIT_VERSIONS, SHORT_URL_SELECTION_SPEC as CONTRACT_SHORT_URL_SELECTION_SPEC, SHORT_URLS_CATALOG as CONTRACT_SHORT_URLS_CATALOG, ContractError, Manifest, canonical_json_bytes, canonical_sha256, ledger_prefix, repository_root, sha256_file, validate_sources, verify_short_url_remediation_authorization
import preflight_g034_hosted_migration_closure as g034_preflight
TIMEOUT_SECONDS=900; CAPTURE_TIMEOUT_SECONDS=3600; RECEIPT_SCHEMA="g035-local-recovery-receipt-v4"; HEX=re.compile(r"^[a-f0-9]{64}$"); AGE_RECIPIENT=re.compile(r"^age1[ac-hj-np-z02-9]{58}$"); SNAPSHOT=re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"); HOSTED_SERVICE="g035"; LOCAL_SERVICE="g035-local"; LOCAL_DBNAME="g035_local"; LOCAL_HOSTS=frozenset({"127.0.0.1","::1"}); SERVICE_KEYS={"host","port","dbname","application_name","sslmode","sslrootcert","user","password","connect_timeout"}; RECOVERY_CONTROL_SCHEMAS=("supabase_migrations",); DUMP_SCHEMAS=APPLICATION_SCHEMAS+RECOVERY_CONTROL_SCHEMAS+MANAGED_METADATA_SCHEMAS; MANAGED_TABLE_DATA_EXCLUSIONS=tuple(f"--exclude-table-data={schema}.*" for schema in MANAGED_METADATA_SCHEMAS); RECOVERY_EXTENSIONS=(("pg_trgm","extensions"),("uuid-ossp","extensions"),("btree_gin","extensions"),("vector","public"),("pgcrypto","extensions")); COMPATIBILITY_HOOKS={"20260627080000":("DROP POLICY IF EXISTS documents_select_own ON public.documents;","DROP POLICY IF EXISTS documents_insert_own ON public.documents;","DROP POLICY IF EXISTS documents_update_own ON public.documents;","DROP POLICY IF EXISTS documents_delete_own ON public.documents;")}; VECTOR_EXTENSION_RELOCATION_HOOK_VERSION="20260627080000"; VECTOR_EXTENSION_RELOCATION_HOOK=("SELECT namespace.nspname FROM pg_catalog.pg_extension AS extension JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=extension.extnamespace WHERE extension.extname='vector'","ALTER EXTENSION vector SET SCHEMA extensions","SELECT namespace.nspname FROM pg_catalog.pg_extension AS extension JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=extension.extnamespace WHERE extension.extname='vector'","SELECT 1 FROM pg_catalog.pg_extension AS extension JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=extension.extnamespace WHERE extension.extname='vector' AND namespace.nspname='public'"); LOCAL_REMEDIATION_SCHEMA="g035_recovery_control"; SHORT_URL_SELECTION_SPEC="row_number() over (partition by target_url order by created_at nulls last, id)"; AUTH_USER_REFERENCE_COLUMNS=(("public","ad_banners","created_by"),("public","admin_restaurant_map_overlays","created_by_admin_id"),("public","admin_restaurant_map_overlays","updated_by_admin_id"),("public","admin_user_preferences","user_id"),("public","announcements","created_by"),("public","documents","user_id"),("public","notifications","user_id"),("public","ocr_logs","user_id"),("public","profiles","user_id"),("public","restaurant_requests","user_id"),("public","restaurant_submissions","resolved_by_admin_id"),("public","restaurant_submissions","user_id"),("public","review_likes","user_id"),("public","reviews","edited_by_admin_id"),("public","reviews","user_id"),("public","search_logs","user_id"),("public","user_account_status","user_id"),("public","user_bookmarks","user_id"),("public","user_roles","user_id"),("public","user_stats","user_id"))
HOSTED_CA_SHA256="700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7"; HOSTED_CA_SIZE=1367
SHORT_URLS_CATALOG=CONTRACT_SHORT_URLS_CATALOG
SHORT_URL_SELECTION_SPEC=CONTRACT_SHORT_URL_SELECTION_SPEC
CROSS_SCHEMA_OWNER_HOOK_VERSION="20260713002000"; CROSS_SCHEMA_OWNER_FUNCTIONS=("public.account_deletion_require_service_role()","public.account_deletion_is_active_admin(uuid)","public.account_deletion_write_audit(public.account_deletion_requests,text,text)","public.preview_account_deletion(uuid,uuid,timestamptz)","public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz)","public.apply_account_deletion_database_cleanup(uuid,uuid)","public.list_account_deletion_storage_objects(uuid,uuid)","public.finalize_account_deletion_storage(uuid,uuid,boolean)","public.finalize_account_deletion_auth(uuid,uuid,boolean)","public.fail_account_deletion(uuid,uuid,text)","privacy_retention.require_service_role()","privacy_retention.write_run_audit(privacy_retention.privacy_retention_runs,text,text)"); CROSS_SCHEMA_OWNER_RESOLVE_SQL="SELECT procedure.oid FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid=pg_catalog.to_regprocedure(%s)"; CROSS_SCHEMA_OWNER_VERIFY_SQL="SELECT role.rolname FROM pg_catalog.pg_proc AS procedure JOIN pg_catalog.pg_roles AS role ON role.oid=procedure.proowner WHERE procedure.oid=pg_catalog.to_regprocedure(%s)"
OBSOLETE_NOTIFICATION_OVERLOAD_HOOK_VERSION="20260713002000"; OBSOLETE_NOTIFICATION_OVERLOAD="public.create_user_notification(uuid,public.notification_type,text,text,jsonb)"; CANONICAL_NOTIFICATION_FUNCTION="public.create_user_notification(uuid,text,text,text,jsonb)"
PUBLIC_FUNCTION_OWNERS_HOOK_VERSION="20260713002000"; PUBLIC_FUNCTION_OWNERS_SQL="SELECT procedure.oid::regprocedure::text, role.rolname FROM pg_catalog.pg_proc AS procedure JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace JOIN pg_catalog.pg_roles AS role ON role.oid=procedure.proowner WHERE namespace.nspname='public' ORDER BY procedure.oid"; PUBLIC_FUNCTION_OWNERS_ALLOWED=frozenset(("supabase_admin","postgres","privacy_workflow_owner")); PUBLIC_FUNCTION_OWNERS_POSTCONDITION=PUBLIC_FUNCTION_OWNERS_ALLOWED
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
def canonical_bytes(value): return canonical_json_bytes(value)
def digest(value): return canonical_sha256(value)
def _approval_contract_descriptor(contract=None):
 contract=g034_preflight.approval_body_contract() if contract is None else contract
 if not isinstance(contract,dict) or not contract or any(not isinstance(identity,str) or not isinstance(expected,dict) for identity,expected in contract.items()): raise RecoveryError("approval contract source invalid")
 return {"approval_contract_sha256":digest(contract),"approval_contract_identities":list(contract),"approval_contract_valid":True}
def _approval_catalog_evidence(conn,contract=None):
 try:
  contract=g034_preflight.approval_body_contract() if contract is None else contract
  descriptor=_approval_contract_descriptor(contract)
  with conn.cursor() as cursor: results=g034_preflight.approval_catalog_contract(cursor,contract)
 except Exception as exc: raise RecoveryError("approval contract validation failed") from exc
 if not isinstance(results,dict) or tuple(results)!=tuple(contract) or any(value is not True for value in results.values()): raise RecoveryError("approval contract validation failed")
 return descriptor
def receipt(mode,status,evidence,prior=None):
 item={"schema":RECEIPT_SCHEMA,"mode":mode,"status":status,"manifest_sha256":MANIFEST_SHA256,"prior_receipt_sha256":prior or [],"evidence":evidence}; item["receipt_sha256"]=digest(item); return item
def emit(value): sys.stdout.buffer.write(canonical_bytes(value))
def _receipt_contract(data):
 expected={"schema","mode","status","manifest_sha256","prior_receipt_sha256","evidence","receipt_sha256"}
 modes={"capture":"captured","restore-verify":"restored","short-url-remediation-inspect":"validated","short-url-remediation-apply":"applied","short-url-remediation-verify":"validated","clone-apply":"applied","local-postflight":"validated"}
 if type(data) is not dict or set(data)!=expected or data.get("schema")!=RECEIPT_SCHEMA or data.get("mode") not in modes or data.get("status")!=modes[data["mode"]] or type(data.get("evidence")) is not dict: raise RecoveryError("receipt binding invalid")
 prior=data.get("prior_receipt_sha256")
 if type(prior) is not list or any(type(value) is not str or not HEX.fullmatch(value) for value in prior): raise RecoveryError("receipt binding invalid")
 if len(prior)!={"capture":0,"restore-verify":1,"short-url-remediation-inspect":1,"short-url-remediation-apply":2,"short-url-remediation-verify":1,"clone-apply":1,"local-postflight":1}[data["mode"]]: raise RecoveryError("receipt binding invalid")
 return data
def read_json_receipt(path):
 path=Path(path); fd=None
 try:
  _require_restrictive_regular_file(path,"receipt")
  fd=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
  if not _same_file_identity(fd,path) or not _restrictive(path): raise RecoveryError("receipt custody lost")
  chunks=[]
  while True:
   chunk=os.read(fd,1024*1024)
   if not chunk: break
   chunks.append(chunk)
  raw=b"".join(chunks)
  if not _same_file_identity(fd,path) or not _restrictive(path): raise RecoveryError("receipt custody lost")
  data=json.loads(raw.decode("utf-8"),object_pairs_hook=_pairs)
  _receipt_contract(data)
  if canonical_bytes(data)!=raw: raise RecoveryError("receipt binding invalid")
  copy=dict(data); got=copy.pop("receipt_sha256")
 except (OSError,UnicodeDecodeError,json.JSONDecodeError,RecoveryError,TypeError,ValueError) as exc: raise RecoveryError("receipt unreadable") from exc
 finally:
  if fd is not None: os.close(fd)
 if not isinstance(got,str) or not HEX.fullmatch(got) or got!=digest(copy) or data["manifest_sha256"]!=MANIFEST_SHA256: raise RecoveryError("receipt binding invalid")
 return data
def _require_prior(path,mode):
 item=read_json_receipt(Path(path))
 if item["mode"]!=mode: raise RecoveryError("prior receipt transition invalid")
 return item
def run(argv,*,env,timeout=TIMEOUT_SECONDS,stdin=subprocess.DEVNULL,pass_fds=()):
 pass_fds=tuple(pass_fds)
 if pass_fds and os.name!="posix": raise RecoveryError("descriptor passing unavailable")
 try:
  kwargs={"stdin":stdin,"stdout":subprocess.PIPE,"stderr":subprocess.PIPE,"env":env,"timeout":timeout,"check":True}
  if pass_fds: kwargs["pass_fds"]=pass_fds
  return subprocess.run(list(argv),**kwargs)
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
_WINDOWS_LOGON_SID=re.compile(r"^S-1-5-5-\d+-\d+$",re.IGNORECASE)
def _windows_current_sid():
 try:
  import ctypes
  from ctypes import wintypes
  token=wintypes.HANDLE(); kernel32=ctypes.WinDLL("kernel32",use_last_error=True); advapi32=ctypes.WinDLL("advapi32",use_last_error=True)
  kernel32.GetCurrentProcess.restype=wintypes.HANDLE; kernel32.CloseHandle.argtypes=(wintypes.HANDLE,)
  advapi32.OpenProcessToken.argtypes=(wintypes.HANDLE,wintypes.DWORD,ctypes.POINTER(wintypes.HANDLE)); advapi32.OpenProcessToken.restype=wintypes.BOOL
  advapi32.GetTokenInformation.argtypes=(wintypes.HANDLE,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(wintypes.DWORD)); advapi32.GetTokenInformation.restype=wintypes.BOOL
  advapi32.ConvertSidToStringSidW.argtypes=(ctypes.c_void_p,ctypes.POINTER(wintypes.LPWSTR)); advapi32.ConvertSidToStringSidW.restype=wintypes.BOOL
  if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(),8,ctypes.byref(token)): return None
  try:
   size=wintypes.DWORD()
   advapi32.GetTokenInformation(token,1,None,0,ctypes.byref(size))
   if not size.value: return None
   data=ctypes.create_string_buffer(size.value)
   if not advapi32.GetTokenInformation(token,1,data,size,ctypes.byref(size)): return None
   sid=ctypes.cast(data,ctypes.POINTER(ctypes.c_void_p)).contents.value; text=wintypes.LPWSTR()
   if not sid or not advapi32.ConvertSidToStringSidW(ctypes.c_void_p(sid),ctypes.byref(text)): return None
   try: return text.value.upper() if _WINDOWS_SID.fullmatch(text.value) else None
   finally: kernel32.LocalFree(text)
  finally: kernel32.CloseHandle(token)
 except (AttributeError,OSError,ValueError): return None
def _windows_logon_sids():
 return ()
def _windows_security_metadata(path):
 try:
  import ctypes
  from ctypes import wintypes
  advapi32=ctypes.WinDLL("advapi32",use_last_error=True); kernel32=ctypes.WinDLL("kernel32",use_last_error=True)
  owner=ctypes.c_void_p(); descriptor=ctypes.c_void_p(); owner_text=wintypes.LPWSTR()
  result=advapi32.GetNamedSecurityInfoW(str(path),1,5,ctypes.byref(owner),None,None,None,ctypes.byref(descriptor))
  if result or not owner.value or not descriptor.value or not advapi32.ConvertSidToStringSidW(owner,ctypes.byref(owner_text)): return None
  control=wintypes.WORD(); revision=wintypes.DWORD()
  if not advapi32.GetSecurityDescriptorControl(descriptor,ctypes.byref(control),ctypes.byref(revision)): return None
  return owner_text.value.upper(),bool(control.value&0x1000)
 except (AttributeError,OSError,ValueError): return None
 finally:
  try:
   if owner_text: kernel32.LocalFree(owner_text)
   if descriptor.value: kernel32.LocalFree(descriptor)
  except (NameError,AttributeError,OSError,TypeError,ValueError): pass
def _windows_dacl_restrictive(path, *, directory=False):
 """Inspect owner and protected DACL with typed WinAPI; never parse tool output."""
 if path.is_symlink() or (not path.is_dir() if directory else not path.is_file()): return False
 current=_windows_current_sid(); metadata=_windows_security_metadata(path)
 if not (current and metadata and metadata[1] and metadata[0] in {current,*_WINDOWS_ALLOWED_SIDS}): return False
 try:
  import ctypes
  from ctypes import wintypes
  advapi32=ctypes.WinDLL("advapi32",use_last_error=True); kernel32=ctypes.WinDLL("kernel32",use_last_error=True); descriptor=ctypes.c_void_p(); text=wintypes.LPWSTR(); size=wintypes.DWORD()
  if advapi32.GetNamedSecurityInfoW(str(path),1,4,None,None,None,None,ctypes.byref(descriptor)) or not descriptor.value: return False
  try:
   if not advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW(descriptor,1,4,ctypes.byref(text),ctypes.byref(size)) or not text.value: return False
   return text.value.upper()==_windows_protected_sddl(directory=directory).upper()
  finally:
   if text: kernel32.LocalFree(text)
   kernel32.LocalFree(descriptor)
 except (AttributeError,OSError,ValueError): return False
def _restrictive(path):
 try:
  if path.is_symlink() or not path.is_file(): return False
  if os.name=="nt": return _windows_dacl_restrictive(path)
  return not bool(path.stat().st_mode & 0o077)
 except OSError:return False
def _restrictive_directory(path):
 try:
  if path.is_symlink() or not path.is_dir(): return False
  if os.name=="nt": return _windows_dacl_restrictive(path,directory=True)
  return not bool(path.stat().st_mode & 0o077)
 except OSError:return False
def _require_restrictive_directory(path,label):
 if not _restrictive_directory(path): raise RecoveryError(f"{label} must be restrictive directory")
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
def _hosted_ca_identity(info):
 return (info.st_dev,info.st_ino,info.st_size)
def _verify_hosted_sslrootcert(value):
 path=Path(value)
 if value=="system" or not path.is_absolute(): raise RecoveryError("invalid hosted sslrootcert")
 try:
  resolved=path.resolve(strict=True); root=repository_root(Path(__file__).resolve()).resolve(strict=True)
  if resolved==root or root in resolved.parents: raise RecoveryError("hosted sslrootcert must be external")
  if not hasattr(os,"getuid") or not hasattr(os,"O_NOFOLLOW"): raise RecoveryError("hosted sslrootcert custody unsupported")
  before=os.lstat(path)
  if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode) or before.st_uid!=os.getuid() or stat.S_IMODE(before.st_mode)!=0o600 or before.st_size!=HOSTED_CA_SIZE: raise RecoveryError("invalid hosted sslrootcert custody")
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|getattr(os,"O_BINARY",0))
  try:
   opened=os.fstat(fd)
   if _hosted_ca_identity(before)!=_hosted_ca_identity(opened) or not stat.S_ISREG(opened.st_mode) or opened.st_uid!=os.getuid() or stat.S_IMODE(opened.st_mode)!=0o600: raise RecoveryError("hosted sslrootcert changed")
   hasher=hashlib.sha256(); size=0
   while True:
    chunk=os.read(fd,65536)
    if not chunk: break
    size+=len(chunk); hasher.update(chunk)
   after_fd=os.fstat(fd); after_path=os.lstat(path); after_resolved=path.resolve(strict=True)
   if after_resolved!=resolved or _hosted_ca_identity(opened)!=_hosted_ca_identity(after_fd) or _hosted_ca_identity(opened)!=_hosted_ca_identity(after_path) or not stat.S_ISREG(after_fd.st_mode) or not stat.S_ISREG(after_path.st_mode) or after_fd.st_uid!=os.getuid() or after_path.st_uid!=os.getuid() or stat.S_IMODE(after_fd.st_mode)!=0o600 or stat.S_IMODE(after_path.st_mode)!=0o600: raise RecoveryError("hosted sslrootcert changed")
   if size!=HOSTED_CA_SIZE or hasher.hexdigest()!=HOSTED_CA_SHA256: raise RecoveryError("hosted sslrootcert pin mismatch")
  finally: os.close(fd)
 except RecoveryError: raise
 except (OSError,ValueError) as exc: raise RecoveryError("invalid hosted sslrootcert") from exc
 return value
def _parse_hosted_service(source,section):
 raw,entries=_parse_service_entries(source,section)
 if section != HOSTED_SERVICE or entries.get("sslmode")!="verify-full" or "sslrootcert" not in entries: raise RecoveryError("invalid hosted source")
 _verify_hosted_sslrootcert(entries["sslrootcert"])
 return raw,entries
def _parse_local_service(source,section):
 raw,entries=_parse_service_entries(source,section)
 if section != LOCAL_SERVICE: raise RecoveryError("invalid service file")
 required={"host","port","dbname","application_name","sslmode"}
 if not required.issubset(entries) or "sslrootcert" in entries or entries["dbname"]!=LOCAL_DBNAME or LOCAL_SERVICE not in entries["application_name"] or entries["sslmode"]!="disable": raise RecoveryError("invalid local destination")
 host=entries["host"]
 try: numeric_host=ipaddress.ip_address(host)
 except ValueError as exc: raise RecoveryError("invalid local destination") from exc
 if str(numeric_host) not in LOCAL_HOSTS or not numeric_host.is_loopback: raise RecoveryError("invalid local destination")
 if not entries["port"].isdigit() or not 1<=int(entries["port"])<=65535: raise RecoveryError("invalid local destination")
 return raw
def _copy_service(tempdir,source,section):
 if source.is_symlink() or not source.is_file() or not _restrictive(source): raise RecoveryError("service file must be restrictive regular file")
 try: raw,_=_parse_hosted_service(source,section)
 except RecoveryError: raise
 except Exception as exc: raise RecoveryError("service file unreadable") from exc
 target=Path(tempdir)/"pg_service.conf"; fd=None; identity=None
 try:
  fd,identity=_owned_output(target,"service file")
  offset=0
  while offset<len(raw): offset+=os.write(fd,raw[offset:])
  os.fsync(fd)
  if not _same_file_identity(fd,target) or not _restrictive(target): raise RecoveryError("service file custody invalid")
  return target
 except Exception as exc:
  if fd is not None: _unlink_owned_output(fd,target,identity)
  if isinstance(exc,RecoveryError): raise
  raise RecoveryError("service file custody invalid") from exc
 finally:
  if fd is not None: os.close(fd)
def _copy_local_service(tempdir,source,section):
 if source.is_symlink() or not source.is_file() or not _restrictive(source): raise RecoveryError("service file must be restrictive regular file")
 raw=_parse_local_service(source,section); target=Path(tempdir)/"pg_service.conf"; fd=None; identity=None
 try:
  fd,identity=_owned_output(target,"service file")
  offset=0
  while offset<len(raw): offset+=os.write(fd,raw[offset:])
  os.fsync(fd)
  if not _same_file_identity(fd,target) or not _restrictive(target): raise RecoveryError("service file custody invalid")
  return target
 except Exception as exc:
  if fd is not None: _unlink_owned_output(fd,target,identity)
  if isinstance(exc,RecoveryError): raise
  raise RecoveryError("service file custody invalid") from exc
 finally:
  if fd is not None: os.close(fd)
def require_local(service):
 if service != LOCAL_SERVICE: raise RecoveryError("operation is limited to g035-local")
def _connect(service, env):
 try:
  import psycopg
  servicefile=env.get("PGSERVICEFILE")
  if not servicefile: raise RecoveryError("database connection unavailable")
  _,entries=(_parse_hosted_service if service==HOSTED_SERVICE else _parse_service_entries)(Path(servicefile),service)
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
def _target_fingerprint(conn):
 rows=_query_conn(conn,"SELECT (pg_catalog.pg_control_system()).system_identifier::text,(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()),current_setting('server_version_num')")
 if len(rows)!=1 or len(rows[0])!=3 or any(not isinstance(value,str) for value in rows[0]): raise RecoveryError("target fingerprint unavailable")
 return hashlib.sha256(json.dumps(list(rows[0]),separators=(",",":")).encode("ascii")).hexdigest()
def _repository_commit(root):
 try:
  value=subprocess.run(["git","-C",str(root),"rev-parse","HEAD"],check=True,capture_output=True,text=True).stdout.strip()
 except Exception as exc: raise RecoveryError("repository commit unavailable") from exc
 if not re.fullmatch(r"[0-9a-f]{40}",value): raise RecoveryError("repository commit unavailable")
 return value
def _preflight_receipt(data):
 return digest({key:data[key] for key in ("catalogFingerprint","hostedLedgerFingerprint","manifestHash","repositoryCommit","sourceFingerprint")})
def _source_fingerprint(manifest):
 return digest({"closureMigrationHashes":[entry.sha256 for entry in manifest.migrations],"trackedApprovalSourceHash":g034_preflight.TRACKED_APPROVAL_SOURCE_SHA256})
def _recovery_source_binding(root, authorized_final_commit):
 try:
  from g040_recovery_source import RecoverySourceError, verify_recovery_source
  binding=verify_recovery_source(root,authorized_final_commit,production=True)
 except Exception as exc: raise RecoveryError("recovery source verification failed") from exc
 if binding.final_commit!=authorized_final_commit or not HEX.fullmatch(binding.runtime_source_root): raise RecoveryError("recovery source verification failed")
 return {"repository_commit":binding.final_commit,"runtime_source_root":binding.runtime_source_root}
def _require_recovery_source_binding(evidence,root):
 if not isinstance(evidence,dict) or set(("repository_commit","runtime_source_root"))-set(evidence): raise RecoveryError("recovery source binding missing")
 binding=_recovery_source_binding(root,evidence["repository_commit"])
 if binding["runtime_source_root"]!=evidence["runtime_source_root"]: raise RecoveryError("recovery source binding mismatch")
 return binding
def _g034_artifact(path,manifest):
 try:
  data=json.loads(Path(path).read_text(encoding="utf8"),object_pairs_hook=_pairs)
 except (OSError,json.JSONDecodeError,RecoveryError) as exc: raise RecoveryError("g034 artifact unreadable") from exc
 required={"artifactVersion","blockers","catalogChecked","catalogFingerprint","cloneApplyRisks","cloneBackupRecoveryRequired","hostedLedgerFingerprint","manifestHash","preflightReceiptId","prerequisites","repositoryCommit","requiredLaterPromotionGate","safeToApply","sourceFingerprint","sourceValid","schemaVersion","ledgerExpectedTerminal","closureTerminalVersion"}
 allowed={"clone-required","clone-backup-recovery-required","catalog-prerequisite","ledger-terminal"}
 fatal_prefixes=("manifest","database-url","catalog-read","catalog-rollback")
 if not isinstance(data,dict) or set(data)!=required or data["artifactVersion"]!=2 or data["ledgerExpectedTerminal"]!=manifest.ledger_terminal_version or not isinstance(data["blockers"],list) or len(data["blockers"])!=len(set(data["blockers"])) or any(not isinstance(code,str) for code in data["blockers"]) or not set(data["blockers"]).issubset(allowed) or any(code.startswith(fatal_prefixes) for code in data["blockers"]) or data["manifestHash"]!=MANIFEST_SHA256 or not re.fullmatch(r"[0-9a-f]{40}",data["repositoryCommit"]) or data["sourceFingerprint"]!=_source_fingerprint(manifest) or not data["sourceValid"] or not data["catalogChecked"] or data["safeToApply"] is not False or data["preflightReceiptId"]!=_preflight_receipt(data):
  raise RecoveryError("g034 capture readiness is not satisfied")
 return data
def _g034_live_fingerprints(conn,artifact):
 try:
  data=json.loads(Path(artifact).read_text(encoding="utf8"),object_pairs_hook=_pairs)
  terminal=data["ledgerExpectedTerminal"]
  if not isinstance(terminal,str) or not re.fullmatch(r"20\d{12}",terminal): raise RecoveryError("g034 artifact unreadable")
 except (OSError,json.JSONDecodeError,RecoveryError,KeyError,TypeError) as exc: raise RecoveryError("g034 artifact unreadable") from exc
 ledger=[str(row[0]) for row in _query_conn(conn,"SELECT version FROM supabase_migrations.schema_migrations ORDER BY version")]
 prerequisites={"ledgerTerminalMatches":bool(ledger) and ledger[-1]==terminal and not any(version>terminal for version in ledger)}
 relations=(("public.restaurants","public","restaurants","publicRestaurants"),("storage.objects","storage","objects","storageObjects"))
 for lookup,namespace,name,key in relations:
  prerequisites[key]=bool(_query_conn(conn,"SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class AS class JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace WHERE class.oid = pg_catalog.to_regclass(%s) AND namespace.nspname = %s AND class.relname = %s AND class.relkind = 'r')",(lookup,namespace,name))[0][0])
 cursor=None
 try:
  cursor=conn.cursor()
  approvals=g034_preflight.approval_catalog_contract(cursor)
  prerequisites["publicApproveSubmissionItem"]=approvals["public.approve_submission_item(uuid,uuid,jsonb)"]
  prerequisites["publicApproveEditSubmissionItem"]=approvals["public.approve_edit_submission_item(uuid,uuid,jsonb)"]
  table_absent=bool(_query_conn(conn,"SELECT pg_catalog.to_regclass('public.restaurants_backup') IS NULL AND EXISTS (SELECT 1 FROM pg_catalog.pg_namespace AS namespace WHERE namespace.nspname = 'public')")[0][0])
  prerequisites["publicRestaurantsBackup"]=table_absent and not g034_preflight.catalog_retirement_dependency_exists(cursor)
 finally:
  if cursor is not None: cursor.close()
 prerequisites["noWaitingLocks"]=int(_query_conn(conn,"SELECT count(*) FROM pg_catalog.pg_locks WHERE NOT granted")[0][0])==0
 prerequisites["requiredRolesPresent"]=int(_query_conn(conn,"SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname = ANY(%s)",(["postgres","service_role","authenticated"],))[0][0])==3
 return {"ledger_sha256":digest(ledger),"catalog_sha256":digest(prerequisites)}
def _g034_adapter(path, root, manifest, observed, source_binding=None):
 data=_g034_artifact(path,manifest)
 source_binding={"repository_commit":data["repositoryCommit"],"runtime_source_root":"0"*64} if source_binding is None else source_binding
 if source_binding["repository_commit"]!=data["repositoryCommit"] or data["hostedLedgerFingerprint"]!=observed["ledger_sha256"] or data["catalogFingerprint"]!=observed["catalog_sha256"]:
  raise RecoveryError("g034 capture readiness is not satisfied")
 return {"g034_preflight_receipt_id":data["preflightReceiptId"],**source_binding,"catalog_sha256":data["catalogFingerprint"],"ledger_sha256":data["hostedLedgerFingerprint"],"source_sha256":data["sourceFingerprint"],"capture_readiness_sha256":digest({"artifact_sha256":sha256_file(Path(path)),"preflight_receipt_id":data["preflightReceiptId"],"live_catalog_sha256":observed["catalog_sha256"],"live_ledger_sha256":observed["ledger_sha256"]})}
def _owned_output(path,label):
 flags=os.O_RDWR|os.O_CREAT|os.O_EXCL|getattr(os,"O_NOFOLLOW",0)|getattr(os,"O_BINARY",0)
 fd=None; identity=None
 try:
  fd=os.open(path,flags,0o600)
  identity=os.fstat(fd)
  if os.name=="nt": _windows_restrict_temporary_file(path)
  else: os.fchmod(fd,0o600)
  identity=os.fstat(fd)
  if not stat.S_ISREG(identity.st_mode) or not _same_file_identity(fd,path) or not _restrictive(path) or (os.name!="nt" and identity.st_mode&0o777!=0o600): raise RecoveryError(f"{label} custody invalid")
  return fd,(identity.st_dev,identity.st_ino)
 except Exception as exc:
  if fd is not None:
   if identity is not None: _unlink_owned_output(fd,path,(identity.st_dev,identity.st_ino))
   try: os.close(fd)
   except OSError: pass
  if isinstance(exc,RecoveryError): raise
  raise RecoveryError(f"{label} custody invalid") from exc
def _parse_inherited_channel(value,label):
 if not isinstance(value,str) or not re.fullmatch(r"(?:[3-9]|[1-9][0-9]+)",value): raise RecoveryError(f"invalid {label}")
 try: channel=int(value,10)
 except ValueError: raise RecoveryError(f"invalid {label}") from None
 if channel>2**31-1: raise RecoveryError(f"invalid {label}")
 return channel
def _owned_identity_stream(args):
 if os.name=="posix":
  if getattr(args,"identity_handle",None) is not None or getattr(args,"identity_fd",None) is None: raise RecoveryError("identity channel invalid")
  fd=_parse_inherited_channel(args.identity_fd,"identity fd"); duplicate=None
  try:
   import fcntl
   flags=fcntl.fcntl(fd,fcntl.F_GETFL)
   if not stat.S_ISFIFO(os.fstat(fd).st_mode) or flags&os.O_ACCMODE!=os.O_RDONLY: raise RecoveryError("identity channel invalid")
   duplicate=os.dup(fd); os.set_inheritable(duplicate,False); os.close(fd); fd=-1
   stream=os.fdopen(duplicate,"rb",closefd=True); duplicate=None
   return stream
  except RecoveryError:
   if duplicate is not None:
    try: os.close(duplicate)
    except OSError: pass
   if fd>=0:
    try: os.close(fd)
    except OSError: pass
   raise
  except (OSError,ImportError) as exc:
   if duplicate is not None:
    try: os.close(duplicate)
    except OSError: pass
   if fd>=0:
    try: os.close(fd)
    except OSError: pass
   raise RecoveryError("identity channel invalid") from exc
 if os.name=="nt":
  if getattr(args,"identity_fd",None) is not None or getattr(args,"identity_handle",None) is None: raise RecoveryError("identity channel invalid")
  handle=_parse_inherited_channel(args.identity_handle,"identity handle"); duplicate=None; fd=None; original_valid=False
  try:
   import ctypes, msvcrt
   from ctypes import wintypes
   kernel32=ctypes.WinDLL("kernel32",use_last_error=True)
   kernel32.GetHandleInformation.argtypes=(wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD)); kernel32.GetHandleInformation.restype=wintypes.BOOL
   kernel32.GetFileType.argtypes=(wintypes.HANDLE,); kernel32.GetFileType.restype=wintypes.DWORD
   kernel32.PeekNamedPipe.argtypes=(wintypes.HANDLE,ctypes.c_void_p,wintypes.DWORD,ctypes.c_void_p,ctypes.POINTER(wintypes.DWORD),ctypes.c_void_p); kernel32.PeekNamedPipe.restype=wintypes.BOOL
   kernel32.GetCurrentProcess.argtypes=(); kernel32.GetCurrentProcess.restype=wintypes.HANDLE
   kernel32.DuplicateHandle.argtypes=(wintypes.HANDLE,wintypes.HANDLE,wintypes.HANDLE,ctypes.POINTER(wintypes.HANDLE),wintypes.DWORD,wintypes.BOOL,wintypes.DWORD); kernel32.DuplicateHandle.restype=wintypes.BOOL
   kernel32.CloseHandle.argtypes=(wintypes.HANDLE,); kernel32.CloseHandle.restype=wintypes.BOOL
   source=wintypes.HANDLE(handle); flags=wintypes.DWORD(); available=wintypes.DWORD()
   if not kernel32.GetHandleInformation(source,ctypes.byref(flags)): raise RecoveryError("identity channel invalid")
   original_valid=True
   if not flags.value&1: raise RecoveryError("identity channel invalid")
   if kernel32.GetFileType(source)!=3 or not kernel32.PeekNamedPipe(source,None,0,None,ctypes.byref(available),None): raise RecoveryError("identity channel invalid")
   current=kernel32.GetCurrentProcess(); duplicate=wintypes.HANDLE()
   if not kernel32.DuplicateHandle(current,source,current,ctypes.byref(duplicate),0,False,2): raise ctypes.WinError(ctypes.get_last_error())
   if not kernel32.CloseHandle(source): raise ctypes.WinError(ctypes.get_last_error())
   original_valid=False
   raw_handle=duplicate.value
   fd=msvcrt.open_osfhandle(raw_handle,os.O_RDONLY|getattr(os,"O_BINARY",0)); duplicate=None
   stream=os.fdopen(fd,"rb",closefd=True); fd=None
   return stream
  except RecoveryError:
   if fd is not None:
    try: os.close(fd)
    except OSError: pass
   elif duplicate is not None:
    try: kernel32.CloseHandle(duplicate)
    except Exception: pass
   if original_valid:
    try: kernel32.CloseHandle(wintypes.HANDLE(handle))
    except Exception: pass
   raise
  except (OSError,ImportError,ValueError) as exc:
   if fd is not None:
    try: os.close(fd)
    except OSError: pass
   elif duplicate is not None:
    try: kernel32.CloseHandle(duplicate)
    except Exception: pass
   if original_valid:
    try: kernel32.CloseHandle(wintypes.HANDLE(handle))
    except Exception: pass
   raise RecoveryError("identity channel invalid") from exc
 raise RecoveryError("identity channel unavailable")
def _path_has_link_or_junction(path):
 current=Path(path.anchor)
 for part in path.parts[1:]:
  current=current/part
  try:
   if current.is_symlink() or (hasattr(current,"is_junction") and current.is_junction()): return True
  except OSError: return True
 return False
def _restore_receipt_target(args):
 requested=Path(args.restore_receipt)
 root=repository_root(Path(__file__).resolve()).resolve(strict=True)
 if not requested.is_absolute() or requested.name in {"",".",".."} or ".." in requested.parts or requested.exists() or requested.is_symlink() or _path_has_link_or_junction(requested.parent): raise RecoveryError("restore receipt custody invalid")
 try: parent=requested.parent.resolve(strict=True)
 except OSError as exc: raise RecoveryError("restore receipt custody invalid") from exc
 target=parent/requested.name
 if target.exists() or target.is_symlink() or target.parent==root or root in target.parent.parents: raise RecoveryError("restore receipt custody invalid")
 _require_restrictive_directory(parent,"receipt parent")
 return target
def _publish_restore_receipt(args,result):
 target=_restore_receipt_target(args)
 raw=canonical_bytes(result); fd=None; temporary=None; identity=None
 try:
  fd,temporary,identity=_owned_temporary_output(target,"restore receipt")
  offset=0
  while offset<len(raw): offset+=os.write(fd,raw[offset:])
  os.fsync(fd)
  stored_digest,stored_size,_,fd=_publish_owned_output(fd,temporary,target,identity,"restore receipt")
  if stored_size!=len(raw) or stored_digest!=hashlib.sha256(raw).hexdigest() or canonical_bytes(json.loads(target.read_text(encoding="utf-8"),object_pairs_hook=_pairs))!=raw: raise RecoveryError("restore receipt persistence invalid")
 except Exception as exc:
  if fd is not None:
   _unlink_owned_output(fd,target,identity)
   if temporary is not None: _unlink_owned_output(fd,temporary,identity)
  raise RecoveryError("restore receipt persistence invalid") from exc
 finally:
  if fd is not None:
   try: os.close(fd)
   except OSError: pass
 return result
def _unlink_owned_output(fd,path,identity):
 try:
  descriptor=os.fstat(fd); entry=path.lstat()
  if stat.S_ISREG(entry.st_mode) and not stat.S_ISLNK(entry.st_mode) and (descriptor.st_dev,descriptor.st_ino)==identity==(entry.st_dev,entry.st_ino): path.unlink()
 except OSError: pass
def _owned_temporary_output(target,label):
 if target.exists() or target.is_symlink(): raise RecoveryError(f"{label} already exists")
 temporary=target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
 fd,identity=_owned_output(temporary,label)
 return fd,temporary,identity
def _descriptor_digest(fd,path,identity,label):
 if not _same_file_identity(fd,path) or not _restrictive(path): raise RecoveryError(f"{label} custody lost")
 before=os.fstat(fd)
 try:
  os.lseek(fd,0,os.SEEK_SET)
  hasher=hashlib.sha256()
  while True:
   chunk=os.read(fd,1024*1024)
   if not chunk: break
   hasher.update(chunk)
 finally:
  os.lseek(fd,0,os.SEEK_SET)
 after=os.fstat(fd)
 if before.st_size!=after.st_size or (after.st_dev,after.st_ino)!=identity or not _same_file_identity(fd,path): raise RecoveryError(f"{label} custody lost")
 return hasher.hexdigest(),after.st_size
def _windows_link_no_replace(fd,target):
 if os.name!="nt": raise RecoveryError("Windows publication unavailable")
 try:
  import ctypes, msvcrt
  kernel32=ctypes.WinDLL("kernel32",use_last_error=True)
  handle=msvcrt.get_osfhandle(fd); length=kernel32.GetFinalPathNameByHandleW(handle,None,0,0)
  if not length: raise ctypes.WinError(ctypes.get_last_error())
  source=ctypes.create_unicode_buffer(length+1)
  if not kernel32.GetFinalPathNameByHandleW(handle,source,len(source),0): raise ctypes.WinError(ctypes.get_last_error())
  if not kernel32.CreateHardLinkW(str(target),source.value,None): raise ctypes.WinError(ctypes.get_last_error())
 except OSError as exc: raise RecoveryError("Windows no-replace publication failed") from exc
def _windows_reopen_verified_output(path,identity,digest_value,size,label):
 try:
  import ctypes, msvcrt
  kernel32=ctypes.WinDLL("kernel32",use_last_error=True)
  create_file=kernel32.CreateFileW
  create_file.argtypes=(ctypes.c_wchar_p,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_void_p,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_void_p)
  create_file.restype=ctypes.c_void_p
  handle=create_file(str(path),0x80000000,0x00000007,None,3,0x00200000,None)
  if handle in (None,ctypes.c_void_p(-1).value): raise ctypes.WinError(ctypes.get_last_error())
  fd=msvcrt.open_osfhandle(handle,os.O_RDONLY)
 except OSError as exc: raise RecoveryError(f"{label} publication invalid") from exc
 try:
  if not _same_file_identity(fd,path) or os.fstat(fd).st_size!=size or not _restrictive(path): raise RecoveryError(f"{label} publication invalid")
  observed,observed_size=_descriptor_digest(fd,path,identity,label)
  if observed!=digest_value or observed_size!=size: raise RecoveryError(f"{label} publication invalid")
  return fd
 except Exception:
  os.close(fd); raise
def _windows_open_delete_handle(path):
 try:
  import ctypes, msvcrt
  kernel32=ctypes.WinDLL("kernel32",use_last_error=True); create_file=kernel32.CreateFileW
  create_file.argtypes=(ctypes.c_wchar_p,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_void_p,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_void_p)
  create_file.restype=ctypes.c_void_p
  handle=create_file(str(path),0x80010080,0x00000007,None,3,0x00200000,None)
  if handle in (None,ctypes.c_void_p(-1).value): raise ctypes.WinError(ctypes.get_last_error())
  try: return msvcrt.open_osfhandle(handle,os.O_RDONLY)
  except OSError:
   kernel32.CloseHandle(ctypes.c_void_p(handle)); raise
 except OSError: return None
def _windows_handle_is_regular_nonreparse(fd):
 try:
  import ctypes, msvcrt
  class AttributeTag(ctypes.Structure): _fields_=(("attributes",ctypes.c_ulong),("tag",ctypes.c_ulong))
  kernel32=ctypes.WinDLL("kernel32",use_last_error=True); information=kernel32.GetFileInformationByHandleEx
  information.argtypes=(ctypes.c_void_p,ctypes.c_int,ctypes.c_void_p,ctypes.c_ulong); information.restype=ctypes.c_int
  attributes=AttributeTag()
  if not information(msvcrt.get_osfhandle(fd),9,ctypes.byref(attributes),ctypes.sizeof(attributes)): return False
  return stat.S_ISREG(os.fstat(fd).st_mode) and not bool(attributes.attributes&0x00000400)
 except OSError: return False
def _windows_mark_handle_delete_pending(fd):
 try:
  import ctypes, msvcrt
  class DispositionInfoEx(ctypes.Structure): _fields_=(("flags",ctypes.c_ulong),)
  class DispositionInfo(ctypes.Structure): _fields_=(("delete_file",ctypes.c_byte),)
  kernel32=ctypes.WinDLL("kernel32",use_last_error=True); disposition=kernel32.SetFileInformationByHandle
  disposition.argtypes=(ctypes.c_void_p,ctypes.c_int,ctypes.c_void_p,ctypes.c_ulong); disposition.restype=ctypes.c_int
  handle=msvcrt.get_osfhandle(fd); extended=DispositionInfoEx(0x00000013)
  if disposition(handle,21,ctypes.byref(extended),ctypes.sizeof(extended)): return True
  if ctypes.get_last_error() not in {1,50,87,120}: return False
  legacy=DispositionInfo(1)
  return bool(disposition(handle,4,ctypes.byref(legacy),ctypes.sizeof(legacy)))
 except OSError: return False
def _windows_remove_exact(path,identity):
 fd=_windows_open_delete_handle(path)
 if fd is None: return False
 try:
  descriptor=os.fstat(fd)
  if not _windows_handle_is_regular_nonreparse(fd) or (descriptor.st_dev,descriptor.st_ino)!=identity or not _same_file_identity(fd,path) or not _restrictive(path): return False
  return _windows_mark_handle_delete_pending(fd)
 except OSError: return False
 finally:
  try: os.close(fd)
  except OSError: pass
def _publish_owned_output(fd,temporary,target,identity,label):
 digest_value,size=_descriptor_digest(fd,temporary,identity,label)
 published=False
 if os.name=="nt":
  source_closed=False; final_fd=None
  try:
   _windows_link_no_replace(fd,target); published=True
   if not _same_file_identity(fd,target) or os.fstat(fd).st_size!=size or not _restrictive(target): raise RecoveryError(f"{label} publication invalid")
   os.close(fd); source_closed=True
   final_fd=_windows_reopen_verified_output(target,identity,digest_value,size,label)
   if not _windows_remove_exact(temporary,identity): raise RecoveryError(f"{label} temporary cleanup failed")
   return digest_value,size,identity,final_fd
  except Exception as exc:
   if final_fd is not None:
    try: os.close(final_fd)
    except OSError: pass
   if not source_closed:
    try: os.close(fd)
    except OSError: pass
   if published: _windows_remove_exact(target,identity)
   _windows_remove_exact(temporary,identity)
   if isinstance(exc,RecoveryError): raise
   raise RecoveryError(f"{label} publication failed") from exc
 try:
  os.link(temporary,target,follow_symlinks=False)
  published=True
  final=os.stat(target)
  if (final.st_dev,final.st_ino)!=identity or not _same_file_identity(fd,target) or final.st_size!=size or not _restrictive(target): raise RecoveryError(f"{label} publication invalid")
  final_digest,final_size=_descriptor_digest(fd,target,identity,label)
  if final_digest!=digest_value or final_size!=size: raise RecoveryError(f"{label} publication invalid")
  _fsync_parent(target)
  _unlink_owned_output(fd,temporary,identity)
  if temporary.exists() or temporary.is_symlink(): raise RecoveryError(f"{label} temporary cleanup failed")
  _fsync_parent(target)
 except Exception as exc:
  if published: _unlink_owned_output(fd,target,identity)
  _unlink_owned_output(fd,temporary,identity)
  if isinstance(exc,RecoveryError): raise
  raise RecoveryError(f"{label} publication failed") from exc
 return digest_value,size,identity,fd
def _fsync_parent(path):
 if os.name=="nt": return
 try:
  flags=os.O_RDONLY|getattr(os,"O_DIRECTORY",0)
  fd=os.open(path.parent,flags)
  try: os.fsync(fd)
  finally: os.close(fd)
 except OSError as exc: raise RecoveryError("artifact parent durability failed") from exc
def _bounded_diagnostic(value):
 if not isinstance(value,(bytes,bytearray)): return ""
 return bytes(value[:4096]).decode("utf-8","replace").replace("\x00"," ").replace("\r"," ").replace("\n"," ")[:4096]
def _reap_processes(processes):
 for process in processes:
  try:
   if process.poll() is None: process.terminate()
  except (AttributeError,OSError): pass
 for process in processes:
  try: process.wait(timeout=5)
  except TypeError: process.wait()
  except (AttributeError,subprocess.TimeoutExpired):
   try: process.kill()
   except (AttributeError,OSError): pass
 for process in processes:
  try: process.wait(timeout=5)
  except TypeError: process.wait()
  except (AttributeError,OSError,subprocess.TimeoutExpired): pass
def _drain_pipeline(processes,deadline):
 results=[None]*len(processes); failures=[]
 def drain(index,process):
  try:
   stream=getattr(process,"stderr",None)
   if stream is None:
    results[index]=process.communicate() if hasattr(process,"communicate") else (b"",b"") if process.wait()==0 else (b"",b"")
    return
   captured=bytearray()
   while True:
    chunk=stream.read(8192)
    if not chunk: break
    captured.extend(chunk[:max(0,4096-len(captured))])
   process.wait()
   results[index]=(b"",bytes(captured))
  except Exception as exc: failures.append(exc)
 threads=[threading.Thread(target=drain,args=(index,process),daemon=True) for index,process in enumerate(processes)]
 for thread in threads: thread.start()
 for thread in threads: thread.join(max(0,deadline-time.monotonic()))
 if any(thread.is_alive() for thread in threads):
  _reap_processes(processes)
  for thread in threads: thread.join(5)
  raise RecoveryError("database capture failed")
 if failures: raise RecoveryError("database capture failed") from failures[0]
 diagnostics=tuple(_bounded_diagnostic(result[1] if result else b"") for result in results)
 if any(getattr(process,"returncode",0) not in (0,None) for process in processes): raise RecoveryError("database capture failed")
 return diagnostics
def _dump_to_encrypted(pg_dump,encryptor,recipient,snapshot,env,destination):
 if not isinstance(snapshot,str) or not SNAPSHOT.fullmatch(snapshot): raise RecoveryError("invalid snapshot")
 output=destination/"g035-dump.enc"; argv=[pg_dump,"--format=custom","--snapshot="+snapshot,"--blobs",*["--schema="+schema for schema in DUMP_SCHEMAS],*MANAGED_TABLE_DATA_EXCLUSIONS,*["--extension="+name for name,_ in RECOVERY_EXTENSIONS],"--dbname=service=g035"]
 fd=None; temporary=None; identity=None; processes=[]
 try:
  fd,temporary,identity=_owned_temporary_output(output,"encrypted archive")
  with os.fdopen(fd,"wb",closefd=False) as sink:
   crypt=subprocess.Popen([encryptor,"--recipient",recipient],stdin=subprocess.PIPE,stdout=sink,stderr=subprocess.PIPE,env=safe_environment(Path("."),crypto=True)); processes.append(crypt)
   dump=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=crypt.stdin,stderr=subprocess.PIPE,env=env); processes.append(dump); crypt.stdin.close()
   _drain_pipeline(processes,time.monotonic()+CAPTURE_TIMEOUT_SECONDS)
   sink.flush(); os.fsync(fd)
  dump_sha256,dump_bytes,identity,fd=_publish_owned_output(fd,temporary,output,identity,"encrypted archive")
  if not _same_file_identity(fd,output): raise RecoveryError("encrypted archive custody lost")
 except Exception as exc:
  _reap_processes(processes)
  if fd is not None and temporary is not None: _unlink_owned_output(fd,temporary,identity)
  if fd is not None: _unlink_owned_output(fd,output,identity)
  raise RecoveryError("database capture failed") from exc
 finally:
  if fd is not None:
   try: os.close(fd)
   except OSError: pass
 return argv,dump_sha256,dump_bytes,identity
def _same_path_identity(path,identity):
 try:
  entry=path.lstat()
  return stat.S_ISREG(entry.st_mode) and not stat.S_ISLNK(entry.st_mode) and (entry.st_dev,entry.st_ino)==identity
 except OSError: return False
def run_capture(args,manifest):
 destination=Path(args.destination).resolve(); root=repository_root(Path(__file__).resolve())
 if not destination.is_dir() or root==destination or root in destination.parents: raise RecoveryError("destination must be an existing directory outside repository")
 if not AGE_RECIPIENT.fullmatch(args.recipient) or hashlib.sha256(args.recipient.encode("utf-8")).hexdigest()!=APPROVED_AGE_RECIPIENT_SHA256: raise RecoveryError("invalid encryption recipient")
 artifact=_g034_artifact(args.g034_artifact,manifest)
 source_binding=_recovery_source_binding(root,artifact["repositoryCommit"])
 _require_restrictive_directory(destination,"archive parent")
 if hasattr(args,"capture_receipt"):
  receipt_parent=Path(args.capture_receipt).resolve().parent
  if receipt_parent==root or root in receipt_parent.parents: raise RecoveryError("capture receipt custody invalid")
  _require_restrictive_directory(receipt_parent,"receipt parent")
 readiness=None; pg_dump=command_exists(args.pg_dump); encryptor=command_exists(args.encrypt_command)
 with tempfile.TemporaryDirectory(prefix="g035-",dir=str(destination)) as raw:
  service=_copy_service(Path(raw),Path(args.service_file),"g035"); env=safe_environment(service); conn=_connect("g035",env)
  try:
   _query_conn(conn,"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); snapshot=_query_conn(conn,"SELECT pg_export_snapshot()")[0][0]
   observed={**_fingerprints(conn),"target_fingerprint":_target_fingerprint(conn)}; readiness=_g034_adapter(args.g034_artifact,root,manifest,_g034_live_fingerprints(conn,args.g034_artifact),source_binding); argv,dump_sha256,dump_bytes,dump_identity=_dump_to_encrypted(pg_dump,encryptor,args.recipient,snapshot,env,destination)
  finally: conn.rollback(); conn.close()
 dump=destination/"g035-dump.enc"
 if not _same_path_identity(dump,dump_identity) or sha256_file(dump)!=dump_sha256 or dump.stat().st_size!=dump_bytes: raise RecoveryError("encrypted archive custody lost")
 evidence={**readiness,"recipient_fingerprint":hashlib.sha256(args.recipient.encode("utf-8")).hexdigest(),"dump_sha256":dump_sha256,"dump_bytes":dump_bytes,"dump_identity":{"device":dump_identity[0],"inode":dump_identity[1]},"schema_scope":list(APPLICATION_SCHEMAS),"recovery_control_schema_scope":list(RECOVERY_CONTROL_SCHEMAS),"extension_scope":[{"name":name,"schema":schema} for name,schema in RECOVERY_EXTENSIONS],"managed_metadata_schema_scope":list(MANAGED_METADATA_SCHEMAS),"managed_table_data_exclusions":list(MANAGED_TABLE_DATA_EXCLUSIONS),"snapshot_consumer_argv":argv,**observed}
 return receipt("capture","captured",evidence)
def _captured_archive_identity(result):
 try:
  evidence=result["evidence"]; recorded=evidence["dump_identity"]
  identity=(recorded["device"],recorded["inode"])
  if not all(isinstance(value,int) and not isinstance(value,bool) for value in identity): raise TypeError()
  return identity
 except (KeyError,TypeError):
  raise RecoveryError("capture archive evidence invalid")
def _rollback_captured_archive(args,result):
 try:
  archive=Path(getattr(args,"destination","")).resolve()/"g035-dump.enc"; identity=_captured_archive_identity(result)
  if os.name=="nt": return _windows_remove_exact(archive,identity)
  fd=os.open(archive,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
  try:
   _unlink_owned_output(fd,archive,identity)
   return not _same_path_identity(archive,identity)
  finally: os.close(fd)
 except (OSError,RecoveryError): return False
def capture_to_custody(args, manifest):
 """Capture through the current implementation and publish its exact receipt once."""
 target=Path(args.capture_receipt).resolve(); root=repository_root(Path(__file__).resolve())
 if target.exists() or target.is_symlink() or target.parent==root or root in target.parent.parents: raise RecoveryError("capture receipt custody invalid")
 _require_restrictive_directory(target.parent,"receipt parent")
 result=run_capture(args,manifest)
 raw=canonical_bytes(result)
 fd=None; temporary=None; identity=None
 try:
  fd,temporary,identity=_owned_temporary_output(target,"capture receipt")
  offset=0
  while offset<len(raw): offset+=os.write(fd,raw[offset:])
  os.fsync(fd)
  stored_digest,stored_size,_,fd=_publish_owned_output(fd,temporary,target,identity,"capture receipt")
  if stored_size!=len(raw) or stored_digest!=hashlib.sha256(raw).hexdigest() or result["receipt_sha256"]!=digest({key:value for key,value in result.items() if key!="receipt_sha256"}) or canonical_bytes(json.loads(target.read_text(encoding="utf-8"),object_pairs_hook=_pairs))!=raw:
   raise RecoveryError("capture receipt persistence invalid")
 except Exception as exc:
  if fd is not None:
   _unlink_owned_output(fd,target,identity)
   if temporary is not None: _unlink_owned_output(fd,temporary,identity)
  _rollback_captured_archive(args,result)
  raise RecoveryError("capture receipt persistence invalid") from exc
 finally:
  if fd is not None:
   try: os.close(fd)
   except OSError: pass
 return result
RESTORED_VECTOR_LAYOUT_CONTRACT = ("preserve-hosted-vector-schema-v1", "public")
LOCAL_CLONE_VECTOR_RELOCATION_VERSION = "20260713002000"
LOCAL_CLONE_VECTOR_RELOCATION_SQL = (
 "DO $$ BEGIN IF (SELECT n.nspname FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector') <> 'public' THEN RAISE EXCEPTION 'local vector compatibility precondition failed'; END IF; END $$;",
 "ALTER EXTENSION vector SET SCHEMA extensions;",
 "DO $$ BEGIN IF (SELECT n.nspname FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector') <> 'extensions' THEN RAISE EXCEPTION 'local vector compatibility postcondition failed'; END IF; END $$;",
)
PRE_DATA_SCHEMA_TOC = (
 ("public","pg_database_owner"),
 ("auth","supabase_admin"),
 ("storage","supabase_admin"),
)
REQUIRED_HOSTED_SCHEMA_TOC = (
 ("ocr_private","postgres"),
 ("provider_budget_private","postgres"),
)
TABLE_DATA_OWNER_COUNTS = (("postgres",50),("privacy_workflow_owner",61))
REQUIRED_HOSTED_TABLE_DATA_RELATIONS = frozenset((
 ("ocr_private","ocr_daily_quota_reservations"),
 ("provider_budget_private","admin_provider_budget_policies"),
 ("provider_budget_private","admin_provider_budget_counters"),
 ("provider_budget_private","admin_provider_budget_decisions"),
))
TABLE_DATA_OWNERS = frozenset(owner for owner,_ in TABLE_DATA_OWNER_COUNTS)
TABLE_DATA_TOC = re.compile(r"^(?P<dump_id>[1-9][0-9]*); (?P<table_oid>[0-9]+) (?P<object_oid>[0-9]+) TABLE DATA (?P<schema>\S+) (?P<name>\S+) (?P<owner>\S+)$")
POST_DATA_OWNER_COUNTS = (("postgres",454),("privacy_workflow_owner",474),("supabase_admin",3),("supabase_auth_admin",128),("supabase_storage_admin",45))
POST_DATA_OWNER_RUNS = (("privacy_workflow_owner",1),("supabase_auth_admin",33),("postgres",2),("privacy_workflow_owner",83),("postgres",3),("privacy_workflow_owner",7),("postgres",1),("privacy_workflow_owner",2),("postgres",24),("privacy_workflow_owner",6),("postgres",1),("privacy_workflow_owner",5),("postgres",47),("supabase_storage_admin",9),("postgres",1),("privacy_workflow_owner",1),("supabase_auth_admin",56),("postgres",2),("privacy_workflow_owner",26),("postgres",2),("privacy_workflow_owner",4),("postgres",2),("privacy_workflow_owner",2),("postgres",25),("privacy_workflow_owner",2),("postgres",19),("privacy_workflow_owner",4),("postgres",40),("privacy_workflow_owner",4),("postgres",1),("privacy_workflow_owner",4),("postgres",47),("supabase_storage_admin",8),("supabase_auth_admin",2),("privacy_workflow_owner",57),("postgres",1),("privacy_workflow_owner",2),("postgres",5),("privacy_workflow_owner",13),("postgres",21),("supabase_storage_admin",5),("supabase_auth_admin",18),("postgres",1),("privacy_workflow_owner",61),("postgres",3),("privacy_workflow_owner",3),("postgres",25),("privacy_workflow_owner",9),("postgres",1),("privacy_workflow_owner",9),("postgres",24),("supabase_storage_admin",5),("privacy_workflow_owner",2),("supabase_auth_admin",16),("postgres",2),("privacy_workflow_owner",113),("postgres",36),("privacy_workflow_owner",2),("postgres",4),("privacy_workflow_owner",1),("postgres",9),("privacy_workflow_owner",1),("postgres",1),("privacy_workflow_owner",1),("postgres",4),("privacy_workflow_owner",8),("postgres",5),("privacy_workflow_owner",2),("postgres",28),("privacy_workflow_owner",1),("postgres",2),("privacy_workflow_owner",3),("postgres",9),("privacy_workflow_owner",23),("postgres",5),("privacy_workflow_owner",1),("postgres",4),("privacy_workflow_owner",7),("postgres",1),("privacy_workflow_owner",4),("postgres",39),("supabase_storage_admin",18),("supabase_auth_admin",3),("postgres",1),("supabase_admin",1),("postgres",1),("supabase_admin",1),("postgres",1),("supabase_admin",1),("postgres",4))
POST_DATA_OWNERS = frozenset(owner for owner,_ in POST_DATA_OWNER_COUNTS)
POST_DATA_TOC = re.compile(r"^(?P<dump_id>[1-9][0-9]*); (?P<catalog_oid>[0-9]+) (?P<object_oid>[0-9]+) (?P<body>\S(?:.*\S)?) (?P<owner>\S+)$")
def _post_data_rows(raw):
 if type(raw) is not bytes: raise RecoveryError("post-data archive TOC unavailable")
 try: lines=raw.decode("utf-8").splitlines(keepends=True)
 except UnicodeDecodeError as exc: raise RecoveryError("post-data archive TOC invalid") from exc
 rows=[]; dump_ids=set()
 for index,line in enumerate(lines):
  body=line.rstrip("\r\n")
  if not body or body.startswith(";"): continue
  match=POST_DATA_TOC.fullmatch(body)
  if match is None: raise RecoveryError("post-data archive TOC malformed")
  dump_id=match.group("dump_id"); owner=match.group("owner")
  if dump_id in dump_ids: raise RecoveryError("duplicate post-data archive TOC dump id")
  if owner not in POST_DATA_OWNERS: raise RecoveryError("post-data archive TOC owner drift")
  dump_ids.add(dump_id); rows.append((index,dump_id,owner))
 return lines,tuple(rows)
def _validate_post_data_contract(rows):
 expected_counts=dict(POST_DATA_OWNER_COUNTS)
 if len(expected_counts)!=len(POST_DATA_OWNER_COUNTS) or set(expected_counts)!=POST_DATA_OWNERS or any(type(owner) is not str or type(count) is not int or count<=0 for owner,count in POST_DATA_OWNER_COUNTS): raise RecoveryError("post-data owner count contract invalid")
 if type(POST_DATA_OWNER_RUNS) is not tuple or len(POST_DATA_OWNER_RUNS)!=90 or any(type(run) is not tuple or len(run)!=2 or run[0] not in POST_DATA_OWNERS or type(run[1]) is not int or run[1]<=0 for run in POST_DATA_OWNER_RUNS): raise RecoveryError("post-data owner run contract invalid")
 counts={owner:0 for owner in POST_DATA_OWNERS}; observed_runs=[]
 for unused_index,unused_dump_id,owner in rows:
  counts[owner]+=1
  if observed_runs and observed_runs[-1][0]==owner: observed_runs[-1]=(owner,observed_runs[-1][1]+1)
  else: observed_runs.append((owner,1))
 if counts!=expected_counts: raise RecoveryError("post-data owner count drift")
 if tuple(observed_runs)!=POST_DATA_OWNER_RUNS: raise RecoveryError("post-data owner run drift")
def _validate_post_data_use_lists(raw,use_lists):
 source_lines,source_rows=_post_data_rows(raw); _validate_post_data_contract(source_rows)
 if type(use_lists) is not tuple or len(use_lists)!=len(POST_DATA_OWNER_RUNS): raise RecoveryError("post-data use-list coverage invalid")
 selected=[]; cursor=0
 for (expected_owner,expected_count),item in zip(POST_DATA_OWNER_RUNS,use_lists):
  if type(item) is not tuple or len(item)!=2 or item[0]!=expected_owner or type(item[1]) is not bytes: raise RecoveryError("post-data use-list coverage invalid")
  try: candidate_lines=item[1].decode("utf-8").splitlines(keepends=True)
  except UnicodeDecodeError as exc: raise RecoveryError("post-data use-list invalid") from exc
  if len(candidate_lines)!=len(source_lines): raise RecoveryError("post-data use-list coverage invalid")
  active_indices={index for index,unused_dump_id,unused_owner in source_rows[cursor:cursor+expected_count]}
  for index,(source,candidate) in enumerate(zip(source_lines,candidate_lines)):
   expected=source if index in active_indices or not source.rstrip("\r\n") or source.startswith(";") else ";"+source
   if candidate!=expected: raise RecoveryError("post-data use-list coverage invalid")
  candidate_rows=_post_data_rows(item[1])[1]
  if tuple(owner for unused_index,unused_dump_id,owner in candidate_rows)!=(expected_owner,)*expected_count: raise RecoveryError("post-data use-list coverage invalid")
  selected.extend(dump_id for unused_index,dump_id,unused_owner in candidate_rows); cursor+=expected_count
 if cursor!=len(source_rows) or tuple(selected)!=tuple(dump_id for unused_index,dump_id,unused_owner in source_rows) or len(selected)!=len(set(selected)): raise RecoveryError("post-data use-list coverage invalid")
def _post_data_use_lists(raw):
 lines,rows=_post_data_rows(raw); _validate_post_data_contract(rows); result=[]; cursor=0
 for owner,count in POST_DATA_OWNER_RUNS:
  active_indices={index for index,unused_dump_id,unused_owner in rows[cursor:cursor+count]}
  payload="".join(line if index in active_indices or not line.rstrip("\r\n") or line.startswith(";") else ";"+line for index,line in enumerate(lines)).encode("utf-8")
  result.append((owner,payload)); cursor+=count
 result=tuple(result); _validate_post_data_use_lists(raw,result); return result
POST_DATA_PRIVACY_TRIGGER_RUNS = ((35,57),(37,2),(39,13))
POST_DATA_PRIVACY_TRIGGER_RELATION_COUNT = 50
POST_DATA_PRIVACY_TRIGGER_RELATION_ROOT = "cbc67324f680a0e0d5bd9861e69e313dd86f2bc00d0da462fe1861c5c7de3dae"
POST_DATA_PRIVACY_TRIGGER_DESCRIPTOR = re.compile(r"^TRIGGER (?P<schema>\S+) (?P<table>\S+) (?P<trigger>\S+)$")
def _validate_post_data_privacy_trigger_contract():
 if POST_DATA_PRIVACY_TRIGGER_RUNS!=((35,57),(37,2),(39,13)) or POST_DATA_PRIVACY_TRIGGER_RELATION_COUNT!=50 or POST_DATA_PRIVACY_TRIGGER_RELATION_ROOT!="cbc67324f680a0e0d5bd9861e69e313dd86f2bc00d0da462fe1861c5c7de3dae" or POST_DATA_PRIVACY_TRIGGER_DESCRIPTOR.pattern!=r"^TRIGGER (?P<schema>\S+) (?P<table>\S+) (?P<trigger>\S+)$": raise RecoveryError("post-data privacy trigger contract invalid")
def _post_data_privacy_trigger_relations(runs):
 _validate_post_data_privacy_trigger_contract()
 if type(runs) is not tuple or len(runs)!=len(POST_DATA_OWNER_RUNS) or tuple(owner for owner,unused_payload in runs)!=tuple(owner for owner,unused_count in POST_DATA_OWNER_RUNS): raise RecoveryError("post-data privacy trigger run invalid")
 relations=[]; relation_set=set(); triggers=set()
 for run,row_count in POST_DATA_PRIVACY_TRIGGER_RUNS:
  if POST_DATA_OWNER_RUNS[run-1]!=(PRIVACY_DATA_ROLE,row_count): raise RecoveryError("post-data privacy trigger run contract invalid")
  payload=runs[run-1][1]
  unused_lines,rows=_post_data_rows(payload)
  if len(rows)!=row_count or any(owner!=PRIVACY_DATA_ROLE for unused_index,unused_dump_id,owner in rows): raise RecoveryError("post-data privacy trigger run invalid")
  decoded=payload.decode("utf-8").splitlines()
  for index,unused_dump_id,unused_owner in rows:
   toc=POST_DATA_TOC.fullmatch(decoded[index])
   descriptor=POST_DATA_PRIVACY_TRIGGER_DESCRIPTOR.fullmatch(toc.group("body")) if toc is not None else None
   if descriptor is None: raise RecoveryError("post-data privacy trigger descriptor invalid")
   relation=(descriptor.group("schema"),descriptor.group("table")); trigger=(*relation,descriptor.group("trigger"))
   if trigger in triggers: raise RecoveryError("duplicate post-data privacy trigger descriptor")
   triggers.add(trigger)
   if relation not in relation_set: relation_set.add(relation); relations.append(relation)
 result=tuple(relations)
 if len(result)!=POST_DATA_PRIVACY_TRIGGER_RELATION_COUNT or hashlib.sha256(canonical_bytes([list(relation) for relation in result])).hexdigest()!=POST_DATA_PRIVACY_TRIGGER_RELATION_ROOT: raise RecoveryError("post-data privacy trigger relation inventory drift")
 return result
def _pre_data_use_list(raw):
 if type(raw) is not bytes: raise RecoveryError("archive TOC unavailable")
 try: lines=raw.decode("utf-8").splitlines(keepends=True)
 except UnicodeDecodeError as exc: raise RecoveryError("archive TOC invalid") from exc
 schema_toc=PRE_DATA_SCHEMA_TOC+REQUIRED_HOSTED_SCHEMA_TOC
 matches={name:[] for name,_ in schema_toc}
 expected=dict(schema_toc)
 for index,line in enumerate(lines):
  body=line.rstrip("\r\n")
  if not body or body.startswith(";"): continue
  parts=body.split()
  if len(parts)>=4 and parts[3]=="SCHEMA":
   if len(parts)!=7 or not parts[0].endswith(";") or not parts[0][:-1].isdigit() or not parts[1].isdigit() or not parts[2].isdigit() or parts[4]!="-":
    raise RecoveryError("archive schema TOC drift")
   name,owner=parts[5],parts[6]
   if name in expected:
    if owner!=expected[name]: raise RecoveryError("archive schema TOC drift")
    matches[name].append(index)
 if any(len(matches[name])!=1 for name in expected): raise RecoveryError("archive schema TOC drift")
 for name,_ in PRE_DATA_SCHEMA_TOC: lines[matches[name][0]]=";"+lines[matches[name][0]]
 return "".join(lines).encode("utf-8")
def _owned_pre_data_use_list(path,raw):
 payload=_pre_data_use_list(raw); fd=None; identity=None
 try:
  fd,identity=_owned_output(path,"restore use-list")
  offset=0
  while offset<len(payload): offset+=os.write(fd,payload[offset:])
  os.fsync(fd)
  _require_temporary_file_identity(fd,path)
  return fd,identity
 except Exception:
  if fd is not None:
   _unlink_owned_output(fd,path,identity)
   os.close(fd)
  raise
def _data_use_lists(raw):
 if type(raw) is not bytes: raise RecoveryError("archive TOC unavailable")
 try: lines=raw.decode("utf-8").splitlines(keepends=True)
 except UnicodeDecodeError as exc: raise RecoveryError("archive TOC invalid") from exc
 postgres_lines=list(lines); privacy_lines=list(lines); counts={owner:0 for owner in TABLE_DATA_OWNERS}; dump_ids=set(); relations=set(); privacy_relations=[]
 for index,line in enumerate(lines):
  body=line.rstrip("\r\n")
  if not body or body.startswith(";"): continue
  match=TABLE_DATA_TOC.fullmatch(body)
  if "TABLE DATA" in body and match is None: raise RecoveryError("archive TABLE DATA TOC drift")
  if match is None:
   privacy_lines[index]=";"+line
   continue
  owner=match.group("owner")
  if owner not in TABLE_DATA_OWNERS: raise RecoveryError("archive TABLE DATA owner drift")
  schema=match.group("schema")
  if schema in MANAGED_METADATA_SCHEMAS: raise RecoveryError("managed TABLE DATA present")
  dump_id=match.group("dump_id"); relation=(schema,match.group("name"))
  if dump_id in dump_ids or relation in relations: raise RecoveryError("duplicate TABLE DATA classification")
  dump_ids.add(dump_id); relations.add(relation); counts[owner]+=1
  if relation in REQUIRED_HOSTED_TABLE_DATA_RELATIONS and owner!="postgres": raise RecoveryError("required hosted TABLE DATA owner drift")
  if owner=="privacy_workflow_owner":
   postgres_lines[index]=";"+line
   privacy_relations.append(relation)
  else:
   privacy_lines[index]=";"+line
 expected=dict(TABLE_DATA_OWNER_COUNTS)
 if counts!=expected: raise RecoveryError("archive TABLE DATA owner count drift")
 if not REQUIRED_HOSTED_TABLE_DATA_RELATIONS.issubset(relations): raise RecoveryError("required hosted TABLE DATA relation drift")
 return ("".join(postgres_lines).encode("utf-8"),"".join(privacy_lines).encode("utf-8"),tuple(privacy_relations))

def _owned_restore_use_list(path,payload):
 fd=None; identity=None
 try:
  fd,identity=_owned_output(path,"restore use-list")
  offset=0
  while offset<len(payload): offset+=os.write(fd,payload[offset:])
  os.fsync(fd)
  _require_temporary_file_identity(fd,path)
  return fd,identity
 except Exception:
  if fd is not None:
   _unlink_owned_output(fd,path,identity)
   os.close(fd)
  raise
POST_DATA_STORAGE_AUTH_SCHEMA_AUTHORITY = (82,"supabase_storage_admin","auth","supabase_admin")
def _validate_post_data_storage_auth_schema_contract():
 if type(POST_DATA_STORAGE_AUTH_SCHEMA_AUTHORITY) is not tuple or POST_DATA_STORAGE_AUTH_SCHEMA_AUTHORITY!=(82,"supabase_storage_admin","auth","supabase_admin"): raise RecoveryError("post-data storage auth schema authority contract invalid")
 run,role,unused_schema,unused_owner=POST_DATA_STORAGE_AUTH_SCHEMA_AUTHORITY
 if POST_DATA_OWNER_RUNS[run-1]!=(role,18): raise RecoveryError("post-data storage auth schema authority contract invalid")
def _restore_post_data_owner_run(restore,plain,env,index,owner,path):
 _validate_post_data_storage_auth_schema_contract()
 if type(index) is not int or index<1 or index>len(POST_DATA_OWNER_RUNS) or owner!=POST_DATA_OWNER_RUNS[index-1][0]: raise RecoveryError("post-data owner run contract invalid")
 argv=[restore,"--section=post-data",f"--use-list={path}",f"--role={owner}","--dbname=service=g035-local",str(plain)]
 if index!=POST_DATA_STORAGE_AUTH_SCHEMA_AUTHORITY[0]:
  return run(argv,env=env)
 baseline=_with_post_data_storage_auth_schema_connection(env,_open_post_data_storage_auth_schema_window)
 try: return run(argv,env=env)
 finally: _with_post_data_storage_auth_schema_connection(env,_close_post_data_storage_auth_schema_window,baseline)
def _restore_post_data_runs(restore,plain_fd,plain,env,workspace,runs):
 owned=[]
 try:
  _validate_post_data_storage_auth_schema_contract()
  if type(runs) is not tuple or tuple(owner for owner,unused_payload in runs)!=tuple(owner for owner,unused_count in POST_DATA_OWNER_RUNS): raise RecoveryError("post-data owner run contract invalid")
  for index,(owner,payload) in enumerate(runs,1):
   path=workspace/f"post-data-{index:02d}-{owner}.list"
   fd,identity=_owned_restore_use_list(path,payload)
   owned.append((owner,path,fd,identity))
  for index,(owner,path,unused_fd,unused_identity) in enumerate(owned,1):
   _require_temporary_file_identity(plain_fd,plain)
   for unused_owner,check_path,check_fd,unused_check_identity in owned: _require_temporary_file_identity(check_fd,check_path)
   _restore_post_data_owner_run(restore,plain,env,index,owner,path)
   _require_temporary_file_identity(plain_fd,plain)
   for unused_owner,check_path,check_fd,unused_check_identity in owned: _require_temporary_file_identity(check_fd,check_path)
 finally:
  for unused_owner,path,fd,identity in reversed(owned):
   _unlink_owned_output(fd,path,identity)
   os.close(fd)

POST_DATA_TRIGGER_FUNCTION_AUTHORITY = (
 ("postgres","privacy_retention.g014_account_deletion_admin_removal_fence()","privacy_workflow_owner",True),
 ("postgres","privacy_retention.g014_account_deletion_item_binding_guard()","privacy_workflow_owner",True),
 ("postgres","privacy_retention.g014_account_deletion_prevent_activated_class_mutation()","privacy_workflow_owner",True),
 ("postgres","privacy_retention.g014_account_deletion_prevent_activated_policy_mutation()","privacy_workflow_owner",True),
 ("postgres","privacy_retention.g014_account_deletion_request_binding_guard()","privacy_workflow_owner",True),
 ("postgres","privacy_retention.g014_account_deletion_seed_external_jobs()","privacy_workflow_owner",True),
 ("postgres","privacy_retention.g014_reject_audit_mutation()","privacy_workflow_owner",True),
 ("postgres","public.g014_marketing_batch_transition()","privacy_workflow_owner",True),
 ("postgres","public.g014_marketing_operation_terminal_guard()","privacy_workflow_owner",True),
 ("postgres","public.g014_marketing_public_recipient_transition()","privacy_workflow_owner",True),
 ("supabase_auth_admin","public.handle_new_user()","postgres",False),
 ("supabase_auth_admin","public.handle_new_user_avatar()","postgres",False),
 ("supabase_storage_admin","privacy_retention.g014_account_deletion_storage_write_fence()","privacy_workflow_owner",False),
)
POST_DATA_TRIGGER_SCHEMA_AUTHORITY = (("privacy_retention","supabase_storage_admin","privacy_workflow_owner"),)
POST_DATA_FUNCTION_AUTHORITY_SQL = "SELECT namespace.nspname||'.'||procedure.proname||'('||pg_catalog.pg_get_function_identity_arguments(procedure.oid)||')',owner.rolname,coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,grantor.rolname,acl.privilege_type,acl.is_grantable) ORDER BY CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,grantor.rolname,acl.privilege_type,acl.is_grantable) FROM pg_catalog.aclexplode(coalesce(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) AS acl LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid=acl.grantee JOIN pg_catalog.pg_roles AS grantor ON grantor.oid=acl.grantor),'[]'::jsonb),pg_catalog.has_function_privilege(target.oid,procedure.oid,'EXECUTE'),EXISTS (SELECT 1 FROM pg_catalog.aclexplode(procedure.proacl) AS direct_acl WHERE direct_acl.grantee=target.oid AND direct_acl.privilege_type='EXECUTE') FROM pg_catalog.pg_proc AS procedure JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace JOIN pg_catalog.pg_roles AS owner ON owner.oid=procedure.proowner JOIN pg_catalog.pg_roles AS target ON target.rolname=%s WHERE procedure.oid=pg_catalog.to_regprocedure(%s)"
POST_DATA_SCHEMA_AUTHORITY_SQL = "SELECT namespace.nspname,owner.rolname,coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,grantor.rolname,acl.privilege_type,acl.is_grantable) ORDER BY CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,grantor.rolname,acl.privilege_type,acl.is_grantable) FROM pg_catalog.aclexplode(coalesce(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))) AS acl LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid=acl.grantee JOIN pg_catalog.pg_roles AS grantor ON grantor.oid=acl.grantor),'[]'::jsonb),pg_catalog.has_schema_privilege(target.oid,namespace.oid,'USAGE'),pg_catalog.has_schema_privilege(target.oid,namespace.oid,'CREATE'),EXISTS (SELECT 1 FROM pg_catalog.aclexplode(namespace.nspacl) AS direct_acl WHERE direct_acl.grantee=target.oid AND direct_acl.privilege_type='USAGE'),EXISTS (SELECT 1 FROM pg_catalog.aclexplode(namespace.nspacl) AS direct_acl WHERE direct_acl.grantee=target.oid AND direct_acl.privilege_type='CREATE') FROM pg_catalog.pg_namespace AS namespace JOIN pg_catalog.pg_roles AS owner ON owner.oid=namespace.nspowner JOIN pg_catalog.pg_roles AS target ON target.rolname=%s WHERE namespace.nspname=%s"
def _read_post_data_storage_auth_schema_state(conn,baseline=False):
 _validate_post_data_storage_auth_schema_contract()
 unused_run,role,schema,expected_owner=POST_DATA_STORAGE_AUTH_SCHEMA_AUTHORITY
 rows=_query_conn(conn,POST_DATA_SCHEMA_AUTHORITY_SQL,(role,schema))
 if len(rows)!=1 or type(rows[0]) is not tuple or len(rows[0])!=7: raise RecoveryError("post-data storage auth schema authority state invalid")
 actual_schema,owner,raw_acl,effective_usage,effective_create,direct_usage,direct_create=rows[0]
 acl=_canonical_authority_acl(raw_acl,{"CREATE","USAGE"})
 direct_acl=any(item[0]==role and item[2]=="USAGE" for item in acl)
 if (actual_schema,owner)!=(schema,expected_owner) or any(type(value) is not bool for value in (effective_usage,effective_create,direct_usage,direct_create)) or direct_usage is not direct_acl or effective_create is not False or direct_create is not False or (baseline and (effective_usage is not False or direct_usage is not False)): raise RecoveryError("post-data storage auth schema authority state invalid")
 return (schema,role,owner,acl,effective_usage,effective_create,direct_usage,direct_create)
def _validate_post_data_storage_auth_schema_baseline(baseline):
 _validate_post_data_storage_auth_schema_contract()
 if type(baseline) is not tuple or len(baseline)!=8 or baseline[:3]!=(POST_DATA_STORAGE_AUTH_SCHEMA_AUTHORITY[2],POST_DATA_STORAGE_AUTH_SCHEMA_AUTHORITY[1],POST_DATA_STORAGE_AUTH_SCHEMA_AUTHORITY[3]) or baseline[4:]!=(False,False,False,False) or _canonical_authority_acl(list(baseline[3]),{"CREATE","USAGE"})!=baseline[3] or any(item[0]==baseline[1] and item[2] in {"CREATE","USAGE"} for item in baseline[3]): raise RecoveryError("post-data storage auth schema authority baseline invalid")
def _post_data_storage_auth_schema_window_state(baseline):
 _validate_post_data_storage_auth_schema_baseline(baseline)
 return (*baseline[:3],tuple(sorted((*baseline[3],(baseline[1],baseline[2],"USAGE",False)))),True,False,True,False)
def _verify_post_data_storage_auth_schema_state(conn,expected):
 if _read_post_data_storage_auth_schema_state(conn)!=expected: raise RecoveryError("post-data storage auth schema authority state invalid")
def _open_post_data_storage_auth_schema_window(conn):
 try:
  _query_conn(conn,"BEGIN")
  baseline=_read_post_data_storage_auth_schema_state(conn,baseline=True)
  _query_conn(conn,"SET LOCAL ROLE "+baseline[2])
  _query_conn(conn,_post_data_schema_authority_statement(baseline[0],baseline[1],True))
  _verify_post_data_storage_auth_schema_state(conn,_post_data_storage_auth_schema_window_state(baseline))
  conn.commit()
  return baseline
 except Exception:
  conn.rollback()
  raise
def _close_post_data_storage_auth_schema_window(conn,baseline):
 _validate_post_data_storage_auth_schema_baseline(baseline); expected_window=_post_data_storage_auth_schema_window_state(baseline)
 try:
  _query_conn(conn,"BEGIN")
  precondition_error=None
  try: _verify_post_data_storage_auth_schema_state(conn,expected_window)
  except Exception as exc: precondition_error=exc
  _query_conn(conn,"SET LOCAL ROLE "+baseline[2])
  _query_conn(conn,_post_data_schema_authority_statement(baseline[0],baseline[1],False))
  readback_error=None
  try: _verify_post_data_storage_auth_schema_state(conn,baseline)
  except Exception as exc: readback_error=exc
  conn.commit()
  if precondition_error is not None: raise precondition_error
  if readback_error is not None: raise readback_error
 except Exception:
  conn.rollback()
  raise
def _with_post_data_storage_auth_schema_connection(env,operation,*args):
 conn=_connect(LOCAL_SERVICE,env)
 try: return operation(conn,*args)
 finally: conn.close()
def _validate_post_data_trigger_authority_contract():
 expected=(
  ("postgres","privacy_retention.g014_account_deletion_admin_removal_fence()","privacy_workflow_owner",True),
  ("postgres","privacy_retention.g014_account_deletion_item_binding_guard()","privacy_workflow_owner",True),
  ("postgres","privacy_retention.g014_account_deletion_prevent_activated_class_mutation()","privacy_workflow_owner",True),
  ("postgres","privacy_retention.g014_account_deletion_prevent_activated_policy_mutation()","privacy_workflow_owner",True),
  ("postgres","privacy_retention.g014_account_deletion_request_binding_guard()","privacy_workflow_owner",True),
  ("postgres","privacy_retention.g014_account_deletion_seed_external_jobs()","privacy_workflow_owner",True),
  ("postgres","privacy_retention.g014_reject_audit_mutation()","privacy_workflow_owner",True),
  ("postgres","public.g014_marketing_batch_transition()","privacy_workflow_owner",True),
  ("postgres","public.g014_marketing_operation_terminal_guard()","privacy_workflow_owner",True),
  ("postgres","public.g014_marketing_public_recipient_transition()","privacy_workflow_owner",True),
  ("supabase_auth_admin","public.handle_new_user()","postgres",False),
  ("supabase_auth_admin","public.handle_new_user_avatar()","postgres",False),
  ("supabase_storage_admin","privacy_retention.g014_account_deletion_storage_write_fence()","privacy_workflow_owner",False),
 )
 if type(POST_DATA_TRIGGER_FUNCTION_AUTHORITY) is not tuple or POST_DATA_TRIGGER_FUNCTION_AUTHORITY!=expected: raise RecoveryError("post-data trigger function authority contract invalid")
 if type(POST_DATA_TRIGGER_SCHEMA_AUTHORITY) is not tuple or POST_DATA_TRIGGER_SCHEMA_AUTHORITY!=(("privacy_retention","supabase_storage_admin","privacy_workflow_owner"),): raise RecoveryError("post-data trigger schema authority contract invalid")
def _canonical_authority_acl(raw,privileges):
 if type(raw) is not list: raise RecoveryError("post-data trigger authority ACL invalid")
 result=[]
 for item in raw:
  if type(item) not in (list,tuple) or len(item)!=4 or any(type(item[index]) is not str or not item[index] for index in range(3)) or type(item[3]) is not bool or item[2] not in privileges: raise RecoveryError("post-data trigger authority ACL invalid")
  result.append(tuple(item))
 result=tuple(result)
 if result!=tuple(sorted(result)) or len(result)!=len(set(result)): raise RecoveryError("post-data trigger authority ACL invalid")
 return result
def _read_post_data_trigger_authority_baseline(conn):
 _validate_post_data_trigger_authority_contract(); functions=[]
 for role,signature,expected_owner,expected_effective in POST_DATA_TRIGGER_FUNCTION_AUTHORITY:
  rows=_query_conn(conn,POST_DATA_FUNCTION_AUTHORITY_SQL,(role,signature))
  if len(rows)!=1 or type(rows[0]) is not tuple or len(rows[0])!=5: raise RecoveryError("post-data trigger function authority state invalid")
  actual_signature,owner,raw_acl,effective_execute,direct_execute=rows[0]
  acl=_canonical_authority_acl(raw_acl,{"EXECUTE"})
  if actual_signature!=signature or owner!=expected_owner or effective_execute is not expected_effective or direct_execute is not False or any(item[0]==role and item[1]==owner and item[2]=="EXECUTE" for item in acl): raise RecoveryError("post-data trigger function authority state invalid")
  functions.append((role,signature,owner,acl,effective_execute,direct_execute))
 schemas=[]
 for schema,role,expected_owner in POST_DATA_TRIGGER_SCHEMA_AUTHORITY:
  rows=_query_conn(conn,POST_DATA_SCHEMA_AUTHORITY_SQL,(role,schema))
  if len(rows)!=1 or type(rows[0]) is not tuple or len(rows[0])!=7: raise RecoveryError("post-data trigger schema authority state invalid")
  actual_schema,owner,raw_acl,effective_usage,effective_create,direct_usage,direct_create=rows[0]
  acl=_canonical_authority_acl(raw_acl,{"CREATE","USAGE"})
  if actual_schema!=schema or owner!=expected_owner or effective_usage is not False or effective_create is not False or direct_usage is not False or direct_create is not False: raise RecoveryError("post-data trigger schema authority state invalid")
  schemas.append((schema,role,owner,acl,False,False))
 return tuple(functions),tuple(schemas)
def _post_data_trigger_window_state(baseline):
 functions,schemas=baseline
 window_functions=tuple((role,signature,owner,acl,True,False) if effective_execute else (role,signature,owner,tuple(sorted((*acl,(role,owner,"EXECUTE",False)))),True,True) for role,signature,owner,acl,effective_execute,unused_direct in functions)
 window_schemas=tuple((schema,role,owner,tuple(sorted((*acl,(role,owner,"USAGE",False)))),True,False) for schema,role,owner,acl,unused_usage,unused_create in schemas)
 return window_functions,window_schemas
def _validate_post_data_trigger_baseline(baseline):
 _validate_post_data_trigger_authority_contract()
 if type(baseline) is not tuple or len(baseline)!=2: raise RecoveryError("post-data trigger authority baseline invalid")
 functions,schemas=baseline
 if type(functions) is not tuple or len(functions)!=len(POST_DATA_TRIGGER_FUNCTION_AUTHORITY) or type(schemas) is not tuple or len(schemas)!=1: raise RecoveryError("post-data trigger authority baseline invalid")
 for expected,item in zip(POST_DATA_TRIGGER_FUNCTION_AUTHORITY,functions):
  if type(item) is not tuple or len(item)!=6 or item[:3]!=expected[:3] or item[4:]!=(expected[3],False) or _canonical_authority_acl(list(item[3]),{"EXECUTE"})!=item[3] or any(acl[0]==item[0] and acl[1]==item[2] and acl[2]=="EXECUTE" for acl in item[3]): raise RecoveryError("post-data trigger authority baseline invalid")
 for expected,item in zip(POST_DATA_TRIGGER_SCHEMA_AUTHORITY,schemas):
  if type(item) is not tuple or len(item)!=6 or item[:3]!=expected or item[4:]!=(False,False) or _canonical_authority_acl(list(item[3]),{"CREATE","USAGE"})!=item[3] or any(acl[0]==item[1] and acl[2] in {"CREATE","USAGE"} for acl in item[3]): raise RecoveryError("post-data trigger authority baseline invalid")
def _read_post_data_trigger_authority_state(conn):
 _validate_post_data_trigger_authority_contract()
 functions=[]
 for role,signature,expected_owner,unused_expected_effective in POST_DATA_TRIGGER_FUNCTION_AUTHORITY:
  rows=_query_conn(conn,POST_DATA_FUNCTION_AUTHORITY_SQL,(role,signature))
  if len(rows)!=1 or type(rows[0]) is not tuple or len(rows[0])!=5: raise RecoveryError("post-data trigger function authority state invalid")
  actual_signature,owner,raw_acl,effective_execute,direct_execute=rows[0]
  acl=_canonical_authority_acl(raw_acl,{"EXECUTE"})
  direct_acl=(role,owner,"EXECUTE",False) in acl
  if actual_signature!=signature or owner!=expected_owner or type(effective_execute) is not bool or type(direct_execute) is not bool or direct_execute is not direct_acl: raise RecoveryError("post-data trigger function authority state invalid")
  functions.append((role,signature,owner,acl,effective_execute,direct_execute))
 schemas=[]
 for schema,role,expected_owner in POST_DATA_TRIGGER_SCHEMA_AUTHORITY:
  rows=_query_conn(conn,POST_DATA_SCHEMA_AUTHORITY_SQL,(role,schema))
  if len(rows)!=1 or type(rows[0]) is not tuple or len(rows[0])!=7: raise RecoveryError("post-data trigger schema authority state invalid")
  actual_schema,owner,raw_acl,effective_usage,effective_create,direct_usage,direct_create=rows[0]
  acl=_canonical_authority_acl(raw_acl,{"CREATE","USAGE"})
  if actual_schema!=schema or owner!=expected_owner or any(type(value) is not bool for value in (effective_usage,effective_create,direct_usage,direct_create)) or effective_usage!=direct_usage or effective_create is not False or direct_create is not False: raise RecoveryError("post-data trigger schema authority state invalid")
  schemas.append((schema,role,owner,acl,effective_usage,effective_create))
 return tuple(functions),tuple(schemas)
def _verify_post_data_trigger_authority_state(conn,expected):
 if _read_post_data_trigger_authority_state(conn)!=expected: raise RecoveryError("post-data trigger authority state invalid")
def _post_data_function_authority_statement(role,signature,grant):
 return ("GRANT" if grant else "REVOKE")+" EXECUTE ON FUNCTION "+signature+(" TO " if grant else " FROM ")+role
def _post_data_schema_authority_statement(schema,role,grant):
 return ("GRANT" if grant else "REVOKE")+" USAGE ON SCHEMA "+schema+(" TO " if grant else " FROM ")+role
def _open_post_data_trigger_authority_window(conn):
 try:
  _query_conn(conn,"BEGIN")
  baseline=_read_post_data_trigger_authority_baseline(conn)
  for role,signature,owner,baseline_effective in POST_DATA_TRIGGER_FUNCTION_AUTHORITY:
   if not baseline_effective:
    _query_conn(conn,"SET LOCAL ROLE "+owner)
    _query_conn(conn,_post_data_function_authority_statement(role,signature,True))
  for schema,role,owner in POST_DATA_TRIGGER_SCHEMA_AUTHORITY:
   _query_conn(conn,"SET LOCAL ROLE "+owner)
   _query_conn(conn,_post_data_schema_authority_statement(schema,role,True))
  _verify_post_data_trigger_authority_state(conn,_post_data_trigger_window_state(baseline))
  conn.commit()
  return baseline
 except Exception:
  conn.rollback()
  raise
def _close_post_data_trigger_authority_window(conn,baseline):
 _validate_post_data_trigger_baseline(baseline); expected_window=_post_data_trigger_window_state(baseline)
 try:
  _query_conn(conn,"BEGIN")
  precondition_error=None
  try: _verify_post_data_trigger_authority_state(conn,expected_window)
  except Exception as exc: precondition_error=exc
  for role,signature,owner,baseline_effective in POST_DATA_TRIGGER_FUNCTION_AUTHORITY:
   if not baseline_effective:
    _query_conn(conn,"SET LOCAL ROLE "+owner)
    _query_conn(conn,_post_data_function_authority_statement(role,signature,False))
  for schema,role,owner in POST_DATA_TRIGGER_SCHEMA_AUTHORITY:
   _query_conn(conn,"SET LOCAL ROLE "+owner)
   _query_conn(conn,_post_data_schema_authority_statement(schema,role,False))
  readback_error=None
  try: _verify_post_data_trigger_authority_state(conn,baseline)
  except Exception as exc: readback_error=exc
  conn.commit()
  if precondition_error is not None: raise precondition_error
  if readback_error is not None: raise readback_error
 except Exception:
  conn.rollback()
  raise
def _with_post_data_trigger_authority_connection(env,operation,*args):
 conn=_connect(LOCAL_SERVICE,env)
 try: return operation(conn,*args)
 finally: conn.close()
POST_DATA_FK_TABLE_AUTHORITY = (
 ("postgres","privacy_retention","privacy_audit_events","privacy_workflow_owner"),
 ("postgres","privacy_retention","privacy_consent_events","privacy_workflow_owner"),
 ("privacy_workflow_owner","auth","users","supabase_auth_admin"),
 ("privacy_workflow_owner","privacy_retention","marketing_campaign_batch_recipients","privacy_workflow_owner"),
 ("privacy_workflow_owner","privacy_retention","privacy_audit_events","privacy_workflow_owner"),
 ("privacy_workflow_owner","privacy_retention","privacy_consent_events","privacy_workflow_owner"),
 ("privacy_workflow_owner","privacy_retention","privacy_guardian_verifications","privacy_workflow_owner"),
 ("privacy_workflow_owner","privacy_retention","privacy_onboarding_challenges","privacy_workflow_owner"),
 ("privacy_workflow_owner","public","marketing_campaign_recipients","postgres"),
)
POST_DATA_FK_SCHEMA_AUTHORITY = (("auth","privacy_workflow_owner","supabase_admin"),)
POST_DATA_FK_TABLE_AUTHORITY_SQL = "SELECT namespace.nspname,class.relname,owner.rolname,coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,grantor.rolname,acl.privilege_type,acl.is_grantable) ORDER BY CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,grantor.rolname,acl.privilege_type,acl.is_grantable) FROM pg_catalog.aclexplode(coalesce(class.relacl,pg_catalog.acldefault('r',class.relowner))) AS acl LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid=acl.grantee JOIN pg_catalog.pg_roles AS grantor ON grantor.oid=acl.grantor),'[]'::jsonb),pg_catalog.has_table_privilege(target.oid,class.oid,'REFERENCES'),EXISTS (SELECT 1 FROM pg_catalog.aclexplode(class.relacl) AS direct_acl WHERE direct_acl.grantee=target.oid AND direct_acl.privilege_type='REFERENCES') FROM pg_catalog.pg_class AS class JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=class.relnamespace JOIN pg_catalog.pg_roles AS owner ON owner.oid=class.relowner JOIN pg_catalog.pg_roles AS target ON target.rolname=%s WHERE namespace.nspname=%s AND class.relname=%s AND class.relkind IN ('r','p')"
def _validate_post_data_fk_authority_contract():
 expected=(
  ("postgres","privacy_retention","privacy_audit_events","privacy_workflow_owner"),
  ("postgres","privacy_retention","privacy_consent_events","privacy_workflow_owner"),
  ("privacy_workflow_owner","auth","users","supabase_auth_admin"),
  ("privacy_workflow_owner","privacy_retention","marketing_campaign_batch_recipients","privacy_workflow_owner"),
  ("privacy_workflow_owner","privacy_retention","privacy_audit_events","privacy_workflow_owner"),
  ("privacy_workflow_owner","privacy_retention","privacy_consent_events","privacy_workflow_owner"),
  ("privacy_workflow_owner","privacy_retention","privacy_guardian_verifications","privacy_workflow_owner"),
  ("privacy_workflow_owner","privacy_retention","privacy_onboarding_challenges","privacy_workflow_owner"),
  ("privacy_workflow_owner","public","marketing_campaign_recipients","postgres"),
 )
 if type(POST_DATA_FK_TABLE_AUTHORITY) is not tuple or POST_DATA_FK_TABLE_AUTHORITY!=expected or type(POST_DATA_FK_SCHEMA_AUTHORITY) is not tuple or POST_DATA_FK_SCHEMA_AUTHORITY!=(("auth","privacy_workflow_owner","supabase_admin"),): raise RecoveryError("post-data FK authority contract invalid")
def _read_post_data_fk_authority_state(conn,baseline=False):
 _validate_post_data_fk_authority_contract(); tables=[]
 for role,schema,table,expected_owner in POST_DATA_FK_TABLE_AUTHORITY:
  rows=_query_conn(conn,POST_DATA_FK_TABLE_AUTHORITY_SQL,(role,schema,table))
  if len(rows)!=1 or type(rows[0]) is not tuple or len(rows[0])!=6: raise RecoveryError("post-data FK table authority state invalid")
  actual_schema,actual_table,owner,raw_acl,effective,direct=rows[0]
  acl=_canonical_authority_acl(raw_acl,PRIVACY_TABLE_PRIVILEGES)
  direct_acl=(role,owner,"REFERENCES",False) in acl
  if (actual_schema,actual_table,owner)!=(schema,table,expected_owner) or type(effective) is not bool or type(direct) is not bool or direct is not direct_acl or (baseline and (effective is not False or direct is not False)): raise RecoveryError("post-data FK table authority state invalid")
  tables.append((role,schema,table,owner,acl,effective,direct))
 schemas=[]
 for schema,role,expected_owner in POST_DATA_FK_SCHEMA_AUTHORITY:
  rows=_query_conn(conn,POST_DATA_SCHEMA_AUTHORITY_SQL,(role,schema))
  if len(rows)!=1 or type(rows[0]) is not tuple or len(rows[0])!=7: raise RecoveryError("post-data FK schema authority state invalid")
  actual_schema,owner,raw_acl,effective_usage,effective_create,direct_usage,direct_create=rows[0]
  acl=_canonical_authority_acl(raw_acl,{"CREATE","USAGE"})
  direct_acl=(role,owner,"USAGE",False) in acl
  if (actual_schema,owner)!=(schema,expected_owner) or any(type(value) is not bool for value in (effective_usage,effective_create,direct_usage,direct_create)) or direct_usage is not direct_acl or effective_create is not False or direct_create is not False or (baseline and (effective_usage is not False or direct_usage is not False)): raise RecoveryError("post-data FK schema authority state invalid")
  schemas.append((schema,role,owner,acl,effective_usage,effective_create,direct_usage,direct_create))
 return tuple(tables),tuple(schemas)
def _validate_post_data_fk_baseline(baseline):
 _validate_post_data_fk_authority_contract()
 if type(baseline) is not tuple or len(baseline)!=2: raise RecoveryError("post-data FK authority baseline invalid")
 tables,schemas=baseline
 if type(tables) is not tuple or len(tables)!=9 or type(schemas) is not tuple or len(schemas)!=1: raise RecoveryError("post-data FK authority baseline invalid")
 objects={}
 for expected,item in zip(POST_DATA_FK_TABLE_AUTHORITY,tables):
  if type(item) is not tuple or len(item)!=7 or item[:4]!=expected or item[5:]!=(False,False) or _canonical_authority_acl(list(item[4]),PRIVACY_TABLE_PRIVILEGES)!=item[4] or any(acl[0]==item[0] and acl[2]=="REFERENCES" for acl in item[4]): raise RecoveryError("post-data FK authority baseline invalid")
  relation=item[1:3]; object_state=item[3:]
  if relation in objects and objects[relation]!=object_state: raise RecoveryError("post-data FK authority baseline invalid")
  objects[relation]=object_state
 for expected,item in zip(POST_DATA_FK_SCHEMA_AUTHORITY,schemas):
  if type(item) is not tuple or len(item)!=8 or item[:3]!=expected or item[4:]!=(False,False,False,False) or _canonical_authority_acl(list(item[3]),{"CREATE","USAGE"})!=item[3] or any(acl[0]==item[1] and acl[2] in {"CREATE","USAGE"} for acl in item[3]): raise RecoveryError("post-data FK authority baseline invalid")
def _post_data_fk_window_state(baseline):
 _validate_post_data_fk_baseline(baseline); tables,schemas=baseline
 grants={}
 for role,schema,table,owner in POST_DATA_FK_TABLE_AUTHORITY:
  grants.setdefault((schema,table,owner),[]).append((role,owner,"REFERENCES",False))
 window_acl={}
 for item in tables:
  key=item[1:4]
  if key not in window_acl: window_acl[key]=tuple(sorted((*item[4],*grants[key])))
 return (
  tuple((*item[:4],window_acl[item[1:4]],True,True) for item in tables),
  tuple((*item[:3],tuple(sorted((*item[3],(item[1],item[2],"USAGE",False)))),True,False,True,False) for item in schemas),
 )
def _verify_post_data_fk_authority_state(conn,expected):
 if _read_post_data_fk_authority_state(conn)!=expected: raise RecoveryError("post-data FK authority state invalid")
def _post_data_fk_table_statement(role,schema,table,grant):
 return ("GRANT" if grant else "REVOKE")+" REFERENCES ON TABLE "+_quoted_identifier(schema)+"."+_quoted_identifier(table)+(" TO " if grant else " FROM ")+role
def _open_post_data_fk_authority_window(conn):
 try:
  _query_conn(conn,"BEGIN")
  baseline=_read_post_data_fk_authority_state(conn,baseline=True)
  for role,schema,table,owner in POST_DATA_FK_TABLE_AUTHORITY:
   _query_conn(conn,"SET LOCAL ROLE "+owner)
   _query_conn(conn,_post_data_fk_table_statement(role,schema,table,True))
  for schema,role,owner in POST_DATA_FK_SCHEMA_AUTHORITY:
   _query_conn(conn,"SET LOCAL ROLE "+owner)
   _query_conn(conn,_post_data_schema_authority_statement(schema,role,True))
  _verify_post_data_fk_authority_state(conn,_post_data_fk_window_state(baseline))
  conn.commit()
  return baseline
 except Exception:
  conn.rollback()
  raise
def _close_post_data_fk_authority_window(conn,baseline):
 _validate_post_data_fk_baseline(baseline); expected_window=_post_data_fk_window_state(baseline)
 try:
  _query_conn(conn,"BEGIN")
  precondition_error=None
  try: _verify_post_data_fk_authority_state(conn,expected_window)
  except Exception as exc: precondition_error=exc
  for role,schema,table,owner in POST_DATA_FK_TABLE_AUTHORITY:
   _query_conn(conn,"SET LOCAL ROLE "+owner)
   _query_conn(conn,_post_data_fk_table_statement(role,schema,table,False))
  for schema,role,owner in POST_DATA_FK_SCHEMA_AUTHORITY:
   _query_conn(conn,"SET LOCAL ROLE "+owner)
   _query_conn(conn,_post_data_schema_authority_statement(schema,role,False))
  readback_error=None
  try: _verify_post_data_fk_authority_state(conn,baseline)
  except Exception as exc: readback_error=exc
  conn.commit()
  if precondition_error is not None: raise precondition_error
  if readback_error is not None: raise readback_error
 except Exception:
  conn.rollback()
  raise
def _with_post_data_fk_authority_connection(env,operation,*args):
 conn=_connect(LOCAL_SERVICE,env)
 try: return operation(conn,*args)
 finally: conn.close()
POST_DATA_TABLE_TRIGGER_STATE_SQL = "SELECT namespace.nspname,class.relname,owner.rolname,class.relrowsecurity,class.relforcerowsecurity,coalesce((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,grantor.rolname,acl.privilege_type,acl.is_grantable) ORDER BY CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE grantee.rolname END,grantor.rolname,acl.privilege_type,acl.is_grantable) FROM pg_catalog.aclexplode(class.relacl) AS acl LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid=acl.grantee JOIN pg_catalog.pg_roles AS grantor ON grantor.oid=acl.grantor),'[]'::jsonb),pg_catalog.has_table_privilege(target.oid,class.oid,'TRIGGER') FROM pg_catalog.pg_class AS class JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=class.relnamespace JOIN pg_catalog.pg_roles AS owner ON owner.oid=class.relowner JOIN pg_catalog.pg_roles AS target ON target.rolname=%s WHERE namespace.nspname=%s AND class.relname=%s AND class.relkind IN ('r','p')"
def _read_post_data_table_trigger_state(conn,relations,baseline=False):
 if type(relations) is not tuple or len(relations)!=POST_DATA_PRIVACY_TRIGGER_RELATION_COUNT or len(relations)!=len(set(relations)): raise RecoveryError("post-data table trigger relation inventory invalid")
 result=[]
 for schema,table in relations:
  rows=_query_conn(conn,POST_DATA_TABLE_TRIGGER_STATE_SQL,(PRIVACY_DATA_ROLE,schema,table))
  if len(rows)!=1 or type(rows[0]) is not tuple or len(rows[0])!=7: raise RecoveryError("post-data table trigger state invalid")
  actual_schema,actual_table,owner,rls,force,raw_acl,effective_trigger=rows[0]
  acl=_canonical_authority_acl(raw_acl,PRIVACY_TABLE_PRIVILEGES)
  if (actual_schema,actual_table)!=(schema,table) or owner!=PRIVACY_DATA_ROLE or type(rls) is not bool or type(force) is not bool or type(effective_trigger) is not bool: raise RecoveryError("post-data table trigger state invalid")
  direct_trigger=any(item[0]==PRIVACY_DATA_ROLE and item[2]=="TRIGGER" for item in acl)
  if baseline and (not effective_trigger and direct_trigger): raise RecoveryError("post-data table trigger state invalid")
  result.append((schema,table,owner,rls,force,acl,effective_trigger))
 return tuple(result)
def _validate_post_data_table_trigger_baseline(relations,baseline):
 if type(relations) is not tuple or len(relations)!=POST_DATA_PRIVACY_TRIGGER_RELATION_COUNT or len(relations)!=len(set(relations)): raise RecoveryError("post-data table trigger relation inventory invalid")
 if type(baseline) is not tuple or len(baseline)!=len(relations): raise RecoveryError("post-data table trigger baseline invalid")
 for relation,item in zip(relations,baseline):
  if type(item) is not tuple or len(item)!=7 or item[:2]!=relation or item[2]!=PRIVACY_DATA_ROLE or type(item[3]) is not bool or type(item[4]) is not bool or type(item[6]) is not bool or _canonical_authority_acl(list(item[5]),PRIVACY_TABLE_PRIVILEGES)!=item[5]: raise RecoveryError("post-data table trigger baseline invalid")
  if not item[6] and any(acl[0]==PRIVACY_DATA_ROLE and acl[2]=="TRIGGER" for acl in item[5]): raise RecoveryError("post-data table trigger baseline invalid")
def _post_data_table_trigger_window_state(baseline):
 return tuple(item if item[6] else (*item[:5],tuple(sorted((*item[5],(PRIVACY_DATA_ROLE,PRIVACY_DATA_ROLE,"TRIGGER",False)))),True) for item in baseline)
def _verify_post_data_table_trigger_state(conn,relations,expected):
 if _read_post_data_table_trigger_state(conn,relations)!=expected: raise RecoveryError("post-data table trigger state invalid")
def _validate_live_post_data_table_trigger_window(relations,live,added_relations):
 if type(live) is not tuple or len(live)!=len(relations): raise RecoveryError("post-data table trigger state invalid")
 added=frozenset(added_relations); temporary=(PRIVACY_DATA_ROLE,PRIVACY_DATA_ROLE,"TRIGGER",False)
 for relation,item in zip(relations,live):
  if item[:2]!=relation: raise RecoveryError("post-data table trigger state invalid")
  if relation in added and (temporary not in item[5] or item[6] is not True): raise RecoveryError("post-data table trigger state invalid")
def _verify_post_data_table_trigger_cleanup(conn,relations,live,added_relations):
 readback=_read_post_data_table_trigger_state(conn,relations)
 added=frozenset(added_relations); temporary=(PRIVACY_DATA_ROLE,PRIVACY_DATA_ROLE,"TRIGGER",False)
 for before,after in zip(live,readback):
  relation=before[:2]
  expected_acl=tuple(acl for acl in before[5] if relation not in added or acl!=temporary)
  if after[:5]!=before[:5] or after[5]!=expected_acl: raise RecoveryError("post-data table trigger state invalid")
  if relation not in added and after[6] is not before[6]: raise RecoveryError("post-data table trigger state invalid")
  if relation in added and any(acl[0] in (PRIVACY_DATA_ROLE,"PUBLIC") and acl[2]=="TRIGGER" for acl in expected_acl) and after[6] is not True: raise RecoveryError("post-data table trigger state invalid")
def _post_data_table_trigger_statement(relations,grant):
 if not relations: return None
 return ("GRANT" if grant else "REVOKE")+" TRIGGER ON TABLE "+",".join(f"{_quoted_identifier(schema)}.{_quoted_identifier(table)}" for schema,table in relations)+(" TO " if grant else " FROM ")+PRIVACY_DATA_ROLE
def _open_post_data_table_trigger_window(conn,relations):
 try:
  _query_conn(conn,"BEGIN")
  baseline=_read_post_data_table_trigger_state(conn,relations,baseline=True)
  added_relations=tuple(item[:2] for item in baseline if not item[6])
  statement=_post_data_table_trigger_statement(added_relations,True)
  if statement is not None:
   _query_conn(conn,"SET LOCAL ROLE "+PRIVACY_DATA_ROLE)
   _query_conn(conn,statement)
  _verify_post_data_table_trigger_state(conn,relations,_post_data_table_trigger_window_state(baseline))
  conn.commit()
  return baseline,added_relations
 except Exception:
  conn.rollback()
  raise
def _close_post_data_table_trigger_window(conn,relations,baseline,added_relations):
 _validate_post_data_table_trigger_baseline(relations,baseline)
 if type(added_relations) is not tuple or len(added_relations)!=len(set(added_relations)) or added_relations!=tuple(item[:2] for item in baseline if not item[6]): raise RecoveryError("post-data table trigger baseline invalid")
 try:
  _query_conn(conn,"BEGIN")
  live=None; precondition_error=None
  try:
   live=_read_post_data_table_trigger_state(conn,relations)
   _validate_live_post_data_table_trigger_window(relations,live,added_relations)
  except Exception as exc: precondition_error=exc
  statement=_post_data_table_trigger_statement(added_relations,False)
  if statement is not None:
   _query_conn(conn,"SET LOCAL ROLE "+PRIVACY_DATA_ROLE)
   _query_conn(conn,statement)
  readback_error=None
  try:
   if live is None: _read_post_data_table_trigger_state(conn,relations)
   else: _verify_post_data_table_trigger_cleanup(conn,relations,live,added_relations)
  except Exception as exc: readback_error=exc
  conn.commit()
  if precondition_error is not None: raise precondition_error
  if readback_error is not None: raise readback_error
 except Exception:
  conn.rollback()
  raise
def _with_post_data_table_trigger_connection(env,operation,*args):
 conn=_connect(LOCAL_SERVICE,env)
 try: return operation(conn,*args)
 finally: conn.close()
def _restore_post_data_with_trigger_authority(restore,plain_fd,plain,env,workspace,runs):
 relations=_post_data_privacy_trigger_relations(runs)
 authority_baseline=_with_post_data_trigger_authority_connection(env,_open_post_data_trigger_authority_window)
 try:
  table_baseline,added_relations=_with_post_data_table_trigger_connection(env,_open_post_data_table_trigger_window,relations)
  try:
   fk_baseline=_with_post_data_fk_authority_connection(env,_open_post_data_fk_authority_window)
   try:
    _restore_post_data_runs(restore,plain_fd,plain,env,workspace,runs)
   finally:
    _with_post_data_fk_authority_connection(env,_close_post_data_fk_authority_window,fk_baseline)
  finally:
   _with_post_data_table_trigger_connection(env,_close_post_data_table_trigger_window,relations,table_baseline,added_relations)
 finally:
  _with_post_data_trigger_authority_connection(env,_close_post_data_trigger_authority_window,authority_baseline)

PRIVACY_DATA_ROLE = "privacy_workflow_owner"
PRIVACY_RELATION_STATE_SQL = "SELECT role.rolname,class.relrowsecurity,class.relforcerowsecurity,ARRAY(SELECT acl.privilege_type FROM pg_catalog.aclexplode(class.relacl) AS acl JOIN pg_catalog.pg_roles AS grantee ON grantee.oid=acl.grantee WHERE grantee.rolname=%s ORDER BY acl.privilege_type),pg_catalog.has_table_privilege(role.oid,class.oid,'INSERT') FROM pg_catalog.pg_class AS class JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=class.relnamespace JOIN pg_catalog.pg_roles AS role ON role.oid=class.relowner WHERE namespace.nspname=%s AND class.relname=%s AND class.relkind IN ('r','p')"
PRIVACY_TABLE_PRIVILEGES = frozenset(("DELETE","INSERT","MAINTAIN","REFERENCES","SELECT","TRIGGER","TRUNCATE","UPDATE"))
def _quoted_identifier(value):
 if type(value) is not str or not value or "\x00" in value: raise RecoveryError("privacy TABLE DATA inventory invalid")
 return '"'+value.replace('"','""')+'"'
def _validate_privacy_relations(relations):
 if type(relations) is not tuple or len(relations)!=dict(TABLE_DATA_OWNER_COUNTS)[PRIVACY_DATA_ROLE] or len(set(relations))!=len(relations) or any(type(relation) is not tuple or len(relation)!=2 or any(type(value) is not str for value in relation) for relation in relations): raise RecoveryError("privacy TABLE DATA inventory invalid")
def _read_privacy_relation_baseline(conn,relations):
 _validate_privacy_relations(relations); baseline=[]
 for schema,relation in relations:
  rows=_query_conn(conn,PRIVACY_RELATION_STATE_SQL,(PRIVACY_DATA_ROLE,schema,relation))
  if len(rows)!=1 or type(rows[0]) is not tuple or len(rows[0])!=5: raise RecoveryError("privacy TABLE DATA privilege state invalid")
  owner,rls,force,raw_privileges,effective_insert=rows[0]
  if owner!=PRIVACY_DATA_ROLE or rls is not False or force is not True or type(raw_privileges) is not list or type(effective_insert) is not bool or any(type(privilege) is not str or privilege not in PRIVACY_TABLE_PRIVILEGES for privilege in raw_privileges): raise RecoveryError("privacy TABLE DATA privilege state invalid")
  privileges=tuple(raw_privileges)
  if privileges!=tuple(sorted(privileges)) or len(privileges)!=len(set(privileges)) or ("INSERT" in privileges and not effective_insert): raise RecoveryError("privacy TABLE DATA privilege state invalid")
  baseline.append((schema,relation,privileges,effective_insert))
 return tuple(baseline)
def _validate_privacy_baseline(relations,baseline):
 _validate_privacy_relations(relations)
 if type(baseline) is not tuple or len(baseline)!=len(relations): raise RecoveryError("privacy TABLE DATA privilege baseline invalid")
 for relation,item in zip(relations,baseline):
  if type(item) is not tuple or len(item)!=4 or item[:2]!=relation or type(item[2]) is not tuple or type(item[3]) is not bool or item[2]!=tuple(sorted(item[2])) or len(item[2])!=len(set(item[2])) or any(type(privilege) is not str or privilege not in PRIVACY_TABLE_PRIVILEGES for privilege in item[2]) or ("INSERT" in item[2] and not item[3]): raise RecoveryError("privacy TABLE DATA privilege baseline invalid")
def _privacy_window_baseline(baseline,added_relations):
 added=frozenset(added_relations)
 return tuple((schema,relation,tuple(sorted((*privileges,"INSERT"))) if (schema,relation) in added else privileges,True) for schema,relation,privileges,effective_insert in baseline)
def _verify_privacy_relation_baseline(conn,relations,expected):
 _validate_privacy_baseline(relations,expected)
 if _read_privacy_relation_baseline(conn,relations)!=expected: raise RecoveryError("privacy TABLE DATA privilege state invalid")
def _privacy_insert_statement(relations,grant):
 if not relations: return None
 return ("GRANT" if grant else "REVOKE")+" INSERT ON TABLE "+",".join(f"{_quoted_identifier(schema)}.{_quoted_identifier(relation)}" for schema,relation in relations)+(" TO " if grant else " FROM ")+PRIVACY_DATA_ROLE
def _open_privacy_insert_window(conn,relations):
 try:
  _query_conn(conn,"BEGIN")
  baseline=_read_privacy_relation_baseline(conn,relations)
  added_relations=tuple((schema,relation) for schema,relation,privileges,effective_insert in baseline if not effective_insert)
  statement=_privacy_insert_statement(added_relations,True)
  if statement is not None: _query_conn(conn,statement)
  _verify_privacy_relation_baseline(conn,relations,_privacy_window_baseline(baseline,added_relations))
  conn.commit()
  return baseline,added_relations
 except Exception:
  conn.rollback()
  raise
def _close_privacy_insert_window(conn,relations,baseline,added_relations):
 _validate_privacy_baseline(relations,baseline)
 if type(added_relations) is not tuple or added_relations!=tuple((schema,relation) for schema,relation,privileges,effective_insert in baseline if not effective_insert): raise RecoveryError("privacy TABLE DATA privilege baseline invalid")
 expected_window=_privacy_window_baseline(baseline,added_relations)
 try:
  _query_conn(conn,"BEGIN")
  precondition_error=None
  try: _verify_privacy_relation_baseline(conn,relations,expected_window)
  except Exception as exc: precondition_error=exc
  statement=_privacy_insert_statement(added_relations,False)
  if statement is not None: _query_conn(conn,statement)
  readback_error=None
  try: _verify_privacy_relation_baseline(conn,relations,baseline)
  except Exception as exc: readback_error=exc
  conn.commit()
  if precondition_error is not None: raise precondition_error
  if readback_error is not None: raise readback_error
 except Exception:
  conn.rollback()
  raise
def _with_privacy_connection(env,operation,*args):
 conn=_connect(LOCAL_SERVICE,env)
 try: return operation(conn,*args)
 finally: conn.close()
def _restore_privacy_data(restore,use_list,plain,env,relations):
 baseline,added_relations=_with_privacy_connection(env,_open_privacy_insert_window,relations)
 try:
  run([restore,"--section=data",f"--use-list={use_list}","--role=privacy_workflow_owner","--dbname=service=g035-local",str(plain)],env=env)
 finally:
  _with_privacy_connection(env,_close_privacy_insert_window,relations,baseline,added_relations)




def _normalize_restored_vector_extension(conn):
 rows=_query_conn(conn,"SELECT namespace.nspname FROM pg_catalog.pg_extension AS extension JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=extension.extnamespace WHERE extension.extname='vector'")
 if rows!=[("public",)]: raise RecoveryError("restored vector extension layout mismatch")
 return "public"
def run_restore_verify(args,manifest):
 require_local(args.destination_service); capture=_require_prior(args.capture_receipt,"capture"); source_binding=_require_recovery_source_binding(capture["evidence"],repository_root(Path(__file__).resolve())); dump=Path(args.dump)
 if capture["evidence"].get("recipient_fingerprint")!=APPROVED_AGE_RECIPIENT_SHA256: raise RecoveryError("capture recipient binding mismatch")
 if capture["evidence"].get("extension_scope")!=[{"name":name,"schema":schema} for name,schema in RECOVERY_EXTENSIONS] or capture["evidence"].get("managed_metadata_schema_scope")!=list(MANAGED_METADATA_SCHEMAS) or capture["evidence"].get("managed_table_data_exclusions")!=list(MANAGED_TABLE_DATA_EXCLUSIONS): raise RecoveryError("capture managed metadata scope mismatch")
 if capture["evidence"].get("schema_scope")!=list(APPLICATION_SCHEMAS): raise RecoveryError("capture application schema scope mismatch")
 if dump.is_symlink() or not dump.is_file() or sha256_file(dump)!=capture["evidence"].get("dump_sha256"): raise RecoveryError("ciphertext input mismatch")
 decryptor,restore=command_exists(args.decrypt_command),command_exists(args.pg_restore)
 with _owned_identity_stream(args) as identity_stream, _restricted_restore_directory() as workspace:
  service=_copy_local_service(workspace,Path(args.service_file),"g035-local"); env=safe_environment(service); plain=workspace/"database.pgdump"; use_list=workspace/"pre-data.list"; postgres_data_list=workspace/"data-postgres.list"; privacy_data_list=workspace/"data-privacy-workflow-owner.list"; plain_fd=None; plain_identity=None; use_list_fd=None; use_list_identity=None; postgres_data_list_fd=None; postgres_data_list_identity=None; privacy_data_list_fd=None; privacy_data_list_identity=None
  try:
   plain_fd,plain_identity=_owned_output(plain,"plaintext restore")
   with os.fdopen(os.dup(plain_fd),"wb",closefd=True) as plain_stream:
    try: subprocess.run([decryptor,"--decrypt","--identity","-",str(dump)],env=safe_environment(service,crypto=True),stdin=identity_stream,stdout=plain_stream,stderr=subprocess.PIPE,timeout=TIMEOUT_SECONDS,check=True)
    except (OSError,subprocess.TimeoutExpired,subprocess.CalledProcessError) as exc: raise RecoveryError("external command failed") from exc
   os.fsync(plain_fd)
   _require_temporary_file_identity(plain_fd,plain)
   toc=run([restore,"--list",str(plain)],env=env)
   _require_temporary_file_identity(plain_fd,plain)
   post_data_toc=run([restore,"--section=post-data","--list",str(plain)],env=env)
   _require_temporary_file_identity(plain_fd,plain)
   use_list_fd,use_list_identity=_owned_pre_data_use_list(use_list,toc.stdout)
   postgres_data,privacy_data,privacy_relations=_data_use_lists(toc.stdout)
   postgres_data_list_fd,postgres_data_list_identity=_owned_restore_use_list(postgres_data_list,postgres_data)
   privacy_data_list_fd,privacy_data_list_identity=_owned_restore_use_list(privacy_data_list,privacy_data)
   post_data_runs=_post_data_use_lists(post_data_toc.stdout)
   conn=_connect("g035-local",env)
   try:
    for schema in (LOCAL_REMEDIATION_SCHEMA,"public","auth","storage"): _query_conn(conn,f"DROP SCHEMA IF EXISTS {schema} CASCADE")
    _query_conn(conn,"CREATE SCHEMA public AUTHORIZATION pg_database_owner")
    _query_conn(conn,"GRANT USAGE ON SCHEMA public TO PUBLIC, anon, authenticated, service_role, postgres")
    _query_conn(conn,"GRANT USAGE, CREATE ON SCHEMA public TO privacy_workflow_owner")
    _query_conn(conn,"CREATE SCHEMA auth AUTHORIZATION supabase_admin")
    _query_conn(conn,"GRANT USAGE, CREATE ON SCHEMA auth TO supabase_auth_admin")
    _query_conn(conn,"CREATE SCHEMA storage AUTHORIZATION supabase_admin")
    _query_conn(conn,"GRANT USAGE, CREATE ON SCHEMA storage TO supabase_storage_admin")
    _query_conn(conn,"DO $$ BEGIN IF pg_catalog.to_regnamespace('extensions') IS NOT NULL THEN RAISE EXCEPTION 'local extensions schema reset drift'; END IF; END $$")
    _query_conn(conn,"CREATE SCHEMA extensions AUTHORIZATION postgres")
    _query_conn(conn,"GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role")
    _query_conn(conn,"GRANT USAGE, CREATE ON SCHEMA extensions TO dashboard_user")
    _query_conn(conn,"GRANT USAGE, CREATE ON SCHEMA extensions TO supabase_admin")
    conn.commit()
   except Exception:
    conn.rollback()
    raise
   finally: conn.close()
   _require_temporary_file_identity(plain_fd,plain)
   _require_temporary_file_identity(use_list_fd,use_list)
   run([restore,"--section=pre-data",f"--use-list={use_list}","--dbname=service=g035-local",str(plain)],env=env)
   _require_temporary_file_identity(use_list_fd,use_list)
   _require_temporary_file_identity(plain_fd,plain)
   _require_temporary_file_identity(postgres_data_list_fd,postgres_data_list)
   _require_temporary_file_identity(privacy_data_list_fd,privacy_data_list)
   run([restore,"--section=data",f"--use-list={postgres_data_list}","--role=postgres","--dbname=service=g035-local",str(plain)],env=env)
   _require_temporary_file_identity(postgres_data_list_fd,postgres_data_list)
   _require_temporary_file_identity(privacy_data_list_fd,privacy_data_list)
   _restore_privacy_data(restore,privacy_data_list,plain,env,privacy_relations)
   _require_temporary_file_identity(postgres_data_list_fd,postgres_data_list)
   _require_temporary_file_identity(privacy_data_list_fd,privacy_data_list)
   conn=_connect("g035-local",env)
   try:
    _create_auth_user_placeholders(conn); conn.commit()
   except Exception:
    conn.rollback()
    raise
   finally: conn.close()
   _restore_post_data_with_trigger_authority(restore,plain_fd,plain,env,workspace,post_data_runs)
   restored_vector_schema=None
   conn=_connect("g035-local",env)
   try:
    restored_vector_schema=_normalize_restored_vector_extension(conn)
    conn.commit()
    observed=_fingerprints(conn)
   except Exception:
    conn.rollback()
    raise
   finally: conn.close()
  finally:
   if privacy_data_list_fd is not None:
    _unlink_owned_output(privacy_data_list_fd,privacy_data_list,privacy_data_list_identity)
    os.close(privacy_data_list_fd)
   if postgres_data_list_fd is not None:
    _unlink_owned_output(postgres_data_list_fd,postgres_data_list,postgres_data_list_identity)
    os.close(postgres_data_list_fd)
   if use_list_fd is not None:
    _unlink_owned_output(use_list_fd,use_list,use_list_identity)
    os.close(use_list_fd)
   if plain_fd is not None:
    _unlink_owned_output(plain_fd,plain,plain_identity)
    os.close(plain_fd)
 expected=capture["evidence"]
 if not _ledger_evidence_equal(expected.get("ledger_pairs"),observed["ledger_pairs"]): raise RecoveryError("restore evidence mismatch")
 for key in ("ledger_sha256","ledger_count","restorable_catalog_sha256","managed_catalog_sha256"):
  if expected.get(key)!=observed.get(key): raise RecoveryError("restore evidence mismatch")
 if tuple(observed.get("managed_metadata_schemas_present",()))!=tuple(MANAGED_METADATA_SCHEMAS): raise RecoveryError("managed metadata structure mismatch")
 return receipt("restore-verify","restored",{**source_binding,**observed,"restored_vector_schema":restored_vector_schema,"restore_compatibility_hook_sha256":digest(RESTORED_VECTOR_LAYOUT_CONTRACT),"managed_metadata_coherence":"managed schema DDL restored with hosted catalog parity; managed table data excluded",**_auth_placeholder_evidence()},[capture["receipt_sha256"]])
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
def _local_clone_compatibility_sql(version):
 return LOCAL_CLONE_VECTOR_RELOCATION_SQL if version==LOCAL_CLONE_VECTOR_RELOCATION_VERSION else ()

def _compatibility_sql(version):
 statements=list(_compatibility_hook(version))
 if version==VECTOR_EXTENSION_RELOCATION_HOOK_VERSION: statements.extend(("DO $$ BEGIN IF (SELECT n.nspname FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector') <> 'public' THEN RAISE EXCEPTION 'vector compatibility precondition failed'; END IF; END $$;","ALTER EXTENSION vector SET SCHEMA extensions","DO $$ BEGIN IF (SELECT n.nspname FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector') <> 'extensions' THEN RAISE EXCEPTION 'vector compatibility postcondition failed'; END IF; END $$;"))
 if version==OBSOLETE_NOTIFICATION_OVERLOAD_HOOK_VERSION: statements.extend((f"DO $$ BEGIN IF pg_catalog.to_regprocedure('{OBSOLETE_NOTIFICATION_OVERLOAD}') IS NULL OR pg_catalog.to_regprocedure('{CANONICAL_NOTIFICATION_FUNCTION}') IS NULL THEN RAISE EXCEPTION 'notification overload compatibility precondition failed'; END IF; END $$;",f"DROP FUNCTION {OBSOLETE_NOTIFICATION_OVERLOAD}",f"DO $$ BEGIN IF pg_catalog.to_regprocedure('{OBSOLETE_NOTIFICATION_OVERLOAD}') IS NOT NULL OR pg_catalog.to_regprocedure('{CANONICAL_NOTIFICATION_FUNCTION}') IS NULL THEN RAISE EXCEPTION 'notification overload compatibility postcondition failed'; END IF; END $$;"))
 if version==PUBLIC_FUNCTION_OWNERS_HOOK_VERSION: statements.extend(g034_preflight.approval_source_statements())
 if version==PUBLIC_FUNCTION_OWNERS_HOOK_VERSION: statements.append("DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND r.rolname NOT IN ('supabase_admin','postgres','privacy_workflow_owner')) THEN RAISE EXCEPTION 'public function owner compatibility precondition failed'; END IF; END $$;")
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
 require_local(args.service); restored=_require_prior(args.restore_receipt,"restore-verify"); source_binding=_require_recovery_source_binding(restored["evidence"],repository_root(Path(__file__).resolve()))
 with tempfile.TemporaryDirectory(prefix="g035-inspect-") as raw:
  service=_copy_local_service(Path(raw),Path(args.service_file),"g035-local"); conn=_connect("g035-local",safe_environment(service))
  try: _query_conn(conn,"BEGIN READ ONLY"); evidence=_short_url_snapshot(conn)
  finally: conn.rollback(); conn.close()
 return receipt("short-url-remediation-inspect","validated",{**source_binding,**{k:v for k,v in evidence.items() if not k.startswith("_")}},[restored["receipt_sha256"]])
def _id_digest(values): return digest(sorted(values))
def _windows_protected_sddl(*,directory):
 current=_windows_current_sid()
 if not current: raise RecoveryError("temporary ACL unavailable")
 return f"D:P(A;{'OICI' if directory else ''};FA;;;{current})(A;{'OICI' if directory else ''};FA;;;SY)(A;{'OICI' if directory else ''};FA;;;BA)"
def _windows_create_restricted_directory(path):
 try:
  import ctypes
  from ctypes import wintypes
  class SECURITY_ATTRIBUTES(ctypes.Structure): _fields_=(("nLength",wintypes.DWORD),("lpSecurityDescriptor",ctypes.c_void_p),("bInheritHandle",wintypes.BOOL))
  kernel32=ctypes.WinDLL("kernel32",use_last_error=True); advapi32=ctypes.WinDLL("advapi32",use_last_error=True); descriptor=ctypes.c_void_p()
  if not advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(_windows_protected_sddl(directory=True),1,ctypes.byref(descriptor),None): raise ctypes.WinError(ctypes.get_last_error())
  try:
   attributes=SECURITY_ATTRIBUTES(ctypes.sizeof(SECURITY_ATTRIBUTES),descriptor,False)
   if not kernel32.CreateDirectoryW(str(path),ctypes.byref(attributes)):
    error=ctypes.get_last_error()
    if error==183: return False
    raise ctypes.WinError(error)
  finally: kernel32.LocalFree(descriptor)
  if not _windows_dacl_restrictive(path,directory=True): raise RecoveryError("temporary ACL unavailable")
  return True
 except (AttributeError,OSError,ValueError) as exc: raise RecoveryError("temporary ACL unavailable") from exc
def _directory_identity(path):
 try:
  entry=path.lstat(); target=path.stat()
  if path.is_symlink() or not stat.S_ISDIR(entry.st_mode) or (entry.st_dev,entry.st_ino)!=(target.st_dev,target.st_ino): raise RecoveryError("restore directory custody invalid")
  return entry.st_dev,entry.st_ino
 except OSError as exc: raise RecoveryError("restore directory custody invalid") from exc
def _same_directory_identity(path,identity):
 try: return _directory_identity(path)==identity
 except RecoveryError: return False
def _windows_set_protected_dacl(path, *, directory):
 try:
  import ctypes
  sddl=_windows_protected_sddl(directory=directory)
  advapi32=ctypes.WinDLL("advapi32",use_last_error=True); kernel32=ctypes.WinDLL("kernel32",use_last_error=True); descriptor=ctypes.c_void_p()
  if not advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl,1,ctypes.byref(descriptor),None): raise ctypes.WinError(ctypes.get_last_error())
  try:
   if not advapi32.SetFileSecurityW(str(path),0x80000004,descriptor): raise ctypes.WinError(ctypes.get_last_error())
  finally: kernel32.LocalFree(descriptor)
  if not _windows_dacl_restrictive(path,directory=directory): raise RecoveryError("temporary ACL unavailable")
 except (AttributeError,OSError,ValueError) as exc: raise RecoveryError("temporary ACL unavailable") from exc
def _windows_restrict_temporary_file(path):
 _windows_set_protected_dacl(path,directory=False)
def _windows_restrict_temporary_directory(path):
 _windows_set_protected_dacl(path,directory=True)
@contextlib.contextmanager
def _restricted_restore_directory():
 parent=Path.home().resolve(strict=True); identity=None
 if os.name=="nt":
  base=parent/".g035-recovery"
  created=_windows_create_restricted_directory(base)
  if not created: _require_restrictive_directory(base,"restore workspace parent")
  _require_restrictive_directory(base,"restore workspace parent")
  parent=base
  for _ in range(32):
   path=parent/f"g035-restore-{uuid.uuid4().hex}"
   if _windows_create_restricted_directory(path): break
  else: raise RecoveryError("restore directory custody invalid")
 else:
  path=Path(tempfile.mkdtemp(prefix="g035-restore-",dir=parent)); path.chmod(0o700)
 try:
  identity=_directory_identity(path)
  if not _restrictive_directory(path): raise RecoveryError("restore directory custody invalid")
  yield path
 finally:
  try:
   if identity is None or not _same_directory_identity(path,identity): raise RecoveryError("restore directory cleanup failed")
   shutil.rmtree(path)
  except OSError as exc: raise RecoveryError("restore directory cleanup failed") from exc
def _same_file_identity(fd,path):
 try:
  descriptor=os.fstat(fd); entry=path.lstat(); target=path.stat()
  return stat.S_ISREG(descriptor.st_mode) and stat.S_ISREG(entry.st_mode) and not stat.S_ISLNK(entry.st_mode) and (descriptor.st_dev,descriptor.st_ino)==(target.st_dev,target.st_ino)
 except OSError: return False
def _require_temporary_file_identity(fd,path):
 if not _same_file_identity(fd,path) or not _restrictive(path): raise RecoveryError("temporary file custody lost")
def _secure_temporary_file(prefix,contents):
 fd,name=tempfile.mkstemp(prefix=prefix)
 path=Path(name)
 try:
  if os.name=="nt": _windows_restrict_temporary_file(path)
  else: os.fchmod(fd,0o600)
  _require_temporary_file_identity(fd,path)
  offset=0
  while offset<len(contents): offset+=os.write(fd,contents[offset:])
  os.fsync(fd)
  _require_temporary_file_identity(fd,path)
  return fd,path
 except Exception:
  _close_temporary_file(fd,path)
  raise
def _open_custodied_input(path,label):
 _require_restrictive_regular_file(path,label)
 try:
  fd=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
 except OSError as exc: raise RecoveryError(f"{label} unreadable") from exc
 try:
  if not _same_file_identity(fd,path) or not _restrictive(path): raise RecoveryError(f"{label} custody lost")
  return fd
 except Exception:
  os.close(fd); raise
def _close_temporary_file(fd,path):
 try:
  same=_same_file_identity(fd,path)
  if os.name=="nt":
   os.close(fd)
   if same: path.unlink(missing_ok=True)
  else:
   if same: path.unlink(missing_ok=True)
   os.close(fd)
 except OSError: pass
def _descriptor_custody_argument(fd):
 if os.name!="posix": raise RecoveryError("descriptor custody unavailable")
 for root in ("/proc/self/fd","/dev/fd"):
  candidate=f"{root}/{fd}"
  if Path(candidate).exists():
   os.lseek(fd,0,os.SEEK_SET)
   return candidate
 raise RecoveryError("descriptor custody unavailable")
def _custodied_argument(fd,path):
 _require_temporary_file_identity(fd,path)
 if os.name=="nt": return str(path)
 argument=_descriptor_custody_argument(fd)
 path.unlink()
 return argument
def _custodied_input_argument(fd,path):
 if os.name=="nt":
  if not _same_file_identity(fd,path) or not _restrictive(path): raise RecoveryError("authorization signature custody lost")
  return str(path)
 return _descriptor_custody_argument(fd)
def _authorization(args,inspection,restored):
 path=Path(args.authorization); signature=Path(args.authorization_signature)
 capture=restored.get("prior_receipt_sha256",[])
 expected={"inspection_receipt_sha256":inspection["receipt_sha256"],"restore_receipt_sha256":restored["receipt_sha256"],"capture_receipt_sha256":capture[0] if len(capture)==1 else None,"manifest_sha256":MANIFEST_SHA256,"repository_commit":restored.get("evidence",{}).get("repository_commit",_repository_commit(repository_root(Path(__file__).resolve())))}
 def verify_detached(raw, signature_path, public_key_pem):
  key_fd,key=_secure_temporary_file("g035-key-",public_key_pem.encode("ascii"))
  raw_fd,exact=_secure_temporary_file("g035-authorization-",raw)
  signature_fd=None
  try:
   signature_fd=_open_custodied_input(signature_path,"authorization signature")
   key_argument=_custodied_argument(key_fd,key); raw_argument=_custodied_argument(raw_fd,exact); signature_argument=_custodied_input_argument(signature_fd,signature_path)
   run(["openssl","pkeyutl","-verify","-pubin","-inkey",key_argument,"-rawin","-in",raw_argument,"-sigfile",signature_argument],env=safe_environment(Path("."),crypto=True),pass_fds=(key_fd,raw_fd,signature_fd) if os.name=="posix" else ())
   if os.name=="nt":
    _require_temporary_file_identity(key_fd,key); _require_temporary_file_identity(raw_fd,exact)
    if not _same_file_identity(signature_fd,signature_path) or not _restrictive(signature_path): raise RecoveryError("authorization signature custody lost")
  finally:
   if signature_fd is not None: os.close(signature_fd)
   _close_temporary_file(key_fd,key); _close_temporary_file(raw_fd,exact)
 try:
  return verify_short_url_remediation_authorization(path,signature,require_custody=_require_restrictive_regular_file,verify_detached=verify_detached,expected_bindings=expected,inspection_evidence=inspection["evidence"])
 except ContractError as exc:
  raise RecoveryError(str(exc)) from exc
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
 require_local(args.service); restored=_require_prior(args.restore_receipt,"restore-verify"); inspected=_require_prior(args.inspect_receipt,"short-url-remediation-inspect"); source_binding=_require_recovery_source_binding(restored.get("evidence"),repository_root(Path(__file__).resolve())); auth=_authorization(args,inspected,restored)
 with tempfile.TemporaryDirectory(prefix="g035-remediate-") as raw:
  service=_copy_local_service(Path(raw),Path(args.service_file),"g035-local"); conn=_connect("g035-local",safe_environment(service))
  try:
   _query_conn(conn,"BEGIN ISOLATION LEVEL SERIALIZABLE"); _query_conn(conn,"LOCK TABLE public.short_urls IN SHARE ROW EXCLUSIVE MODE"); recovered=_recovered_apply_evidence(conn,auth,restored,inspected)
   if recovered is not None:
    conn.commit()
    return receipt("short-url-remediation-apply","applied",{**source_binding,**recovered},[restored["receipt_sha256"],inspected["receipt_sha256"]])
   state=_short_url_snapshot(conn)
   if any(state[k]!=inspected["evidence"][k] for k in state if k!="_victims"): raise RecoveryError("inspection stale")
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
 return receipt("short-url-remediation-apply","applied",{**source_binding,"local_only":True,"batch_id":auth["batch_id"],"restore_receipt_sha256":restored["receipt_sha256"],"inspection_receipt_sha256":inspected["receipt_sha256"],"authorization_sha256":digest(auth),"manifest_sha256":MANIFEST_SHA256,"repository_commit":auth["repository_commit"],"short_urls_catalog_sha256":state["short_urls_catalog_sha256"],"selection_spec_sha256":state["selection_spec_sha256"],"duplicate_group_count":state["duplicate_group_count"],"quarantined_row_count":len(quarantine_ids),"quarantined_row_sha256":digest(descriptors),"quarantined_ids_sha256":_id_digest(quarantine_ids),"deleted_ids_sha256":_id_digest(deleted_ids),"victim_descriptors_sha256":state["victim_descriptors_sha256"],"pre_short_urls_rowset_sha256":state["pre_short_urls_rowset_sha256"],"survivor_short_urls_rowset_sha256":survivor["pre_short_urls_rowset_sha256"],"quarantine_catalog_sha256":catalog},[restored["receipt_sha256"],inspected["receipt_sha256"]])
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
 require_local(args.service); applied=_require_prior(args.apply_receipt,"short-url-remediation-apply"); _require_recovery_source_binding(applied["evidence"],repository_root(Path(__file__).resolve()))
 with tempfile.TemporaryDirectory(prefix="g035-verify-") as raw:
  service=_copy_local_service(Path(raw),Path(args.service_file),"g035-local"); conn=_connect("g035-local",safe_environment(service))
  try:
   _query_conn(conn,"BEGIN READ ONLY"); batch,count,state=_verify_remediation_state(conn,applied["evidence"])
  finally: conn.rollback(); conn.close()
 return receipt("short-url-remediation-verify","validated",{**applied["evidence"],"apply_receipt_sha256":applied["receipt_sha256"],"batch_id":batch,"quarantined_row_count":count,"survivor_short_urls_rowset_sha256":state["pre_short_urls_rowset_sha256"]},[applied["receipt_sha256"]])
def apply_manifest(args,manifest):
 require_local(args.service); prior=_require_prior(args.restore_receipt,"restore-verify"); source_binding=_require_recovery_source_binding(prior.get("evidence"),repository_root(Path(__file__).resolve())); psql=command_exists(args.psql)
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
     hook=(*_compatibility_sql(entry.version),*_local_clone_compatibility_sql(entry.version))
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
   _ledger_assert(conn,manifest,len(manifest.migrations)); runtime=repository_root(Path(__file__).resolve())/"backend/supabase/tests/g035_hosted_clone_runtime.sql"; g041_runtime=repository_root(Path(__file__).resolve())/"backend/supabase/tests/g041_auth_boundary_runtime.sql"
   approval_evidence=_approval_catalog_evidence(conn)
   for fixture in (runtime,g041_runtime): run([psql,"service=g035-local","--set","ON_ERROR_STOP=1","--file",str(fixture)],env=env)
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
 return receipt("clone-apply","applied",{**source_binding,"clone_state":"transformed_local_clone_not_exact_restore","hosted_mutations":0,"baseline_pairs_sha256":BASELINE_SHA256,"initial_ledger_state":initial_state,"migrations_applied_in_invocation":len(manifest.migrations) if initial_state=="baseline" else 0,"migrations_already_present":len(manifest.migrations) if initial_state=="full" else 0,"short_url_remediation_verify_receipt_sha256":verified["receipt_sha256"] if initial_state=="baseline" else None,"compatibility_hook_owner_function_count":compatibility_hook_owner_function_count,"compatibility_hook_obsolete_function_count":compatibility_hook_obsolete_function_count,"compatibility_hook_public_function_count":len(compatibility_hook_public_function_signatures),"compatibility_hook_public_function_sha256":digest(compatibility_hook_public_function_signatures),"compatibility_hook_sha256":digest((COMPATIBILITY_HOOKS,VECTOR_EXTENSION_RELOCATION_HOOK_VERSION,VECTOR_EXTENSION_RELOCATION_HOOK,LOCAL_CLONE_VECTOR_RELOCATION_VERSION,LOCAL_CLONE_VECTOR_RELOCATION_SQL,OBSOLETE_NOTIFICATION_OVERLOAD_HOOK_VERSION,OBSOLETE_NOTIFICATION_OVERLOAD,CANONICAL_NOTIFICATION_FUNCTION,PUBLIC_FUNCTION_OWNERS_HOOK_VERSION,PUBLIC_FUNCTION_OWNERS_SQL,CROSS_SCHEMA_OWNER_HOOK_VERSION,CROSS_SCHEMA_OWNER_FUNCTIONS)),**approval_evidence,**{k:v for k,v in observed.items() if k!="ledger_pairs"}},[prior["receipt_sha256"]])
def run_postflight(args,manifest):
 require_local(args.service); applied=_require_prior(args.clone_receipt,"clone-apply"); source_binding=_require_recovery_source_binding(applied["evidence"],repository_root(Path(__file__).resolve())); evidence=applied.get("evidence"); approval_descriptor=_approval_contract_descriptor()
 required={"clone_state":"transformed_local_clone_not_exact_restore","hosted_mutations":0,"baseline_pairs_sha256":BASELINE_SHA256,**approval_descriptor}
 if not isinstance(evidence,dict) or any(evidence.get(key)!=value for key,value in required.items()) or len(applied.get("prior_receipt_sha256",()))!=1: raise RecoveryError("clone receipt evidence mismatch")
 psql=command_exists(args.psql)
 with tempfile.TemporaryDirectory(prefix="g035-postflight-") as raw:
  service=_copy_local_service(Path(raw),Path(args.service_file),"g035-local"); env=safe_environment(service); conn=_connect("g035-local",env)
  try:
   _query_conn(conn,"BEGIN READ ONLY"); observed=_fingerprints(conn); approval_evidence=_approval_catalog_evidence(conn)
   runtime=repository_root(Path(__file__).resolve())/"backend/supabase/tests/g035_hosted_clone_runtime.sql"; g041_runtime=repository_root(Path(__file__).resolve())/"backend/supabase/tests/g041_auth_boundary_runtime.sql"
   for fixture in (runtime,g041_runtime): run([psql,"service=g035-local","--set","ON_ERROR_STOP=1","--file",str(fixture)],env=env)
  finally: conn.rollback(); conn.close()
 if not ledger_prefix(manifest,observed["ledger_pairs"]) or len(observed["ledger_pairs"])!=len(BASELINE_PAIRS)+len(manifest.migrations): raise RecoveryError("local postflight ledger mismatch")
 for key in ("ledger_sha256","ledger_count","restorable_catalog_sha256","managed_catalog_sha256"):
  if evidence.get(key)!=observed.get(key): raise RecoveryError("clone receipt evidence mismatch")
 if not _managed_metadata_schemas_equal(evidence.get("managed_metadata_schemas_present"),observed.get("managed_metadata_schemas_present")): raise RecoveryError("clone receipt evidence mismatch")
 return receipt("local-postflight","validated",{**source_binding,**approval_evidence,**{k:v for k,v in observed.items() if k!="ledger_pairs"}},[applied["receipt_sha256"]])
def parser():
 p=argparse.ArgumentParser(); sub=p.add_subparsers(dest="mode",required=True); sub.add_parser("validate")
 c=sub.add_parser("capture"); c.add_argument("--destination",required=True); c.add_argument("--service-file",required=True); c.add_argument("--recipient",required=True); c.add_argument("--g034-artifact",required=True); c.add_argument("--pg-dump",default="pg_dump"); c.add_argument("--encrypt-command",required=True)
 pc=sub.add_parser("production-capture"); pc.add_argument("--destination",required=True); pc.add_argument("--capture-receipt",required=True); pc.add_argument("--service-file",required=True); pc.add_argument("--recipient",required=True); pc.add_argument("--g034-artifact",required=True); pc.add_argument("--pg-dump",default="pg_dump"); pc.add_argument("--encrypt-command",required=True)
 r=sub.add_parser("restore-verify"); r.add_argument("--dump",required=True); r.add_argument("--capture-receipt",required=True); r.add_argument("--restore-receipt",required=True); r.add_argument("--service-file",required=True); r.add_argument("--destination-service",required=True); identity=r.add_mutually_exclusive_group(required=True); identity.add_argument("--identity-fd"); identity.add_argument("--identity-handle"); r.add_argument("--decrypt-command",required=True); r.add_argument("--pg-restore",default="pg_restore")
 i=sub.add_parser("short-url-remediation-inspect"); i.add_argument("--service",required=True); i.add_argument("--service-file",required=True); i.add_argument("--restore-receipt",required=True)
 a=sub.add_parser("short-url-remediation-apply"); a.add_argument("--service",required=True); a.add_argument("--service-file",required=True); a.add_argument("--restore-receipt",required=True); a.add_argument("--inspect-receipt",required=True); a.add_argument("--authorization",required=True); a.add_argument("--authorization-signature",required=True)
 v=sub.add_parser("short-url-remediation-verify"); v.add_argument("--service",required=True); v.add_argument("--service-file",required=True); v.add_argument("--apply-receipt",required=True)
 a=sub.add_parser("clone-apply"); a.add_argument("--service",required=True); a.add_argument("--service-file",required=True); a.add_argument("--restore-receipt",required=True); a.add_argument("--short-url-remediation-receipt"); a.add_argument("--psql",default="psql")
 q=sub.add_parser("local-postflight"); q.add_argument("--service",required=True); q.add_argument("--service-file",required=True); q.add_argument("--clone-receipt",required=True); q.add_argument("--psql",default="psql")
 return p
def main(argv=None):
 args=parser().parse_args(argv)
 try:
  manifest=validate_sources(repository_root(Path(__file__).resolve()))
  if args.mode=="validate": result=receipt("validate","valid",{"manifest_sha256":MANIFEST_SHA256,"baseline_pairs_sha256":BASELINE_SHA256}); emit(result); return 0
  if args.mode=="restore-verify": _restore_receipt_target(args); _publish_restore_receipt(args,run_restore_verify(args,manifest)); return 0
  result={"capture":run_capture,"production-capture":capture_to_custody,"short-url-remediation-inspect":run_short_url_inspect,"short-url-remediation-apply":run_short_url_apply,"short-url-remediation-verify":run_short_url_verify,"clone-apply":apply_manifest,"local-postflight":run_postflight}[args.mode](args,manifest); emit(result); return 0
 except (ContractError,RecoveryError):
  if args.mode!="restore-verify": emit(receipt(args.mode,"rejected",{"reason":"policy_rejected"}))
  return 2
if __name__=="__main__": raise SystemExit(main())
