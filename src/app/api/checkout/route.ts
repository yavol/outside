import { NextResponse } from "next/server";
import { assertCheckoutBudget, assertCheckoutOrigin, prepareCheckout, ShopError, type CheckoutItem } from "@/lib/shop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    assertCheckoutOrigin(request);
    if (Number(request.headers.get("content-length") || 0) > 16000) throw new ShopError("Selection is too large.", 413);
    if (!(request.headers.get("content-type") || "").includes("application/json")) throw new ShopError("Send a JSON gear selection.", 415);
    const raw = await request.text();
    if (raw.length > 16000) throw new ShopError("Selection is too large.", 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new ShopError("Send a valid JSON gear selection.", 400); }
    const budget = body && typeof body === "object" && "budget" in body ? body.budget : undefined;
    assertCheckoutBudget(budget);
    const rows = body && typeof body === "object" && "items" in body ? body.items : undefined;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 6) throw new ShopError("Select between one and six gear items.", 400);
    const items: CheckoutItem[] = rows.map((row: unknown) => {
      if (!row || typeof row !== "object") throw new ShopError("Invalid gear selection.", 400);
      const value = row as Record<string, unknown>;
      const quantity = value.quantity === undefined ? 1 : value.quantity;
      if (typeof value.productId !== "string" || !/^gid:\/\/shopify\/(?:p|Product)\/[a-zA-Z0-9_-]{1,100}$/.test(value.productId)) throw new ShopError("Invalid product selection.", 400);
      if (typeof value.variantId !== "string" || !/^gid:\/\/shopify\/ProductVariant\/[0-9]{1,30}$/.test(value.variantId)) throw new ShopError("Invalid product option.", 400);
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 5) throw new ShopError("Choose a quantity from one to five.", 400);
      return { productId: value.productId, variantId: value.variantId, quantity };
    });
    if (new Set(items.map((i) => i.variantId)).size !== items.length) throw new ShopError("Combine duplicate gear items into one quantity.", 400);
    const receipt = await prepareCheckout(items);
    assertCheckoutBudget(budget, receipt);
    return NextResponse.json(receipt, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ status: "unavailable", source: "Shop MCP", links: [], message: error instanceof ShopError ? error.message : "Checkout could not be prepared.", error: error instanceof ShopError ? error.message : "Checkout could not be prepared." }, { status: error instanceof ShopError ? error.status : 502, headers: { "Cache-Control": "no-store" } });
  }
}
