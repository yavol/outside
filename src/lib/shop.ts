/** Public Shop MCP. Merchant prices, stock, images and URLs are always fetched live. */
const SHOP_MCP = "https://mcp.shop.com";
const MCP_VERSION = "2026-07-28";
const MAX_RESPONSE_BYTES = 2_000_000;
const CONTEXT = { address_country: "US", currency: "USD" };

type JsonObject = Record<string, unknown>;
export type GearCategory = "shell" | "daypack" | "bottle";
export type ShopOption = { name: string; label: string };
export type ShopVariant = {
  id: string;
  title: string;
  price: number;
  priceAmount: number;
  currency: string;
  available: boolean | null;
  url: string;
  checkoutUrl: string | null;
  image: string | null;
  selectedOptions: ShopOption[];
};
export type ShopProduct = ShopVariant & {
  productId: string;
  variantId: string;
  category: GearCategory;
  description: string;
  merchant: string;
  shopDomain: string;
  variants: ShopVariant[];
  options: { name: string; values: { label: string; available: boolean | null }[] }[];
  source: "Shop MCP";
  checkedAt: string;
};
export type ShopSearchResult = {
  status: "live" | "partial" | "unavailable";
  source: "Shop MCP";
  sourceUrl: "https://shop.dev";
  products: ShopProduct[];
  messages: string[];
  checkedAt: string;
  error?: string;
};

export class ShopError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "ShopError";
    this.status = status;
  }
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function str(value: unknown): string { return typeof value === "string" ? value : ""; }
function text(value: unknown, max = 600): string {
  return str(value).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, max);
}
function https(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? value : null;
  } catch { return null; }
}
function sourceImage(value: unknown): string | null {
  const item = array(value).map(object).find((m) => m.type === "image" && https(m.url));
  return item ? https(item.url) : null;
}
function messages(data: JsonObject): string[] {
  return array(data.messages).map((m) => typeof m === "string" ? text(m) : text(object(m).content || object(m).message || object(m).code)).filter(Boolean).slice(0, 20);
}

async function boundedBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new ShopError("Shop returned an oversized response.");
  const reader = response.body?.getReader();
  if (!reader) throw new ShopError("Shop returned an empty response.");
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new ShopError("Shop returned an oversized response.");
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
}

/** Fixed remote endpoint and explicit tool allowlist prevent user supplied SSRF/tool calls. */
async function callShop(name: "search_catalog" | "get_product" | "lookup_catalog", args: JsonObject): Promise<JsonObject> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(SHOP_MCP, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": MCP_VERSION,
        "Mcp-Method": "tools/call",
        "Mcp-Name": name,
      },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call",
        params: {
          name, arguments: args,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": MCP_VERSION,
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    if (!response.ok) {
      throw new ShopError(response.status === 429 ? "Shop is busy. Please try again shortly." : `Shop is temporarily unavailable (HTTP ${response.status}).`, response.status === 429 ? 429 : 502);
    }
    const body = await boundedBody(response);
    // Shop currently returns JSON; support the MCP SSE representation as well.
    const payload = body.trim().startsWith("data:")
      ? body.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter((line) => line !== "[DONE]").at(-1) || "{}"
      : body;
    const envelope = object(JSON.parse(payload));
    if (envelope.error) throw new ShopError(text(object(envelope.error).message) || "Shop could not complete that request.");
    const result = object(envelope.result);
    const data = object(result.structuredContent);
    if (result.isError === true) {
      const detail = messages(data)[0] || array(result.content).map((item) => text(object(item).text)).find(Boolean);
      throw new ShopError(detail || "Shop could not complete that request.");
    }
    if (!Object.keys(data).length) throw new ShopError("Shop returned no product data.");
    return data;
  } catch (error) {
    if (error instanceof ShopError) throw error;
    if (controller.signal.aborted) throw new ShopError("Shop took too long to respond. Please try again.", 504);
    throw new ShopError("Live Shop data could not be reached. Please try again.");
  } finally { clearTimeout(timer); }
}

function normalizeVariant(raw: unknown, product: JsonObject): ShopVariant | null {
  const variant = object(raw);
  const price = object(variant.price);
  const amount = price.amount;
  const currency = str(price.currency);
  const url = https(variant.url);
  const id = str(variant.id);
  if (!id || !url || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  const digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  const stock = object(variant.availability).available;
  return {
    id, title: text(variant.title || product.title, 180),
    price: amount / (10 ** (digits ?? 2)), priceAmount: amount, currency,
    available: typeof stock === "boolean" ? stock : null,
    url, checkoutUrl: https(variant.checkout_url),
    image: sourceImage(variant.media) || sourceImage(product.media),
    selectedOptions: array(variant.options).map(object).map((o) => ({ name: text(o.name, 80), label: text(o.label, 100) })).filter((o) => o.name && o.label),
  };
}

function normalizeProduct(raw: unknown, category: GearCategory, preferredVariant?: string): ShopProduct | null {
  const product = object(raw);
  const rawVariants = array(product.variants);
  const variants = rawVariants.map((v) => normalizeVariant(v, product)).filter((v): v is ShopVariant => Boolean(v));
  const variant = preferredVariant ? variants.find((v) => v.id === preferredVariant) : variants.find((v) => v.available === true) || variants[0];
  if (!variant) return null;
  const rawVariant = object(rawVariants.find((v) => object(v).id === variant.id));
  const seller = object(rawVariant.seller);
  const domain = str(seller.domain);
  if (!/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null;
  return {
    ...variant, productId: str(product.id), variantId: variant.id, category,
    title: text(product.title || variant.title, 180),
    description: text(object(product.description).plain),
    merchant: text(seller.name, 100) || domain, shopDomain: domain,
    variants,
    options: array(product.options).map(object).map((o) => ({
      name: text(o.name, 80), values: array(o.values).map(object).map((v) => ({ label: text(v.label, 100), available: typeof v.available === "boolean" ? v.available : null })),
    })),
    source: "Shop MCP", checkedAt: new Date().toISOString(),
  };
}

const CATEGORY_QUERIES: Record<GearCategory, string> = {
  shell: "waterproof hiking rain jacket",
  daypack: "lightweight hiking daypack",
  bottle: "hiking water bottle",
};
export function inferGearCategory(query: string): GearCategory {
  if (/bottle|water|flask|hydrat/i.test(query) && !/waterproof/i.test(query)) return "bottle";
  if (/pack|bag|rucksack/i.test(query)) return "daypack";
  return "shell";
}
export type ShopSearchInput = { query?: string; budget?: number; color?: string; cheaper?: boolean; category?: GearCategory; limit?: number };

export type ShopProductResult = {
  status: "live"; source: "Shop MCP"; sourceUrl: "https://shop.dev";
  product: ShopProduct; products: ShopProduct[]; messages: string[]; checkedAt: string;
};

/** Product detail returns full option values; fetch again for each exact combo.
 * A product's options list does not imply every size/color combination exists.
 */
export async function fetchProduct(productId: string, input: { category?: GearCategory; selected?: ShopOption[] } = {}): Promise<ShopProductResult> {
  if (!/^gid:\/\/shopify\/(?:p|Product)\/[a-zA-Z0-9_-]{1,100}$/.test(productId)) throw new ShopError("Invalid product selection.", 400);
  const selected = input.selected || [];
  if (!Array.isArray(selected) || selected.length > 8 || selected.some((o) => !o || typeof o.name !== "string" || typeof o.label !== "string" || !o.name.trim() || !o.label.trim() || o.name.length > 100 || o.label.length > 100 || /[\x00-\x1f]/.test(o.name + o.label))) {
    throw new ShopError("Choose valid product sizes and colors.", 400);
  }
  const data = await callShop("get_product", { catalog: {
    id: productId, context: CONTEXT,
    ...(selected.length ? { selected } : {}),
  } });
  const raw = object(data.product);
  if (raw.id !== productId) throw new ShopError("This product is no longer available. Refresh the gear list.", 404);
  const variants = array(raw.variants).map((v) => normalizeVariant(v, raw)).filter((v): v is ShopVariant => Boolean(v));
  const matches = variants.filter((variant) => selected.every((request) => variant.selectedOptions.some((actual) => actual.name === request.name && actual.label === request.label)));
  const exact = matches.find((variant) => variant.available === true) || matches[0];
  if (!exact) throw new ShopError("That size and color combination is not available. Choose another option.", 409);
  const product = normalizeProduct(raw, input.category || "shell", exact.id);
  if (!product) throw new ShopError("Live product options could not be verified. Please try again.");
  return {
    status: "live", source: "Shop MCP", sourceUrl: "https://shop.dev",
    product, products: [product], messages: messages(data), checkedAt: product.checkedAt,
  };
}

export async function searchGear(input: ShopSearchInput = {}): Promise<ShopSearchResult> {
  const checkedAt = new Date().toISOString();
  const categories: GearCategory[] = input.query ? [input.category || inferGearCategory(input.query)] : input.category ? [input.category] : ["shell", "daypack", "bottle"];
  const fullKitBudget = input.budget !== undefined && categories.length > 1;
  const kitAmount = Math.round((input.budget || 0) * 100);
  // Reserve a share for every essential so a three-item kit can fit the whole
  // budget. Assign the cent remainder once, rather than rounding shares up.
  const kitCaps: Record<GearCategory, number> = {
    shell: Math.floor(kitAmount * 0.5),
    daypack: Math.floor(kitAmount * 0.3),
    bottle: kitAmount - Math.floor(kitAmount * 0.5) - Math.floor(kitAmount * 0.3),
  };
  const settled = await Promise.allSettled(categories.map(async (category) => {
    const filters: JsonObject = { available: true, ships_to: { country: "US" } };
    const capAmount = fullKitBudget ? kitCaps[category] : input.budget !== undefined ? Math.round(input.budget * 100) : undefined;
    if (capAmount !== undefined) filters.price = { max: capAmount };
    if (input.color) filters.attributes = [{ name: "Color", values: [input.color] }];
    if (input.cheaper || fullKitBudget) filters.price_tier = ["low"];
    const data = await callShop("search_catalog", { catalog: {
      query: input.query || CATEGORY_QUERIES[category], context: CONTEXT, filters,
      pagination: { limit: input.limit || (categories.length === 1 ? 6 : 2) },
    } });
    let products = array(data.products).map((p) => normalizeProduct(p, category)).filter((p): p is ShopProduct => Boolean(p));
    // A currency filter can convert other currencies. The UI's USD budget is
    // only marked satisfied when the actual returned offer is in USD.
    if (capAmount !== undefined) products = products.filter((p) => p.currency === "USD" && p.priceAmount <= capAmount);
    if (input.cheaper || fullKitBudget) products.sort((a, b) => a.currency === b.currency ? a.priceAmount - b.priceAmount : 0);
    return { products, messages: messages(data) };
  }));
  const success = settled.filter((r): r is PromiseFulfilledResult<{ products: ShopProduct[]; messages: string[] }> => r.status === "fulfilled");
  const errors = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason instanceof Error ? r.reason.message : "Shop request failed.");
  return {
    status: success.length ? errors.length ? "partial" : "live" : "unavailable",
    source: "Shop MCP", sourceUrl: "https://shop.dev",
    products: success.flatMap((r) => r.value.products),
    messages: [...success.flatMap((r) => r.value.messages), ...errors], checkedAt,
    ...(errors.length ? { error: errors.join(" ") } : {}),
  };
}

export type CheckoutItem = { productId: string; variantId: string; quantity: number };
export type CheckoutLink = { merchant: string; url: string; kind: "checkout" | "merchant_cart" | "product"; items: { title: string; quantity: number; selectedOptions: ShopOption[] }[]; messages: string[] };
export type DemoOrderItem = {
  productId: string; variantId: string; title: string; quantity: number;
  price: number; priceAmount: number; currency: string; image: string | null;
  merchant: string; selectedOptions: ShopOption[];
};
export type CheckoutResult = {
  status: "demo"; demo: true; orderId: string; receiptId: string;
  total: number; totalAmount: number; currency: string;
  items: DemoOrderItem[]; links: CheckoutLink[]; message: string; source: "Shop MCP";
};

/** Next's internal bind address can differ from the browser-facing Host. */
export function assertCheckoutOrigin(request: Request): void {
  const reject = () => { throw new ShopError("Use checkout from the OUTSIDE app.", 403); };
  if (request.headers.get("sec-fetch-site") === "cross-site") reject();
  const origin = request.headers.get("origin");
  if (!origin) return; // Non-browser clients do not send Origin.
  try {
    const internal = new URL(request.url);
    const host = request.headers.get("host") || internal.host;
    const protocol = (request.headers.get("x-forwarded-proto") || internal.protocol.replace(":", "")).split(",")[0].trim();
    if (!host || !["http", "https"].includes(protocol)) reject();
    const expected = new URL(`${protocol}://${host}`);
    if (expected.username || expected.password || expected.pathname !== "/" || expected.search || expected.hash || origin !== expected.origin) reject();
  } catch (error) {
    if (error instanceof ShopError) throw error;
    reject();
  }
}

/** Compare the refreshed receipt with the user's hard USD cap in integer cents. */
export function assertCheckoutBudget(budget: unknown, receipt?: { totalAmount: number; currency: string }): void {
  if (budget === undefined) return;
  if (typeof budget !== "number" || !Number.isFinite(budget) || budget < 10 || budget > 5000) {
    throw new ShopError("Choose a budget between 10 and 5000 USD.", 400);
  }
  if (!receipt) return;
  if (receipt.currency !== "USD") throw new ShopError("The selected currency cannot be verified against your USD budget. Choose USD gear.", 409);
  const limitAmount = Math.round(budget * 100);
  if (receipt.totalAmount > limitAmount) throw new ShopError("Your refreshed kit is over budget. Remove an item or choose a cheaper option.", 409);
}

/** Reverify stock and issue a local test receipt. No external cart or payment calls. */
export async function prepareCheckout(items: CheckoutItem[]): Promise<CheckoutResult> {
  const data = await callShop("lookup_catalog", { catalog: { ids: items.map((i) => i.variantId), context: CONTEXT } });
  const products = array(data.products);
  const verified = items.map((item) => {
    const raw = products.find((p) => object(p).id === item.productId && array(object(p).variants).some((v) => object(v).id === item.variantId));
    const product = raw ? normalizeProduct(raw, "shell", item.variantId) : null;
    if (!product) throw new ShopError("One selected item could not be verified. Refresh the gear list and try again.", 409);
    if (product.available !== true) throw new ShopError(`${product.title} is no longer confirmed in stock. Choose another option.`, 409);
    return { product, quantity: item.quantity };
  });
  const currencies = new Set(verified.map(({ product }) => product.currency));
  if (currencies.size !== 1) throw new ShopError("Select products in the same currency to prepare your test order.", 409);
  const currency = verified[0].product.currency;
  const totalAmount = verified.reduce((sum, { product, quantity }) => sum + product.priceAmount * quantity, 0);
  const digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const orderId = `OUT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const orderItems = verified.map(({ product, quantity }): DemoOrderItem => ({
    productId: product.productId, variantId: product.variantId, title: product.title,
    quantity, price: product.price, priceAmount: product.priceAmount, currency: product.currency,
    image: product.image, merchant: product.merchant, selectedOptions: product.selectedOptions,
  }));
  // Links are source data only. The test order never opens them or creates a cart.
  const links = verified.map(({ product, quantity }): CheckoutLink => ({
    merchant: product.merchant, url: product.url, kind: "product",
    items: [{ title: product.title, quantity, selectedOptions: product.selectedOptions }], messages: [],
  }));
  return {
    status: "demo", demo: true, orderId, receiptId: orderId,
    total: totalAmount / (10 ** digits), totalAmount, currency, items: orderItems, links,
    source: "Shop MCP", message: "Test order confirmed. No payment was processed and no merchant order was placed.",
  };
}
