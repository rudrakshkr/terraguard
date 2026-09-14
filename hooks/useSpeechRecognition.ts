"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type WindowWithSpeech = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

/**
 * Browser speech-to-text (Web Speech API). Final transcripts accumulate in
 * `finalText`; the page appends the delta into its description field.
 */
export function useSpeechRecognition(lang: "en-IN" | "hi-IN") {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const langRef = useRef(lang);

  useEffect(() => {
    const t = setTimeout(() => {
      const w = window as WindowWithSpeech;
      const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
      setSupported(Boolean(Ctor));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const start = useCallback(() => {
    const w = window as WindowWithSpeech;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setError("Speech recognition is not supported in this browser. Type the description instead.");
      return;
    }
    setError(null);
    try {
      const rec = new Ctor();
      rec.lang = langRef.current;
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        let finals = "";
        let inter = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finals += r[0].transcript;
          else inter += r[0].transcript;
        }
        if (finals) setFinalText((prev) => (prev ? `${prev} ${finals.trim()}` : finals.trim()));
        setInterim(inter);
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setError("Microphone permission was denied. Allow mic access or type the description.");
        } else if (e.error !== "aborted" && e.error !== "no-speech") {
          setError("Voice input failed. Please type the description instead.");
        }
        setListening(false);
      };
      rec.onend = () => setListening(false);
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setError("Could not start voice input. Please type the description instead.");
      setListening(false);
    }
  }, []);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
    setListening(false);
    setInterim("");
  }, []);

  const reset = useCallback(() => {
    setFinalText("");
    setInterim("");
  }, []);

  useEffect(
    () => () => {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  return { supported, listening, finalText, interim, error, start, stop, reset, setLang: (l: "en-IN" | "hi-IN") => (langRef.current = l) };
}
