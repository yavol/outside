export type ModelRole = 'planner' | 'vision';

/** Verified against the official model pages and Gateway catalog on October 14, 2026. */
export const DEFAULT_MODELS = Object.freeze({
  planner: 'openai/gpt-6-luna',
  vision: 'google/gemini-4-argon',
  plannerFallback: 'google/gemini-4-argon',
  visionFallback: 'openai/gpt-6-luna',
  directGemini: 'gemini-4-argon',
  transcription: 'microsoft/mai-transcribe-2',
  speech: 'microsoft/mai-voice-2.1-flash',
});

export function roleModels() {
  return {
    planner: {
      primary: process.env.OUTSIDE_PLANNER_MODEL?.trim() || DEFAULT_MODELS.planner,
      fallback: process.env.OUTSIDE_PLANNER_FALLBACK_MODEL?.trim() || DEFAULT_MODELS.plannerFallback,
    },
    vision: {
      primary: process.env.OUTSIDE_VISION_MODEL?.trim() || DEFAULT_MODELS.vision,
      fallback: process.env.OUTSIDE_VISION_FALLBACK_MODEL?.trim() || DEFAULT_MODELS.visionFallback,
    },
    directGemini: process.env.OUTSIDE_GEMINI_MODEL?.trim() || DEFAULT_MODELS.directGemini,
  };
}

export function voiceModels() {
  return {
    transcription: process.env.OUTSIDE_TRANSCRIPTION_MODEL?.trim() || DEFAULT_MODELS.transcription,
    speech: process.env.OUTSIDE_SPEECH_MODEL?.trim() || DEFAULT_MODELS.speech,
  };
}

export function generationSettings(model: string) {
  return {
    // Argon's reasoning shares this cap with its final JSON. Low effort keeps the task bounded.
    maxOutputTokens: /(?:^|\/)gemini-4-argon/.test(model) ? 16_384 : 4_096,
    reasoningEffort: /^(?:google\/gemini-[34]|openai\/gpt-6)/.test(model) ? 'low' as const : undefined,
  };
}
