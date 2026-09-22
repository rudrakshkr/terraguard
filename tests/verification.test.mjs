/**
 * Verification-policy tests.
 *
 * The rule under test: HillSense assesses EVIDENCE CONSISTENCY, not whether a
 * person is truthful. A plausible community report must never be rejected just
 * because the AI is uncertain, the photo is unclear, the declared hazard type
 * differs from the classification, or there is no nearby corroboration.
 * NOT PUBLISHED is reserved for genuinely unusable submissions.
 *
 * Run: npm run test:verification
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const OUT = "/tmp/hs-verify-compile";

console.log("Compiling lib/verification.ts for tests…");
fs.rmSync(OUT, { recursive: true, force: true });
execSync(
  `npx tsc lib/verification.ts --outDir ${OUT} --module commonjs --target es2022 ` +
    "--moduleResolution node --esModuleInterop --skipLibCheck",
  { stdio: "inherit" },
);

const require = createRequire(import.meta.url);
const { verifyReport, looksLikeGibberish } = require(path.join(OUT, "verification.js"));

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

/** Minimal IncidentAnalysis with sensible defaults. */
const analysis = (over = {}) => ({
  incident_type: "Landslide",
  severity: "High",
  confidence: 0.9,
  summary: "Large landslide covering one lane of the road.",
  risk_factors: ["Unstable slope material", "Vehicles stuck behind the blockage"],
  immediate_actions: [],
  avoid: [],
  recommended_response: "",
  requires_urgent_attention: true,
  ...over,
});

/** A nearby report used for corroboration checks. */
const nearbyReport = (distanceKm, minutesApart) => ({
  incident: { status: "Open", verification: "verified" },
  distanceKm,
  minutesApart,
});

const statuses = (r) => `${r.status}/${r.publication}/${r.headline}`;

/* ------------------------------- Case A ------------------------------------ */
console.log("\nCASE A — plausible text report, no image");
{
  const r = verifyReport({
    analysis: analysis(),
    aiAvailable: true,
    hasImage: false,
    hasText: true,
    text: "There is a large landslide on the road near the village. Mud and rocks are covering one lane and traffic is slowing down.",
    hazardType: "Landslide",
    location: { lat: 31.1, lng: 77.17 },
  });
  check("never NOT PUBLISHED without an image", r.status !== "rejected", statuses(r));
  check("lands in needs_review or verified", r.status === "needs_review" || r.status === "verified", statuses(r));
  check("no-image consistency check is not a hard fail", !r.evidence_checks.some((c) => c.pass === "fail"), JSON.stringify(r.evidence_checks));
  check("no truthfulness claim", !/truth|\blie\b|\blying\b/i.test(JSON.stringify(r)));
}

/* ------------------------------- Case B ------------------------------------ */
console.log("\nCASE B — clear text + image, low model confidence");
{
  const r = verifyReport({
    analysis: analysis({ confidence: 0.32, needs_verification: true, verification_note: "Photo unclear" }),
    aiAvailable: true,
    hasImage: true,
    hasText: true,
    text: "Large landslide has blocked the highway after heavy rain, debris is still moving down the slope.",
    hazardType: "Landslide",
    location: { lat: 31.1, lng: 77.17 },
  });
  check("is needs_review", r.status === "needs_review", statuses(r));
  check("not published", r.publication === "review_only", r.publication);
  const consistency = r.evidence_checks.find((c) => c.check === "Image ↔ description consistency");
  const plausibility = r.evidence_checks.find((c) => c.check === "Image plausibility");
  check("consistency check is warn (not fail)", consistency?.pass === "warn", JSON.stringify(consistency));
  check("image plausibility is warn (not fail)", plausibility?.pass === "warn", JSON.stringify(plausibility));
  check(
    "explains it was retained for review",
    /retained for .*review/i.test(consistency?.detail ?? ""),
    consistency?.detail,
  );
}

/* ------------------------------- Case C ------------------------------------ */
console.log("\nCASE C — reporter says Landslide, AI classifies Road Blockage");
{
  const r = verifyReport({
    analysis: analysis({ incident_type: "Road Blockage", confidence: 0.9 }),
    aiAvailable: true,
    hasImage: true,
    hasText: true,
    text: "The landslide debris has completely covered the road and nothing can pass through this stretch.",
    hazardType: "Landslide",
    location: { lat: 31.1, lng: 77.17 },
  });
  check("is needs_review, not rejected", r.status === "needs_review", statuses(r));
  const typeCheck = r.evidence_checks.find((c) => c.check === "Hazard-type consistency");
  check("type mismatch is warn", typeCheck?.pass === "warn", JSON.stringify(typeCheck));
  check(
    "wording explains the difference needs review",
    /needs review/i.test(typeCheck?.detail ?? ""),
    typeCheck?.detail,
  );
}

/* ------------------------------- Case D ------------------------------------ */
console.log("\nCASE D — no nearby corroboration");
{
  const r = verifyReport({
    analysis: analysis(),
    aiAvailable: true,
    hasImage: true,
    hasText: true,
    text: "Rockfall has covered the left lane near the culvert, several large stones are still on the road.",
    hazardType: "Rockfall",
    nearby: [],
    location: { lat: 31.1, lng: 77.17 },
  });
  check("never rejected for missing corroboration", r.status !== "rejected", statuses(r));
  const corr = r.evidence_checks.find((c) => c.check === "Nearby corroboration");
  check("corroboration stays a warn", corr?.pass === "warn", JSON.stringify(corr));
}

/* ------------------------------- Case E ------------------------------------ */
console.log("\nCASE E — short but plausible report");
{
  const r = verifyReport({
    analysis: analysis({ incident_type: "Rockfall" }),
    aiAvailable: true,
    hasImage: false,
    hasText: true,
    text: "Rockfall near the road, several large stones have fallen onto the left lane.",
    hazardType: "Rockfall",
    location: { lat: 31.1, lng: 77.17 },
  });
  check("never rejected", r.status !== "rejected", statuses(r));
}

/* ------------------------------- Case F ------------------------------------ */
console.log("\nCASE F — random text, no image");
{
  check("gibberish detector still fires", looksLikeGibberish("asdf qqqq zzzzz 12345"));
  const r = verifyReport({
    analysis: analysis({ incident_type: "Other", confidence: 0.1, needs_verification: true }),
    aiAvailable: true,
    hasImage: false,
    hasText: true,
    text: "asdf qqqq zzzzz 12345",
    location: { lat: 31.1, lng: 77.17 },
  });
  check("is NOT PUBLISHED", r.status === "rejected", statuses(r));
  check("publication hidden", r.publication === "hidden", r.publication);
  check("headline NOT PUBLISHED", r.headline === "NOT PUBLISHED", r.headline);
}

/* ------------------------------- Case G ------------------------------------ */
console.log("\nCASE G — random text + useful hazard image");
{
  const r = verifyReport({
    analysis: analysis({ confidence: 0.55, needs_verification: true }),
    aiAvailable: true,
    hasImage: true,
    hasText: true,
    text: "asdf qqqq zzzzz 12345",
    hazardType: "Landslide",
    location: { lat: 31.1, lng: 77.17 },
  });
  check("needs_review, not rejection", r.status === "needs_review", statuses(r));
  const quality = r.evidence_checks.find((c) => c.check === "Description quality");
  check("description quality is warn when a photo exists", quality?.pass === "warn", JSON.stringify(quality));
}

/* ------------------------------- Case H ------------------------------------ */
console.log("\nCASE H — no text and no image");
{
  const r = verifyReport({
    analysis: analysis(),
    aiAvailable: true,
    hasImage: false,
    hasText: false,
    text: "",
  });
  check("is NOT PUBLISHED", r.status === "rejected", statuses(r));
  check("explains there is no usable evidence", /no usable evidence/i.test(r.explanation), r.explanation);
}

/* -------------------- AI CHECK PASSED must stay reachable ------------------- */
console.log("\nCASE I — fully consistent, corroborated report still passes");
{
  const r = verifyReport({
    analysis: analysis({ confidence: 0.93 }),
    aiAvailable: true,
    hasImage: true,
    hasText: true,
    text: "A large landslide has brought mud and rocks down onto the highway near the village, blocking one lane completely and leaving traffic standing.",
    hazardType: "Landslide",
    location: { lat: 31.1, lng: 77.17 },
    nearby: [nearbyReport(2.1, 90), nearbyReport(3.4, 210)],
  });
  check("verified / public / AI CHECK PASSED", r.status === "verified" && r.publication === "public" && r.headline === "AI CHECK PASSED", statuses(r));
  check("no warning left in the checks", !r.evidence_checks.some((c) => c.pass === "warn"), JSON.stringify(r.evidence_checks));
  check("no truthfulness claim", !/truth|\blie\b|\blying\b/i.test(JSON.stringify(r)));
}

/* ------------------------- policy invariants (all cases) ------------------- */
console.log("\nINVARIANTS");
{
  const inputs = [
    { hasImage: false, hasText: true, text: "There is a landslide on the road near the village, mud and rocks cover one lane.", hazardType: "Landslide" },
    { hasImage: true, hasText: true, text: "Rockfall on the road, large stones on the left lane.", hazardType: "Road Blockage" },
    { hasImage: true, hasText: false, text: "", hazardType: undefined },
    { hasImage: true, hasText: true, text: "Flood water rising near the bridge and entering the lower houses of the village.", hazardType: "Flood" },
  ];
  let rejected = 0;
  let truthClaim = false;
  let probability = false;
  for (const input of inputs) {
    const r = verifyReport({
      analysis: analysis({ confidence: 0.2, needs_verification: true }),
      aiAvailable: true,
      ...input,
      location: { lat: 31.1, lng: 77.17 },
    });
    if (r.status === "rejected") rejected++;
    if (r.explanation && /truth|\blie\b|\blying\b/i.test(r.explanation)) truthClaim = true;
    const flat = JSON.stringify(r);
    if (/truth_probability|probability_of_truth|"probability"/.test(flat)) probability = true;
  }
  check("no truly-usable submission is rejected at low confidence", rejected === 0, `rejected=${rejected}`);
  check("no truthfulness wording anywhere", !truthClaim);
  check("no numerical truth probability", !probability);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
