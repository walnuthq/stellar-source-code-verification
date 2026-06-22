/** Lowercase hex SHA-256: exactly 64 hex characters. */
const WASM_HASH_RE = /^[0-9a-f]{64}$/;

export function isValidWasmHash(value: string): boolean {
  return WASM_HASH_RE.test(value);
}
