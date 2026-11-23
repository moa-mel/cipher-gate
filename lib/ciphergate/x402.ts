import type {
  FiberPaymentRequirement,
  PublishedResource,
  X402PaymentPayload,
  X402PaymentRequired,
} from './types';

export const FIBER_TESTNET_AMOUNT_SHANNONS = '100000000'; // 1 CKB

export function buildPaymentRequired(
  resource: PublishedResource,
  resourceUrl: string,
): X402PaymentRequired {
  const accepted: FiberPaymentRequirement = {
    scheme: 'exact',
    network: 'fiber:testnet',
    asset: 'ckb',
    amount: FIBER_TESTNET_AMOUNT_SHANNONS,
    payTo: resource.sellerPubkey,
    maxTimeoutSeconds: 3600,
    extra: {
      offerId: resource.slug,
      invoice: resource.offer.invoice,
      paymentHash: resource.offer.paymentHash,
      cipher: 'AES-256-GCM',
    },
  };

  return {
    x402Version: 2,
    error: 'PAYMENT-SIGNATURE header is required',
    resource: {
      url: resourceUrl,
      description: resource.description,
      mimeType: 'application/json',
    },
    accepts: [accepted],
  };
}

export function encodeX402Header(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

export function decodeX402PaymentHeader(value: string): X402PaymentPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
  } catch {
    throw new Error('PAYMENT-SIGNATURE is not valid base64-encoded JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('PAYMENT-SIGNATURE must contain a JSON object.');
  }

  const payload = parsed as Partial<X402PaymentPayload>;
  if (
    payload.x402Version !== 2 ||
    !payload.accepted ||
    !payload.payload ||
    typeof payload.payload.invoice !== 'string' ||
    typeof payload.payload.paymentPreimage !== 'string'
  ) {
    throw new Error('PAYMENT-SIGNATURE does not match the CipherGate Fiber proof shape.');
  }

  return payload as X402PaymentPayload;
}

export function encodeBrowserBase64(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBrowserBase64<T>(value: string): T {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
