
'use client';

import { useEffect, useRef, useState } from 'react';
import {
    scriptToAddress,
    type FiberBrowserNode,
    type Channel,
} from '@fiber-pay/sdk/browser';
import { startRole, connectAndOpenChannel, readChannel, ready } from '@/lib/fiber';
import { createBrowserNodeSession } from '@/lib/node-session';
import { encryptedBuyerProfile } from '@/lib/progress';
import { dailySpendStorageKey, DEMO_SPENDING_POLICY } from '@/lib/ciphergate/policy';
import { payAndDecryptChallenge } from '@/lib/ciphergate/agent-client';
import { decodeBrowserBase64 } from '@/lib/ciphergate/x402';
import type { X402PaymentRequired } from '@/lib/ciphergate/types';
import styles from '../ciphergate.module.css';



type ApiChallengeBody = {
    x402Version: 2;
    provider: string;
    preview: {
        title: string;
        description: string;
        cipher: string;
    };
    offer: unknown;
};

type CipherGateReceipt = {
    success: boolean;
    network: string;
    amount: string;
    transaction: string;
    receiptId: string;
    verification: string;
};

function getTodaySpend(): bigint {
    try {
        return BigInt(localStorage.getItem(dailySpendStorageKey()) ?? '0');
    } catch {
        return 0n;
    }
}

function recordTodaySpend(amount: bigint): void {
    localStorage.setItem(
        dailySpendStorageKey(),
        (getTodaySpend() + amount).toString()
    );
}

export default function CipherGateAgentPage() {
    const nodeRef = useRef<FiberBrowserNode | null>(null);

    const [session] = useState(() => createBrowserNodeSession());
    const [channel, setChannel] = useState<Channel | null>(null);
    const [buyerStarted, setBuyerStarted] = useState(false);

    const [slug, setSlug] = useState('energy-market');
    const [status, setStatus] = useState(
        'Start Buyer A to run the autonomous payment demo.'
    );
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const [challengeBody, setChallengeBody] = useState<ApiChallengeBody | null>(null);
    const [challenge, setChallenge] = useState<X402PaymentRequired | null>(null);
    const [unlocked, setUnlocked] = useState<unknown>(null);
    const [receipt, setReceipt] = useState<CipherGateReceipt | null>(null);
    const [dailySpend, setDailySpend] = useState('0');
    const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [fundingAddress, setFundingAddress] = useState('');

    useEffect(() => {
        setDailySpend(getTodaySpend().toString());

        if (cleanupTimerRef.current) {
            clearTimeout(cleanupTimerRef.current);
            cleanupTimerRef.current = null;
        }

        return () => {
            cleanupTimerRef.current = setTimeout(() => {
                void session.stop().catch((error) => {
                    console.error('Failed to stop Buyer A session:', error);
                });

                cleanupTimerRef.current = null;
            }, 0);
        };
    }, [session]);

    async function run(action: () => Promise<void>) {
        setBusy(true);
        setError('');

        try {
            await action();
        } catch (cause) {
            setError(
                cause instanceof Error ? cause.message : 'Agent operation failed.'
            );
        } finally {
            setBusy(false);
        }
    }

    async function startBuyer() {
        await session.start(encryptedBuyerProfile, async (track) => {
            nodeRef.current = await startRole('buyer', track);
        });

        const node = nodeRef.current;

        if (!node) {
            throw new Error('Buyer A did not start.');
        }

        // Retrieve Buyer A's node information.
        const info = await node.getNodeInfo();

        // Derive the CKB Testnet funding address.
        if (!info.default_funding_lock_script) {
            throw new Error(
                'Buyer A started, but its default CKB funding lock script is unavailable.'
            );
        }

        const address = scriptToAddress(
            info.default_funding_lock_script,
            'testnet'
        );

        setFundingAddress(address);
        setBuyerStarted(true);

        setStatus(
            'Buyer A is running. Copy its Testnet CKB funding address, fund it, then connect to Bottle.'
        );
    }

    async function openChannel() {
        const node = nodeRef.current;

        if (!node) {
            throw new Error('Start Buyer A first.');
        }

        const existing = await readChannel(node);

        if (existing && ready(existing)) {
            setChannel(existing);
            setStatus('Buyer channel is already CHANNEL_READY.');
            return;
        }

        const opened = await connectAndOpenChannel(node);

        setChannel(opened ?? null);

        setStatus(
            opened && ready(opened)
                ? 'Buyer channel is CHANNEL_READY.'
                : 'Channel opening was submitted. Refresh until it reaches CHANNEL_READY.'
        );
    }

    async function refreshChannel() {
        const node = nodeRef.current;

        if (!node) {
            throw new Error('Start Buyer A first.');
        }

        const current = await readChannel(node);

        setChannel(current ?? null);

        setStatus(
            current && ready(current)
                ? 'Buyer channel is CHANNEL_READY.'
                : `Buyer channel state: ${current?.state.state_name ?? 'not found'}.`
        );
    }

    async function requestChallenge() {
        if (!nodeRef.current) {
            throw new Error('Start Buyer A first.');
        }

        if (!channel || !ready(channel)) {
            throw new Error(
                'Buyer channel must be CHANNEL_READY before paying.'
            );
        }

        setUnlocked(null);
        setReceipt(null);

        const response = await fetch(
            `/api/ciphergate/resources/${encodeURIComponent(slug)}`,
            {
                method: 'GET',
                cache: 'no-store',
            }
        );

        if (response.status !== 402) {
            const body = await response.json().catch(() => ({}));

            throw new Error(
                body.error ??
                `Expected HTTP 402 but received ${response.status}. Publish the resource first.`
            );
        }

        const requiredHeader = response.headers.get('PAYMENT-REQUIRED');

        if (!requiredHeader) {
            throw new Error(
                'Gateway returned HTTP 402 without a PAYMENT-REQUIRED header.'
            );
        }

        const paymentRequired =
            decodeBrowserBase64<X402PaymentRequired>(requiredHeader);

        const body = (await response.json()) as ApiChallengeBody;

        if (!paymentRequired.accepts?.length || !body.offer) {
            throw new Error('Payment challenge is incomplete.');
        }

        setChallenge(paymentRequired);
        setChallengeBody(body);

        setStatus(
            'Received HTTP 402. The resource is encrypted; the agent must check policy before paying.'
        );
    }

    async function payAndUnlock() {
        const buyer = nodeRef.current;

        if (!buyer) {
            throw new Error('Start Buyer A first.');
        }

        if (!challenge || !challengeBody) {
            throw new Error('Request the API resource first.');
        }

        if (!channel || !ready(channel)) {
            throw new Error('Buyer channel must be CHANNEL_READY.');
        }

        const attemptKey = `ciphergate:attempt:${slug}`;

        const result = await payAndDecryptChallenge({
            node: buyer,
            slug,
            challenge,
            challengeBody,
            policy: DEMO_SPENDING_POLICY,
            alreadySpentToday: getTodaySpend(),

            getAttempt: () => localStorage.getItem(attemptKey) ?? '',

            saveAttempt: (hash) => {
                if (hash) {
                    localStorage.setItem(attemptKey, hash);
                } else {
                    localStorage.removeItem(attemptKey);
                }
            },

            onProgress: setStatus,
        });

        if (result.kind === 'pending') {
            setStatus(
                `Fiber payment status: ${result.paymentStatus}. Select the action again to check this existing payment; it will not automatically submit a duplicate.`
            );
            return;
        }

        setUnlocked(result.data);
        setReceipt(result.receipt);

        recordTodaySpend(result.amountShannons);

        setDailySpend(getTodaySpend().toString());

        setStatus(
            'Payment succeeded, the preimage matched the invoice hash, and the encrypted API response was decrypted.'
        );
    }

    const readyForPayment = Boolean(
        challenge && challengeBody && channel && ready(channel)
    );

    return (
        <main className={styles.shell}>
            <div className={styles.container}>
                <p className={styles.eyebrow}>
                    CipherGate · Autonomous agent
                </p>

                <h1 className={styles.heading}>
                    Buy private API data with Fiber.
                </h1>

                <p className={styles.lede}>
                    The agent requests a paid resource, receives an x402 HTTP 402
                    challenge, checks its spending policy, pays the Fiber invoice,
                    retrieves the payment preimage and decrypts the response locally.
                </p>

                <section className={styles.card}>
                    <h2>1. Connect Buyer A</h2>

                    <div className={styles.actions}>
                        <button
                            className={styles.button}
                            disabled={Boolean(busy)}
                            onClick={() => void run(startBuyer)}
                        >
                            Start Buyer A
                        </button>

                        <button
                            className={`${styles.button} ${styles.secondary}`}
                            disabled={Boolean(busy || !buyerStarted)}
                            onClick={() => void run(openChannel)}
                        >
                            Open / reuse Bottle channel
                        </button>

                        <button
                            className={`${styles.button} ${styles.secondary}`}
                            disabled={Boolean(busy || !buyerStarted)}
                            onClick={() => void run(refreshChannel)}
                        >
                            Refresh channel
                        </button>
                    </div>

                    <dl className={styles.kv}>
                        <dt>Channel state</dt>
                        <dd>{channel?.state.state_name ?? 'Not connected'}</dd>

                        <dt>Required state</dt>
                        <dd>CHANNEL_READY</dd>
                    </dl>

                    {fundingAddress && (
                        <div className={styles.result}>
                            <h3>Buyer A CKB Testnet Funding Address</h3>

                            <p className={styles.muted}>
                                Send more than 500 Testnet CKB to this address.
                                Keep additional CKB available for the transaction fee.
                            </p>

                            <code
                                style={{
                                    display: 'block',
                                    overflowWrap: 'anywhere',
                                    padding: '12px',
                                    marginTop: '12px',
                                    background: 'rgba(128, 128, 128, 0.12)',
                                    borderRadius: '8px',
                                }}
                            >
                                {fundingAddress}
                            </code>

                            <button
                                type="button"
                                className={styles.button}
                                onClick={() => {
                                    void navigator.clipboard.writeText(fundingAddress);
                                    setStatus('Buyer A funding address copied.');
                                }}
                            >
                                Copy funding address
                            </button>
                        </div>
                    )}

                </section>

                <section className={styles.card}>
                    <h2>2. Request a protected API resource</h2>

                    <div className={styles.field}>
                        <label htmlFor="cg-agent-slug">Resource slug</label>

                        <input
                            id="cg-agent-slug"
                            className={styles.input}
                            value={slug}
                            onChange={(event) =>
                                setSlug(event.target.value.toLowerCase())
                            }
                        />
                    </div>

                    <button
                        className={styles.button}
                        disabled={Boolean(
                            busy || !buyerStarted || !channel || !ready(channel)
                        )}
                        onClick={() => void run(requestChallenge)}
                    >
                        Request resource
                    </button>

                    {challenge && challengeBody && (
                        <div className={styles.result}>
                            <span className={styles.pill}>
                                HTTP 402 · Payment required
                            </span>

                            <h3>{challengeBody.preview.title}</h3>

                            <p className={styles.muted}>
                                {challengeBody.preview.description}
                            </p>

                            <dl className={styles.kv}>
                                <dt>Network</dt>
                                <dd>{challenge.accepts[0].network}</dd>

                                <dt>Amount</dt>
                                <dd>{challenge.accepts[0].amount} shannons (1 CKB)</dd>

                                <dt>Payment hash</dt>
                                <dd>{challenge.accepts[0].extra.paymentHash}</dd>

                                <dt>Encryption</dt>
                                <dd>{challengeBody.preview.cipher}</dd>
                            </dl>

                            <p className={styles.muted}>
                                Only the public preview and encrypted offer are available
                                before payment.
                            </p>
                        </div>
                    )}
                </section>

                <section className={styles.card}>
                    <h2>3. Agent spending policy</h2>

                    <dl className={styles.kv}>
                        <dt>Allowed providers</dt>
                        <dd>
                            {DEMO_SPENDING_POLICY.providerIdAllowlist.join(', ')}
                        </dd>

                        <dt>Maximum per request</dt>
                        <dd>1 CKB</dd>

                        <dt>Daily budget</dt>
                        <dd>5 CKB</dd>

                        <dt>Spent today</dt>
                        <dd>
                            {(BigInt(dailySpend) / 100_000_000n).toString()} CKB
                        </dd>
                    </dl>

                    <p className={styles.muted}>
                        The SDK blocks an offer before payment if the provider, request
                        amount or daily budget violates this policy.
                    </p>

                    <button
                        className={styles.button}
                        disabled={Boolean(busy || !readyForPayment)}
                        onClick={() => void run(payAndUnlock)}
                    >
                        Approve policy + pay 1 CKB + decrypt
                    </button>
                </section>

                {status && (
                    <p className={styles.status}>{status}</p>
                )}

                {error && (
                    <p className={styles.error}>{error}</p>
                )}

                {receipt && (
                    <section className={styles.card}>
                        <span className={styles.pill}>
                            Payment proof accepted
                        </span>

                        <h2>Fiber receipt</h2>

                        <dl className={styles.kv}>
                            <dt>Success</dt>
                            <dd>{String(receipt.success)}</dd>

                            <dt>Network</dt>
                            <dd>{receipt.network}</dd>

                            <dt>Amount</dt>
                            <dd>{receipt.amount} shannons</dd>

                            <dt>Receipt reference</dt>
                            <dd>{receipt.receiptId}</dd>

                            <dt>Verification</dt>
                            <dd>{receipt.verification}</dd>
                        </dl>

                        <p className={styles.muted}>
                            The receipt reference identifies this preimage proof; it is
                            not a CKB transaction hash.
                        </p>
                    </section>
                )}

                {unlocked !== null && (
                    <section className={styles.card}>
                        <span className={styles.pill}>
                            Encrypted resource unlocked
                        </span>

                        <h2>Decrypted API response</h2>

                        <div className={styles.result}>
                            <pre>{JSON.stringify(unlocked, null, 2)}</pre>
                        </div>
                    </section>
                )}
            </div>
        </main>
    );
}
