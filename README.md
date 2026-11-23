# CipherGate — Fiber Advanced Quest Extension

CipherGate is an Advanced-quest use case built **on top of the official Fiber encrypted-data-payment starter**.

It demonstrates a developer-facing paid API resource:

1. A provider starts the existing Seller C browser Fiber node.
2. The provider creates a JSON research response.
3. The existing starter encrypts the JSON with AES-256-GCM and creates a 1 CKB Fiber Testnet invoice whose payment preimage is the AES key.
4. The provider publishes only the encrypted offer to a small API gateway.
5. An agent starts the existing Buyer A browser Fiber node and requests the resource.
6. The gateway returns HTTP 402 and an x402 V2-style `PAYMENT-REQUIRED` header.
7. The agent checks its provider allowlist and spending limits, validates the Fiber invoice, and pays it using the starter's `payForOffer` recovery logic.
8. After the buyer's Fiber node reports `Success` and returns `payment_preimage`, the agent retries the API request with `PAYMENT-SIGNATURE`.
9. The gateway checks that the preimage hashes to the invoice payment hash, marks this one-time offer as consumed and returns the encrypted envelope with a `PAYMENT-RESPONSE` receipt.
10. The agent decrypts the JSON locally.

This keeps the campaign's core cryptographic sequence intact: **encrypted offer → Fiber invoice → successful payment → payment preimage → decryption**.

## Important: this is an extension, not a replacement starter

Copy/merge the folders in this archive into the root of the extracted `encrypted-data-payment` starter directory. Do not replace the starter's existing `lib/fiber.ts`, `lib/crypto.ts`, `lib/offer.ts`, `lib/payment.ts`, `lib/payment-submission.ts`, `lib/progress.ts`, or `lib/node-session.ts`.

The extension reuses these existing starter functions:

- `startRole`, `connectAndOpenChannel`, `readChannel`, `ready` from `lib/fiber.ts`
- `createOffer`, `parseOffer` from `lib/offer.ts`
- `validateOffer`, `payForOffer` from `lib/payment.ts`
- `decryptResult` from `lib/crypto.ts`
- `createBrowserNodeSession` from `lib/node-session.ts`
- `encryptedBuyerProfile`, `encryptedSellerProfile` from `lib/progress.ts`

No additional npm packages are required by this extension.

## Run it

Use the same Node.js version required by the official starter (Node.js 22.18 or newer).

From the existing `encrypted-data-payment` directory:

```bash
npm run typecheck
npm test
npm run build
npm run dev
```

Keep the original starter's dependency versions and Next.js cross-origin isolation headers.

Open these routes in the same browser on the same `localhost:3001` origin:

- Provider: `http://localhost:3001/ciphergate/provider`
- Agent: `http://localhost:3001/ciphergate/agent`

### Demo sequence

1. Open `/ciphergate/provider`.
2. Select **Start Seller C**.
3. Select **Open / reuse Bottle channel**. If the channel from Basic is already ready, it will be reused. Otherwise fund Seller C's displayed address and wait for `CHANNEL_READY`.
4. Edit the JSON resource if desired, then select **Encrypt JSON + create 1 CKB invoice + publish**.
5. Open `/ciphergate/agent` in a second tab.
6. Select **Start Buyer A**.
7. Select **Open / reuse Bottle channel**. Reuse the channel from Basic or fund the displayed Buyer A address and wait for `CHANNEL_READY`.
8. Select **Request resource**. The agent should receive HTTP 402 and show the public preview and invoice details.
9. Select **Approve policy + pay 1 CKB + decrypt**.
10. Wait for Fiber payment success. The agent then sends the x402 `PAYMENT-SIGNATURE` proof, receives the encrypted resource, and decrypts the JSON locally.

Keep one active tab per saved Fiber node. The seller and buyer use different saved node profiles, so the provider and agent pages can run in separate tabs. Close the original tutorial page if it has already started either node; the starter uses Web Locks to prevent the same saved node from running in two tabs.

## API contract

### `GET /api/ciphergate/resources/:slug`

Without a `PAYMENT-SIGNATURE` header, returns `402 Payment Required`, a base64-encoded x402 V2 `PAYMENT-REQUIRED` header, a public preview, and the encrypted offer envelope. The envelope is safe to expose because the plaintext is AES-256-GCM encrypted. Each published offer uses one invoice and is single-use; publish a fresh offer and invoice for another purchase.

With a base64-encoded x402 V2 `PAYMENT-SIGNATURE` header containing the Fiber invoice and payment preimage, the gateway checks:

- the selected scheme, network and asset;
- the fixed 1 CKB amount and seller public key;
- the resource ID, invoice and payment hash;
- that SHA-256(payment preimage) equals the invoice payment hash.

On a matching proof, it returns HTTP 200, the encrypted resource envelope and a `PAYMENT-RESPONSE` header.

## Demo limitations (read before deploying)

- **This is a local hackathon demo, not a production payment facilitator.** The browser agent uses the real Fiber Testnet node and the starter's payment result to obtain the preimage. The gateway independently checks the preimage/hash binding, but it does not connect to the seller's Fiber node to query `get_invoice` status. A production gateway must independently reconcile the merchant invoice state (or use a properly configured Fiber x402 facilitator) before issuing a final settlement receipt.
- The `transaction` string in the demo `PAYMENT-RESPONSE` is a deterministic receipt reference, **not a CKB layer-1 transaction hash**. Fiber payments are channel payments.
- Resource records are kept in a process-local in-memory `Map`. Restarting the Next.js server clears them. A multi-instance deployment needs durable storage and atomic payment/receipt state.
- The agent spending policy is enforced in the demo client. A production agent SDK should persist budget usage in a trusted store and enforce limits at the payment boundary so a compromised client cannot bypass policy.
- x402's HTTP V2 header format is used with the Fiber-specific `fiber:testnet` exact-payment requirement and invoice/preimage proof shape. Fiber's x402 facilitator implementation has been proposed separately; do not assume every Fiber node exposes facilitator endpoints.
- The API's sample research content is illustrative. It is not generated by an AI model and is not verified market research.

## Files added

```text
app/
  api/ciphergate/
    publish/route.ts
    resources/[slug]/route.ts
  ciphergate/
    ciphergate.module.css
    provider/page.tsx
    agent/page.tsx
lib/
  ciphergate/
    agent-client.ts
    agent-client.ts
    policy.ts
    store.ts
    types.ts
    x402.ts
```

## Attribution

CipherGate builds on the official Fiber encrypted-data-payment starter and its Fiber WASM/browser SDK integration. Retain attribution to the Fiber documentation and starter code in the project README and submission.
