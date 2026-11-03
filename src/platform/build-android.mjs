import { existsSync, constants } from 'node:fs';
import { readFile, mkdir, copyFile, mkdtemp, writeFile, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadSigningMaterial } from './signing.mjs';
import { defaultCandidatePath, verifyFrozenCandidate } from './mobile-candidate.mjs';

const exec = promisify(execFile);
const release = process.argv.includes('--release');
const versionIndex = process.argv.indexOf('--version-code');
const versionCode = versionIndex < 0 ? 1 : Number(process.argv[versionIndex + 1]);
if (!Number.isSafeInteger(versionCode) || versionCode < 1) throw new Error('Version code must be a positive integer.');
const candidateIndex = process.argv.indexOf('--candidate');
const candidatePath = candidateIndex < 0 ? defaultCandidatePath : process.argv[candidateIndex + 1];

const cache = join(homedir(), 'Library/Caches/axis-mobile');
const env = { ...process.env };
const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || join(cache, 'android-sdk');
if (!existsSync(join(sdk, 'platform-tools'))) throw new Error('Install the Android SDK or set ANDROID_HOME first.');
env.ANDROID_HOME = sdk;
env.ANDROID_USER_HOME ||= join(cache, 'android-user');
env.GRADLE_USER_HOME ||= join(cache, 'gradle');
const workspaceKey = createHash('sha256').update(resolve('.')).digest('hex').slice(0, 12);
env.AXIS_ANDROID_BUILD_ROOT ||= join(cache, `android-build-${workspaceKey}`);
const appBuildRoot = join(env.AXIS_ANDROID_BUILD_ROOT, 'app');
const localJava = '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
if (!env.JAVA_HOME && existsSync(localJava)) env.JAVA_HOME = localJava;
await mkdir(env.ANDROID_USER_HOME, { recursive: true });

const config = JSON.parse(await readFile('android/app/src/main/assets/capacitor.config.json', 'utf8'));
const probe = process.argv.includes('--probe');
if (release && probe) throw new Error('A probe must not be signed as a trial release.');
if (config.server?.url) throw new Error('Native packages must contain local web assets.');
if (probe !== config.webDir.endsWith('/probe-dist')) throw new Error('The synced assets do not match this build. Run the corresponding mobile sync first.');
if (!probe && config.webDir !== 'dist') throw new Error('Product assets must come from dist.');
const candidate = release ? await verifyFrozenCandidate(candidatePath, 'android/app/src/main/assets/public') : null;

async function stripGeneratedMetadata(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await stripGeneratedMetadata(path);
    else if (entry.name.startsWith('._') || entry.name === '.DS_Store') await unlink(path);
  }
}
// All these trees are generated native project/package inputs, not user data.
for (const directory of [
  'android/app/src/main',
  'android/capacitor-cordova-android-plugins/src/main',
  'node_modules/@capacitor/android/capacitor/src/main',
  ...['app', 'filesystem', 'preferences', 'share'].map(name => `node_modules/@capacitor/${name}/android/src/main`),
]) if (existsSync(directory)) await stripGeneratedMetadata(directory);

const exitCode = await new Promise((resolveCode, reject) => {
  const child = spawn(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['--no-daemon', '--max-workers=1', '--project-cache-dir', join(cache, `android-project-cache-${workspaceKey}`), `-PaxisVersionCode=${versionCode}`, release ? ':app:assembleRelease' : ':app:assembleDebug'], { cwd: resolve('android'), env, stdio: 'inherit' });
  child.once('error', reject); child.once('exit', resolveCode);
});
if (exitCode !== 0) process.exit(exitCode || 1);
// A new delivery may use a separate evidence folder; keep the original default.
const destination = resolve(process.env.AXIS_ANDROID_OUTPUT_DIR || 'evidence/beginner-site-2026-11-01/mobile/apk');
await mkdir(destination, { recursive: true });
if (!release) {
  const name = probe ? 'axis-capability-probe-debug.apk' : 'axis-beginner-debug.apk';
  await copyFile(join(appBuildRoot, 'outputs/apk/debug/app-debug.apk'), join(destination, name));
  console.log(`Debug APK: ${join(destination, name)} (not a release-signed trial build)`);
} else {
  await verifyFrozenCandidate(candidatePath, 'android/app/src/main/assets/public');
  // Gradle builds unsigned. Secrets are only supplied to the short-lived signing
  // process, so Gradle logs, caches, and project files never receive passwords.
  const signing = await loadSigningMaterial();
  const name = `axis-beginner-0.1.0-${versionCode}-release.apk`;
  const output = join(destination, name);
  if (existsSync(output)) throw new Error('A signed artifact already exists for this version; preserve it and use a new version code.');
  const temporary = await mkdtemp(join(cache, 'release-package-'));
  const aligned = join(temporary, 'aligned.apk');
  const signed = join(temporary, name);
  const buildTools = join(sdk, 'build-tools/36.0.0');
  await exec(join(buildTools, 'zipalign'), ['-P', '16', '-f', '4', join(appBuildRoot, 'outputs/apk/release/app-release-unsigned.apk'), aligned], { env });
  const signingEnv = { ...env, AXIS_APK_STORE_PASSWORD: signing.storePassword, AXIS_APK_KEY_PASSWORD: signing.keyPassword };
  try {
    await exec(join(buildTools, 'apksigner'), ['sign', '--ks', signing.keystore, '--ks-key-alias', signing.alias, '--ks-pass', 'env:AXIS_APK_STORE_PASSWORD', '--key-pass', 'env:AXIS_APK_KEY_PASSWORD', '--out', signed, aligned], { env: signingEnv, timeout: 60_000 });
  } catch { throw new Error('APK signing failed; no release artifact was published.'); }
  const { stdout: signature } = await exec(join(buildTools, 'apksigner'), ['verify', '--verbose', '--print-certs', signed], { env });
  const actualFingerprint = signature.match(/Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]+)/)?.[1];
  if (!actualFingerprint || actualFingerprint.toLowerCase() !== signing.certificateSha256.replaceAll(':', '').toLowerCase()) throw new Error('APK signing certificate mismatch.');
  let verification;
  try {
    const result = await exec('python3', ['src/platform/verify-apk.py', signed, candidatePath, signing.keystore], { env: { ...env, AXIS_VERIFY_SIGNING_PASSWORD: signing.storePassword } });
    verification = JSON.parse(result.stdout);
  } catch { throw new Error('Packaged content or private signing material check failed; no release artifact was published.'); }
  await verifyFrozenCandidate(candidatePath, 'android/app/src/main/assets/public');
  const apkSha256 = createHash('sha256').update(await readFile(signed)).digest('hex');
  await copyFile(signed, output, constants.COPYFILE_EXCL);
  if (createHash('sha256').update(await readFile(output)).digest('hex') !== apkSha256) throw new Error('Copied APK verification failed.');
  const metadata = { builtAt: new Date().toISOString(), appId: 'app.axis.cube', versionName: '0.1.0', versionCode, type: 'release', apkSha256, certificateSha256: signing.certificateSha256, frozenWebDigest: candidate.digest, ...verification, physicalDeviceValidated: false };
  await writeFile(output + '.json', JSON.stringify(metadata, null, 2) + '\n');
  await writeFile(output + '.signature.txt', signature);
  console.log(JSON.stringify({ releaseApk: output, ...metadata }));
}
