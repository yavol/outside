import { getCameraObservation, InputError, parseAgentInput, planTrip, protectPost, readJson } from "@/lib/agent";
import { getConditions } from "@/lib/conditions";
import { destinations } from "@/lib/destinations";
import { withTrace } from "@/lib/trace";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const started = Date.now();
  const { result: traced, trace } = await withTrace(async () => { try {
    protectPost(request);
    const input = parseAgentInput(await readJson(request, 12_000));
    const conditions = await getConditions();
    const context = {
      fetchedAt: conditions.fetchedAt,
      destinations: destinations.map(place => {
        const evidence = conditions.destinations.find(value => value.id === place.id)!;
        const visualEvidence = evidence.camera.imageUrl ? getCameraObservation(evidence.camera.imageUrl) : undefined;
        return { id: place.id, name: place.name, description: place.description, tags: place.tags, weather: evidence.weather, camera: evidence.camera, alerts: evidence.alerts, alertsStatus: evidence.alertsStatus, ...(visualEvidence ? { visualEvidence } : {}) };
      }),
    };
    const result = await planTrip(input, context);
    return { body: { ...result, latencyMs: Date.now() - started }, status: 200 };
  } catch (error) {
    return { body: { error: error instanceof InputError ? error.message : "The planner could not complete this request." }, status: error instanceof InputError ? error.status : 500 };
  } });
  return Response.json({ ...traced.body, trace }, { status: traced.status, headers: { "cache-control": "no-store" } });
}
