import { NextRequest, NextResponse } from "next/server";
import { getConditions } from "@/lib/conditions";
import { isDestinationId, type DestinationId } from "@/lib/destinations";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const idsParam = request.nextUrl.searchParams.get("ids");
  let ids: DestinationId[] | undefined;
  if (idsParam !== null) {
    const requested = idsParam.split(",").filter(Boolean);
    if (!requested.length || requested.length > 3 || !requested.every(isDestinationId)) {
      return NextResponse.json({ error: "Choose cowells, main-beach, or sunset (maximum 3)." }, { status: 400 });
    }
    ids = requested as DestinationId[];
  }
  const conditions = await getConditions(ids);
  return NextResponse.json(conditions, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
  });
}
