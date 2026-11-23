import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getResource, markResourceConsumed } from '@/lib/ciphergate/store';
import { buildPaymentRequired, decodeX402PaymentHeader, encodeX402Header } from '@/lib/ciphergate/x402';

export const runtime = 'nodejs';

function sha256Hex(preimage: string): string {
  const hex = preimage.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('Payment preimage must be exactly 32 bytes of hexadecimal data.');
  }
  return createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');
}

function constantTimeHexEqual(left: string, right: string): boolean {
  const a = Buffer.from(left.replace(/^0x/i, '').toLowerCase(), 'hex');
  const b = Buffer.from(right.replace(/^0x/i, '').toLowerCase(), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

type Context = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: Context) {
  const { slug } = await context.params;
  const resource = getResource(slug);
  if (!resource) {
    return NextResponse.json({ error: `Resource '${slug}' was not found. Publish it from the provider route first.` }, { status: 404 });
  }
  if (resource.consumedAt) {
    return NextResponse.json({ error: 'This published offer has already been unlocked. Publish a fresh offer with a new invoice for another purchase.' }, { status: 409 });
  }

  const url = new URL(request.url);
  const resourceUrl = `${url.origin}/api/ciphergate/resources/${resource.slug}`;
  const paymentRequired = buildPaymentRequired(resource, resourceUrl);
  const paymentSignature = request.headers.get('PAYMENT-SIGNATURE');

  if (!paymentSignature) {
    return NextResponse.json({
      x402Version: 2,
      resource: paymentRequired.resource,
      accepts: paymentRequired.accepts,
      provider: resource.providerName,
      preview: {
        title: resource.title,
        description: resource.description,
        cipher: resource.offer.cipher,
      },
      offer: resource.offer,
      message: 'This resource is encrypted. Pay the Fiber invoice to obtain the preimage and decrypt it.',
    }, {
      status: 402,
      headers: {
        'PAYMENT-REQUIRED': encodeX402Header(paymentRequired),
        'Cache-Control': 'no-store',
      },
    });
  }

  try {
    const paymentPayload = decodeX402PaymentHeader(paymentSignature);
    const accepted = paymentPayload.accepted;
    const preimage = paymentPayload.payload.paymentPreimage;
    const paymentHash = resource.offer.paymentHash;

    if (paymentPayload.x402Version !== 2) throw new Error('Only x402 version 2 is supported.');
    if (accepted.scheme !== 'exact' || accepted.network !== 'fiber:testnet' || accepted.asset !== 'ckb') {
      throw new Error('Payment scheme, network or asset does not match this Fiber Testnet offer.');
    }
    if (accepted.amount !== '100000000' || accepted.payTo !== resource.sellerPubkey) {
      throw new Error('Payment amount or recipient does not match the published offer.');
    }
    if (
      accepted.extra.offerId !== resource.slug ||
      accepted.extra.invoice !== resource.offer.invoice ||
      accepted.extra.paymentHash.toLowerCase() !== paymentHash.toLowerCase()
    ) {
      throw new Error('Payment challenge does not match the requested resource.');
    }
    if (paymentPayload.payload.invoice !== resource.offer.invoice) {
      throw new Error('Submitted invoice does not match the published offer.');
    }

    const digest = `0x${sha256Hex(preimage)}`;
    if (!constantTimeHexEqual(digest, paymentHash)) {
      throw new Error('Payment preimage does not match the invoice payment hash.');
    }

    if (!markResourceConsumed(resource.slug)) {
      throw new Error('This one-time invoice has already been used. Ask the provider to publish a fresh offer.');
    }

    const receipt = {
      success: true,
      // Fiber payments are channel payments; this is a receipt reference, not
      // a CKB L1 transaction hash. A production facilitator should reconcile
      // the merchant node's invoice state before issuing a final receipt.
      transaction: `fiber-preimage-proof:${paymentHash}`,
      network: 'fiber:testnet',
      amount: '100000000',
      receiptId: `fiber-preimage-proof:${paymentHash}`,
      verification: 'sha256-preimage-matches-invoice-payment-hash',
    };

    return NextResponse.json({
      x402Version: 2,
      resource: paymentRequired.resource,
      preview: { title: resource.title, description: resource.description },
      encryptedResource: {
        cipher: resource.offer.cipher,
        iv: resource.offer.iv,
        ciphertext: resource.offer.ciphertext,
      },
      receipt,
    }, {
      status: 200,
      headers: {
        'PAYMENT-RESPONSE': encodeX402Header(receipt),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payment proof was rejected.';
    return NextResponse.json({ error: message }, { status: 402, headers: { 'Cache-Control': 'no-store' } });
  }
}
