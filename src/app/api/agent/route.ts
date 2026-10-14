import { InputError, parseAgentInput, planTrip, protectPost, readJson } from "@/lib/agent";
import { getConditions } from "@/lib/conditions";
import { destinations } from "@/lib/destinations";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const started = Date.now();
  try {
    protectPost(request);
    const input = parseAgentInput(await readJson(request, 12_000));
    const conditions = await getConditions();
    const context = {
      fetchedAt: conditions.fetchedAt,
      destinations: destinations.map(place => {
        const evidence = conditions.destinations.find(value => value.id === place.id)!;
        return { id: place.id, name: place.name, description: place.description, tags: place.tags, weather: evidence.weather, camera: evidence.camera, alerts: evidence.alerts, alertsStatus: evidence.alertsStatus };
      }),
    };
    const result = await planTrip(input, context);
    return Response.json({ ...result, latencyMs: Date.now() - started }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof InputError ? error.message : "The planner could not complete this request." }, { status: error instanceof InputError ? error.status : 500 });
  }
}
