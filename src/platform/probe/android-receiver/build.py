"""Build a local share receiver with official SDK tools; never bundled in AXIS."""
import os
import pathlib
import shutil
import subprocess
import zipfile

source = pathlib.Path(__file__).resolve().parent
cache = pathlib.Path.home() / 'Library/Caches/axis-mobile'
work = cache / 'share-receiver'
work.mkdir(parents=True, exist_ok=True)
sdk = pathlib.Path(os.environ.get('ANDROID_HOME', cache / 'android-sdk'))
java = pathlib.Path(os.environ.get('JAVA_HOME', '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home'))
tools = sdk / 'build-tools/36.0.0'
android = sdk / 'platforms/android-36/android.jar'
env = {**os.environ, 'JAVA_HOME': str(java)}
def run(args):
    subprocess.run(list(map(str, args)), env=env, check=True)
classes = work / 'classes'; classes.mkdir(exist_ok=True)
run([java/'bin/javac', '-source', '8', '-target', '8', '-classpath', android, '-d', classes, source/'ReceiverActivity.java'])
dex = work/'dex'; dex.mkdir(exist_ok=True)
run([tools/'d8', '--lib', android, '--min-api', '29', '--output', dex, *classes.rglob('*.class')])
run([tools/'aapt2', 'link', '--manifest', source/'AndroidManifest.xml', '-I', android, '-o', work/'unsigned.apk'])
with zipfile.ZipFile(work/'unsigned.apk', 'a') as archive:
    archive.write(dex/'classes.dex', 'classes.dex')
run([tools/'zipalign', '-f', '4', work/'unsigned.apk', work/'aligned.apk'])
key = work/'test-only.p12'
env['AXIS_TEST_KEY_PASSWORD'] = 'android'
if not key.exists():
    run([java/'bin/keytool', '-genkeypair', '-keystore', key, '-storepass:env', 'AXIS_TEST_KEY_PASSWORD', '-keypass:env', 'AXIS_TEST_KEY_PASSWORD', '-alias', 'local-test', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '365', '-dname', 'CN=AXIS Local Test Only'])
run([tools/'apksigner', 'sign', '--ks', key, '--ks-key-alias', 'local-test', '--ks-pass', 'env:AXIS_TEST_KEY_PASSWORD', '--out', work/'axis-local-receiver.apk', work/'aligned.apk'])
run([tools/'apksigner', 'verify', work/'axis-local-receiver.apk'])
print(work/'axis-local-receiver.apk')
