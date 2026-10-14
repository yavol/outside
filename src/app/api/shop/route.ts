import { NextResponse } from "next/server";
import { searchGear, ShopError, type GearCategory } from "@/lib/shop";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = (params.get("q") || "").trim();
    const color = (params.get("color") || "").trim();
    const budgetValue = params.get("budget");
    const budget = budgetValue === null || budgetValue === "" ? undefined : Number(budgetValue);
    const category = params.get("category") || undefined;
    const cheaper = params.get("cheaper") === "true";
    if (query.length > 240 || color.length > 60 || /[\x00-\x1f]/.test(query + color)) throw new ShopError("Use a shorter gear search.", 400);
    if (budget !== undefined && (!Number.isFinite(budget) || budget < 1 || budget > 10000)) throw new ShopError("Budget must be between 1 and 10000 USD.", 400);
    if (category && !["shell", "daypack", "bottle"].includes(category)) throw new ShopError("Choose shell, daypack or bottle.", 400);
    const result = await searchGear({ query: query || undefined, budget, color: color || undefined, cheaper, category: category as GearCategory | undefined });
    return NextResponse.json(result, { status: result.status === "unavailable" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ status: "unavailable", source: "Shop MCP", products: [], error: error instanceof ShopError ? error.message : "Gear search could not be completed." }, { status: error instanceof ShopError ? error.status : 502, headers: { "Cache-Control": "no-store" } });
  }
}
