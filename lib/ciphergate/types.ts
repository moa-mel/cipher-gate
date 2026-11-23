export type PublicEncryptedOffer = {
  version: 2;
  cipher: 'AES-256-GCM';
  ciphertext: `0x${string}`;
  iv: `0x${string}`;
  invoice: string;
  paymentHash: `0x${string}`;
  lastHop: {
    pubkey: `0x${string}`;
    channel_outpoint: `0x${string}`;
    fee_rate: `0x${string}`;
    tlc_expiry_delta: `0x${string}`;
  };
};

export type PublishedResource = {
  slug: string;
  title: string;
  description: string;
  providerId: string;
  providerName: string;
  sellerPubkey: `0x${string}`;
  offer: PublicEncryptedOffer;
  createdAt: string;
  consumedAt?: string;
};

export type FiberPaymentRequirement = {
  scheme: 'exact';
  network: 'fiber:testnet';
  asset: 'ckb';
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    offerId: string;
    invoice: string;
    paymentHash: string;
    cipher: 'AES-256-GCM';
  };
};

export type X402PaymentRequired = {
  x402Version: 2;
  error?: string;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepts: FiberPaymentRequirement[];
};

export type X402PaymentPayload = {
  x402Version: 2;
  accepted: FiberPaymentRequirement;
  payload: {
    invoice: string;
    paymentPreimage: string;
  };
};
