"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Siren, ImageIcon, Mic, MicOff, X, AlertTriangle, ShieldAlert, Ban, Users,
  MapPin, ScanSearch, Save, RotateCcw, ArrowRight, Sparkles, TextCursorInput,
} from "lucide-react";
import { LOCATIONS } from "@/lib/threat";
import type { AnalyzeResponse, Incident } from "@/lib/types";
import { SeverityBadge } from "@/components/Badge";
import { ModeBadge } from "@/components/Badge";
import SourcesPanel from "@/components/SourcesPanel";
import { Spinner, AnalysisProgress } from "@/components/Spinner";
import { DEMO_SCENARIOS } from "@/lib/seed-incidents";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

/** Downscale an image client-side to keep uploads fast. */
async function downscale(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("read"));
    fr.readAsDataURL(file);
  });
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("decode"));
      im.src = dataUrl;
    });
    const max = 1280;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    if (scale === 1 && dataUrl.length < 1_500_000) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return dataUrl;
  }
}

export default function ReportPage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [location, setLocation] = useState("Kullu");
  const [lang, setLang] = useState<"en-IN" | "hi-IN">("en-IN");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Incident | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const voice = useSpeechRecognition(lang);
  const lastFinal = useRef("");

  // Append newly-finalized speech into the description box (editable before sending).
  useEffect(() => {
    const t = voice.finalText;
    if (t && t !== lastFinal.current) {
      const addition = lastFinal.current ? t.slice(lastFinal.current.length).trim() : t;
      lastFinal.current = t;
      if (addition) setText((prev) => (prev ? `${prev} ${addition}` : addition));
    }
  }, [voice.finalText]);

  const toggleMic = () => {
    if (voice.listening) voice.stop();
    else {
      lastFinal.current = "";
      voice.reset();
      voice.start();
    }
  };

  const onFile = useCallback(async (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Unsupported file. Please choose an image (JPG / PNG / WebP).");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Image too large. Please choose one under 15 MB.");
      return;
    }
    setError(null);
    setImageName(file.name);
    setImage(await downscale(file));
  }, []);

  const applyScenario = (s: (typeof DEMO_SCENARIOS)[number]) => {
    setText(s.text);
    setLocation(s.location);
    setImage(null);
    setImageName(null);
    setResult(null);
    setSaved(null);
    setError(null);
    if (s.id === "rockfall") {
      setError(null); // image optional — the text alone drives the pipeline
    }
  };

  const analyze = async () => {
    if (!text.trim() && !image) {
      setError("Add a description, an image, or a voice transcription first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    setSaved(null);
    try {
      const form = new FormData();
      form.set("text", text);
      form.set("location", location);
      if (image) {
        const blob = await (await fetch(image)).blob();
        form.set("image", blob, imageName ?? "evidence.jpg");
      }
      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Analysis failed. Please try again.");
        return;
      }
      setResult(data as AnalyzeResponse);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch {
      setError("Could not reach the analysis service. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location,
          description: text,
          analysis: result.analysis,
          aiAvailable: result.aiAvailable,
          sources: result.sources.map((s) => ({ title: s.title, doc: s.doc })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not save the incident.");
        return;
      }
      setSaved(data.incident as Incident);
    } catch {
      setError("Could not save the incident. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const resetAll = () => {
    setText("");
    setImage(null);
    setImageName(null);
    setResult(null);
    setSaved(null);
    setError(null);
    voice.reset();
    lastFinal.current = "";
  };

  const a = result?.analysis;

  return (
    <div className="topo min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* Heading */}
        <div className="mb-6">
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/15 ring-1 ring-red-500/40">
              <Siren className="h-4.5 w-4.5 text-red-400" />
            </span>
            Report an Incident
          </h1>
          <p className="mt-2 text-[13.5px] text-[#8ba1b7]">
            Describe what you see — with an image, text, or your voice. AI classifies the incident,
            grounds its guidance in the knowledge base, and produces a report.
          </p>
        </div>

        {/* Demo scenarios */}
        <div className="panel mb-6 p-4">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[#c6d4e0]">
            <Sparkles className="h-4 w-4 text-amber-300" />
            One-click demo scenarios
            <span className="font-normal text-[#8ba1b7]">— fills the form and runs the full pipeline</span>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {DEMO_SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => applyScenario(s)}
                disabled={busy}
                className="panel-hover rounded-lg border border-[#223041] bg-[#0d1218] p-3.5 text-left disabled:opacity-50"
              >
                <div className="text-lg">{s.emoji}</div>
                <div className="mt-1 text-[13px] font-semibold">{s.label}</div>
                <div className="mt-1 text-[12px] leading-snug text-[#8ba1b7]">{s.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* ---------- Input column ---------- */}
          <div className="space-y-4">
            {/* Image */}
            <div className="panel p-4">
              <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
                <ImageIcon className="h-4 w-4 text-sky-400" /> Image evidence <span className="font-normal text-[#8ba1b7]">(optional)</span>
              </div>
              {image ? (
                <div className="relative overflow-hidden rounded-lg border border-[#223041]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="Incident evidence preview" className="max-h-56 w-full object-cover" />
                  <button
                    onClick={() => { setImage(null); setImageName(null); }}
                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white ring-1 ring-white/20 hover:bg-black"
                    aria-label="Remove image"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2.5 py-1 font-mono text-[10px] text-[#c6d4e0]">
                    {imageName ?? "evidence.jpg"}
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
                  className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[#2c3e54] text-[#8ba1b7] transition hover:border-sky-500/50 hover:text-[#c6d4e0]"
                >
                  <ImageIcon className="h-6 w-6" />
                  <span className="text-[13px]">Drop a photo here or click to upload</span>
                  <span className="text-[11px]">JPG / PNG / WebP — analysed by a vision model</span>
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </div>

            {/* Description */}
            <div className="panel p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[13px] font-semibold">
                  <TextCursorInput className="h-4 w-4 text-sky-400" /> Description
                </div>
                <span className="font-mono text-[10px] text-[#4d6275]">{text.trim().length} chars</span>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder="e.g. Heavy rain has triggered a landslide and blocked the road near Kullu. Several vehicles are stuck…"
                className="w-full resize-none rounded-lg border border-[#223041] bg-[#0d1218] p-3 text-[13.5px] leading-relaxed text-[#e6edf3] placeholder:text-[#4d6275] focus:border-sky-500/60 focus:outline-none"
              />
              {/* Voice */}
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <button
                  onClick={toggleMic}
                  disabled={!voice.supported}
                  title={voice.supported ? "Voice input" : "Speech recognition unavailable in this browser"}
                  className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-semibold ring-1 transition ${
                    voice.listening
                      ? "bg-red-500/15 text-red-300 ring-red-500/40"
                      : "bg-[#141c25] text-[#e6edf3] ring-[#2c3e54] hover:border-sky-500/50 disabled:opacity-40"
                  }`}
                >
                  {voice.listening ? <Mic className="h-4 w-4 animate-pulse" /> : <MicOff className="h-4 w-4" />}
                  {voice.listening ? "Listening… tap to stop" : "Add voice description"}
                </button>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value as "en-IN" | "hi-IN")}
                  className="rounded-lg border border-[#223041] bg-[#0d1218] px-2.5 py-2 text-[12.5px] text-[#c6d4e0]"
                  aria-label="Voice language"
                >
                  <option value="en-IN">English</option>
                  <option value="hi-IN">हिन्दी</option>
                </select>
                {voice.interim && (
                  <span className="text-[12px] italic text-[#8ba1b7]">“{voice.interim}”</span>
                )}
              </div>
              {voice.error && <p className="mt-2 text-[12px] text-amber-300">{voice.error}</p>}
              {!voice.supported && !voice.error && (
                <p className="mt-2 text-[12px] text-[#4d6275]">
                  Voice input needs Chrome or Edge — the description box works everywhere.
                </p>
              )}
            </div>

            {/* Location + actions */}
            <div className="panel p-4">
              <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
                <MapPin className="h-4 w-4 text-sky-400" /> Location
              </div>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-lg border border-[#223041] bg-[#0d1218] px-3 py-2.5 text-[13.5px] text-[#e6edf3]"
              >
                {LOCATIONS.map((l) => (
                  <option key={l.name} value={l.name}>{l.name}</option>
                ))}
              </select>
              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                <button
                  onClick={analyze}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4.5 py-2.5 text-[13.5px] font-semibold text-[#06232f] transition hover:bg-sky-400 disabled:opacity-50"
                >
                  {busy ? <Spinner /> : <ScanSearch className="h-4 w-4" />}
                  {busy ? "Analyzing…" : "Analyze with AI"}
                </button>
                <button
                  onClick={resetAll}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#2c3e54] px-3.5 py-2.5 text-[13px] font-medium text-[#8ba1b7] transition hover:text-white disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </button>
              </div>
              {error && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 p-3 text-[12.5px] text-red-300 ring-1 ring-red-500/30">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* ---------- Result column ---------- */}
          <div ref={resultRef} className="space-y-4">
            <AnalysisProgress active={busy} />

            {!busy && !a && (
              <div className="panel flex h-full min-h-72 flex-col items-center justify-center p-8 text-center">
                <ScanSearch className="h-8 w-8 text-[#2c3e54]" />
                <p className="mt-3 text-[13.5px] font-medium text-[#8ba1b7]">
                  Analysis will appear here
                </p>
                <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-[#4d6275]">
                  Pick a demo scenario or write your own report, then run the pipeline —
                  classification, grounded guidance and sources.
                </p>
              </div>
            )}

            {a && (
              <>
                {/* Verdict */}
                <div className="panel fade-up p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={a.severity} />
                    <span className="rounded-full bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-sky-300 ring-1 ring-sky-500/30">
                      {a.incident_type}
                    </span>
                    {a.requires_urgent_attention && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-0.5 text-[11px] font-bold text-red-300 ring-1 ring-red-500/40">
                        <ShieldAlert className="h-3 w-3" /> URGENT
                      </span>
                    )}
                    <span className="ml-auto"><ModeBadge aiAvailable={result!.aiAvailable} grounded={result!.grounded} /></span>
                  </div>

                  {/* Confidence */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-[11px] font-medium text-[#8ba1b7]">
                      <span>Model confidence</span>
                      <span className="font-mono">{Math.round(a.confidence * 100)}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#1c2836]">
                      <div
                        className="h-full rounded-full bg-sky-400"
                        style={{ width: `${Math.round(a.confidence * 100)}%` }}
                      />
                    </div>
                  </div>

                  <p className="mt-4 text-[14px] leading-relaxed text-[#e6edf3]">{a.summary}</p>

                  {/* Risk factors */}
                  {a.risk_factors.length > 0 && (
                    <div className="mt-4">
                      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5" /> Detected risk factors
                      </div>
                      <ul className="space-y-1">
                        {a.risk_factors.map((r, i) => (
                          <li key={i} className="flex gap-2 text-[13px] text-[#c6d4e0]">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Recommended actions */}
                <div className="panel fade-up space-y-4 p-5">
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                      <Users className="h-3.5 w-3.5" /> Immediate actions
                    </div>
                    <ol className="space-y-1.5">
                      {a.immediate_actions.map((act, i) => (
                        <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-[#e6edf3]">
                          <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded bg-emerald-500/15 text-[10px] font-bold text-emerald-300">
                            {i + 1}
                          </span>
                          {act}
                        </li>
                      ))}
                    </ol>
                  </div>
                  {a.avoid.length > 0 && (
                    <div>
                      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-red-300">
                        <Ban className="h-3.5 w-3.5" /> Things to avoid
                      </div>
                      <ul className="space-y-1.5">
                        {a.avoid.map((v, i) => (
                          <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-[#c6d4e0]">
                            <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                            {v}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {a.recommended_response && (
                    <div className="rounded-lg border border-[#223041] bg-[#0d1218] p-3.5">
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-sky-300">
                        Recommended response
                      </div>
                      <p className="text-[13px] leading-relaxed text-[#c6d4e0]">{a.recommended_response}</p>
                    </div>
                  )}
                  <p className="text-[11px] leading-relaxed text-[#4d6275]">
                    Decision support only — not an official emergency instruction. In a
                    life-threatening situation call 112.
                  </p>
                </div>

                {/* Sources */}
                <SourcesPanel sources={result!.sources} grounded={result!.grounded} />

                {/* Save / report */}
                <div className="panel fade-up p-4">
                  {saved ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-emerald-300">
                        <Save className="h-4 w-4" /> Saved as {saved.id}
                      </span>
                      <button
                        onClick={() => router.push(`/report/${saved.id}`)}
                        className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-[13px] font-semibold text-[#06232f] hover:bg-sky-400"
                      >
                        Open incident report <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => router.push("/dashboard")}
                        className="text-[13px] font-medium text-[#8ba1b7] hover:text-white"
                      >
                        View in Command Center
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={save}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-[13px] font-semibold text-[#06232f] hover:bg-sky-400 disabled:opacity-50"
                      >
                        {saving ? <Spinner /> : <Save className="h-4 w-4" />}
                        Save to Command Center
                      </button>
                      <span className="text-[12px] text-[#8ba1b7]">
                        Persists the incident, then opens the printable report with map and PDF download.
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
