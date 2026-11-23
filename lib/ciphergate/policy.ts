export type SpendingPolicy = {
  providerIdAllowlist: string[];
  maxPerRequestShannons: bigint;
  dailyBudgetShannons: bigint;
};

export type PaymentIntent = {
  providerId: string;
  amountShannons: bigint;
};

export const DEMO_SPENDING_POLICY: SpendingPolicy = {
  providerIdAllowlist: ['ciphergate-demo'],
  maxPerRequestShannons: 100_000_000n, // 1 CKB
  dailyBudgetShannons: 500_000_000n, // 5 CKB
};

export function assertPaymentAllowed(
  policy: SpendingPolicy,
  intent: PaymentIntent,
  alreadySpentToday: bigint,
): void {
  if (!policy.providerIdAllowlist.includes(intent.providerId)) {
    throw new Error(`Provider ${intent.providerId} is not on the agent allowlist.`);
  }
  if (intent.amountShannons <= 0n) {
    throw new Error('Payment amount must be greater than zero.');
  }
  if (intent.amountShannons > policy.maxPerRequestShannons) {
    throw new Error('Payment exceeds the agent per-request spending limit.');
  }
  if (alreadySpentToday + intent.amountShannons > policy.dailyBudgetShannons) {
    throw new Error('Payment would exceed the agent daily spending budget.');
  }
}

export function dailySpendStorageKey(date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return `ciphergate:agent-spend:${day}`;
}
