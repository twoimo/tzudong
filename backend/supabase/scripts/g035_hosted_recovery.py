#!/usr/bin/env python3
"""Fail-closed, local-only encrypted backup/restore/clone rehearsal."""
from __future__ import annotations
import argparse, csv, hashlib, json, os, re, shutil, subprocess, tempfile
from pathlib import Path
from typing import Any, Sequence
from g035_hosted_recovery_contract import APPLICATION_SCHEMAS, BASELINE_PAIRS, BASELINE_SHA256, FORBIDDEN_VERSIONS, MANAGED_METADATA_SCHEMAS, MANIFEST_SHA256, SELF_COMMIT_VERSIONS, ContractError, Manifest, ledger_prefix, repository_root, sha256_file, validate_sources
TIMEOUT_SECONDS=900; RECEIPT_SCHEMA="g035-local-recovery-receipt-v3"; HEX=re.compile(r"^[a-f0-9]{64}$"); AGE_RECIPIENT=re.compile(r"^age1[ac-hj-np-z02-9]{58}$"); ID=re.compile(r"^[A-Za-z0-9._:-]{1,128}$"); LOCAL_SERVICE="g035-local"; LOCAL_DBNAME="g035_local"; LOCAL_HOSTS={"localhost","127.0.0.1","::1"}; SERVICE_KEYS={"host","port","dbname","application_name","sslmode","user","password","connect_timeout"}
class RecoveryError(RuntimeError): pass
def _pairs(pairs):
 result={}
 for k,v in pairs:
  if k in result: raise RecoveryError("duplicate JSON object key")
  result[k]=v
 return result
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
def _parse_local_service(source,section):
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
 if headers != 1 or section != LOCAL_SERVICE or set(entries).difference(SERVICE_KEYS): raise RecoveryError("invalid service file")
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
  return psycopg.connect(f"service={service}", autocommit=False)
 except Exception as exc: raise RecoveryError("local database connection unavailable") from exc
def _query_conn(conn,sql,params=None):
 with conn.cursor() as cur:
  cur.execute(sql,params); return cur.fetchall()
def _fingerprints(conn):
 rows=_query_conn(conn,"SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version, name")
 pairs=[(str(v),str(n)) for v,n in rows]; raw=json.dumps(pairs,separators=(",",":"))
 catalog=_query_conn(conn,"SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) ORDER BY 1,2",(list(APPLICATION_SCHEMAS+MANAGED_METADATA_SCHEMAS),))
 return {"ledger_pairs":pairs,"ledger_sha256":hashlib.sha256(raw.encode()).hexdigest(),"ledger_count":len(pairs),"catalog_sha256":hashlib.sha256(json.dumps(catalog,default=str,separators=(",",":")).encode()).hexdigest()}
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
def _g034_adapter(path, root, manifest, observed):
 try:
  data=json.loads(Path(path).read_text(encoding="utf8"),object_pairs_hook=_pairs)
 except (OSError,json.JSONDecodeError,RecoveryError) as exc: raise RecoveryError("g034 artifact unreadable") from exc
 required={"artifactVersion","blockers","catalogChecked","catalogFingerprint","cloneApplyRisks","cloneBackupRecoveryRequired","hostedLedgerFingerprint","manifestHash","preflightReceiptId","prerequisites","repositoryCommit","requiredLaterPromotionGate","safeToApply","sourceFingerprint","sourceValid","schemaVersion","ledgerExpectedTerminal","closureTerminalVersion"}
 allowed={"clone-required","clone-backup-recovery-required","catalog-prerequisite"}
 fatal_prefixes=("manifest","database-url","catalog-read","catalog-rollback")
 if not isinstance(data,dict) or set(data)!=required or data["artifactVersion"]!=2 or not isinstance(data["blockers"],list) or len(data["blockers"])!=len(set(data["blockers"])) or any(not isinstance(code,str) for code in data["blockers"]) or not set(data["blockers"]).issubset(allowed) or any(code.startswith(fatal_prefixes) for code in data["blockers"]) or data["manifestHash"]!=MANIFEST_SHA256 or data["repositoryCommit"]!=_repository_commit(root) or data["sourceFingerprint"]!=_source_fingerprint(manifest) or not data["sourceValid"] or not data["catalogChecked"] or data["safeToApply"] is not False or data["preflightReceiptId"]!=_preflight_receipt(data) or data["hostedLedgerFingerprint"]!=observed["ledger_sha256"] or data["catalogFingerprint"]!=observed["catalog_sha256"]:
  raise RecoveryError("g034 capture readiness is not satisfied")
 return {"g034_preflight_receipt_id":data["preflightReceiptId"],"commit_sha256":data["repositoryCommit"],"catalog_sha256":data["catalogFingerprint"],"ledger_sha256":data["hostedLedgerFingerprint"],"source_sha256":data["sourceFingerprint"],"capture_readiness_sha256":digest({"artifact_sha256":sha256_file(Path(path)),"preflight_receipt_id":data["preflightReceiptId"],"live_catalog_sha256":observed["catalog_sha256"],"live_ledger_sha256":observed["ledger_sha256"]})}
def _dump_to_encrypted(pg_dump,encryptor,recipient,snapshot,env,destination):
 output=destination/"g035-dump.enc"; argv=[pg_dump,"service=g035","--format=custom","--snapshot="+snapshot,"--blobs",*["--schema="+schema for schema in APPLICATION_SCHEMAS]]
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
   observed=_fingerprints(conn); readiness=_g034_adapter(args.g034_artifact,root,manifest,observed); argv=_dump_to_encrypted(pg_dump,encryptor,args.recipient,snapshot,env,destination)
  finally: conn.rollback(); conn.close()
 evidence={**readiness,"recipient_fingerprint":hashlib.sha256(args.recipient.encode("utf-8")).hexdigest(),"dump_sha256":sha256_file(destination/"g035-dump.enc"),"dump_bytes":(destination/"g035-dump.enc").stat().st_size,"schema_scope":list(APPLICATION_SCHEMAS),"managed_metadata_schemas":list(MANAGED_METADATA_SCHEMAS),"managed_metadata_coherence":"metadata fingerprints only; not dumped or restored","snapshot_consumer_argv":argv,**{k:v for k,v in observed.items() if k!="ledger_pairs"}}
 return receipt("capture","captured",evidence)
def run_restore_verify(args,manifest):
 require_local(args.destination_service); capture=_require_prior(args.capture_receipt,"capture"); dump=Path(args.dump)
 if dump.is_symlink() or not dump.is_file() or sha256_file(dump)!=capture["evidence"].get("dump_sha256"): raise RecoveryError("ciphertext input mismatch")
 decryptor,restore=command_exists(args.decrypt_command),command_exists(args.pg_restore)
 with tempfile.TemporaryDirectory(prefix="g035-restore-") as raw:
  service=_copy_local_service(Path(raw),Path(args.service_file),"g035-local"); env=safe_environment(service); plain=Path(raw)/"database.pgdump"; run([decryptor,"--output",str(plain),str(dump)],env=safe_environment(service,crypto=True)); run([restore,"--dbname=service=g035-local",str(plain)],env=env)
  conn=_connect("g035-local",env)
  try: observed=_fingerprints(conn)
  finally: conn.rollback(); conn.close()
 for key in ("ledger_sha256","ledger_count","catalog_sha256"):
  if observed[key]!=capture["evidence"].get(key): raise RecoveryError("restore evidence mismatch")
 return receipt("restore-verify","restored",{k:v for k,v in observed.items() if k!="ledger_pairs"},[capture["receipt_sha256"]])
def _ledger_assert(conn,manifest,count):
 actual=_fingerprints(conn)["ledger_pairs"]
 if any(v in FORBIDDEN_VERSIONS for v,_ in actual) or not ledger_prefix(manifest,actual) or len(actual)!=len(BASELINE_PAIRS)+count: raise RecoveryError("ledger prefix mismatch")
def apply_manifest(args,manifest):
 require_local(args.service); prior=_require_prior(args.restore_receipt,"restore-verify"); psql=command_exists(args.psql)
 with tempfile.TemporaryDirectory(prefix="g035-clone-") as raw:
  service=_copy_local_service(Path(raw),Path(args.service_file),"g035-local"); env=safe_environment(service); conn=_connect("g035-local",env); self_commit_attempted=False
  try:
   _query_conn(conn,"SELECT pg_advisory_lock(35035)")
   for index,entry in enumerate(manifest.migrations):
    _ledger_assert(conn,manifest,index); source=repository_root(Path(__file__).resolve())/entry.path
    if sha256_file(source)!=entry.sha256: raise RecoveryError("migration source hash mismatch")
    if entry.version in SELF_COMMIT_VERSIONS:
     try:
      self_commit_attempted=True
      run([psql,"service=g035-local","--set","ON_ERROR_STOP=1","--file",str(source)],env=env)
      _query_conn(conn,"INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES (%s,%s)",(entry.version,entry.name)); conn.commit()
      _ledger_assert(conn,manifest,index+1)
     except Exception as exc: raise RecoveryError("self_commit_ambiguous") from exc
    else:
     script=Path(raw)/f"{entry.version}.sql"
     script.write_text(f"BEGIN;\n\\i {source.as_posix()}\nINSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('{entry.version}','{entry.name}');\nCOMMIT;\n",encoding="utf8")
     run([psql,"service=g035-local","--set","ON_ERROR_STOP=1","--file",str(script)],env=env)
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
 return receipt("clone-apply","applied",{"baseline_pairs_sha256":BASELINE_SHA256,**{k:v for k,v in observed.items() if k!="ledger_pairs"}},[prior["receipt_sha256"]])
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
 r=sub.add_parser("restore-verify"); r.add_argument("--dump",required=True); r.add_argument("--capture-receipt",required=True); r.add_argument("--service-file",required=True); r.add_argument("--destination-service",required=True); r.add_argument("--decrypt-command",required=True); r.add_argument("--pg-restore",default="pg_restore")
 a=sub.add_parser("clone-apply"); a.add_argument("--service",required=True); a.add_argument("--service-file",required=True); a.add_argument("--restore-receipt",required=True); a.add_argument("--psql",default="psql")
 q=sub.add_parser("local-postflight"); q.add_argument("--service",required=True); q.add_argument("--service-file",required=True); q.add_argument("--clone-receipt",required=True)
 return p
def main(argv=None):
 args=parser().parse_args(argv)
 try:
  manifest=validate_sources(repository_root(Path(__file__).resolve())); result=receipt("validate","valid",{"manifest_sha256":MANIFEST_SHA256,"baseline_pairs_sha256":BASELINE_SHA256}) if args.mode=="validate" else {"capture":run_capture,"restore-verify":run_restore_verify,"clone-apply":apply_manifest,"local-postflight":run_postflight}[args.mode](args,manifest); emit(result); return 0
 except (ContractError,RecoveryError): emit(receipt(args.mode,"rejected",{"reason":"policy_rejected"})); return 2
if __name__=="__main__": raise SystemExit(main())
