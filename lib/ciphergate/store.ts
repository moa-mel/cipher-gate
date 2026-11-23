import type { PublishedResource } from './types';

/*
 * Demo-only in-memory storage. This is intentionally small for the CKBoost
 * demonstration. Replace with durable storage before deploying multiple
 * server instances or using this with real customer data.
 */
const globalForCipherGate = globalThis as typeof globalThis & {
  __cipherGateResources?: Map<string, PublishedResource>;
};

const resources =
  globalForCipherGate.__cipherGateResources ??
  (globalForCipherGate.__cipherGateResources = new Map<string, PublishedResource>());

export function saveResource(resource: PublishedResource): void {
  resources.set(resource.slug, resource);
}

export function getResource(slug: string): PublishedResource | undefined {
  return resources.get(slug);
}

export function markResourceConsumed(slug: string): boolean {
  const resource = resources.get(slug);
  if (!resource || resource.consumedAt) return false;
  resources.set(slug, { ...resource, consumedAt: new Date().toISOString() });
  return true;
}
