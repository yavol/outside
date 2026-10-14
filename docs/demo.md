# OUTSIDE — 90-second demo

**Pitch:** “Tell OUTSIDE what kind of day you want. It brings the coast, the camera evidence, and the gear you are missing into one conversation.”

Use a desktop browser with the app open, working model credentials, and a clear photo of a reusable water bottle ready. The microphone uses Gateway transcription; typing gives the same planning flow. Enable **Preferences → Read responses aloud** to hear the plan through Gateway speech. Live catalog results and conditions can change, so rehearse with the products returned on demo day.

App: [outside-teal.vercel.app](https://outside-teal.vercel.app).

| Time | Action | What to say or show |
| --- | --- | --- |
| 0–15 s | Type or speak the coastal request. | **“Find me a warmer coastal walk with less wind. I already have a backpack. Keep my gear under $120.”** Watch the map move to the resolved destination. The reply compares available NWS forecasts and keeps the stated budget and owned backpack. |
| 15–30 s | Open the camera card and press **Tell me what you see**. | “This is a public USGS snapshot. The image model describes the supplied frame.” Point to the printed image timestamp; open **See the sources** if useful. Forecast values remain separate from image observations. |
| 30–45 s | Choose **Build my weekend bag**, then **Already have it? Show me.** | Upload the bottle photo, or open the camera and capture it. Confirm **I own this water bottle** after a supported result. “The cheapest gear is the gear I already own.” If analysis is unavailable, choose **Water bottle** manually and describe that action plainly. |
| 45–60 s | Ask for a cheaper blue option. | **“Find a cheaper option in blue.”** Show the real Shop catalog products, merchant, price, returned options, and **Jev checked** assessment when available. Choose an available variant and add it to the bag. The owned backpack and bottle categories are excluded. |
| 60–75 s | Select **Review my bag** and complete the test checkout. | “It checks the selected variants and subtotal again.” The confirmation is a local test receipt. The UI says **Test mode** and **no payment collected**. No merchant order is placed. |
| 75–90 s | Choose **Save my escape**, open **My escapes**, and restore it. | “The destination, budget, owned gear, and bag are here when I come back.” Close with the map and saved plan visible. |

## Optional resilience moment

Open **Preferences**, enable **Try provider fallback**, then send a short follow-up such as **“Keep Cowell Beach and remind me of my budget.”** The next request skips the primary model and calls a configured alternate. Point to the returned model, elapsed time, and fallback label beneath the reply. Turn the setting off after the demonstration.

This is a separate optional moment, since waiting for an unavailable upstream can exceed a tight 90-second slot. If all model providers fail, the response is labeled **Local planner**; that proves continuity of trip state, not successful alternate-model inference. Image analysis has no fabricated local vision result.

## Show the AI work

Open **AI calls** in the top bar, or click the gear assessment banner. Inspect the actual request and response for conversation, camera/gear vision, Jev's Decision API, transcription, and spoken replies. The panel shows the provider, model, status, elapsed time, and token usage when supplied. A failed primary call and a successful alternate are separate events; basic rules and local planning are labeled locally. Credentials, image bytes, and audio bytes are redacted. Use the microphone or **Preferences → Upload audio**, analyze a camera frame, build a gear bag, and select **Hear this plan** to show all five models responding in one session. An uncertain Jev result remains uncertain rather than becoming an invented approval.

## Rehearsal checks

1. Open `/api/health` and confirm the expected provider flags. Then make an actual planner request and camera analysis; flags only show configuration.
2. Read each selected camera's printed timestamp and inspect the NWS forecast period. Describe whatever is present rather than rehearsing a fixed weather claim.
3. Search for blue gear within the intended budget. Choose a product with an available variant. If no match exists, adjust the request or budget openly; the app does not insert placeholder inventory.
4. Complete a test receipt and restore a saved escape. Clear a previous saved trip in browser storage if you want the first-run state.
5. For a camera-based gear scan, allow camera permission on localhost or HTTPS. For voice, allow microphone access after clicking the mic, then click it again to finish. Recordings stop after 20 seconds. An uploaded voice note under 30 seconds also works.

## Honest technical answers

**What is real?** The map, public USGS images, NWS forecasts and alerts, model requests, Shop catalog products, merchant variants, Jev suitability decisions, stock refresh, budget checks, and browser persistence. The UI distinguishes a successful Jev response from basic rules when the service is unavailable.

**What is the checkout?** A local test order after a fresh catalog lookup. It does not collect payment, create an external cart, or submit an order to a merchant. The subtotal excludes shipping and taxes.

**How fresh are the cameras?** USGS publishes daylight still images about every half hour with a delay. Capture time is printed in the bitmap. Source fetch time and HTTP file-update time are shown separately; neither is presented as capture time.

**How does the agent work?** Next.js server routes gather source data and resolve explicit facts. Vercel AI Gateway is the preferred model transport, with configured alternate models and optional direct Gemini fallback. The local planner preserves destination, budget, and ownership when inference is unavailable. Forecast comparisons do not imply weekend weather from a few current forecast hours.

**What about voice and evaluation?** Five models have distinct roles: GPT-6 Luna for planning, Gemini 4 Argon for image observations, Jev for typed product suitability, MAI-Transcribe-2 for spoken requests, and MAI-Voice-2.1-Flash for spoken replies. All use the same Vercel AI Gateway credential. The app sends real audio to the speech endpoints; it does not count browser speech as a model call. Jev receives server-refetched product facts and forecast context through Gateway's Decision API, returning typed product-purpose probabilities. Code keeps budget, stock, and ownership checks authoritative. Automated local tests exercise those boundaries and labeled fallback behavior.

**Is the line a route?** It is a visual coastal guide connecting approximate beach destinations. It does not give road directions or travel-time calculations.

**Where is the data saved?** Trip state is saved to local storage in this browser. Uploaded gear photos are sent for image analysis and are not included in the saved trip. There is no account or cross-device synchronization.
