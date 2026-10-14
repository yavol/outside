"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AITrace } from "@/lib/trace";
import { audioBlobFromBase64, MAX_AUDIO_BYTES, prepareTranscriptionAudio, RECORDING_LIMIT_MS } from "@/lib/browser-audio";

type VoiceOptions = {
  onTranscript: (text: string) => void;
  onTrace: (data: { trace?: AITrace[] }) => void;
  onError: (message: string) => void;
};
type VoiceResponse = { text?: string; audio?: string; mediaType?: string; error?: string; trace?: AITrace[] };
type Recording = { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; bytes: number; generation: number; submit: boolean; timer?: ReturnType<typeof setTimeout> };
type Playback = { audio: HTMLAudioElement; url: string; generation: number };

const stopTracks = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop());
const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const isAbort = (error: unknown) => error instanceof Error && error.name === "AbortError";

export default function useGatewayVoice(options: VoiceOptions) {
  const callbacksRef = useRef(options);
  callbacksRef.current = options;
  const mountedRef = useRef(false);
  const inputGenerationRef = useRef(0);
  const speechGenerationRef = useRef(0);
  const startingRef = useRef(false);
  const recordingRef = useRef<Recording | null>(null);
  const inputAbortRef = useRef<AbortController | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  const playbackRef = useRef<Playback | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const disposePlayback = useCallback(() => {
    const playback = playbackRef.current;
    playbackRef.current = null;
    if (playback) {
      playback.audio.onended = null;
      playback.audio.onerror = null;
      playback.audio.pause();
      playback.audio.removeAttribute("src");
      playback.audio.load();
      URL.revokeObjectURL(playback.url);
    }
  }, []);

  const cancelSpeech = useCallback(() => {
    speechGenerationRef.current++;
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    disposePlayback();
    if (mountedRef.current) setSpeaking(false);
  }, [disposePlayback]);

  const cancelInput = useCallback(() => {
    inputGenerationRef.current++;
    startingRef.current = false;
    inputAbortRef.current?.abort();
    inputAbortRef.current = null;
    const active = recordingRef.current;
    recordingRef.current = null;
    if (active) {
      active.submit = false;
      clearTimeout(active.timer);
      active.recorder.ondataavailable = null;
      active.recorder.onstop = null;
      active.recorder.onerror = null;
      if (active.recorder.state !== "inactive") active.recorder.stop();
      stopTracks(active.stream);
      active.chunks.length = 0;
    }
    if (mountedRef.current) { setListening(false); setTranscribing(false); }
  }, []);

  const cancel = useCallback(() => { cancelInput(); cancelSpeech(); }, [cancelInput, cancelSpeech]);
  const currentInput = useCallback((generation: number) => mountedRef.current && inputGenerationRef.current === generation, []);
  const currentSpeech = useCallback((generation: number) => mountedRef.current && speechGenerationRef.current === generation, []);

  const readResponse = useCallback(async (response: Response): Promise<VoiceResponse> => {
    let data: VoiceResponse;
    try { data = await response.json() as VoiceResponse; } catch { throw new Error("The voice service could not respond. Try again in a moment."); }
    // Preserve evidence for completed requests, even when a newer turn supersedes
    // their result. The generation guard below prevents an old transcript acting.
    if (mountedRef.current && Array.isArray(data.trace)) callbacksRef.current.onTrace({ trace: data.trace });
    if (!response.ok) throw new Error(data.error || "The voice service is unavailable. Try again in a moment.");
    return data;
  }, []);

  const transcribe = useCallback(async (blob: Blob, generation: number, controller: AbortController, fileName?: string) => {
    try {
      if (!currentInput(generation)) return;
      setTranscribing(true);
      const payload = await prepareTranscriptionAudio(blob, { fileName, signal: controller.signal });
      if (!currentInput(generation)) return;
      const response = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal, cache: "no-store" });
      const data = await readResponse(response);
      if (!currentInput(generation)) return;
      const text = typeof data.text === "string" ? data.text.trim() : "";
      if (!text) throw new Error("I could not hear a plan in that clip. Try speaking a little closer to the microphone.");
      setTranscribing(false);
      callbacksRef.current.onTranscript(text);
    } catch (error) {
      if (currentInput(generation) && !isAbort(error)) callbacksRef.current.onError(errorText(error, "I could not transcribe that recording. Try again."));
    } finally {
      if (currentInput(generation)) { setTranscribing(false); inputAbortRef.current = null; }
    }
  }, [currentInput, readResponse]);

  const stopRecording = useCallback((active: Recording) => {
    clearTimeout(active.timer);
    if (currentInput(active.generation)) { setListening(false); setTranscribing(true); }
    if (active.recorder.state !== "inactive") active.recorder.stop();
    stopTracks(active.stream);
  }, [currentInput]);

  const toggleRecording = useCallback(async () => {
    const active = recordingRef.current;
    if (active) { stopRecording(active); return; }
    if (startingRef.current) { cancelInput(); return; }
    cancelInput();
    cancelSpeech();
    if (!mountedRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      callbacksRef.current.onError("This browser cannot record audio here. Try Chrome or Safari on an HTTPS connection, or upload a short audio clip.");
      return;
    }
    const generation = inputGenerationRef.current;
    const controller = new AbortController();
    inputAbortRef.current = controller;
    startingRef.current = true;
    setListening(true);
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
      // getUserMedia itself cannot be aborted while its permission dialog is open.
      if (!currentInput(generation)) { stopTracks(stream); return; }
      startingRef.current = false;
      const preferredType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, { ...(preferredType ? { mimeType: preferredType } : {}), audioBitsPerSecond: 64_000 });
      const recording: Recording = { recorder, stream, chunks: [], bytes: 0, generation, submit: true };
      recordingRef.current = recording;
      recorder.ondataavailable = (event: BlobEvent) => {
        if (!currentInput(generation) || !recording.submit || !event.data.size) return;
        recording.bytes += event.data.size;
        if (recording.bytes > MAX_AUDIO_BYTES) {
          cancelInput();
          callbacksRef.current.onError("That recording reached 3 MB. Try a shorter message.");
          return;
        }
        recording.chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (currentInput(generation)) {
          cancelInput();
          callbacksRef.current.onError("The microphone recording stopped unexpectedly. Try recording again.");
        }
      };
      recorder.onstop = () => {
        clearTimeout(recording.timer);
        stopTracks(recording.stream);
        if (recordingRef.current === recording) recordingRef.current = null;
        const blob = new Blob(recording.chunks, { type: recorder.mimeType || preferredType || "audio/webm" });
        recording.chunks.length = 0;
        if (!currentInput(generation) || !recording.submit) return;
        setListening(false);
        void transcribe(blob, generation, controller);
      };
      recorder.start(250);
      recording.timer = setTimeout(() => { if (currentInput(generation)) stopRecording(recording); }, RECORDING_LIMIT_MS);
    } catch (error) {
      if (stream) stopTracks(stream);
      if (!currentInput(generation)) return;
      cancelInput();
      const name = error instanceof Error ? error.name : "";
      callbacksRef.current.onError(name === "NotAllowedError" || name === "SecurityError" ? "Microphone access was not allowed. Enable it in your browser, or upload a short audio clip." : name === "NotFoundError" ? "No microphone was found. Connect one, or upload a short audio clip." : errorText(error, "The microphone could not start. Try recording again."));
    } finally {
      if (currentInput(generation)) startingRef.current = false;
    }
  }, [cancelInput, cancelSpeech, currentInput, stopRecording, transcribe]);

  const transcribeFile = useCallback(async (file: File) => {
    cancelInput();
    cancelSpeech();
    if (!mountedRef.current) return;
    const controller = new AbortController();
    inputAbortRef.current = controller;
    await transcribe(file, inputGenerationRef.current, controller, file.name);
  }, [cancelInput, cancelSpeech, transcribe]);

  const speak = useCallback(async (text: string) => {
    cancelSpeech();
    if (!mountedRef.current || !text.trim()) return;
    const generation = speechGenerationRef.current;
    const controller = new AbortController();
    speechAbortRef.current = controller;
    setSpeaking(true);
    let playbackErrorReported = false;
    try {
      const response = await fetch("/api/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.trim() }), signal: controller.signal, cache: "no-store" });
      const data = await readResponse(response);
      if (!currentSpeech(generation)) return;
      if (typeof data.audio !== "string" || typeof data.mediaType !== "string") throw new Error("The voice service returned no audio. Try reading the response instead.");
      const audio = new Audio();
      const url = URL.createObjectURL(audioBlobFromBase64(data.audio, data.mediaType));
      const playback: Playback = { audio, url, generation };
      playbackRef.current = playback;
      audio.src = url;
      audio.onended = () => { if (currentSpeech(generation)) { disposePlayback(); setSpeaking(false); } };
      audio.onerror = () => {
        if (currentSpeech(generation)) {
          playbackErrorReported = true;
          disposePlayback();
          setSpeaking(false);
          callbacksRef.current.onError("The generated voice could not play. The written response is ready above.");
        }
      };
      await audio.play();
      if (!currentSpeech(generation) && playbackRef.current === playback) disposePlayback();
    } catch (error) {
      if (currentSpeech(generation) && !isAbort(error) && !playbackErrorReported) {
        disposePlayback();
        setSpeaking(false);
        callbacksRef.current.onError(error instanceof Error && error.name === "NotAllowedError" ? "Your browser paused voice playback. Tap the read-aloud button to hear the response." : errorText(error, "Voice playback is unavailable. The written response is ready above."));
      }
    } finally {
      if (currentSpeech(generation)) speechAbortRef.current = null;
    }
  }, [cancelSpeech, currentSpeech, disposePlayback, readResponse]);

  useEffect(() => {
    mountedRef.current = true;
    window.addEventListener("pagehide", cancel);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", cancel);
      cancel();
    };
  }, [cancel]);

  return { listening, transcribing, speaking, toggleRecording, cancel, speak, transcribeFile };
}
