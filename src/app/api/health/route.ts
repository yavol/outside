import { credentialStatus } from "@/lib/agent";

export const runtime = "nodejs";

export async function GET() {
  const credentials = credentialStatus();
  return Response.json({ status: "ok", credentials, planner: credentials.gateway ? "gateway" : credentials.gemini ? "gemini" : "local", vision: credentials.gateway || credentials.gemini }, { headers: { "cache-control": "no-store" } });
}
