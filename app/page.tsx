import Link from "next/link";
import {
  Mountain,
  ScanSearch,
  BookOpenCheck,
  Mic,
  Gauge,
  ScrollText,
  LayoutDashboard,
  ArrowRight,
  Siren,
} from "lucide-react";

const STEPS = [
  { n: 1, title: "Report", desc: "Image, text or voice — whatever the situation allows.", icon: Siren },
  { n: 2, title: "Analyze", desc: "Vision + language model classifies type, severity, urgency.", icon: ScanSearch },
  { n: 3, title: "Ground", desc: "RAG retrieves safety knowledge; recommendations cite it.", icon: BookOpenCheck },
  { n: 4, title: "Respond", desc: "Actions, map view and a shareable incident report.", icon: Gauge },
];

const CAPABILITIES = [
  { icon: ScanSearch, title: "Multimodal incident analysis", desc: "Image + text understanding of landslides, flash floods, rockfall and more." },
  { icon: BookOpenCheck, title: "RAG-powered safety guidance", desc: "Every recommendation is grounded in a local disaster-safety knowledge base." },
  { icon: Mic, title: "Voice reporting", desc: "Speak the report in English or Hindi; transcription is editable before analysis." },
  { icon: Gauge, title: "Risk classification", desc: "Severity, confidence and urgency flags following a documented severity guide." },
  { icon: ScrollText, title: "Incident report generation", desc: "One click produces a structured report — printable and downloadable as PDF." },
  { icon: LayoutDashboard, title: "Command-center dashboard", desc: "Live map, severity filters, charts and incident management for responders." },
];

const PIPELINE = [
  { label: "Input", value: "“Heavy rain has triggered a landslide and blocked a road near Kullu.”", tone: "text-[#e6edf3]" },
  { label: "AI Analysis", value: "Landslide · High severity · 0.91 confidence — debris on highway, vehicles stranded, rain ongoing", tone: "text-sky-300" },
  { label: "Recommendations", value: "Cordon both approaches · move people clear of the slope · divert traffic · request PWD clearance (grounded in 3 sources)", tone: "text-emerald-300" },
  { label: "Report", value: "HS-1001 · Kullu · structured PDF with evidence, actions and source references", tone: "text-amber-300" },
];

export default function LandingPage() {
  return (
    <div className="topo">
      {/* Hero */}
      <section className="mx-auto max-w-7xl px-4 pb-16 pt-20 text-center sm:pt-24">
        <div className="fade-up mx-auto mb-6 inline-flex items-center gap-2 rounded-full bg-sky-500/10 px-3.5 py-1.5 text-xs font-medium text-sky-300 ring-1 ring-sky-500/30">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
          Engineering Day prototype · decision support, not official advisories
        </div>
        <h1 className="fade-up text-4xl font-bold tracking-tight sm:text-6xl">
          HillSense <span className="text-sky-400">AI</span>
        </h1>
        <p className="fade-up mx-auto mt-4 max-w-2xl text-lg font-medium text-[#c6d4e0] sm:text-xl">
          AI-powered disaster intelligence for mountain communities
        </p>
        <p className="fade-up mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-[#8ba1b7]">
          Turn reports, images and voice messages into actionable incident intelligence —
          grounded in a disaster-safety knowledge base, mapped, and ready to share.
        </p>
        <div className="fade-up mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/report"
            className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-[#06232f] transition hover:bg-sky-400"
          >
            <Siren className="h-4 w-4" />
            Report an Incident
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-[#2c3e54] bg-[#141c25] px-5 py-2.5 text-sm font-semibold text-[#e6edf3] transition hover:border-sky-500/50"
          >
            <LayoutDashboard className="h-4 w-4" />
            Open Command Center
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-4 py-14">
        <h2 className="text-center text-2xl font-bold tracking-tight">How it works</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ n, title, desc, icon: Icon }) => (
            <div key={n} className="panel panel-hover p-5">
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 ring-1 ring-sky-500/30">
                  <Icon className="h-4.5 w-4.5 text-sky-400" />
                </span>
                <span className="font-mono text-xs text-[#4d6275]">0{n}</span>
              </div>
              <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#8ba1b7]">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Example scenario pipeline */}
      <section className="mx-auto max-w-7xl px-4 py-14">
        <div className="panel overflow-hidden">
          <div className="border-b border-[#223041] bg-[#0d1218] px-5 py-3.5">
            <h2 className="text-sm font-semibold tracking-wide text-[#c6d4e0]">
              Example scenario — from message to mission-ready report
            </h2>
          </div>
          <div className="grid gap-0 md:grid-cols-4">
            {PIPELINE.map((p, i) => (
              <div key={p.label} className="relative border-b border-[#223041] p-5 md:border-b-0 md:border-r md:last:border-r-0">
                <div className="font-mono text-[10px] uppercase tracking-widest text-[#4d6275]">
                  Step {i + 1}
                </div>
                <div className="mt-1 text-[13px] font-semibold">{p.label}</div>
                <p className={`mt-2 text-[12.5px] leading-relaxed ${p.tone}`}>{p.value}</p>
                {i < PIPELINE.length - 1 && (
                  <ArrowRight className="absolute -right-2.5 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-[#3b82c4] md:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI capabilities */}
      <section className="mx-auto max-w-7xl px-4 py-14">
        <h2 className="text-center text-2xl font-bold tracking-tight">AI capabilities</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="panel panel-hover p-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 ring-1 ring-sky-500/30">
                <Icon className="h-4.5 w-4.5 text-sky-400" />
              </span>
              <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#8ba1b7]">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-20 pt-6">
        <div className="panel flex flex-col items-center gap-4 px-6 py-10 text-center">
          <Mountain className="h-6 w-6 text-sky-400" />
          <h2 className="text-xl font-bold tracking-tight">
            Human report → AI understanding → grounded knowledge → actionable response
          </h2>
          <p className="max-w-xl text-[13px] leading-relaxed text-[#8ba1b7]">
            HillSense AI is a demonstration prototype. Outputs are decision support to help
            organise information faster — always follow official instructions from your district
            administration. In a life-threatening emergency, call 112.
          </p>
          <Link
            href="/report"
            className="mt-1 inline-flex items-center gap-2 rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-[#06232f] transition hover:bg-sky-400"
          >
            Try the live demo
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
