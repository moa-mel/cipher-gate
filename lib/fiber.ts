import { createTestnetFiberFactory } from './fiber-testnet-runtime';
import { requireNewChannelFunding } from './channel-funding';
import { encryptedBuyerProfile, encryptedSellerProfile, savedNodeIdentifier } from './progress';
import type { Channel, FiberBrowserNode } from '@fiber-pay/sdk/browser';


export const channelFundingCkb = 500n;

export const bottle = {
  pubkey: '0x02b6d4e3ab86a2ca2fad6fae0ecb2e1e559e0b911939872a90abdda6d20302be71' as const,
  address: '/dns4/bottle.fiber.channel/tcp/443/wss/p2p/QmXen3eUHhywmutEzydCsW4hXBoeVmdET2FJvMX69XJ1Eo',
};

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
const fromHex = (value: string) =>
  Uint8Array.from(value.match(/.{2}/g) ?? [], (part) => Number.parseInt(part, 16));

function profile(role: 'buyer' | 'seller') {
  const storageKey = role === 'buyer' ? encryptedBuyerProfile : encryptedSellerProfile;
  const saved = localStorage.getItem(storageKey);
  if (saved && !savedNodeIdentifier(localStorage, storageKey)) throw new Error('Saved node profile is unreadable. Do not replace keys for a funded node.');
  if (saved) {
    const value = JSON.parse(saved);
    return {
      fiberKey: fromHex(value.fiberKey),
      ckbKey: fromHex(value.ckbKey),
      identifier: value.identifier as string,
    };
  }
  const value = {
    fiberKey: toHex(crypto.getRandomValues(new Uint8Array(32))),
    ckbKey: toHex(crypto.getRandomValues(new Uint8Array(32))),
    identifier: crypto.randomUUID(),
  };
  localStorage.setItem(storageKey, JSON.stringify(value));
  return {
    fiberKey: fromHex(value.fiberKey),
    ckbKey: fromHex(value.ckbKey),
    identifier: value.identifier,
  };
}

export async function startRole(role: 'buyer' | 'seller', track: (node: FiberBrowserNode) => void) {
  if (!window.crossOriginIsolated) throw new Error('Cross-origin isolation is required. Restart the server and reload.');
  const { FiberBrowserNode, RawKeyCredentialProvider } = await import('@fiber-pay/sdk/browser');
  const keys = profile(role);
  const node = new FiberBrowserNode({
    wasmFactory: await createTestnetFiberFactory(),
    network: 'testnet',
    credential: new RawKeyCredentialProvider(keys.fiberKey, keys.ckbKey, keys.identifier),
    nodeConfig: { bootnodes: [], logLevel: 'info' },
  });
  track(node);
  await node.start();
  return node;
}

export function ready(channel: Channel) {
  return channel.state.state_name.replace(/[^a-z0-9]/gi, '').toLowerCase() === 'channelready';
}

// export async function connectAndOpenChannel(node: FiberBrowserNode) {
//   await node.connectPeer(bottle);
//   const existing = await readChannel(node);
//   if (!existing) {
//     await requireNewChannelFunding(node);
//     await node.openChannel({
//       pubkey: bottle.pubkey,
//       funding_amount: `0x${(channelFundingCkb * 100_000_000n).toString(16)}`,
//       public: true,
//     });
//   }
//   return readChannel(node);
// }


export async function connectAndOpenChannel(node: FiberBrowserNode) {
  const normalize = (value: string) =>
    value.replace(/^0x/i, '').toLowerCase();

  console.log('[CipherGate] Connecting to Bottle...');

  await node.connectPeer(bottle);

  let bottleConnected = false;

  for (let attempt = 1; attempt <= 15; attempt++) {
    const result = await node.listPeers();

    bottleConnected = result.peers.some(
      (peer) =>
        normalize(peer.pubkey) === normalize(bottle.pubkey)
    );

    console.log(
      `[CipherGate] Peer check ${attempt}/15:`,
      bottleConnected ? 'Bottle connected' : 'Waiting for Bottle'
    );

    if (bottleConnected) break;

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!bottleConnected) {
    throw new Error(
      'Bottle did not appear in Buyer A peer list after 15 seconds.'
    );
  }

  console.log('[CipherGate] Bottle peer connection confirmed.');

  // Allow time for the peer connection to initialize.
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const existing = await readChannel(node);

  if (existing) {
    console.log('[CipherGate] Existing channel:', existing);
    return existing;
  }

  console.log('[CipherGate] Checking Buyer A channel funding...');

  await requireNewChannelFunding(node);

  console.log('[CipherGate] Opening Bottle channel...');

  await node.openChannel({
    pubkey: bottle.pubkey,
    funding_amount: `0x${(
      channelFundingCkb * 100_000_000n
    ).toString(16)}`,
    public: true,
  });

  console.log('[CipherGate] Channel opening request submitted.');

  return readChannel(node);
}


export async function readChannel(node: FiberBrowserNode) {
  const channels = (await node.listChannels()).channels.filter((channel) =>
    channel.pubkey.replace(/^0x/i, '').toLowerCase() === bottle.pubkey.slice(2) && !['CLOSED', 'SHUTTING_DOWN'].includes(channel.state.state_name),
  );
  return channels.find(ready) ?? channels[0];
}
