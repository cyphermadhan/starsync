// Deliberately duplicated from src/lib/encryption.ts rather than imported
// across the project boundary — this worker has its own build/deploy
// pipeline (plain wrangler, not Astro/Vite), and keeping a small, stable
// decrypt-only helper self-contained avoids cross-project import fragility.
// Must stay format-compatible with the main app's encryptField: AES-256-GCM,
// stored as base64(iv) + "." + base64(ciphertext).

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
}

export async function decryptField(encoded: string, base64Key: string): Promise<string> {
  const [ivB64, ciphertextB64] = encoded.split('.');
  const key = await importKey(base64Key);
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ciphertextB64), (c) => c.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
