export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

const STEPS = [
  "Reading your report",
  "Checking the evidence for consistency",
  "Attaching relevant safety guidance",
  "Preparing the assessment",
];

export function AnalysisProgress({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="panel fade-up p-4">
      <div className="space-y-2.5">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2.5 text-[13px] text-[#aebecb]">
            <span className="relative flex h-2 w-2">
              <span
                className="absolute inline-flex h-full w-full rounded-full bg-sky-400"
                style={{ animation: `markerPulse 1.4s ease-out ${i * 0.25}s infinite` }}
              />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-400/70" />
            </span>
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}
