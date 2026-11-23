// Verifiable delivery. The starter lets a buyer pay without knowing the ciphertext really
// matches the key. The seller commits to SHA-256(plaintext) in the offer; after paying and
// decrypting, the buyer checks it. This DETECTS a dishonest seller. It cannot refund the payment.

const toHex = (bytes: Uint8Array) =>
  `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;

export async function plaintextHash(plaintext: string): Promise<`0x${string}`> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plaintext));
  return toHex(new Uint8Array(digest)) as `0x${string}`;
}

export type Verification = { ok: true } | { ok: false; reason: string };

export async function verifyDelivery(plaintext: string, committedHash: string): Promise<Verification> {
  if (!/^0x[0-9a-f]{64}$/i.test(committedHash)) return { ok: false, reason: 'Offer has no valid plaintext commitment.' };
  const actual = await plaintextHash(plaintext);
  return actual === committedHash.toLowerCase()
    ? { ok: true }
    : { ok: false, reason: 'Decrypted content does not match the seller\'s commitment.' };
}
