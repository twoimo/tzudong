import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const FIXED_PYTHON_COMMANDS = new Set(['python', 'python3', 'py']);
const MAX_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const CHILD_ENV_KEYS = [
  'HOME', 'USERPROFILE', 'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR',
  'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'PYTHONHOME', 'PYTHONPATH',
];
const PROCESS_TREE_POLL_MS = 25;
const PROCESS_TERMINATION_GRACE_MS = 100;
const PROCESS_TREE_CLEANUP_RESERVE_MS = 2_000;
const WINDOWS_SUPERVISOR_FORCE_GRACE_MS = 100;
const WINDOWS_SUPERVISOR_CLEANUP_DEADLINE_MS = 2_000;
const WINDOWS_SYSTEM32 = process.arch === 'ia32' && process.env.PROCESSOR_ARCHITEW6432
  ? 'C:\\Windows\\Sysnative'
  : 'C:\\Windows\\System32';
const WINDOWS_POWERSHELL = `${WINDOWS_SYSTEM32}\\WindowsPowerShell\\v1.0\\powershell.exe`;

function fixedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function isTrustedYoutubeVideoId(value) {
  return typeof value === 'string' && VIDEO_ID_PATTERN.test(value);
}

export function extractTrustedYoutubeVideoId(value) {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  let videoId = null;
  if ((host === 'www.youtube.com' || host === 'youtube.com') && parsed.pathname === '/watch') {
    videoId = parsed.searchParams.get('v');
  } else if (host === 'youtu.be' && /^\/[A-Za-z0-9_-]{11}\/?$/.test(parsed.pathname)) {
    videoId = parsed.pathname.split('/')[1];
  } else if ((host === 'www.youtube.com' || host === 'youtube.com') && /^\/embed\/[A-Za-z0-9_-]{11}\/?$/.test(parsed.pathname)) {
    videoId = parsed.pathname.split('/')[2];
  }
  return isTrustedYoutubeVideoId(videoId) ? videoId : null;
}

function resolveRegularFile(candidate, code) {
  if (!path.isAbsolute(candidate)) throw fixedError(code);
  try {
    const before = fs.lstatSync(candidate);
    const resolved = fs.realpathSync.native(candidate);
    const after = fs.lstatSync(resolved);
    if (
      before.isSymbolicLink()
      || !before.isFile()
      || after.isSymbolicLink()
      || !after.isFile()
      || before.dev !== after.dev
      || before.ino !== after.ino
    ) {
      throw fixedError(code);
    }
    return resolved;
  } catch (error) {
    if (error?.code === code) throw error;
    throw fixedError(code);
  }
}

function resolveTrustedExecutableFile(candidate, code) {
  if (!path.isAbsolute(candidate)) throw fixedError(code);
  try {
    const resolved = fs.realpathSync.native(candidate);
    const after = fs.lstatSync(resolved);
    if (after.isSymbolicLink() || !after.isFile()) throw fixedError(code);
    return resolved;
  } catch (error) {
    if (error?.code === code) throw error;
    throw fixedError(code);
  }
}

export function resolveTrustedPythonCommand(value = 'python') {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw fixedError('TRANSCRIPT_PYTHON_COMMAND_INVALID');
  }
  if (FIXED_PYTHON_COMMANDS.has(value)) return value;
  return resolveTrustedExecutableFile(value, 'TRANSCRIPT_PYTHON_COMMAND_INVALID');
}

export function buildTranscriptYtDlpInvocation({
  videoId,
  outputPrefix,
  cookiesPath = null,
  mode,
  userAgent,
  pythonCommand = 'python',
  nodePath = process.execPath,
}) {
  if (!isTrustedYoutubeVideoId(videoId)) throw fixedError('TRANSCRIPT_VIDEO_ID_INVALID');
  if (!path.isAbsolute(outputPrefix) || path.basename(outputPrefix) !== `temp_${videoId}`) {
    throw fixedError('TRANSCRIPT_OUTPUT_PATH_INVALID');
  }
  if (!['cookies', 'stealth'].includes(mode)) throw fixedError('TRANSCRIPT_MODE_INVALID');
  if (typeof nodePath !== 'string' || !path.isAbsolute(nodePath)) throw fixedError('TRANSCRIPT_NODE_PATH_INVALID');

  const executable = resolveTrustedPythonCommand(pythonCommand);
  const args = [
    '-m', 'yt_dlp',
    '--js-runtimes', `node:${nodePath}`,
    '--remote-components', 'ejs:github',
  ];
  if (mode === 'cookies') {
    if (!cookiesPath) throw fixedError('TRANSCRIPT_COOKIE_PATH_INVALID');
    args.push('--cookies', resolveRegularFile(cookiesPath, 'TRANSCRIPT_COOKIE_PATH_INVALID'));
  } else {
    if (typeof userAgent !== 'string' || userAgent.length < 10 || userAgent.length > 512 || /[\r\n\0]/.test(userAgent)) {
      throw fixedError('TRANSCRIPT_USER_AGENT_INVALID');
    }
    args.push(
      '--no-cache-dir',
      '--user-agent', userAgent,
      '--extractor-args', 'youtube:player_client=web',
      '--sleep-requests', '1',
    );
  }
  args.push(
    '--write-auto-sub',
    '--write-sub',
    '--sub-lang', 'ko',
    '--skip-download',
    '--convert-subs', 'vtt',
    '--output', outputPrefix,
    `https://www.youtube.com/watch?v=${videoId}`,
  );
  return { executable, args };
}

function buildChildEnvironment(source = process.env) {
  const env = {};
  for (const key of CHILD_ENV_KEYS) {
    if (typeof source[key] === 'string') env[key] = source[key];
  }
  return env;
}

function hasValidProcessId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function remainingDeadlineMs(deadline) {
  return Math.max(0, deadline - Date.now());
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPosixProcessGroupGone(pid) {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

async function waitForPosixProcessGroupExit(pid, deadline) {
  while (!isPosixProcessGroupGone(pid)) {
    const remaining = remainingDeadlineMs(deadline);
    if (remaining === 0) return false;
    await delay(Math.min(PROCESS_TREE_POLL_MS, remaining));
  }
  return true;
}

async function terminatePosixProcessTree(pid, deadline) {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') return false;
  }
  if (await waitForPosixProcessGroupExit(pid, Math.min(
    deadline,
    Date.now() + PROCESS_TERMINATION_GRACE_MS,
  ))) {
    return true;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') return false;
  }
  return waitForPosixProcessGroupExit(pid, deadline);
}

const WINDOWS_JOB_SUPERVISOR_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$source=@'
using System;
using System.ComponentModel;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
public static class TranscriptJob {
 const uint EXTENDED_STARTUPINFO_PRESENT=0x00080000,CREATE_NO_WINDOW=0x08000000,CREATE_SUSPENDED=0x00000004,CREATE_UNICODE_ENVIRONMENT=0x00000400,STARTF_USESTDHANDLES=0x00000100,JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE=0x00002000,WAIT_OBJECT_0=0,WAIT_TIMEOUT=258,SYNCHRONIZE=0x00100000,GENERIC_READ=0x80000000,GENERIC_WRITE=0x40000000,FILE_SHARE_READ=1,FILE_SHARE_WRITE=2,OPEN_EXISTING=3,FILE_ATTRIBUTE_NORMAL=0x80,HANDLE_FLAG_INHERIT=1;
 static readonly IntPtr PROC_THREAD_ATTRIBUTE_JOB_LIST=new IntPtr(0x0002000D),PROC_THREAD_ATTRIBUTE_HANDLE_LIST=new IntPtr(0x00020002),INVALID_HANDLE_VALUE=new IntPtr(-1);
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct SI { public int cb; public string r,d,t; public uint x,y,xs,ys,xc,yc,fill,flags; public short show,res; public IntPtr reserved,hin,hout,herr; }
 [StructLayout(LayoutKind.Sequential)] struct SIX { public SI si; public IntPtr attributes; }
 [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process,thread; public uint pid,tid; }
 [StructLayout(LayoutKind.Sequential)] struct BL { public long pp,pj; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IOC { public ulong ro,wo,oo,rb,wb,ob; }
 [StructLayout(LayoutKind.Sequential)] struct EL { public BL basic; public IOC io; public UIntPtr pml,jml,peakp,peakj; }
 [StructLayout(LayoutKind.Sequential)] struct BA { public long tu,tk,ptu,ptk; public uint faults,total,active,terminated; }
 sealed class ControlState { public volatile bool terminate; }
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref SIX si,out PI pi);
 [DllImport("kernel32",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string n);
 [DllImport("kernel32",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr j,int c,IntPtr i,uint l);
 [DllImport("kernel32",SetLastError=true)] static extern bool TerminateJobObject(IntPtr j,uint c);
 [DllImport("kernel32",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr l,int n,int f,ref IntPtr s);
 [DllImport("kernel32",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr l,uint f,IntPtr a,IntPtr v,IntPtr s,IntPtr p,IntPtr r);
 [DllImport("kernel32")] static extern void DeleteProcThreadAttributeList(IntPtr l);
 [DllImport("kernel32",SetLastError=true)] static extern uint ResumeThread(IntPtr h);
 [DllImport("kernel32",SetLastError=true)] static extern uint WaitForMultipleObjects(uint n,IntPtr[] h,bool all,uint ms);
 [DllImport("kernel32",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
 [DllImport("kernel32",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr h,out uint c);
 [DllImport("kernel32",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateFileW(string n,uint a,uint s,IntPtr sa,uint c,uint f,IntPtr t);
 [DllImport("kernel32",SetLastError=true)] static extern bool SetHandleInformation(IntPtr h,uint m,uint f);
 [DllImport("kernel32",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr j,int c,IntPtr i,uint l,IntPtr r);
 [DllImport("kernel32")] static extern bool CloseHandle(IntPtr h);
 static void Check(bool ok,string what) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error(),what); }
 static uint Active(IntPtr job) { int size=Marshal.SizeOf(typeof(BA)); IntPtr info=Marshal.AllocHGlobal(size); try { Check(QueryInformationJobObject(job,1,info,(uint)size,IntPtr.Zero),"QueryInformationJobObject"); return ((BA)Marshal.PtrToStructure(info,typeof(BA))).active; } finally { Marshal.FreeHGlobal(info); } }
 static bool Empty(IntPtr job,long deadline) { while(Active(job)!=0) { long remaining=deadline-DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); if(remaining<=0)return false; Thread.Sleep((int)Math.Min(10,remaining)); } return true; }
 static bool TerminateAndDrain(IntPtr job,long deadline) { try { if(!TerminateJobObject(job,125))return false; return Empty(job,deadline); } catch { return false; } }
 static bool EnsureEmpty(IntPtr job,long deadline) { try { return Active(job)==0 || TerminateAndDrain(job,deadline); } catch { return false; } }
 static void Frame(StreamWriter writer,string kind,string nonce,long deadline) { writer.WriteLine(kind+" "+nonce+" "+deadline); }
 static IntPtr NullHandle(uint access) { IntPtr handle=CreateFileW("NUL",access,FILE_SHARE_READ|FILE_SHARE_WRITE,IntPtr.Zero,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,IntPtr.Zero); if(handle==INVALID_HANDLE_VALUE)throw new Win32Exception(Marshal.GetLastWin32Error(),"CreateFileW"); Check(SetHandleInformation(handle,HANDLE_FLAG_INHERIT,HANDLE_FLAG_INHERIT),"SetHandleInformation"); return handle; }
 static string ReadFrame(StreamReader reader,long deadline) { Task<string> task=reader.ReadLineAsync(); while(!task.IsCompleted) { long remaining=deadline-DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); if(remaining<=0)return null; Thread.Sleep((int)Math.Min(10,remaining)); } return task.Result; }
 static int Terminated(StreamReader reader,StreamWriter writer,IntPtr job,string nonce,long deadline) { bool empty=TerminateAndDrain(job,deadline); if(empty)Frame(writer,"TERMINATED",nonce,deadline); reader.Dispose(); writer.Dispose(); return 125; }
 public static int Run(string exe,string cmd,string cwd,string environmentB64,string pipe,string nonce,long deadline,uint parentPid) {
  IntPtr job=IntPtr.Zero,info=IntPtr.Zero,list=IntPtr.Zero,value=IntPtr.Zero,handles=IntPtr.Zero,environment=IntPtr.Zero,parent=IntPtr.Zero,hin=IntPtr.Zero,hout=IntPtr.Zero,herr=IntPtr.Zero; bool initialized=false,drained=false; PI pi=new PI();
  try {
   if(!System.Text.RegularExpressions.Regex.IsMatch(nonce,"^[a-f0-9]{64}$") || deadline<=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())return 125;
   parent=OpenProcess(SYNCHRONIZE,false,parentPid); if(parent==IntPtr.Zero)return 125;
   using(var control=new NamedPipeClientStream(".",pipe,PipeDirection.InOut,PipeOptions.None)) {
    int connectMs=(int)Math.Min(5000,Math.Max(1,deadline-DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())); control.Connect(connectMs);
    var reader=new StreamReader(control,new UTF8Encoding(false),false,512,true); var writer=new StreamWriter(control,new UTF8Encoding(false),512,true); writer.NewLine="\n"; writer.AutoFlush=true;
    Frame(writer,"READY",nonce,deadline);
    if(ReadFrame(reader,deadline)!="ACK "+nonce+" "+deadline)return 125;
    job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"CreateJobObject");
    EL limits=new EL(); limits.basic.flags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; int size=Marshal.SizeOf(typeof(EL)); info=Marshal.AllocHGlobal(size); Marshal.StructureToPtr(limits,info,false); Check(SetInformationJobObject(job,9,info,(uint)size),"SetInformationJobObject");
    IntPtr listSize=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref listSize); if(listSize==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error(),"InitializeProcThreadAttributeList");
    list=Marshal.AllocHGlobal(listSize); Check(InitializeProcThreadAttributeList(list,2,0,ref listSize),"InitializeProcThreadAttributeList"); initialized=true;
    value=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(value,job); Check(UpdateProcThreadAttribute(list,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,value,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"UpdateProcThreadAttribute");
    hin=NullHandle(GENERIC_READ); hout=NullHandle(GENERIC_WRITE); herr=NullHandle(GENERIC_WRITE); handles=Marshal.AllocHGlobal(IntPtr.Size*3); Marshal.WriteIntPtr(handles,0,hin); Marshal.WriteIntPtr(handles,IntPtr.Size,hout); Marshal.WriteIntPtr(handles,IntPtr.Size*2,herr); Check(UpdateProcThreadAttribute(list,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,handles,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero),"UpdateProcThreadAttribute");
    byte[] environmentBytes=Convert.FromBase64String(environmentB64); if(environmentBytes.Length<4 || environmentBytes.Length%2!=0 || environmentBytes[environmentBytes.Length-1]!=0 || environmentBytes[environmentBytes.Length-2]!=0)throw new ArgumentException("environment");
    environment=Marshal.AllocHGlobal(environmentBytes.Length); Marshal.Copy(environmentBytes,0,environment,environmentBytes.Length);
    SIX startup=new SIX(); startup.si.cb=Marshal.SizeOf(typeof(SIX)); startup.si.flags=STARTF_USESTDHANDLES; startup.si.hin=hin; startup.si.hout=hout; startup.si.herr=herr; startup.attributes=list;
    Frame(writer,"CONTAINED",nonce,deadline);
    string instruction=ReadFrame(reader,deadline);
    if(instruction!="RUN "+nonce+" "+deadline)return Terminated(reader,writer,job,nonce,deadline);
    if(deadline<=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())return Terminated(reader,writer,job,nonce,deadline);
    Check(CreateProcessW(exe,new StringBuilder(cmd),IntPtr.Zero,IntPtr.Zero,true,CREATE_NO_WINDOW|CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|EXTENDED_STARTUPINFO_PRESENT,environment,cwd,ref startup,out pi),"CreateProcessW");
    if(ResumeThread(pi.thread)==0xffffffff)throw new Win32Exception(Marshal.GetLastWin32Error(),"ResumeThread");
    CloseHandle(pi.thread); pi.thread=IntPtr.Zero;
    Frame(writer,"STARTED",nonce,deadline);
    ControlState state=new ControlState(); Thread listener=new Thread(()=>{ try { using(var input=new StreamReader(Console.OpenStandardInput(),new UTF8Encoding(false),false,128)) { state.terminate=input.ReadLine()!=""; } } catch { state.terminate=true; } }); listener.IsBackground=true; listener.Start();
    for(;;) {
     long remaining=deadline-DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); if(remaining<=0)return Terminated(reader,writer,job,nonce,deadline);
     if(state.terminate)return Terminated(reader,writer,job,nonce,deadline);
     uint wait=WaitForMultipleObjects(2,new IntPtr[]{parent,pi.process},false,(uint)Math.Min(25,remaining));
     if(wait==WAIT_TIMEOUT)continue;
     if(wait!=WAIT_OBJECT_0+1)return Terminated(reader,writer,job,nonce,deadline);
     uint code; if(!GetExitCodeProcess(pi.process,out code))return Terminated(reader,writer,job,nonce,deadline);
     drained=EnsureEmpty(job,deadline); if(!drained)return 125;
     if(state.terminate)return Terminated(reader,writer,job,nonce,deadline);
     Frame(writer,"COMPLETE",nonce,deadline);
     return unchecked((int)code);
    }
   }
  } catch { if(job!=IntPtr.Zero)drained=TerminateAndDrain(job,deadline); return 125; }
  finally { if(job!=IntPtr.Zero&&!drained)TerminateAndDrain(job,deadline); if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread); if(pi.process!=IntPtr.Zero)CloseHandle(pi.process); if(hin!=IntPtr.Zero)CloseHandle(hin); if(hout!=IntPtr.Zero)CloseHandle(hout); if(herr!=IntPtr.Zero)CloseHandle(herr); if(parent!=IntPtr.Zero)CloseHandle(parent); if(initialized)DeleteProcThreadAttributeList(list); if(handles!=IntPtr.Zero)Marshal.FreeHGlobal(handles); if(value!=IntPtr.Zero)Marshal.FreeHGlobal(value); if(list!=IntPtr.Zero)Marshal.FreeHGlobal(list); if(info!=IntPtr.Zero)Marshal.FreeHGlobal(info); if(environment!=IntPtr.Zero)Marshal.FreeHGlobal(environment); if(job!=IntPtr.Zero)CloseHandle(job); }
 }
}
'@
Add-Type -TypeDefinition $source -Language CSharp
function Decode([string]$name) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((Get-Item ("Env:"+$name)).Value)) }
$exe=Decode 'TRANSCRIPT_JOB_EXECUTABLE_B64'
$cmd=Decode 'TRANSCRIPT_JOB_COMMAND_LINE_B64'
$cwd=Decode 'TRANSCRIPT_JOB_CWD_B64'
$pipe=Decode 'TRANSCRIPT_JOB_CONTROL_PIPE_B64'
$nonce=$env:TRANSCRIPT_JOB_CONTROL_NONCE
$deadline=[Int64]$env:TRANSCRIPT_JOB_CONTROL_DEADLINE
$parentPid=[UInt32]$env:TRANSCRIPT_JOB_PARENT_PID
$environmentB64=$env:TRANSCRIPT_JOB_ENVIRONMENT_B64
Remove-Item Env:TRANSCRIPT_JOB_EXECUTABLE_B64,Env:TRANSCRIPT_JOB_COMMAND_LINE_B64,Env:TRANSCRIPT_JOB_CWD_B64,Env:TRANSCRIPT_JOB_CONTROL_PIPE_B64,Env:TRANSCRIPT_JOB_CONTROL_NONCE,Env:TRANSCRIPT_JOB_CONTROL_DEADLINE,Env:TRANSCRIPT_JOB_PARENT_PID,Env:TRANSCRIPT_JOB_ENVIRONMENT_B64 -ErrorAction SilentlyContinue
try { exit [TranscriptJob]::Run($exe,$cmd,$cwd,$environmentB64,$pipe,$nonce,$deadline,$parentPid) } catch { exit 125 }
`;

const WINDOWS_JOB_SUPERVISOR_BOOTSTRAP = String.raw`
$ErrorActionPreference='Stop'
$encoded=$env:TRANSCRIPT_JOB_SCRIPT_GZIP_B64
Remove-Item Env:TRANSCRIPT_JOB_SCRIPT_GZIP_B64 -ErrorAction SilentlyContinue
if(-not $encoded){exit 125}
$compressed=[Convert]::FromBase64String($encoded)
$inputStream=[IO.MemoryStream]::new($compressed,$false)
$gzip=[IO.Compression.GzipStream]::new($inputStream,[IO.Compression.CompressionMode]::Decompress)
$reader=[IO.StreamReader]::new($gzip,[Text.Encoding]::UTF8,$true)
try{$script=$reader.ReadToEnd()}finally{$reader.Dispose();$gzip.Dispose();$inputStream.Dispose()}
& ([ScriptBlock]::Create($script))
`;

function quoteWindowsCreateProcessArgument(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw fixedError('TRANSCRIPT_YTDLP_SPAWN_FAILED');
  if (!value || /[\s"]/.test(value)) {
    let quoted = '"';
    let slashes = 0;
    for (const character of value) {
      if (character === '\\') {
        slashes += 1;
      } else if (character === '"') {
        quoted += '\\'.repeat(slashes * 2 + 1) + '"';
        slashes = 0;
      } else {
        quoted += '\\'.repeat(slashes) + character;
        slashes = 0;
      }
    }
    return quoted + '\\'.repeat(slashes * 2) + '"';
  }
  return value;
}

function buildWindowsEnvironmentBlock(environment) {
  const entries = new Map();
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value !== 'string' || !/^[^=\0]+$/.test(key) || value.includes('\0')) {
      throw fixedError('TRANSCRIPT_YTDLP_SPAWN_FAILED');
    }
    const folded = key.toUpperCase();
    if (!entries.has(folded)) entries.set(folded, [key, value]);
  }
  const block = [...entries.values()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\0');
  return Buffer.from(`${block}\0\0`, 'utf16le').toString('base64');
}

function windowsJobSupervisorSpec(invocation, environment, pipeName, nonce, deadline) {
  const encode = (value) => Buffer.from(value, 'utf8').toString('base64');
  const commandLine = [
    quoteWindowsCreateProcessArgument(invocation.executable),
    ...invocation.args.map(quoteWindowsCreateProcessArgument),
  ].join(' ');
  return {
    executable: WINDOWS_POWERSHELL,
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-OutputFormat',
      'Text',
      '-EncodedCommand',
      Buffer.from(WINDOWS_JOB_SUPERVISOR_BOOTSTRAP, 'utf16le').toString('base64'),
    ],
    environment: {
      SystemRoot: 'C:\\Windows',
      ComSpec: `${WINDOWS_SYSTEM32}\\cmd.exe`,
      TRANSCRIPT_JOB_SCRIPT_GZIP_B64: gzipSync(
        Buffer.from(WINDOWS_JOB_SUPERVISOR_SCRIPT, 'utf8'),
      ).toString('base64'),
      TRANSCRIPT_JOB_EXECUTABLE_B64: encode(invocation.executable),
      TRANSCRIPT_JOB_COMMAND_LINE_B64: encode(commandLine),
      TRANSCRIPT_JOB_CWD_B64: encode(process.cwd()),
      TRANSCRIPT_JOB_CONTROL_PIPE_B64: encode(pipeName),
      TRANSCRIPT_JOB_CONTROL_NONCE: nonce,
      TRANSCRIPT_JOB_CONTROL_DEADLINE: String(deadline),
      TRANSCRIPT_JOB_PARENT_PID: String(process.pid),
      TRANSCRIPT_JOB_ENVIRONMENT_B64: buildWindowsEnvironmentBlock(environment),
    },
  };
}

function runPosixTranscriptYtDlp(invocation, {
  timeoutMs,
  spawnImpl,
  signal,
}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const executionDeadline = deadline - Math.min(
      PROCESS_TREE_CLEANUP_RESERVE_MS,
      Math.floor(timeoutMs / 3),
    );
    let child;
    let timer;
    let settled = false;
    let closeObserved = false;
    let terminationReason = null;
    let terminationComplete = false;
    let treeGone = false;
    let drainStarted = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const errorForReason = (reason) => {
      if (reason === 'timeout') return fixedError('TRANSCRIPT_YTDLP_TIMEOUT');
      if (reason === 'aborted') return fixedError('TRANSCRIPT_YTDLP_ABORTED');
      if (reason === 'spawn_error') return fixedError('TRANSCRIPT_YTDLP_SPAWN_FAILED');
      if (reason === 'failed') return fixedError('TRANSCRIPT_YTDLP_FAILED');
      return fixedError('TRANSCRIPT_YTDLP_TREE_CLEANUP_FAILED');
    };
    const finishTerminationWhenReady = () => {
      if (!terminationComplete || !closeObserved) return;
      if (!treeGone) {
        finish(fixedError('TRANSCRIPT_YTDLP_TREE_CLEANUP_FAILED'));
      } else {
        finish(terminationReason === 'normal_cleanup' ? null : errorForReason(terminationReason));
      }
    };
    const terminate = (reason) => {
      if (settled || terminationReason !== null) return;
      terminationReason = reason;
      void (async () => {
        if (!hasValidProcessId(child?.pid)) return true;
        return terminatePosixProcessTree(child.pid, deadline);
      })().then((gone) => {
        treeGone = gone;
      }).catch(() => {
        treeGone = false;
      }).finally(() => {
        terminationComplete = true;
        finishTerminationWhenReady();
      });
    };
    const verifyNormalExit = () => {
      if (drainStarted || settled || terminationReason !== null) return;
      drainStarted = true;
      if (isPosixProcessGroupGone(child.pid)) {
        finish();
      } else {
        terminate('normal_cleanup');
      }
    };
    const abort = () => terminate('aborted');

    try {
      child = spawnImpl(invocation.executable, invocation.args, {
        shell: false,
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
        env: buildChildEnvironment(),
      });
    } catch {
      finish(fixedError('TRANSCRIPT_YTDLP_SPAWN_FAILED'));
      return;
    }

    child.once('error', () => {
      closeObserved = true;
      terminate('spawn_error');
    });
    child.once('close', (code) => {
      closeObserved = true;
      if (terminationReason !== null) {
        finishTerminationWhenReady();
      } else if (code === 0) {
        verifyNormalExit();
      } else {
        terminate('failed');
      }
    });
    timer = setTimeout(() => terminate('timeout'), Math.max(0, executionDeadline - Date.now()));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function runWindowsTranscriptYtDlp(invocation, {
  timeoutMs,
  spawnImpl,
  signal,
}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const executionDeadline = deadline - Math.min(
      PROCESS_TREE_CLEANUP_RESERVE_MS,
      Math.floor(timeoutMs / 3),
    );
    const nonce = randomBytes(32).toString('hex');
    const pipeName = `transcript-job-${nonce}`;
    const pipePath = `\\\\.\\pipe\\${pipeName}`;
    const environment = buildChildEnvironment();
    const launch = windowsJobSupervisorSpec(invocation, environment, pipeName, nonce, deadline);
    const server = createServer();
    let child;
    let socket;
    let executionTimer;
    let forceTimer;
    let cleanupTimer;
    let cleanupDeadline = null;
    let settled = false;
    let helperClosed = false;
    let helperCode = null;
    let phase = 'waiting';
    let terminal = null;
    let terminationReason = null;
    let targetMayHaveLaunched = false;
    let supervisorForceRequested = false;

    const errorForReason = (reason) => {
      if (reason === 'timeout') return fixedError('TRANSCRIPT_YTDLP_TIMEOUT');
      if (reason === 'aborted') return fixedError('TRANSCRIPT_YTDLP_ABORTED');
      if (reason === 'spawn_error') return fixedError('TRANSCRIPT_YTDLP_SPAWN_FAILED');
      if (reason === 'failed') return fixedError('TRANSCRIPT_YTDLP_FAILED');
      return fixedError('TRANSCRIPT_YTDLP_TREE_CLEANUP_FAILED');
    };
    const clearTimers = () => {
      clearTimeout(executionTimer);
      clearTimeout(forceTimer);
      clearTimeout(cleanupTimer);
    };
    const removeListeners = () => {
      signal?.removeEventListener('abort', abort);
      child?.removeListener('error', onChildError);
      child?.removeListener('close', onChildClose);
      server.removeListener('error', onServerError);
      server.removeListener('listening', launchSupervisor);
      server.removeListener('connection', onConnection);
      socket?.removeListener('data', onSocketData);
      socket?.removeListener('error', onSocketError);
      socket?.removeListener('end', onSocketEnd);
    };
    const closeLocalHandles = () => {
      try {
        child?.stdin?.destroy();
        socket?.destroy();
        server.close();
      } catch {
        // Local control cleanup never exposes provider diagnostics.
      }
      if (!helperClosed) {
        try {
          child?.unref?.();
        } catch {
          // A failed unref cannot expose provider diagnostics.
        }
      }
    };
    const forceSupervisorTermination = () => {
      if (helperClosed || supervisorForceRequested) return;
      supervisorForceRequested = true;
      try {
        child?.stdin?.destroy();
      } catch {
        // Forced supervisor termination uses the direct child handle only.
      }
      try {
        child?.kill?.('SIGKILL');
      } catch {
        // The bounded cleanup deadline returns a fixed error if this cannot close.
      }
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      removeListeners();
      if (!helperClosed) forceSupervisorTermination();
      closeLocalHandles();
      if (error) reject(error);
      else resolve();
    };
    const finishAfterHelperExit = () => {
      if (!helperClosed || settled) return;
      if (terminal === 'complete') {
        if (!targetMayHaveLaunched) {
          finish(fixedError('TRANSCRIPT_YTDLP_TREE_CLEANUP_FAILED'));
        } else if (terminationReason !== null) {
          finish(errorForReason(terminationReason));
        } else if (helperCode === 0) {
          finish();
        } else {
          finish(errorForReason('failed'));
        }
      } else if (terminal === 'terminated') {
        finish(errorForReason(terminationReason ?? 'tree_cleanup'));
      } else if (!targetMayHaveLaunched) {
        finish(errorForReason(terminationReason ?? 'spawn_error'));
      } else {
        finish(fixedError('TRANSCRIPT_YTDLP_TREE_CLEANUP_FAILED'));
      }
    };
    const send = (frame) => {
      if (!socket || socket.destroyed || !socket.writable) return false;
      try {
        socket.write(`${frame} ${nonce} ${deadline}\n`);
        return true;
      } catch {
        return false;
      }
    };
    const requestSupervisorTermination = () => {
      if (!child?.stdin || child.stdin.destroyed) return false;
      try {
        child.stdin.write('TERMINATE\n');
        return true;
      } catch {
        return false;
      }
    };
    const cleanupExpired = () => {
      if (settled) return;
      forceSupervisorTermination();
      if (helperClosed) {
        finishAfterHelperExit();
      } else {
        finish(fixedError('TRANSCRIPT_YTDLP_TREE_CLEANUP_FAILED'));
      }
    };
    const beginTermination = (reason) => {
      if (settled || terminationReason !== null) return;
      terminationReason = reason;
      cleanupDeadline = Math.min(
        deadline,
        Date.now() + WINDOWS_SUPERVISOR_CLEANUP_DEADLINE_MS,
      );
      const remaining = remainingDeadlineMs(cleanupDeadline);
      const requested = targetMayHaveLaunched && (
        phase === 'contained'
          ? send('TERMINATE')
          : phase === 'started' && requestSupervisorTermination()
      );
      const forceDelay = !targetMayHaveLaunched || !requested
        ? 0
        : Math.min(WINDOWS_SUPERVISOR_FORCE_GRACE_MS, remaining);
      forceTimer = setTimeout(forceSupervisorTermination, forceDelay);
      cleanupTimer = setTimeout(cleanupExpired, remaining);
    };
    const terminate = (reason) => beginTermination(reason);
    const protocolFailure = () => {
      if (settled || terminal !== null) return;
      beginTermination('tree_cleanup');
    };
    const abort = () => terminate('aborted');
    const onChildError = () => {
      if (!hasValidProcessId(child?.pid)) {
        finish(errorForReason('spawn_error'));
      } else {
        protocolFailure();
      }
    };
    const onChildClose = (code) => {
      helperClosed = true;
      helperCode = code;
      finishAfterHelperExit();
    };
    const launchSupervisor = () => {
      if (settled || terminationReason !== null) return;
      try {
        child = spawnImpl(launch.executable, launch.args, {
          shell: false,
          windowsHide: true,
          detached: false,
          stdio: ['pipe', 'ignore', 'ignore'],
          env: launch.environment,
        });
      } catch {
        finish(errorForReason('spawn_error'));
        return;
      }
      child.once('error', onChildError);
      child.once('close', onChildClose);
    };
    const onServerError = () => {
      if (child) protocolFailure();
      else finish(errorForReason('spawn_error'));
    };
    const onSocketData = (chunk) => {
      frames += chunk;
      if (frames.length > 512) {
        protocolFailure();
        return;
      }
      const pending = frames.split('\n');
      frames = pending.pop();
      for (const frame of pending) {
        if (phase === 'waiting' && frame === `READY ${nonce} ${deadline}`) {
          phase = 'ready';
          if (!send('ACK')) protocolFailure();
        } else if (phase === 'ready' && frame === `CONTAINED ${nonce} ${deadline}`) {
          phase = 'contained';
          if (terminationReason === null) {
            targetMayHaveLaunched = true;
            if (!send('RUN')) protocolFailure();
          } else if (!send('TERMINATE')) {
            protocolFailure();
          }
        } else if (phase === 'contained' && frame === `STARTED ${nonce} ${deadline}`) {
          phase = 'started';
        } else if (
          (phase === 'contained' || phase === 'started')
          && frame === `TERMINATED ${nonce} ${deadline}`
        ) {
          terminal = 'terminated';
          clearTimeout(executionTimer);
          clearTimeout(forceTimer);
          socket.end();
        } else if (phase === 'started' && frame === `COMPLETE ${nonce} ${deadline}`) {
          terminal = 'complete';
          clearTimeout(executionTimer);
          clearTimeout(forceTimer);
          socket.end();
        } else {
          protocolFailure();
        }
      }
    };
    const onSocketError = () => protocolFailure();
    const onSocketEnd = () => {
      if (frames || terminal === null) protocolFailure();
    };
    let frames = '';
    const onConnection = (candidate) => {
      if (socket || settled) {
        candidate.destroy();
        protocolFailure();
        return;
      }
      socket = candidate;
      socket.setEncoding('utf8');
      socket.on('data', onSocketData);
      socket.once('error', onSocketError);
      socket.once('end', onSocketEnd);
    };

    server.once('error', onServerError);
    server.once('listening', launchSupervisor);
    server.on('connection', onConnection);
    executionTimer = setTimeout(
      () => terminate('timeout'),
      Math.max(0, executionDeadline - Date.now()),
    );
    signal?.addEventListener('abort', abort, { once: true });
    server.listen(pipePath);
    if (signal?.aborted) abort();
  });
}

export function runTranscriptYtDlp(invocation, {
  timeoutMs = 120_000,
  spawnImpl = spawn,
  signal,
} = {}) {
  const boundedTimeout = Number(timeoutMs);
  if (!Number.isSafeInteger(boundedTimeout) || boundedTimeout < 1_000 || boundedTimeout > MAX_COMMAND_TIMEOUT_MS) {
    return Promise.reject(fixedError('TRANSCRIPT_TIMEOUT_INVALID'));
  }
  if (signal?.aborted) return Promise.reject(fixedError('TRANSCRIPT_YTDLP_ABORTED'));
  if (!invocation || typeof invocation.executable !== 'string' || !Array.isArray(invocation.args)) {
    return Promise.reject(fixedError('TRANSCRIPT_YTDLP_SPAWN_FAILED'));
  }
  if (process.platform === 'win32') {
    return runWindowsTranscriptYtDlp(invocation, {
      timeoutMs: boundedTimeout,
      spawnImpl,
      signal,
    });
  }
  return runPosixTranscriptYtDlp(invocation, {
    timeoutMs: boundedTimeout,
    spawnImpl,
    signal,
  });
}
