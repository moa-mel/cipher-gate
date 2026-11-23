import { NextResponse } from 'next/server';
import { saveResource } from '@/lib/ciphergate/store';
import type { PublicEncryptedOffer, PublishedResource } from '@/lib/ciphergate/types';

export const runtime = 'nodejs';

function isHex(value: unknown, bytes: number): value is `0x${string}` {
  return typeof value === 'string' && new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value);
}

function isHexBytes(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(value);
}

function isOffer(value: unknown): value is PublicEncryptedOffer {
  if (!value || typeof value !== 'object') return false;
  const offer = value as Record<string, unknown>;
  const lastHop = offer.lastHop as Record<string, unknown> | undefined;
  return (
    offer.version === 2 &&
    offer.cipher === 'AES-256-GCM' &&
    typeof offer.invoice === 'string' &&
    offer.invoice.toLowerCase().startsWith('fibt') &&
    isHexBytes(offer.ciphertext) &&
    typeof offer.iv === 'string' &&
    /^0x[0-9a-fA-F]{24}$/.test(offer.iv) &&
    isHex(offer.paymentHash, 32) &&
    !!lastHop &&
    isHex(lastHop.pubkey, 33) &&
    typeof lastHop.channel_outpoint === 'string' &&
    typeof lastHop.fee_rate === 'string' &&
    typeof lastHop.tlc_expiry_delta === 'string'
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const slug = input.slug;
  const title = input.title;
  const description = input.description;
  const sellerPubkey = input.sellerPubkey;
  const offer = input.offer;

  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{2,48}$/.test(slug)) {
    return NextResponse.json({ error: 'Slug must be 3–49 lowercase letters, numbers or hyphens.' }, { status: 400 });
  }
  if (typeof title !== 'string' || title.trim().length < 3 || title.length > 100) {
    return NextResponse.json({ error: 'Title must contain 3–100 characters.' }, { status: 400 });
  }
  if (typeof description !== 'string' || description.trim().length < 10 || description.length > 300) {
    return NextResponse.json({ error: 'Description must contain 10–300 characters.' }, { status: 400 });
  }
  if (!isHex(sellerPubkey, 33)) {
    return NextResponse.json({ error: 'Seller Fiber public key is missing or malformed.' }, { status: 400 });
  }
  if (!isOffer(offer)) {
    return NextResponse.json({ error: 'Encrypted offer is incomplete or malformed.' }, { status: 400 });
  }

  const resource: PublishedResource = {
    slug,
    title: title.trim(),
    description: description.trim(),
    providerId: 'ciphergate-demo',
    providerName: 'CipherGate Research Provider',
    sellerPubkey,
    offer,
    createdAt: new Date().toISOString(),
  };

  saveResource(resource);
  return NextResponse.json({
    success: true,
    slug,
    resourceUrl: `/api/ciphergate/resources/${slug}`,
    message: 'Encrypted resource published. The plaintext and AES key were not sent to the gateway.',
  });
}
