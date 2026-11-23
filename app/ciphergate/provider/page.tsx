
'use client';

import { useEffect, useRef, useState } from 'react';
import type { FiberBrowserNode, Channel } from '@fiber-pay/sdk/browser';
import { startRole, connectAndOpenChannel, readChannel, ready } from '@/lib/fiber';
import { createOffer } from '@/lib/offer';
import { createBrowserNodeSession } from '@/lib/node-session';
import { encryptedSellerProfile } from '@/lib/progress';
import styles from '../ciphergate.module.css';
import Link from 'next/link';

const initialResource = {
  resourceType: 'research-report',
  title: 'African renewable energy market outlook',
  generatedAt: '2026-11-23T00:00:00.000Z',
  executiveSummary: 'Illustrative research response for the CipherGate pay-to-decrypt demonstration.',
  findings: [
    'Distributed solar remains an important option for underserved communities.',
    'Grid reliability and financing conditions influence project deployment.',
    'Storage and demand-response services can improve renewable integration.',
  ],
  recommendation: 'Evaluate project economics, grid constraints and local regulatory conditions before investment.',
  sourceNote: 'Demonstration content only; not investment advice or verified market research.',
};

export default function CipherGateProviderPage() {
  const nodeRef = useRef<FiberBrowserNode | null>(null);

  const [session] = useState(() => createBrowserNodeSession());
  const [channel, setChannel] = useState<Channel | null>(null);
  const [nodeStarted, setNodeStarted] = useState(false);

  const [title, setTitle] = useState('African renewable energy market outlook');
  const [description, setDescription] = useState(
    'A detailed energy-market research response. The full JSON is encrypted and unlocked after a Fiber Testnet payment.'
  );
  const [slug, setSlug] = useState('energy-market');
  const [resourceJson, setResourceJson] = useState(
    JSON.stringify(initialResource, null, 2)
  );

  const [status, setStatus] = useState(
    'Start Seller C to publish an encrypted API resource.'
  );
  const [fundingAddress, setFundingAddress] = useState('');
  const [resourceUrl, setResourceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    return () => {
      void session.stop().catch(() => undefined);
    };
  }, [session]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');

    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Provider action failed.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function startSeller() {
    await session.start(encryptedSellerProfile, async (track) => {
      nodeRef.current = await startRole('seller', track);
    });

    const node = nodeRef.current;

    if (!node) {
      throw new Error('Seller node did not start.');
    }

    // Notify React that the seller node is ready.
    setNodeStarted(true);

    const info = await node.nodeInfo();

    console.log('Seller C node info:', info);
    console.log('Seller C public key:', info.pubkey);
    console.log('Public key type:', typeof info.pubkey);
    console.log(
      'Public key valid:',
      typeof info.pubkey === 'string' &&
      /^0x[0-9a-fA-F]{66}$/.test(info.pubkey)
    );

    const { scriptToAddress } = await import('@fiber-pay/sdk/browser');

    setFundingAddress(
      scriptToAddress(info.default_funding_lock_script, 'testnet')
    );

    setStatus(
      'Seller C is running. Connect to Bottle and check the channel.'
    );
  }

  async function openChannel() {
    const node = nodeRef.current;

    if (!node) {
      throw new Error('Start Seller C first.');
    }

    const existing = await readChannel(node);

    if (existing && ready(existing)) {
      setChannel(existing);
      setStatus('Seller channel is already CHANNEL_READY.');
      return;
    }

    const opened = await connectAndOpenChannel(node);

    setChannel(opened ?? null);

    setStatus(
      opened && ready(opened)
        ? 'Seller channel is CHANNEL_READY.'
        : 'Channel opening was submitted. Refresh channel status until it reaches CHANNEL_READY.'
    );
  }

  async function refreshChannel() {
    const node = nodeRef.current;

    if (!node) {
      throw new Error('Start Seller C first.');
    }

    const current = await readChannel(node);

    setChannel(current ?? null);

    setStatus(
      current && ready(current)
        ? 'Seller channel is CHANNEL_READY.'
        : `Seller channel state: ${current?.state.state_name ?? 'not found'}.`
    );
  }

  async function publishResource() {
    const node = nodeRef.current;

    if (!node) {
      throw new Error('Start Seller C first.');
    }

    if (!channel || !ready(channel)) {
      throw new Error(
        'Seller channel must be CHANNEL_READY before creating the offer.'
      );
    }

    let parsedResource: unknown;

    try {
      parsedResource = JSON.parse(resourceJson);
    } catch {
      throw new Error('Resource content must be valid JSON.');
    }

    // The official starter creates the AES-256-GCM payload and a 1 CKB Fiber
    // invoice whose payment preimage is the encryption key.
    const offerJson = await createOffer(
      node,
      channel,
      JSON.stringify(parsedResource)
    );

    const offer = JSON.parse(offerJson) as Record<string, unknown>;
    const info = await node.nodeInfo();

    const response = await fetch('/api/ciphergate/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        slug,
        title,
        description,
        sellerPubkey: info.pubkey,
        offer,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error ?? 'The gateway rejected the encrypted offer.'
      );
    }

    setResourceUrl(`${window.location.origin}${result.resourceUrl}`);

    setStatus(
      'Encrypted resource published. The gateway received ciphertext, not the plaintext or AES key.'
    );
  }

  return (
    <main className={styles.shell}>
      <div className={styles.container}>
        <p className={styles.eyebrow}>CipherGate · Provider</p>

        <h1 className={styles.heading}>
          Publish an encrypted API resource.
        </h1>

        <div className={styles.actions}>
          <Link
            href="/ciphergate/agent"
            className={`${styles.button} ${styles.secondary}`}
          >
            Open Agent →
          </Link>
        </div>

        <p className={styles.lede}>
          Seller C encrypts a JSON response with the same AES-256-GCM and Fiber
          invoice-preimage mechanism used in the official tutorial. The API
          publishes only the encrypted offer.
        </p>

        <section className={styles.card}>
          <h2>1. Connect the provider Fiber node</h2>

          <div className={styles.actions}>
            <button
              className={styles.button}
              disabled={Boolean(busy)}
              onClick={() => void run(startSeller)}
            >
              Start Seller C
            </button>

            <button
              className={`${styles.button} ${styles.secondary}`}
              disabled={Boolean(busy || !nodeStarted)}
              onClick={() => void run(openChannel)}
            >
              Open / reuse Bottle channel
            </button>

            <button
              className={`${styles.button} ${styles.secondary}`}
              disabled={Boolean(busy || !nodeStarted)}
              onClick={() => void run(refreshChannel)}
            >
              Refresh channel
            </button>
          </div>

          {fundingAddress && (
            <div className={styles.field}>
              <label>Seller C Testnet funding address</label>
              <code className={styles.code}>{fundingAddress}</code>
            </div>
          )}

          <dl className={styles.kv}>
            <dt>Channel state</dt>
            <dd>{channel?.state.state_name ?? 'Not connected'}</dd>

            <dt>Required state</dt>
            <dd>CHANNEL_READY</dd>
          </dl>

          <p className={styles.status}>{status}</p>

          {error && <p className={styles.error}>{error}</p>}
        </section>

        <section className={styles.card}>
          <h2>2. Define the private API response</h2>

          <div className={styles.grid}>
            <div className={styles.field}>
              <label htmlFor="cg-title">Public resource title</label>
              <input
                id="cg-title"
                className={styles.input}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="cg-slug">Resource slug</label>
              <input
                id="cg-slug"
                className={styles.input}
                value={slug}
                onChange={(event) =>
                  setSlug(event.target.value.toLowerCase())
                }
              />
            </div>
          </div>

          <div className={styles.field}>
            <label htmlFor="cg-description">Public description</label>
            <input
              id="cg-description"
              className={styles.input}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="cg-json">
              Private JSON resource (encrypted before publish)
            </label>
            <textarea
              id="cg-json"
              className={styles.textarea}
              value={resourceJson}
              onChange={(event) => setResourceJson(event.target.value)}
              spellCheck={false}
            />
          </div>

          <button
            className={styles.button}
            disabled={Boolean(busy || !channel || !ready(channel))}
            onClick={() => void run(publishResource)}
          >
            Encrypt JSON + create 1 CKB invoice + publish
          </button>

          {resourceUrl && (
            <div className={styles.result}>
              <p className={styles.success}>
                Resource published successfully.
              </p>

              <p className={styles.muted}>
                Give this resource endpoint to the agent demo:
              </p>

              <code className={styles.code}>{resourceUrl}</code>

              <p className={styles.muted}>
                Agent page:{' '}
                <a href="/ciphergate/agent">/ciphergate/agent</a>
              </p>
            </div>
          )}
        </section>

        <p className={styles.muted}>
          Demo note: the gateway stores the encrypted offer in memory.
          Restarting the Next.js server clears published resources. Use
          Testnet funds only.
        </p>
      </div>
    </main>
  );
}
