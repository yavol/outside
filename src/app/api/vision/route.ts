import { InputError, inspectImage, parseVisionInput, protectPost, readJson } from "@/lib/agent";
import { withTrace } from "@/lib/trace";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const { result, trace } = await withTrace(async () => { try {
    protectPost(request);
    const input = parseVisionInput(await readJson(request, 4_300_000));
    return { body: await inspectImage(input), status: 200 };
  } catch (error) {
    return { body: { error: error instanceof InputError ? error.message : "The image could not be analyzed." }, status: error instanceof InputError ? error.status : 500 };
  } });
  return Response.json({ ...result.body, trace }, { status: result.status, headers: { "cache-control": "no-store" } });
}
