"use client";
import { useEffect, useRef, useState } from "react";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionCtor = new () => Recognition;
type SpeechWindow = { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };

/** Free dictation using the browser's built-in speech recognition (Chrome and Edge). Hidden where unsupported. */
export function VoiceDictation({ onText, lang = "en-IN" }: { onText: (text: string) => void; lang?: string }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const callback = useRef(onText);
  useEffect(() => { callback.current = onText; }, [onText]);
  useEffect(() => {
    const w = window as unknown as SpeechWindow;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => recognition.current?.stop();
  }, []);
  if (!supported) return null;

  function toggle() {
    if (listening) { recognition.current?.stop(); return; }
    const w = window as unknown as SpeechWindow;
    const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as RecognitionCtor;
    const next = new Ctor();
    next.lang = lang; next.continuous = true; next.interimResults = false;
    next.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) callback.current(event.results[i][0].transcript.trim());
      }
    };
    next.onend = () => setListening(false);
    next.onerror = () => setListening(false);
    recognition.current = next;
    next.start();
    setListening(true);
  }

  return <button type="button" className={`ats-voice-btn${listening ? " is-live" : ""}`} aria-pressed={listening} onClick={toggle}>{listening ? "● Listening… tap to stop" : "🎤 Dictate"}</button>;
}
