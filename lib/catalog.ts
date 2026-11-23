// Catalogue of encrypted offers the agent can shop from. Pure logic, no SDK imports.
// Each item wraps one version-2 encrypted offer (its own key, invoice and payment hash)
// with the metadata an agent needs to decide: title, description, price and a plaintext commitment.

export type CatalogItem = {
  id: string;
  title: string;
  description: string;
  /** Price in shannons, as a decimal string. Must equal the invoice amount. */
  price: string;
  /** Seller node pubkey. Self-declared and unsigned in this version: see README note. */
  seller: string;
  /** SHA-256 of the plaintext, 0x-prefixed. Checked after decryption. */
  plaintextHash: string;
  /** The encrypted offer JSON produced by createOffer, kept opaque here. */
  offer: unknown;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseCatalog(text: string): CatalogItem[] {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error('Catalogue must be a JSON array.');
  const ids = new Set<string>();
  return raw.map((item, index) => {
    if (!isObject(item)) throw new Error(`Catalogue item ${index} is not an object.`);
    for (const field of ['id', 'title', 'description', 'price', 'seller', 'plaintextHash'] as const) {
      if (typeof item[field] !== 'string' || !item[field]) throw new Error(`Catalogue item ${index} is missing ${field}.`);
    }
    if (!/^\d+$/.test(item.price as string) || BigInt(item.price as string) <= 0n) {
      throw new Error(`Catalogue item ${index} has an invalid price.`);
    }
    if (!/^0x[0-9a-f]{64}$/i.test(item.plaintextHash as string)) {
      throw new Error(`Catalogue item ${index} has an invalid plaintext commitment.`);
    }
    if (!isObject(item.offer)) throw new Error(`Catalogue item ${index} is missing its encrypted offer.`);
    if (ids.has(item.id as string)) throw new Error(`Duplicate catalogue id: ${item.id}.`);
    ids.add(item.id as string);
    return item as unknown as CatalogItem;
  });
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];

/** Fraction of task words that appear in the item's title or description, from 0 to 1. */
export function relevance(task: string, item: Pick<CatalogItem, 'title' | 'description'>): number {
  const wanted = new Set(words(task));
  if (wanted.size === 0) return 0;
  const available = new Set(words(`${item.title} ${item.description}`));
  let hits = 0;
  for (const word of wanted) if (available.has(word)) hits += 1;
  return hits / wanted.size;
}

/** Items relevant enough to consider, best first. Cheaper wins ties. */
export function rankItems(task: string, items: CatalogItem[], minRelevance = 0.2) {
  return items
    .map((item) => ({ item, score: relevance(task, item) }))
    .filter((entry) => entry.score >= minRelevance)
    .sort((a, b) => b.score - a.score || Number(BigInt(a.item.price) - BigInt(b.item.price)));
}
