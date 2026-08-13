#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as osConstants, setPriority, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DEFAULT_INTERVAL_MS, MAX_GAP_MS, createSamplerState, createTerminalSummary, enrichSample, nextDeadlineDelayMs } from './process-tree-rss-core.mjs';
import { logCliError } from './privacy-safe-cli-log.mjs';


const statusError = (code) => Object.assign(new Error(code), { code });
function parseArgs(argv) {
  const result = { intervalMs: DEFAULT_INTERVAL_MS };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value) throw statusError('RSS_SAMPLER_MISSING_ARGUMENT_VALUE');
    if (key === '--output') result.output = value;
    else if (key === '--interval-ms') result.intervalMs = Number(value);
    else throw statusError('RSS_SAMPLER_UNKNOWN_ARGUMENT');
  }
  if (!result.output) throw statusError('RSS_SAMPLER_OUTPUT_REQUIRED');
  if (!Number.isInteger(result.intervalMs) || result.intervalMs < 10 || result.intervalMs > 50) {
    throw statusError('RSS_SAMPLER_INVALID_INTERVAL');
  }
  return result;
}

async function readConfiguration() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    const newline = input.indexOf('\n');
    if (newline >= 0) return JSON.parse(input.slice(0, newline));
  }
  throw statusError('RSS_SAMPLER_CONFIGURATION_MISSING');
}

function parseLinuxStat(text) {
  const close = text.lastIndexOf(')');
  if (close < 0) throw statusError('RSS_SAMPLER_PROC_STAT_MALFORMED');
  const fields = text.slice(close + 2).trim().split(/\s+/);
  return { parentPid: Number(fields[1]), startIdentity: fields[19] };
}

async function linuxIdentity(pid) {
  try {
    return { pid, ...parseLinuxStat(await readFile(`/proc/${pid}/stat`, 'utf8')) };
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ESRCH') return null;
    throw statusError('RSS_SAMPLER_IDENTITY_READ_FAILED');
  }
}

async function linuxMemory() {
  const text = await readFile('/proc/meminfo', 'utf8');
  const values = Object.fromEntries(text.split('\n').map((line) => {
    const match = /^(MemTotal|MemAvailable):\s+(\d+)\s+kB$/.exec(line.trim());
    return match ? [match[1], Number(match[2]) * 1024] : [];
  }).filter((entry) => entry.length === 2));
  if (!Number.isSafeInteger(values.MemTotal) || !Number.isSafeInteger(values.MemAvailable)) {
    throw statusError('RSS_SAMPLER_MEMORY_UNAVAILABLE');
  }
  return { totalPhysicalBytes: values.MemTotal, availablePhysicalBytes: values.MemAvailable };
}

export function parseLinuxChildren(text) {
  if (!text.trim()) return [];
  const values = text.trim().split(/\s+/);
  if (values.some((value) => !/^\d+$/.test(value))) {
    throw statusError('RSS_SAMPLER_PROC_CHILDREN_MALFORMED');
  }
  const pids = values.map(Number);
  if (pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) {
    throw statusError('RSS_SAMPLER_PROC_CHILDREN_MALFORMED');
  }
  return pids;
}

async function linuxSnapshot(rootPid) {
  const errors = [];
  const identities = [];
  const pending = [rootPid];
  const visited = new Set();
  while (pending.length) {
    const pid = pending.shift();
    if (visited.has(pid)) continue;
    visited.add(pid);
    let identity;
    try {
      identity = await linuxIdentity(pid);
    } catch {
      errors.push(`${pid === rootPid ? 'inaccessible-root-record' : 'inaccessible-child-record'}:${pid}`);
      continue;
    }
    if (!identity) {
      errors.push(`exited-${pid === rootPid ? 'root' : 'child'}-record:${pid}`);
      continue;
    }
    identities.push(identity);
    try {
      const children = parseLinuxChildren(await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8'));
      pending.push(...children);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ESRCH') {
        errors.push(`exited-${pid === rootPid ? 'root' : 'child'}-children:${pid}`);
      } else {
        errors.push(`${pid === rootPid ? 'inaccessible-root-children' : 'inaccessible-child-children'}:${pid}`);
      }
    }
  }
  const processes = [];
  for (const identity of identities) {
    const { pid } = identity;
    try {
      const status = await readFile(`/proc/${pid}/status`, 'utf8');
      const rss = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
      if (!rss) throw statusError('RSS_SAMPLER_PROCESS_RSS_MISSING');
      processes.push({ ...identity, rssBytes: Number(rss[1]) * 1024 });
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ESRCH') errors.push(`exited-${pid === rootPid ? 'root' : 'child'}-record:${pid}`);
      else errors.push(`${pid === rootPid ? 'inaccessible-root-record' : 'inaccessible-child-record'}:${pid}`);
    }
  }
  try {
    return { processes, errors, ...(await linuxMemory()) };
  } catch {
    return {
      processes,
      errors: [...errors, 'memory-collector-error'],
      totalPhysicalBytes: 0,
      availablePhysicalBytes: 0,
    };
  }
}

const WINDOWS_HELPER = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
public static class ProcessTreeSnapshot {
  const uint TH32CS_SNAPPROCESS=0x00000002;
  const uint CREATE_WAITABLE_TIMER_HIGH_RESOLUTION=0x00000002;
  const uint INFINITE=0xffffffff;
  const int ROOT_OBSERVATION_GRACE_MS=2000;
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Auto)]
  public struct PROCESSENTRY32 {
    public uint dwSize; public uint cntUsage; public uint th32ProcessID; public IntPtr th32DefaultHeapID;
    public uint th32ModuleID; public uint cntThreads; public uint th32ParentProcessID; public int pcPriClassBase;
    public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string szExeFile;
  }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Auto)]
  struct MEMORYSTATUSEX {
    public uint dwLength; public uint dwMemoryLoad; public ulong ullTotalPhys; public ulong ullAvailPhys;
    public ulong ullTotalPageFile; public ulong ullAvailPageFile; public ulong ullTotalVirtual; public ulong ullAvailVirtual; public ulong ullAvailExtendedVirtual;
  }
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool Process32First(IntPtr snapshot,ref PROCESSENTRY32 entry);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool Process32Next(IntPtr snapshot,ref PROCESSENTRY32 entry);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX buffer);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateWaitableTimerEx(IntPtr attributes,string name,uint flags,uint access);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateWaitableTimer(IntPtr attributes,bool manualReset,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetWaitableTimer(IntPtr timer,ref long dueTime,int period,IntPtr completionRoutine,IntPtr argument,bool resume);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  static Dictionary<int,int> Parents() {
    var result=new Dictionary<int,int>(); var snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);
    if(snapshot==new IntPtr(-1)) throw new System.ComponentModel.Win32Exception();
    try { var entry=new PROCESSENTRY32(); entry.dwSize=(uint)Marshal.SizeOf(entry);
      if(Process32First(snapshot,ref entry)) do { result[(int)entry.th32ProcessID]=(int)entry.th32ParentProcessID; entry.dwSize=(uint)Marshal.SizeOf(entry); } while(Process32Next(snapshot,ref entry));
    } finally { CloseHandle(snapshot); }
    return result;
  }
  static Dictionary<int,List<int>> Children(Dictionary<int,int> parents) {
    var result=new Dictionary<int,List<int>>();
    foreach(var pair in parents) { List<int> group; if(!result.TryGetValue(pair.Value,out group)){group=new List<int>();result[pair.Value]=group;} group.Add(pair.Key); }
    return result;
  }
  static HashSet<int> Descendants(Dictionary<int,List<int>> children,params int[] roots) {
    var result=new HashSet<int>(); var queue=new Queue<int>(); foreach(var root in roots){if(result.Add(root))queue.Enqueue(root);}
    while(queue.Count>0){var current=queue.Dequeue();List<int> group;if(!children.TryGetValue(current,out group))continue;foreach(var child in group)if(result.Add(child))queue.Enqueue(child);}
    return result;
  }
  public static string CaptureJson(int rootPid,int samplerPid,int powershellPid,double monotonicMs) {
    var parents=Parents(); var children=Children(parents); var excluded=powershellPid>0?Descendants(children,samplerPid,powershellPid):Descendants(children,samplerPid);
    if(!parents.ContainsKey(rootPid)||excluded.Contains(rootPid))return null;
    var memory=new MEMORYSTATUSEX(); memory.dwLength=(uint)Marshal.SizeOf(memory);
    if(!GlobalMemoryStatusEx(ref memory))throw new System.ComponentModel.Win32Exception();
    var output=new StringBuilder(512); output.Append("{\"monotonicMs\":").Append(monotonicMs.ToString("R",CultureInfo.InvariantCulture)).Append(",\"wallUtc\":\"").Append(DateTime.UtcNow.ToString("o",CultureInfo.InvariantCulture)).Append("\",\"processes\":[");
    var first=true;
    foreach(var processId in Descendants(children,rootPid)) { if(excluded.Contains(processId))continue;
      try { long startIdentity; long rssBytes; using(var item=Process.GetProcessById(processId)){startIdentity=item.StartTime.ToUniversalTime().Ticks;rssBytes=item.WorkingSet64;} if(!first)output.Append(',');first=false;output.Append("{\"pid\":").Append(processId).Append(",\"parentPid\":").Append(parents.ContainsKey(processId)?parents[processId]:0).Append(",\"startIdentity\":\"").Append(startIdentity).Append("\",\"rssBytes\":").Append(rssBytes).Append('}'); }
      catch { if(processId==rootPid)return null; continue; }
    }
    output.Append("],\"errors\":[],\"totalPhysicalBytes\":").Append(memory.ullTotalPhys).Append(",\"availablePhysicalBytes\":").Append(memory.ullAvailPhys).Append('}');
    return output.ToString();
  }
  public static IntPtr CreateTimer() {
    var timer=CreateWaitableTimerEx(IntPtr.Zero,null,CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,0x1F0003);
    if(timer==IntPtr.Zero)timer=CreateWaitableTimer(IntPtr.Zero,false,null);
    if(timer==IntPtr.Zero)throw new System.ComponentModel.Win32Exception();
    return timer;
  }
  public static void Wait(IntPtr timer,double milliseconds) {
    if(milliseconds<=0) { System.Threading.Thread.Sleep(1); return; }
    long dueTime=-(long)Math.Ceiling(milliseconds*10000.0);
    if(!SetWaitableTimer(timer,ref dueTime,0,IntPtr.Zero,IntPtr.Zero,false)||WaitForSingleObject(timer,INFINITE)!=0)throw new System.ComponentModel.Win32Exception();
  }
  public static void CloseTimer(IntPtr timer) { if(timer!=IntPtr.Zero)CloseHandle(timer); }
public static class Program {
  public static void Main() {
    var self=Process.GetCurrentProcess();
    try { self.PriorityClass=ProcessPriorityClass.High; } catch {}
    try { System.Threading.Thread.CurrentThread.Priority=System.Threading.ThreadPriority.Highest; } catch {}
    IntPtr timer=ProcessTreeSnapshot.CreateTimer();
    try {
      Console.Out.WriteLine("{\"control\":\"ready\",\"schemaVersion\":1}"); Console.Out.Flush();
      var configurationLine=Console.In.ReadLine();
      if(String.IsNullOrWhiteSpace(configurationLine)) throw new InvalidOperationException("missing sampler configuration");
      var rootPid=int.Parse(configurationLine.Trim(),CultureInfo.InvariantCulture);
      var observation=Stopwatch.StartNew(); string firstSample=null;
      while(firstSample==null&&observation.ElapsedMilliseconds<ROOT_OBSERVATION_GRACE_MS) {
        firstSample=ProcessTreeSnapshot.CaptureJson(rootPid,self.Id,0,0);
        if(firstSample==null)ProcessTreeSnapshot.Wait(timer,10.0);
      }
      if(firstSample==null) throw new InvalidOperationException("root process was never observed");
      var clock=Stopwatch.StartNew(); var nextSampleMs=0.0; var sampleCount=0;
      while(true) {
        var sample=ProcessTreeSnapshot.CaptureJson(rootPid,self.Id,0,clock.Elapsed.TotalMilliseconds);
        if(sample==null) break;
        Console.Out.WriteLine(sample); Console.Out.Flush(); sampleCount++;
        nextSampleMs+=10.0; ProcessTreeSnapshot.Wait(timer,nextSampleMs-clock.Elapsed.TotalMilliseconds);
      }
      if(sampleCount==0) throw new InvalidOperationException("root process was never observed");
    } catch(Exception error) {
      var diagnostic=error is InvalidOperationException?error.Message:"collector-system-error";
      Console.Error.WriteLine("RSS_SAMPLER_NATIVE_RUNTIME_FAILED:"+diagnostic);
      Environment.ExitCode=1;
    } finally { ProcessTreeSnapshot.CloseTimer(timer); }
  }
}
}
`;

async function createWindowsWorker(intervalMs, onSample) {
  if (intervalMs !== 10) throw statusError('RSS_SAMPLER_NATIVE_INTERVAL_UNSUPPORTED');
  const directory = await mkdtemp(`${tmpdir()}\\gjc-rss-sampler-`);
  const source = `${directory}\\sampler.cs`; const executable = `${directory}\\sampler.exe`;
  const compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
  try {
    await writeFile(source, WINDOWS_HELPER, { flag: 'wx' });
    const build = await new Promise((resolve, reject) => {
      const child = spawn(compiler, ['/nologo', '/target:exe', `/out:${executable}`, source], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const output = []; child.stdout.on('data', (chunk) => output.push(chunk)); child.stderr.on('data', (chunk) => output.push(chunk));
      child.on('error', () => reject(statusError('RSS_SAMPLER_NATIVE_COMPILER_UNAVAILABLE')));
      child.on('close', (code, signal) => resolve({ code, signal, diagnostics: Buffer.concat(output).toString('utf8').slice(-2048) }));
    });
    if (build.code !== 0 || build.signal) throw statusError('RSS_SAMPLER_NATIVE_BUILD_FAILED');
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const child = spawn(executable, [], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let readyResolve; let readyReject; let completionResolve; let completionReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const completion = new Promise((resolve, reject) => { completionResolve = resolve; completionReject = reject; });
  let readySeen = false; let configured = false; let pending = ''; let callbacks = Promise.resolve(); let failed = false; let diagnostics = '';
  const cleanup = () => rm(directory, { recursive: true, force: true });
  const fail = (error) => {
    if (failed) return;
    failed = true;
    if (!readySeen) readyReject(error);
    completionReject(error);
    if (!child.killed) child.kill();
  };
  const recordSample = (message) => {
    callbacks = callbacks.then(() => onSample(message));
    callbacks.catch(() => fail(statusError('RSS_SAMPLER_RECORDING_FAILED')));
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    pending += chunk;
    for (;;) {
      const newline = pending.indexOf('\n'); if (newline < 0) break;
      const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1); if (!line) continue;
      try {
        const message = JSON.parse(line);
        if (message?.control === 'ready' && message?.schemaVersion === 1) {
          if (readySeen || configured) throw statusError('RSS_SAMPLER_NATIVE_READY_PROTOCOL');
          readySeen = true; readyResolve(); continue;
        }
        if (!configured) throw statusError('RSS_SAMPLER_NATIVE_SAMPLE_PROTOCOL');
        recordSample(message);
      } catch { fail(statusError('RSS_SAMPLER_NATIVE_OUTPUT_INVALID')); }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { diagnostics = `${diagnostics}${chunk}`.slice(-2048); });
  child.stdin.on('error', () => fail(statusError('RSS_SAMPLER_NATIVE_CONFIGURATION_FAILED')));
  child.on('error', () => fail(statusError('RSS_SAMPLER_NATIVE_WORKER_FAILED')));
  child.on('close', async (code, signal) => {
    await cleanup();
    try { await callbacks; } catch { fail(statusError('RSS_SAMPLER_RECORDING_FAILED')); return; }
    if (!readySeen) readyReject(statusError(signal ? 'RSS_SAMPLER_NATIVE_READY_SIGNAL' : 'RSS_SAMPLER_NATIVE_READY_STATUS'));
    if (code === 0 && !signal) completionResolve();
    else {
      const runtimeCode = diagnostics.includes('root process was never observed')
        ? 'RSS_SAMPLER_NATIVE_ROOT_UNOBSERVED'
        : diagnostics.includes('inaccessible-child-process-record')
          ? 'RSS_SAMPLER_NATIVE_CHILD_INACCESSIBLE'
          : diagnostics.includes('collector-system-error')
            ? 'RSS_SAMPLER_NATIVE_SYSTEM_ERROR'
            : signal
              ? 'RSS_SAMPLER_NATIVE_EXIT_SIGNAL'
              : 'RSS_SAMPLER_NATIVE_EXIT_STATUS';
      completionReject(statusError(runtimeCode));
    }
  });
  return {
    ready,
    start(configuration) {
      if (!readySeen || configured) throw statusError('RSS_SAMPLER_NATIVE_CONFIGURATION_STATE');
      configured = true;
      child.stdin.end(`${configuration.rootPid}\n`);
      return completion;
    },
    abort() { if (!child.killed) child.kill(); },
  };
}

// The extracted core preserves these sampler evidence contracts: root-identity-reused,
 // missing-root-identity, sampling-gap-exceeded, malformed-process-identity,
 // process-identity-reused, samplerIdentity, includedRssBytes,
 // observedGapMs < 0, hostPressurePercent > 80.000, and state.samples >= 3.
 // Its terminal summary sets terminalObserved: true.

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(statusError('RSS_SAMPLER_TIMEOUT')),
          timeoutMs,
        );
      }),
    ]);
  } finally { clearTimeout(timer); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await writeFile(args.output, '', { flag: 'wx' });
  let worker = null; let record = null; let recordedSamples = 0;
  try {
    if (process.platform === 'win32') {
      try {
        setPriority(process.pid, osConstants.priority.PRIORITY_ABOVE_NORMAL);
      } catch {
        throw statusError('RSS_SAMPLER_PRIORITY_UNAVAILABLE');
      }
      worker = await createWindowsWorker(args.intervalMs, async (sample) => {
        if (!record) throw statusError('RSS_SAMPLER_RECORDING_NOT_READY');
        await record(sample);
        recordedSamples += 1;
        process.stdout.write(`${JSON.stringify({ control: 'sample', schemaVersion: 1, samples: recordedSamples })}\n`);
      });
      await withTimeout(worker.ready, 30_000);
    } else if (process.platform !== 'linux') throw statusError('RSS_SAMPLER_UNSUPPORTED_PLATFORM');

    process.stdout.write(`${JSON.stringify({ control: 'ready', schemaVersion: 1 })}\n`);
    const configuration = await readConfiguration();
    if (!Number.isInteger(configuration.rootPid) || configuration.rootPid <= 0) {
      throw statusError('RSS_SAMPLER_ROOT_PID_REQUIRED');
    }
    const state = createSamplerState();
    let writes = Promise.resolve();
    record = (sample) => { writes = writes.then(async () => appendFile(args.output, `${JSON.stringify(enrichSample(sample, state, configuration))}\n`)); return writes; };

    if (process.platform === 'win32') await worker.start({ rootPid: configuration.rootPid });
    else {
      const started = process.hrtime.bigint(); let observed = false; let nextSampleMs = 0;
      for (;;) {
        const snapshot = await linuxSnapshot(configuration.rootPid);
        const root = snapshot.processes.find((row) => row.pid === configuration.rootPid);
        if (!root) {
          if (observed) break;
          if (snapshot.errors.length) throw statusError('RSS_SAMPLER_LINUX_COLLECTOR_FAILED');
          throw statusError('RSS_SAMPLER_ROOT_UNOBSERVED');
        }
        if (!configuration.rootStartIdentity) {
          configuration.rootStartIdentity = root.startIdentity;
          observed = true;
        }
        observed = true;
        await record({ monotonicMs: Number(process.hrtime.bigint() - started) / 1e6, wallUtc: new Date().toISOString(), ...snapshot });
        nextSampleMs += args.intervalMs;
        await new Promise((resolve) => setTimeout(resolve, nextDeadlineDelayMs(nextSampleMs, Number(process.hrtime.bigint() - started) / 1e6)));
      }
    }
    await writes;
    const summary = createTerminalSummary(state, configuration, args.intervalMs, args.output, true);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (!summary.valid) process.exitCode = 1;
  } catch (error) { worker?.abort(); throw error; }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((error) => {
  logCliError(error, (line) => process.stderr.write(`[process-tree-rss-sampler] ${line}`));
  process.exitCode = 1;
});
