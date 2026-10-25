import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

export function chromeForTestingExecutable() {
  const core = path.dirname(require.resolve('playwright-core/package.json'));
  const pins = JSON.parse(readFileSync(path.join(core, 'browsers.json'), 'utf8'));
  const pin = pins.browsers.find((entry: { name: string }) => entry.name === 'chromium');
  const executable = chromium.executablePath();
  if (pin?.title !== 'Chrome for Testing' || !executable.includes(`chromium-${pin.revision}`)
    || !lstatSync(executable).isFile() || realpathSync(executable) !== executable) {
    throw new Error('CHROME_FOR_TESTING_PIN_UNVERIFIED');
  }
  if (process.platform === 'darwin') {
    const info = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.resolve(executable, '../../Info.plist')], { encoding: 'utf8' }));
    if (info.CFBundleIdentifier !== 'com.google.chrome.for.testing'
      || info.CFBundleShortVersionString !== pin.browserVersion
      || info.CFBundleExecutable !== path.basename(executable)) throw new Error('CHROME_FOR_TESTING_IDENTITY_UNVERIFIED');
  } else if (process.platform === 'win32') {
    const info = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Item -LiteralPath $env:TZUDONG_CFT_EXECUTABLE).VersionInfo | Select-Object ProductName,ProductVersion | ConvertTo-Json -Compress'], { encoding: 'utf8', env: { ...process.env, TZUDONG_CFT_EXECUTABLE: executable } }));
    if (info.ProductName !== 'Google Chrome for Testing' || info.ProductVersion !== pin.browserVersion) throw new Error('CHROME_FOR_TESTING_IDENTITY_UNVERIFIED');
  } else {
    const version = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
    if (version !== `Google Chrome for Testing ${pin.browserVersion}`) throw new Error('CHROME_FOR_TESTING_IDENTITY_UNVERIFIED');
  }
  return executable;
}
