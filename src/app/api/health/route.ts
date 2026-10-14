import { credentialStatus } from "@/lib/agent";
import { roleModels, voiceModels } from "@/lib/models";

export const runtime = "nodejs";

export async function GET() {
  const credentials = credentialStatus();
  return Response.json({ status: "ok", credentials, models: { ...roleModels(), ...voiceModels() }, planner: credentials.gateway ? "gateway" : credentials.gemini ? "gemini" : "local", vision: credentials.gateway || credentials.gemini, voice: credentials.gateway }, { headers: { "cache-control": "no-store" } });
}
