// Spending policy for the buyer agent. Pure logic: no Fiber, browser or SDK imports,
// so it can be tested with `node --test`. All amounts are shannons (1 CKB = 100_000_000).

export type Policy = {
  totalBudget: bigint;
  perItemCap: bigint;
  /** Seller node pubkeys the agent may buy from. Empty list means nobody is allowed. */
  allowedSellers: string[];
};

export type LedgerEntry = {
  paymentHash: string;
  seller: string;
  price: bigint;
  /** pending: payment submitted or outcome unknown. settled: paid. failed: node confirmed failure. */
  status: 'pending' | 'settled' | 'failed';
};

export type Ledger = {
  entries: LedgerEntry[];
  /** Sellers whose delivery failed verification. They are never bought from again. */
  flaggedSellers: string[];
};

export type PurchaseRequest = { paymentHash: string; seller: string; price: bigint };
export type Decision = { allow: true } | { allow: false; reason: string };

export const emptyLedger = (): Ledger => ({ entries: [], flaggedSellers: [] });

const normalize = (value: string) => value.replace(/^0x/i, '').toLowerCase();

/** Money that is spent or may still be spent. Pending counts, so in-flight payments cannot be overspent. */
export function committed(ledger: Ledger): bigint {
  return ledger.entries.reduce((sum, e) => (e.status === 'failed' ? sum : sum + e.price), 0n);
}

export function remaining(policy: Policy, ledger: Ledger): bigint {
  const left = policy.totalBudget - committed(ledger);
  return left > 0n ? left : 0n;
}

export function evaluate(policy: Policy, ledger: Ledger, request: PurchaseRequest): Decision {
  const seller = normalize(request.seller);
  if (request.price <= 0n) return { allow: false, reason: 'Price must be greater than zero.' };
  if (ledger.flaggedSellers.some((s) => normalize(s) === seller)) {
    return { allow: false, reason: 'Seller failed delivery verification earlier.' };
  }
  if (!policy.allowedSellers.some((s) => normalize(s) === seller)) {
    return { allow: false, reason: 'Seller is not on the allowlist.' };
  }
  const duplicate = ledger.entries.find(
    (e) => normalize(e.paymentHash) === normalize(request.paymentHash) && e.status !== 'failed',
  );
  if (duplicate) return { allow: false, reason: 'This offer was already purchased or is pending.' };
  if (request.price > policy.perItemCap) return { allow: false, reason: 'Price is above the per-item cap.' };
  if (request.price > remaining(policy, ledger)) return { allow: false, reason: 'Not enough budget remaining.' };
  return { allow: true };
}

/** Reserve budget BEFORE submitting a payment. Throws if the policy forbids it. */
export function reserve(policy: Policy, ledger: Ledger, request: PurchaseRequest): Ledger {
  const decision = evaluate(policy, ledger, request);
  if (!decision.allow) throw new Error(decision.reason);
  return { ...ledger, entries: [...ledger.entries, { ...request, status: 'pending' }] };
}

export function markStatus(ledger: Ledger, paymentHash: string, status: 'settled' | 'failed'): Ledger {
  const target = normalize(paymentHash);
  if (!ledger.entries.some((e) => normalize(e.paymentHash) === target)) {
    throw new Error('No ledger entry for this payment hash.');
  }
  return {
    ...ledger,
    entries: ledger.entries.map((e) => (normalize(e.paymentHash) === target ? { ...e, status } : e)),
  };
}

export function flagSeller(ledger: Ledger, seller: string): Ledger {
  if (ledger.flaggedSellers.some((s) => normalize(s) === normalize(seller))) return ledger;
  return { ...ledger, flaggedSellers: [...ledger.flaggedSellers, seller] };
}

// bigint is not JSON-safe, so the ledger is stored with string prices.
export function serializeLedger(ledger: Ledger): string {
  return JSON.stringify({
    entries: ledger.entries.map((e) => ({ ...e, price: e.price.toString() })),
    flaggedSellers: ledger.flaggedSellers,
  });
}

export function parseLedger(text: string): Ledger {
  const raw = JSON.parse(text);
  if (!raw || !Array.isArray(raw.entries) || !Array.isArray(raw.flaggedSellers)) {
    throw new Error('Saved ledger is unreadable. Do not discard it: it may track real spending.');
  }
  return {
    flaggedSellers: raw.flaggedSellers.map(String),
    entries: raw.entries.map((e: Record<string, unknown>) => {
      if (!['pending', 'settled', 'failed'].includes(String(e.status))) throw new Error('Ledger entry has an invalid status.');
      return {
        paymentHash: String(e.paymentHash),
        seller: String(e.seller),
        price: BigInt(String(e.price)),
        status: e.status as LedgerEntry['status'],
      };
    }),
  };
}
