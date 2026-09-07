import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const root = 'mobile-app/android/app/src/main/java/cz/intentsmith/companion';
const vault = read(`${root}/KeystoreVault.java`);
const policy = read(`${root}/LockPolicy.java`);
const plugin = read(`${root}/VaultPlugin.java`);
const activity = read(`${root}/MainActivity.java`);
const gradle = read('mobile-app/android/app/build.gradle');
const manifest = read('mobile-app/android/app/src/main/AndroidManifest.xml');
const client = read('src/mobile/client/app.js');
const instrumented = read('mobile-app/android/app/src/androidTest/java/cz/intentsmith/companion/KeystoreVaultInstrumentedTest.java');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

console.log('\n=== Direct AndroidKeyStore vault boundary ===');

test('the vault owns a non-exportable AES-256 key in AndroidKeyStore', () => {
  assert.match(vault, /KeyStore\.getInstance\(KEYSTORE\)/);
  assert.match(vault, /KeyGenerator\.getInstance\(KeyProperties\.KEY_ALGORITHM_AES, KEYSTORE\)/);
  assert.match(vault, /\.setKeySize\(256\)/);
  assert.match(vault, /PURPOSE_ENCRYPT\s*\|\s*KeyProperties\.PURPOSE_DECRYPT/);
});

test('AES-GCM encryption uses a provider-generated random IV and a 128-bit tag', () => {
  assert.match(vault, /AES\/GCM\/NoPadding/);
  assert.match(vault, /\.setBlockModes\(KeyProperties\.BLOCK_MODE_GCM\)/);
  assert.match(vault, /\.setRandomizedEncryptionRequired\(true\)/);
  assert.match(vault, /cipher\.init\(Cipher\.ENCRYPT_MODE, key\);[\s\S]+?cipher\.getIV\(\)/);
  assert.match(vault, /new GCMParameterSpec\(TAG_BITS, iv\)/);
  assert.match(vault, /TAG_BITS = 128/);
});

test('record identity is authenticated as AAD on encrypt and decrypt', () => {
  assert.match(vault, /getPackageName\(\) \+ "\\u0000" \+ recordName/);
  assert.equal((vault.match(/cipher\.updateAAD\(aad\(recordName\)\)/g) || []).length, 2);
});

test('ciphertext has an explicit version and strict IV/payload validation', () => {
  assert.match(vault, /return "v1\."/);
  assert.match(vault, /parts\.length != 3 \|\| !"v1"\.equals\(parts\[0\]\)/);
  assert.match(vault, /iv\.length != IV_BYTES \|\| ciphertext\.length < TAG_BITS \/ 8/);
});

test('logical groups encrypt first and then use one synchronous commit', () => {
  assert.match(vault, /Map<String, String> envelopes = new HashMap<>\(\);[\s\S]+?SharedPreferences\.Editor editor/);
  assert.match(vault, /if \(!editor\.commit\(\)\) throw new GeneralSecurityException/);
  assert.doesNotMatch(vault, /\.apply\(\)/);
  assert.doesNotMatch(policy, /\.apply\(\)/);
});

test('authentication failures are eager and make the plugin report unavailable', () => {
  assert.match(vault, /private void validateAll\(\)/);
  assert.match(vault, /decrypt\(name, \(String\) entry\.getValue\(\)\)/);
  assert.match(policy, /markUnavailable\(error\)/);
  assert.match(plugin, /result\.put\("available", LockPolicy\.available\(getContext\(\)\)\);\s*result\.put\("error"/);
  assert.match(plugin, /if \(!LockPolicy\.available\(getContext\(\)\)\) \{\s*call\.reject\("vault_unavailable"/);
});

test('cold start seals the plugin before the WebView can execute', () => {
  assert.match(
    activity,
    /boolean coldStartLocked = LockPolicy\.lockEngaged\(this\);\s*if \(coldStartLocked\) VaultPlugin\.LockState\.lock\(\);\s*super\.onCreate/,
  );
});

test('deprecated Security Crypto wrappers are absent from release code', () => {
  assert.doesNotMatch(vault, /import\s+androidx\.security\.crypto/);
  assert.doesNotMatch(policy, /import\s+androidx\.security\.crypto/);
  assert.doesNotMatch(gradle, /implementation\s+["'][^"']*security-crypto/);
});

test('legacy reset is narrow, recorded, and gives the user a recovery action', () => {
  assert.match(vault, /LEGACY_STORE = "intentsmith\.vault"/);
  assert.match(vault, /LEGACY_KEY_ALIAS = "_androidx_security_master_key_"/);
  assert.match(vault, /putBoolean\(REPAIR_KEY, true\)/);
  assert.match(plugin, /"repairRequired", LockPolicy\.repairRequired/);
  assert.match(client, /Bezpečné úložiště bylo aktualizováno/);
  assert.match(client, /znovu spáruj/);
});

test('PIN verifier, attempt counter, credential and app state share the encrypted store', () => {
  assert.doesNotMatch(policy, /SharedPreferences/);
  assert.match(policy, /values\.put\(K_TOKEN, token\)/);
  assert.match(policy, /values\.put\(K_PIN_HASH/);
  assert.match(policy, /Collections\.singletonMap\(K_FAILURES/);
  assert.match(policy, /store\.putStrings/);
  assert.match(
    policy,
    /if \(count >= MAX_FAILURES\) \{[\s\S]+?store\.putStrings\([\s\S]+?names\(K_TOKEN, K_DEVICE, K_SCOPES, K_APP_STATE\)\)/,
  );
  assert.doesNotMatch(policy, /\bSet\.of\(/, 'Set.of is unavailable on the Android 7 runtime floor');
});

test('logout can recover a corrupt vault and backup stays disabled', () => {
  assert.match(vault, /static void destroy\(Context suppliedContext\)/);
  assert.match(vault, /deleteKey\(KEY_ALIAS\)/);
  assert.match(vault, /deleteKey\(LEGACY_KEY_ALIAS\)/);
  assert.match(plugin, /LockPolicy\.clearAll\(getContext\(\), preservedAppState\)/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:fullBackupContent="false"/);
});

test('app state is bounded, namespaced and excludes credential identities', () => {
  assert.match(policy, /MAX_APP_STATE_BYTES = 8 \* 1024 \* 1024/);
  assert.match(policy, /json\.getBytes\(StandardCharsets\.UTF_8\)\.length > MAX_APP_STATE_BYTES/);
  assert.match(policy, /new JSONObject\(json\)/);
  assert.match(policy, /!key\.startsWith\("is\."\)/);
  assert.match(policy, /"is\.auth\.token"\.equals\(key\)/);
  assert.match(policy, /"is\.auth\.device"\.equals\(key\)/);
  assert.match(policy, /Collections\.singletonMap\(K_APP_STATE, json\)/);
});

test('the app-state bridge is sealed while locked and never falls back', () => {
  assert.match(plugin, /void readAppState\(PluginCall call\)[\s\S]+?LockState\.isLocked\(\)[\s\S]+?call\.reject\("locked"\)/);
  assert.match(plugin, /void writeAppState\(PluginCall call\)[\s\S]+?LockState\.isLocked\(\)[\s\S]+?call\.reject\("locked"\)/);
  assert.match(client, /encrypted_app_state_bridge_missing/);
  assert.match(client, /if \(store\.plugin && String\(method\)\.toUpperCase\(\) !== 'GET'\) await store\.flush\(\)/);
  assert.match(client, /if \(this\.plugin && \(!this\.native \|\| this\.failure\)\) throw/);
});

test('logout rotates the key and seeds only caller-validated preferences', () => {
  assert.match(policy, /preferencesStateInputValid\(String json\)/);
  assert.match(policy, /!"is\.prefs"\.equals\(keys\.next\(\)\)/);
  assert.match(policy, /preservedAppState != null && !preferencesStateInputValid\(preservedAppState\)/);
  assert.match(policy, /KeystoreVault\.destroy\(context\)[\s\S]+?Collections\.singletonMap\(K_APP_STATE, preservedAppState\)/);
  assert.match(client, /const preserved = store\.preferencesOnly\(\)[\s\S]+?plugin\.clear\(\{ appState: JSON\.stringify\(preserved\) \}\)/);
});

test('device-side tests cover round-trip, corruption and legacy reset', () => {
  assert.match(instrumented, /roundTripLeavesNoCleartextInPreferences/);
  assert.match(instrumented, /authenticatedCorruptionFailsClosedInsteadOfLookingUnpaired/);
  assert.match(instrumented, /legacyPrototypeIsNarrowlyResetAndRepairClearsAfterPairing/);
  assert.match(instrumented, /appStateRoundTripIsEncryptedAndRejectsCredentialKeys/);
  assert.match(instrumented, /assertFalse\(stored\.contains\("token-secret-123"\)\)/);
  assert.match(instrumented, /assertFalse\(stored\.contains\("draft-secret-789"\)\)/);
});

console.log(`\nDirect AndroidKeyStore vault: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
