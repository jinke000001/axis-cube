import { randomBytes, X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, writeFile, readFile, chmod, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const base = join(homedir(), '.local/share/axis-mobile');
export const signingDirectory = join(base, 'signing');
const filename = 'axis-release.p12';
const alias = 'axis-release';

async function assertPrivate(path, directory) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) throw new Error('Signing storage must be a regular private file or directory.');
  if (process.getuid && info.uid !== process.getuid()) throw new Error('Signing storage must belong to the current user.');
  if ((info.mode & 0o077) !== 0) throw new Error('Signing storage grants access to other users; expected directory 700 / files 600.');
}
function keytool() {
  const java = process.env.JAVA_HOME || '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
  const binary = join(java, 'bin/keytool');
  if (!existsSync(binary)) throw new Error('Set JAVA_HOME to a JDK with keytool.');
  return binary;
}
async function fingerprint(directory, secret) {
  let certificate;
  try {
    ({ stdout: certificate } = await exec(keytool(), ['-exportcert', '-keystore', join(directory, filename), '-alias', alias, '-storepass:env', 'AXIS_KEYTOOL_PASSWORD'], {
      env: { ...process.env, AXIS_KEYTOOL_PASSWORD: secret }, encoding: 'buffer', timeout: 30_000,
    }));
  } catch { throw new Error('Unable to validate the private release signing certificate.'); }
  return new X509Certificate(certificate).fingerprint256;
}

export async function loadSigningMaterial() {
  await assertPrivate(base, true);
  await assertPrivate(signingDirectory, true);
  await assertPrivate(join(signingDirectory, filename), false);
  await assertPrivate(join(signingDirectory, 'credentials.json'), false);
  let material;
  try { material = JSON.parse(await readFile(join(signingDirectory, 'credentials.json'), 'utf8')); }
  catch { throw new Error('Private signing record could not be read.'); }
  if (material.alias !== alias || typeof material.storePassword !== 'string' || material.storePassword.length < 32 || material.keyPassword !== material.storePassword) throw new Error('Invalid private signing record.');
  return { ...material, keystore: join(signingDirectory, filename), certificateSha256: await fingerprint(signingDirectory, material.storePassword) };
}

export async function createSigningMaterial() {
  await mkdir(base, { recursive: true, mode: 0o700 });
  await assertPrivate(base, true);
  if (existsSync(signingDirectory)) {
    const existing = await loadSigningMaterial();
    console.log(JSON.stringify({ reused: true, directory: signingDirectory, certificateSha256: existing.certificateSha256 }));
    return;
  }
  // A fresh private staging directory avoids publishing an incomplete identity.
  // Failed/interrupted staging is retained for recovery; no existing key is deleted.
  const staging = await mkdtemp(join(base, 'signing-pending-'));
  await chmod(staging, 0o700);
  const secret = randomBytes(32).toString('base64url');
  await writeFile(join(staging, 'credentials.json'), JSON.stringify({ alias, storePassword: secret, keyPassword: secret, createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  try {
    await exec(keytool(), ['-genkeypair', '-alias', alias, '-keyalg', 'RSA', '-keysize', '3072', '-sigalg', 'SHA256withRSA', '-validity', '10000', '-dname', 'CN=AXIS Private Trial', '-keystore', join(staging, filename), '-storetype', 'PKCS12', '-storepass:env', 'AXIS_KEYTOOL_PASSWORD', '-keypass:env', 'AXIS_KEYTOOL_PASSWORD', '-noprompt'], {
      env: { ...process.env, AXIS_KEYTOOL_PASSWORD: secret }, timeout: 60_000,
    });
  } catch { throw new Error('Release key generation failed. Private staging was retained; no existing key was overwritten.'); }
  await chmod(join(staging, filename), 0o600);
  const certificateSha256 = await fingerprint(staging, secret);
  // rename refuses to replace a nonempty existing signing directory if another
  // creator won the race. Its key remains authoritative.
  await rename(staging, signingDirectory);
  console.log(JSON.stringify({ reused: false, directory: signingDirectory, certificateSha256 }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await createSigningMaterial();
