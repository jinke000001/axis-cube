import { spawn } from 'node:child_process';
import { defaultCandidatePath, verifyFrozenCandidate } from './mobile-candidate.mjs';

const args = process.argv.slice(2);
let candidate = defaultCandidatePath;
let versionCode = '1';
for (let index = 0; index < args.length; index += 2) {
  const option = args[index];
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}.`);
  if (option === '--candidate') candidate = value;
  else if (option === '--version-code') versionCode = value;
  else throw new Error(`Unknown release option: ${option}`);
}
if (!/^\d+$/.test(versionCode) || !Number.isSafeInteger(Number(versionCode)) || Number(versionCode) < 1) throw new Error('Version code must be a positive integer.');
if (process.env.AXIS_MOBILE_PROBE) throw new Error('Unset AXIS_MOBILE_PROBE before building a product release.');
await verifyFrozenCandidate(candidate);

async function run(script, scriptArgs) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...scriptArgs], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0) throw new Error(`Release step failed with exit code ${code}.`);
}
await run('node_modules/@capacitor/cli/bin/capacitor', ['sync', 'android']);
await run('src/platform/build-android.mjs', ['--release', '--candidate', candidate, '--version-code', versionCode]);
