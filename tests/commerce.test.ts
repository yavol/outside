import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

// A URL keeps Node's native TypeScript extension without requiring the app's
// bundler-oriented tsconfig to enable allowImportingTsExtensions.
const shopModule = new URL("../src/lib/shop.ts", import.meta.url);
const { assertCheckoutBudget, assertCheckoutOrigin, fetchProduct, inferGearCategory, lookupGear, searchGear, prepareCheckout, ShopError } = await import(shopModule.href) as typeof import("../src/lib/shop");

const PRODUCT_ID = "gid://shopify/p/test-shell";
const VARIANT_ID = "gid://shopify/ProductVariant/123";

function variant(overrides: Record<string, unknown> = {}) {
  return {
    id: VARIANT_ID,
    title: "Test shell · Blue / Medium",
    price: { amount: 12999, currency: "USD" },
    availability: { available: true },
    url: "https://merchant.example/products/shell?variant=123&source=shop",
    checkout_url: "https://merchant.example/cart/123:1?source=shop",
    options: [{ name: "Color", label: "Blue" }, { name: "Size", label: "Medium" }],
    media: [{ type: "image", url: "https://cdn.shopify.com/test-shell.png" }],
    seller: { name: "Test Merchant", domain: "test-merchant.myshopify.com" },
    ...overrides,
  };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    title: "Test shell",
    description: { plain: "<p>A shell &amp; hood.</p>" },
    options: [{ name: "Color", values: [{ label: "Blue", available: true }] }],
    variants: [variant()],
    ...overrides,
  };
}

type RpcRequest = {
  jsonrpc: string;
  method: string;
  params: {
    name: string;
    arguments: { catalog: Record<string, unknown> };
    _meta: Record<string, unknown>;
  };
};

function installCatalog(products = [product()]) {
  const calls: { url: string; init: RequestInit; rpc: RpcRequest }[] = [];
  mock.method(globalThis, "fetch", async (url: string | URL | Request, init: RequestInit) => {
    calls.push({ url: String(url), init, rpc: JSON.parse(String(init.body)) as RpcRequest });
    return Response.json({ jsonrpc: "2.0", result: { structuredContent: { products, messages: [] }, isError: false } });
  });
  return calls;
}

afterEach(() => mock.restoreAll());

test("USD budgets become minor units and exact returned options/prices are preserved", async () => {
  const calls = installCatalog();
  const result = await searchGear({ category: "shell", color: "Blue", budget: 150.25 });
  const catalog = calls[0].rpc.params.arguments.catalog;
  assert.deepEqual(catalog.context, { address_country: "US", currency: "USD" });
  assert.deepEqual(catalog.filters, {
    available: true, ships_to: { country: "US" },
    price: { max: 15025 }, attributes: [{ name: "Color", values: ["Blue"] }],
  });
  assert.equal(result.status, "live");
  assert.equal(result.products[0].price, 129.99);
  assert.equal(result.products[0].priceAmount, 12999);
  assert.equal(result.products[0].currency, "USD");
  assert.equal(result.products[0].description, "A shell & hood.");
  assert.equal(result.products[0].variantId, VARIANT_ID);
  assert.deepEqual(result.products[0].selectedOptions, [{ name: "Color", label: "Blue" }, { name: "Size", label: "Medium" }]);
});

test("a hard USD budget excludes offers over budget and unconverted foreign currencies", async () => {
  installCatalog([
    product({ id: "gid://shopify/p/within", variants: [variant({ price: { amount: 4999, currency: "USD" } })] }),
    product({ id: "gid://shopify/p/over", variants: [variant({ price: { amount: 5001, currency: "USD" } })] }),
    product({ id: "gid://shopify/p/foreign", variants: [variant({ price: { amount: 1000, currency: "CAD" } })] }),
  ]);
  const result = await searchGear({ category: "shell", budget: 50 });
  assert.deepEqual(result.products.map((p) => p.productId), ["gid://shopify/p/within"]);
});

test("cheaper alternatives request the low tier and sort actual returned prices", async () => {
  const calls = installCatalog([9000, 2500, 4999].map((amount) => product({
    id: `gid://shopify/p/price${amount}`, variants: [variant({ price: { amount, currency: "USD" } })],
  })));
  const result = await searchGear({ category: "shell", cheaper: true });
  assert.deepEqual(result.products.map((p) => p.price), [25, 49.99, 90]);
  assert.deepEqual((calls[0].rpc.params.arguments.catalog.filters as Record<string, unknown>).price_tier, ["low"]);
});

test("search requests stay on the fixed MCP host and never cache merchant results", async () => {
  const calls = installCatalog();
  await searchGear({ query: "https://untrusted.example gear" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://mcp.shop.com");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].rpc.method, "tools/call");
  assert.equal(calls[0].rpc.params.name, "search_catalog");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("MCP-Protocol-Version"), "2026-07-28");
  assert.equal(headers.get("Mcp-Name"), "search_catalog");
  assert.equal(calls[0].rpc.params._meta["io.modelcontextprotocol/protocolVersion"], "2026-07-28");
});

test("one category outage preserves other live categories and labels the response partial", async () => {
  mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const rpc = JSON.parse(String(init.body)) as RpcRequest;
    const query = String(rpc.params.arguments.catalog.query);
    if (query.includes("daypack")) return new Response("busy", { status: 503 });
    return Response.json({ result: { structuredContent: { products: [product()] }, isError: false } });
  });
  const result = await searchGear();
  assert.equal(result.status, "partial");
  assert.deepEqual(result.products.map((p) => p.category), ["shell", "bottle"]);
  assert.match(result.error || "", /HTTP 503/);
});

test("rate limiting produces an honest unavailable state with no fabricated inventory", async () => {
  mock.method(globalThis, "fetch", async () => new Response("busy", { status: 429 }));
  const result = await searchGear({ category: "shell" });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.products, []);
  assert.match(result.error || "", /Shop is busy/);
});

test("oversized upstream responses are rejected before decoding", async () => {
  mock.method(globalThis, "fetch", async () => new Response("{}", { headers: { "content-length": "2000001" } }));
  const result = await searchGear({ category: "shell" });
  assert.equal(result.status, "unavailable");
  assert.match(result.error || "", /oversized/);
});

test("unsafe product URLs are omitted and unsafe image URLs never reach the UI", async () => {
  installCatalog([
    product({ id: "gid://shopify/p/unsafe", variants: [variant({ url: "javascript:alert(1)" })] }),
    product({ id: "gid://shopify/p/safe", variants: [variant({ media: [{ type: "image", url: "http://unsafe.example/image.png" }] })] }),
  ]);
  const result = await searchGear({ category: "shell" });
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].productId, "gid://shopify/p/safe");
  assert.equal(result.products[0].image, null);
});

test("test checkout uses current variant prices, quantity arithmetic and only read-only catalog calls", async () => {
  const calls = installCatalog();
  const order = await prepareCheckout([{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 3 }]);
  assert.equal(order.status, "demo");
  assert.equal(order.demo, true);
  assert.equal(order.totalAmount, 38997);
  assert.equal(order.total, 389.97);
  assert.equal(order.currency, "USD");
  assert.match(order.orderId, /^OUT-[A-F0-9]{8}$/);
  assert.equal(order.receiptId, order.orderId);
  assert.equal(order.items[0].quantity, 3);
  assert.equal(order.items[0].priceAmount, 12999);
  assert.equal(order.links[0].kind, "product");
  assert.equal(order.links[0].url, "https://merchant.example/products/shell?variant=123&source=shop");
  assert.match(order.message, /No payment was processed/);
  assert.deepEqual(calls.map((call) => call.rpc.params.name), ["lookup_catalog"]);
  assert.deepEqual(calls[0].rpc.params.arguments.catalog.ids, [VARIANT_ID]);
  assert(calls.every((call) => call.url === "https://mcp.shop.com"));
});

test("checkout binds a selected variant to its exact product instead of trusting the request", async () => {
  installCatalog();
  await assert.rejects(
    () => prepareCheckout([{ productId: "gid://shopify/p/different", variantId: VARIANT_ID, quantity: 1 }]),
    (error: unknown) => error instanceof ShopError && error.status === 409,
  );
  await assert.rejects(
    () => prepareCheckout([{ productId: PRODUCT_ID, variantId: "gid://shopify/ProductVariant/999", quantity: 1 }]),
    (error: unknown) => error instanceof ShopError && error.status === 409,
  );
});

test("checkout prices the exact chosen variant even when a cheaper variant appears first", async () => {
  installCatalog([product({ variants: [
    variant({ id: "gid://shopify/ProductVariant/111", price: { amount: 1000, currency: "USD" } }),
    variant(),
  ] })]);
  const order = await prepareCheckout([{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 1 }]);
  assert.equal(order.totalAmount, 12999);
  assert.equal(order.items[0].variantId, VARIANT_ID);
});

test("checkout refuses both unavailable stock and stock with unknown availability", async () => {
  for (const availability of [{ available: false }, {}]) {
    mock.restoreAll();
    installCatalog([product({ variants: [variant({ availability })] })]);
    await assert.rejects(
      () => prepareCheckout([{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 1 }]),
      (error: unknown) => error instanceof ShopError && error.status === 409 && /stock/.test(error.message),
    );
  }
});

test("checkout refuses to sum different currencies into a misleading total", async () => {
  const secondId = "gid://shopify/p/foreign";
  const secondVariant = "gid://shopify/ProductVariant/456";
  installCatalog([product(), product({ id: secondId, variants: [variant({
    id: secondVariant, price: { amount: 12999, currency: "CAD" },
  })] })]);
  await assert.rejects(
    () => prepareCheckout([
      { productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 1 },
      { productId: secondId, variantId: secondVariant, quantity: 1 },
    ]),
    (error: unknown) => error instanceof ShopError && error.status === 409 && /same currency/.test(error.message),
  );
});

test("checkout budgets reject malformed, nonfinite and out-of-range values", () => {
  for (const budget of [null, "100", NaN, Infinity, -Infinity, 0, 9.99, 5000.01]) {
    assert.throws(() => assertCheckoutBudget(budget), (error: unknown) => error instanceof ShopError && error.status === 400);
  }
  for (const budget of [undefined, 10, 100.1, 5000]) assert.doesNotThrow(() => assertCheckoutBudget(budget));
});

test("refreshed checkout totals enforce the USD cap precisely at the cent boundary", async () => {
  assert.doesNotThrow(() => assertCheckoutBudget(100.1, { totalAmount: 10010, currency: "USD" }));
  assert.throws(
    () => assertCheckoutBudget(100.1, { totalAmount: 10011, currency: "USD" }),
    (error: unknown) => error instanceof ShopError && error.status === 409 && /over budget/.test(error.message),
  );
  assert.throws(
    () => assertCheckoutBudget(100, { totalAmount: 9000, currency: "CAD" }),
    (error: unknown) => error instanceof ShopError && error.status === 409 && /USD budget/.test(error.message),
  );
  // The cap applies to the current catalog price, including quantity, rather
  // than any price last seen in the browser.
  installCatalog();
  const refreshed = await prepareCheckout([{ productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 2 }]);
  assert.throws(
    () => assertCheckoutBudget(200, refreshed),
    (error: unknown) => error instanceof ShopError && error.status === 409,
  );
  assert.doesNotThrow(() => assertCheckoutBudget(259.98, refreshed));
});

test("a full-kit budget reserves category caps whose sum fits the entire kit", async () => {
  const caps: number[] = [];
  mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const rpc = JSON.parse(String(init.body)) as RpcRequest;
    const filters = rpc.params.arguments.catalog.filters as { price: { max: number }; price_tier: string[] };
    caps.push(filters.price.max);
    assert.deepEqual(filters.price_tier, ["low"]);
    return Response.json({ result: { structuredContent: { products: [product({
      variants: [variant({ price: { amount: filters.price.max, currency: "USD" } })],
    })] }, isError: false } });
  });
  const result = await searchGear({ budget: 120.01 });
  assert.deepEqual(caps, [6000, 3600, 2401]);
  assert.equal(caps.reduce((sum, cap) => sum + cap, 0), 12001);
  assert.equal(result.products.length, 3);
  assert.deepEqual(result.products.map((p) => p.category), ["shell", "daypack", "bottle"]);
  assert.equal(result.products.reduce((sum, p) => sum + p.priceAmount, 0), 12001);
});

test("a single category or search keeps the full budget without forcing the low tier", async () => {
  const calls = installCatalog();
  await searchGear({ category: "shell", budget: 150 });
  await searchGear({ query: "rain jacket", budget: 150 });
  for (const { rpc } of calls) {
    const filters = rpc.params.arguments.catalog.filters as Record<string, unknown>;
    assert.deepEqual(filters.price, { max: 15000 });
    assert.equal(filters.price_tier, undefined);
  }
});

test("product details request exact option pairs and preserve full option values with current stock", async () => {
  const selected = [{ name: "Color", label: "Blue" }, { name: "Size", label: "Medium" }];
  let request: RpcRequest | undefined;
  mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    request = JSON.parse(String(init.body)) as RpcRequest;
    return Response.json({ result: { structuredContent: { product: product({
      options: [
        { name: "Color", values: [{ label: "Blue", available: true }, { label: "Olive", available: false }] },
        { name: "Size", values: [{ label: "Medium", available: true }, { label: "Large", available: true }] },
      ],
    }) }, isError: false } });
  });
  const result = await fetchProduct(PRODUCT_ID, { category: "daypack", selected });
  assert.equal(request?.params.name, "get_product");
  assert.deepEqual(request?.params.arguments.catalog, { id: PRODUCT_ID, context: { address_country: "US", currency: "USD" }, selected });
  assert.equal(result.product.category, "daypack");
  assert.equal(result.product.available, true);
  assert.equal(result.product.priceAmount, 12999);
  assert.deepEqual(result.product.selectedOptions, selected);
  assert.equal(result.product.options[0].values[1].available, false);
  assert.equal(result.products[0], result.product);
});

test("product details do not silently substitute another size or color", async () => {
  mock.method(globalThis, "fetch", async () => Response.json({
    result: { structuredContent: { product: product() }, isError: false },
  }));
  await assert.rejects(
    () => fetchProduct(PRODUCT_ID, { selected: [{ name: "Color", label: "Red" }] }),
    (error: unknown) => error instanceof ShopError && error.status === 409,
  );
});

test("product details reject URLs and malformed option selections before any remote call", async () => {
  const calls = installCatalog();
  await assert.rejects(
    () => fetchProduct("https://untrusted.example/products/shell"),
    (error: unknown) => error instanceof ShopError && error.status === 400,
  );
  await assert.rejects(
    () => fetchProduct(PRODUCT_ID, { selected: [{ name: "Color", label: "" }] }),
    (error: unknown) => error instanceof ShopError && error.status === 400,
  );
  assert.equal(calls.length, 0);
});

test("checkout recognizes the browser-facing host when Next binds to 0.0.0.0", () => {
  const request = new Request("http://0.0.0.0:3000/api/checkout", {
    headers: { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" },
  });
  assert.doesNotThrow(() => assertCheckoutOrigin(request));
  const proxy = new Request("http://internal:3000/api/checkout", {
    headers: { host: "outside.vercel.app", origin: "https://outside.vercel.app", "x-forwarded-proto": "https", "sec-fetch-site": "same-origin" },
  });
  assert.doesNotThrow(() => assertCheckoutOrigin(proxy));
});

test("checkout still rejects foreign origins, cross-site requests and malformed origins", () => {
  const cases: Record<string, string>[] = [
    { host: "localhost:3000", origin: "https://attacker.example" },
    { host: "localhost:3000", origin: "http://localhost:3000.attacker.example" },
    { host: "localhost:3000", origin: "null" },
    { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "cross-site" },
    { host: "localhost:3000", "sec-fetch-site": "cross-site" },
  ];
  for (const headers of cases) {
    assert.throws(
      () => assertCheckoutOrigin(new Request("http://0.0.0.0:3000/api/checkout", { headers })),
      (error: unknown) => error instanceof ShopError && error.status === 403,
    );
  }
});

test("gear evaluation lookup batches exact references, preserves order and infers purpose from catalog titles", async () => {
  const packId = "gid://shopify/p/pack";
  const packVariant = "gid://shopify/ProductVariant/456";
  const bottleId = "gid://shopify/p/bottle";
  const bottleVariant = "gid://shopify/ProductVariant/789";
  const calls = installCatalog([
    product(),
    product({ id: bottleId, title: "Hiking water bottle", variants: [variant({ id: bottleVariant })] }),
    product({ id: packId, title: "20L hiking daypack", variants: [variant({ id: packVariant })] }),
  ]);
  const products = await lookupGear([
    { productId: packId, variantId: packVariant },
    { productId: PRODUCT_ID, variantId: VARIANT_ID },
    { productId: bottleId, variantId: bottleVariant },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].rpc.params.name, "lookup_catalog");
  assert.deepEqual(calls[0].rpc.params.arguments.catalog.ids, [packVariant, VARIANT_ID, bottleVariant]);
  assert.deepEqual(products.map((p) => p.category), ["daypack", "shell", "bottle"]);
  assert.deepEqual(products.map((p) => p.variantId), [packVariant, VARIANT_ID, bottleVariant]);
});

test("gear evaluation lookup retains unconfirmed stock while receipt creation rejects it", async () => {
  installCatalog([product({ variants: [variant({ availability: { available: false } })] })]);
  const refs = [{ productId: PRODUCT_ID, variantId: VARIANT_ID }];
  const products = await lookupGear(refs);
  assert.equal(products[0].available, false);
  await assert.rejects(
    () => prepareCheckout([{ ...refs[0], quantity: 1 }]),
    (error: unknown) => error instanceof ShopError && error.status === 409,
  );
});

test("gear evaluation lookup rejects invalid or excessive refs before the remote request", async () => {
  const calls = installCatalog();
  const invalid = [
    [],
    [{ productId: "https://untrusted.example/product", variantId: VARIANT_ID }],
    [{ productId: PRODUCT_ID, variantId: "not-a-real-variant" }],
    Array.from({ length: 7 }, () => ({ productId: PRODUCT_ID, variantId: VARIANT_ID })),
  ];
  for (const refs of invalid) {
    await assert.rejects(() => lookupGear(refs), (error: unknown) => error instanceof ShopError && error.status === 400);
  }
  assert.equal(calls.length, 0);
});

test("gear purpose distinguishes packaway apparel from waterproof and hydration backpacks", () => {
  assert.equal(inferGearCategory("Regatta Mens Pack-It III Waterproof Walking Packaway Jacket"), "shell");
  assert.equal(inferGearCategory("Waterproof Hiking Backpack"), "daypack");
  assert.equal(inferGearCategory("Hydration Backpack"), "daypack");
  assert.equal(inferGearCategory("Trail Water Bottle"), "bottle");
});
