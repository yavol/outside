import { protectPost, readJson } from "@/lib/agent";
import { getDestinationConditions } from "@/lib/conditions";
import { evaluateGear, EvaluationInputError, parseEvaluationInput } from "@/lib/jev";
import { lookupGear } from "@/lib/shop";
import { withTrace } from "@/lib/trace";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    protectPost(request);
    const input = parseEvaluationInput(await readJson(request, 12_000));
    const { result, trace } = await withTrace(async () => {
      const [products, conditions] = await Promise.all([
        lookupGear(input.products),
        getDestinationConditions(input.destinationId),
      ]);
      return evaluateGear(input, products, conditions);
    });
    return Response.json({ ...result, trace }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof EvaluationInputError ? 400 : error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : 502;
    return Response.json({ error: error instanceof Error ? error.message : "Gear assessment could not be completed." }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
