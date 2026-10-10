import { useState, useRef, useCallback } from "react";

// Web Speech API - Chrome/Edge/Safari support it under the webkit-prefixed
// name; no server round-trip, transcription happens in the browser.
const SpeechRecognition = typeof window !== "undefined"
  ? window.SpeechRecognition || window.webkitSpeechRecognition
  : null;

export function useVoiceInput(onResult) {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);

  const toggle = useCallback(() => {
    if (!SpeechRecognition) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const text = e.results?.[0]?.[0]?.transcript;
      if (text) onResult(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [listening, onResult]);

  return { supported: !!SpeechRecognition, listening, toggle };
}
