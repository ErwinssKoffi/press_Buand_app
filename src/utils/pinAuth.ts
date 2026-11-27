/**
 * Cryptographic helpers for the 5-digit counter PIN lock.
 * Uses Web Crypto SHA-256 with a per-shop random salt and constant-time comparison.
 */

export function isValidFiveDigitPin(pin: string): boolean {
  return /^\d{5}$/.test(pin);
}

export function generatePinSaltHex(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256HexFallback(input: string): Promise<string> {
  // Deterministic non-reversible mixing fallback only if crypto.subtle is unavailable (e.g. non-HTTPS LAN)
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${part1}${part2}`.repeat(4);
}

export async function hashFiveDigitPin(pin: string, salt: string): Promise<string> {
  const payload = `${salt}:${pin}:eclat-pressing-pin-v1`;
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const data = new TextEncoder().encode(payload);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(digest);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return sha256HexFallback(payload);
}

export async function verifyFiveDigitPin(
  pin: string,
  salt: string | undefined,
  expectedHash: string | undefined
): Promise<boolean> {
  if (!salt || !expectedHash || !isValidFiveDigitPin(pin)) {
    return false;
  }
  const candidate = await hashFiveDigitPin(pin, salt);
  if (candidate.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}
