import { InputError, protectPost, readJson } from "@/lib/agent";
import { withTrace } from "@/lib/trace";
import { parseSpeechInput, synthesizeSpeech, VoiceError } from "@/lib/voice";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const { result, trace } = await withTrace(async () => {
    try {
      protectPost(request);
      const input = parseSpeechInput(await readJson(request, 8_000));
      return { body: await synthesizeSpeech(input), status: 200 };
    } catch (error) {
      return { body: { error: error instanceof VoiceError || error instanceof InputError ? error.message : "Speech could not be generated." }, status: error instanceof VoiceError || error instanceof InputError ? error.status : 502 };
    }
  });
  return Response.json({ ...result.body, trace }, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
