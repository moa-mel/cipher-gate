import type { FiberBrowserNode } from '@fiber-pay/sdk/browser';
import { decryptResult } from '@/lib/crypto';
import { parseOffer } from '@/lib/offer';
import { payForOffer, validateOffer } from '@/lib/payment';
import { assertPaymentAllowed, type SpendingPolicy } from './policy';
import { encodeBrowserBase64 } from './x402';
import type { X402PaymentPayload, X402PaymentRequired } from './types';

type ChallengeBody = {
  x402Version: 2;
  provider: string;
  preview: { title: string; description: string; cipher: string };
  offer: unknown;
};

export type CipherGateUnlockResult =
  | { kind: 'pending'; paymentStatus: string; paymentHash: string }
  | {
      kind: 'unlocked';
      data: unknown;
      paymentHash: string;
      amountShannons: bigint;
      feeShannons: string;
      receipt: {
        success: boolean;
        network: string;
        amount: string;
        transaction: string;
        receiptId: string;
        verification: string;
      };
    };

export type PayAndDecryptInput = {
  node: FiberBrowserNode;
  slug: string;
  challenge: X402PaymentRequired;
  challengeBody: ChallengeBody;
  policy: SpendingPolicy;
  alreadySpentToday: bigint;
  getAttempt: () => string;
  saveAttempt: (paymentHash: string) => void;
  onProgress?: (message: string) => void;
};

function decodeBase64Json<T>(value: string): T {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/**
 * Executes one paid CipherGate request with a real Fiber browser node.
 * The caller is responsible for obtaining the HTTP 402 challenge and for
 * persisting daily budget usage after this function returns kind='unlocked'.
 */
export async function payAndDecryptChallenge(input: PayAndDecryptInput): Promise<CipherGateUnlockResult> {
  const {
    node, slug, challenge, challengeBody, policy, alreadySpentToday,
    getAttempt, saveAttempt, onProgress,
  } = input;
  const accepted = challenge.accepts?.[0];
  if (!accepted) throw new Error('The gateway did not advertise a supported payment requirement.');
  if (accepted.network !== 'fiber:testnet' || accepted.asset !== 'ckb' || accepted.scheme !== 'exact') {
    throw new Error('This agent currently accepts exact CKB payments on Fiber Testnet only.');
  }

  const offer = parseOffer(JSON.stringify(challengeBody.offer));
  const invoice = await validateOffer(node, offer);
  if (accepted.amount !== '100000000') {
    throw new Error('This demo agent is configured for exactly 1 CKB per resource.');
  }
  if (invoice.data.payment_hash.toLowerCase() !== offer.paymentHash.toLowerCase()) {
    throw new Error('Invoice payment hash does not match the encrypted offer.');
  }

  assertPaymentAllowed(policy, {
    providerId: 'ciphergate-demo',
    amountShannons: BigInt(accepted.amount),
  }, alreadySpentToday);

  // Prove that the offer is still unreadable before payment.
  onProgress?.('Testing decryption without the payment preimage…');
  let substituteKeyRejected = false;
  try {
    await decryptResult(offer, `0x${'11'.repeat(32)}`);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'OperationError') {
      substituteKeyRejected = true;
    } else {
      throw error;
    }
  }
  if (!substituteKeyRejected) {
    throw new Error('Ciphertext unexpectedly decrypted with a substitute key.');
  }

  onProgress?.('Submitting or checking the Fiber payment…');
  const paymentResult = await payForOffer(
    node,
    offer,
    getAttempt(),
    saveAttempt,
  );

  if (paymentResult.status !== 'Success') {
    return {
      kind: 'pending',
      paymentStatus: paymentResult.status,
      paymentHash: paymentResult.payment_hash,
    };
  }

  const paymentPreimage = paymentResult.payment_preimage;
  if (!paymentPreimage) {
    throw new Error('Fiber reports Success but did not return payment_preimage. Check the node/SDK payment result before proceeding.');
  }

  onProgress?.('Retrying the API request with the x402 payment proof…');
  const paymentPayload: X402PaymentPayload = {
    x402Version: 2,
    accepted,
    payload: {
      invoice: offer.invoice,
      paymentPreimage,
    },
  };

  const paidResponse = await fetch(`/api/ciphergate/resources/${encodeURIComponent(slug)}`, {
    method: 'GET',
    cache: 'no-store',
    headers: { 'PAYMENT-SIGNATURE': encodeBrowserBase64(paymentPayload) },
  });
  const paidBody = await paidResponse.json();
  if (!paidResponse.ok) {
    throw new Error(paidBody.error ?? 'Gateway rejected the Fiber payment proof.');
  }

  if (!paidBody.encryptedResource || !paidBody.receipt?.success) {
    throw new Error('Gateway did not return a verified encrypted resource.');
  }

  onProgress?.('Decrypting the API response locally…');
  const decryptedText = await decryptResult(paidBody.encryptedResource, paymentPreimage);
  let data: unknown;
  try {
    data = JSON.parse(decryptedText);
  } catch {
    data = decryptedText;
  }

  saveAttempt('');
  return {
    kind: 'unlocked',
    data,
    paymentHash: paymentResult.payment_hash,
    amountShannons: BigInt(accepted.amount),
    feeShannons: paymentResult.fee,
    receipt: paidBody.receipt,
  };
}
