import { InputError, inspectImage, parseVisionInput, protectPost, readJson } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    protectPost(request);
    const input = parseVisionInput(await readJson(request, 4_300_000));
    return Response.json(await inspectImage(input), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof InputError ? error.message : "The image could not be analyzed." }, { status: error instanceof InputError ? error.status : 500 });
  }
}
