import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyLedger, evaluate, flagSeller, markStatus, parseLedger, remaining, reserve, serializeLedger } from './lib/policy.ts';
import { parseCatalog, rankItems } from './lib/catalog.ts';
import { plaintextHash, verifyDelivery } from './lib/verify.ts';

const CKB = 100_000_000n;
const seller = `0x02${'b'.repeat(64)}`;
const policy = { totalBudget: 2n * CKB, perItemCap: 1n * CKB, allowedSellers: [seller] };
const req = (n, price = CKB / 2n, s = seller) => ({ paymentHash: `0x${String(n).repeat(64)}`, seller: s, price });

test('policy allows an in-budget purchase from an allowlisted seller', () => {
  assert.deepEqual(evaluate(policy, emptyLedger(), req(1)), { allow: true });
});
test('policy refuses unknown sellers, over-cap prices, zero prices and flagged sellers', () => {
  assert.match(evaluate(policy, emptyLedger(), req(1, CKB / 2n, '0x03aa')).reason, /allowlist/);
  assert.match(evaluate(policy, emptyLedger(), req(1, 2n * CKB)).reason, /per-item cap/);
  assert.match(evaluate(policy, emptyLedger(), req(1, 0n)).reason, /greater than zero/);
  assert.match(evaluate(policy, flagSeller(emptyLedger(), seller), req(1)).reason, /verification/);
});
test('pending reservations count against the budget so in-flight payments cannot overspend', () => {
  let ledger = emptyLedger();
  for (const n of [1, 2, 3, 4]) ledger = reserve(policy, ledger, req(n));
  assert.equal(remaining(policy, ledger), 0n);
  assert.throws(() => reserve(policy, ledger, req(5)), /Not enough budget/);
});
test('a confirmed failure releases its budget; settled spending stays committed', () => {
  let ledger = reserve(policy, emptyLedger(), req(1, CKB));
  ledger = reserve(policy, ledger, req(2, CKB));
  ledger = markStatus(ledger, req(1).paymentHash, 'failed');
  assert.equal(remaining(policy, ledger), CKB);
  ledger = markStatus(ledger, req(2).paymentHash, 'settled');
  assert.equal(remaining(policy, ledger), CKB);
});
test('the same offer cannot be bought twice, but a failed attempt may be retried', () => {
  let ledger = reserve(policy, emptyLedger(), req(1));
  assert.match(evaluate(policy, ledger, req(1)).reason, /already purchased/);
  ledger = markStatus(ledger, req(1).paymentHash, 'failed');
  assert.deepEqual(evaluate(policy, ledger, req(1)), { allow: true });
});
test('ledger survives a JSON round trip with bigint prices and rejects corrupt data', () => {
  const ledger = flagSeller(reserve(policy, emptyLedger(), req(1)), '0x03aa');
  assert.deepEqual(parseLedger(serializeLedger(ledger)), ledger);
  assert.throws(() => parseLedger('{"entries":"no"}'), /unreadable/);
  assert.throws(() => markStatus(emptyLedger(), req(9).paymentHash, 'settled'), /No ledger entry/);
});

const item = (id, title, description, price = '50000000') => ({
  id, title, description, price, seller, plaintextHash: `0x${'c'.repeat(64)}`, offer: { version: 2 },
});
test('catalogue validation rejects malformed items and duplicate ids', () => {
  const ok = [item('a', 'CKB report', 'Fiber channel liquidity analysis')];
  assert.equal(parseCatalog(JSON.stringify(ok)).length, 1);
  assert.throws(() => parseCatalog('{}'), /array/);
  assert.throws(() => parseCatalog(JSON.stringify([{ ...ok[0], price: '-1' }])), /price/);
  assert.throws(() => parseCatalog(JSON.stringify([{ ...ok[0], plaintextHash: '0x12' }])), /commitment/);
  assert.throws(() => parseCatalog(JSON.stringify([ok[0], ok[0]])), /Duplicate/);
});
test('ranking prefers relevant items and breaks ties on price', () => {
  const items = [
    item('cake', 'Cake recipes', 'Sponge and frosting'),
    item('exp', 'Fiber liquidity report', 'Channel liquidity analysis for Fiber', '90000000'),
    item('cheap', 'Fiber liquidity notes', 'Channel liquidity analysis for Fiber', '10000000'),
  ];
  const ranked = rankItems('analyse Fiber channel liquidity', items);
  assert.deepEqual(ranked.map((r) => r.item.id), ['cheap', 'exp']);
});
test('delivery verification accepts matching plaintext and flags a swapped one', async () => {
  const hash = await plaintextHash('real report');
  assert.deepEqual(await verifyDelivery('real report', hash), { ok: true });
  assert.equal((await verifyDelivery('garbage', hash)).ok, false);
  assert.equal((await verifyDelivery('real report', '0x12')).ok, false);
});
