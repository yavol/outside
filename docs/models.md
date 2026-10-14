# Model choices

Verified **October 14, 2026** against the live [AI Gateway catalog](https://ai-gateway.vercel.sh/v1/models), official OpenAI documentation, and Google's current model and release pages.

## Models used by OUTSIDE

| Work | Primary | Alternate |
| --- | --- | --- |
| Trip planning and conversation | `openai/gpt-6-luna` | `google/gemini-4-argon` |
| Camera observations and owned-gear recognition | `google/gemini-4-argon` | `openai/gpt-6-luna` |
| Gear suitability probabilities | `typesafe-ai/jev` | Explicitly labeled budget, stock, and ownership rules |
| Spoken requests and uploaded voice notes | `microsoft/mai-transcribe-2` | Type a request |
| Spoken plan replies | `microsoft/mai-voice-2.1-flash` | Read the written reply |

GPT-6 Luna is the user's chosen conversation model. It supports image input and structured output, so it also provides a current alternate for vision. [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna), [Gateway model documentation](https://vercel.com/ai-gateway/models/gpt-6-luna).

Gemini 4 Argon became generally available on **October 13, 2026**. It is the newest Gemini flagship verified for this build. Camera and gear requests use low reasoning effort and a larger bounded output allowance so reasoning does not consume the entire response budget. The optional direct Gemini connection also uses `gemini-4-argon`. [Google model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon), [release notes](https://ai.google.dev/gemini-api/docs/changelog).

Jev answers bounded product-purpose questions using actual server-fetched catalog descriptions and separate weather forecasts. Code enforces stock, ownership, and budget limits regardless of the model's probability. [Gateway Decision API](https://vercel.com/docs/ai-gateway/modalities/decision#http-api).

Five models serve five distinct jobs. Luna resolves the trip; Argon reads images; Jev returns a bounded suitability probability; MAI-Transcribe-2 turns actual audio into a request; MAI-Voice-2.1-Flash turns the reply into playable audio. The voice models use the same Gateway credential. Speech is requested only when the user records/uploads a clip, selects **Hear this plan**, or enables spoken replies. [Gateway speech to text](https://vercel.com/docs/ai-gateway/modalities/speech-to-text), [Gateway text to speech](https://vercel.com/docs/ai-gateway/modalities/text-to-speech).

The speech models were verified against the authenticated Gateway on October 14: `mai-transcribe-2` was released September 3, 2026; `mai-voice-2.1-flash` was released October 1, 2026 and is in public preview. Their catalog rates are $0.10 per audio hour and $15 per million generated characters, respectively. [Transcription catalog](https://vercel.com/ai-gateway/models/mai-transcribe-2), [Speech catalog](https://vercel.com/ai-gateway/models/mai-voice-2.1-flash).

An exact, current public camera analysis may also be reused as planning context for 15 minutes. This process-local cache is best effort across Vercel instances; a miss contributes no visual claims. Private gear photos never enter the observation cache.

## Current lineup checked

Standard short-context token prices from the live Gateway catalog, in USD per million tokens. Regional, fast, long-context, search, and cache pricing can differ.

| Model | Catalog release date | Input / output | Selection |
| --- | --- | --- | --- |
| GPT-6 Luna | Sep 22, 2026 | $0.10 / $0.50 | Used for planning, as requested |
| GPT-6.1 Sol | Sep 29, 2026 | $2 / $10 | Current OpenAI workhorse; not selected over the requested Luna |
| GPT-6 Astra | Sep 4, 2026 | $10 / $50 | Current frontier option; not needed for this bounded workflow |
| Gemini 4 Argon | Oct 13, 2026 | $2 / $10 | Used for vision; introductory price |
| Gemini 3.8 Flash | Sep 2, 2026 | $0.75 / $3.75 | Current faster Flash option; available as a deliberate future configuration |
| Jev | Sep 15, 2026 | $0.042 / $0 | Used for product suitability |

The runtime model identifiers are centralized in `src/lib/models.ts`. Configuration changes use explicit role variables from `.env.example`; there are no legacy model defaults. Check the live catalog again before a later model change rather than inferring a model identifier from a product name.

## Verify a run

The **AI calls** drawer shows the actual returned model, request, response, token usage, duration, and each alternate attempt. A deliberate primary skip is a local routing event and is not counted as a network call. Cached observations are labeled separately. Credentials, image bytes, and audio bytes are redacted, and traces stay with the caller's current browser session.
