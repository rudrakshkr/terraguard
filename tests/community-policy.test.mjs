/**
 * Community corroboration tests.
 *
 * Covers the confirmation policy end to end at the library level:
 *   A. the reporter cannot confirm their own report
 *   B. another authenticated user can
 *   C. anonymous (no session) cannot
 *   D. one confirmation per user is enforced (repeats are not counted twice)
 *   E. the publication threshold is three independent non-reporter confirmations
 *      (two alone is not enough)
 *   F. corroboration is independent per user (a "cleared" vote never publishes)
 *   G. the reporter's own response can NEVER contribute to the threshold —
 *      even as legacy data written before the rule existed
 *   H. NEEDS REVIEW stays out of the public feed until the threshold is met
 *   I. a already-corroborated report remains published and leaves the review queue
 *   J. comment likes are intent-based: replaying a like or an unlike is
 *      idempotent (a retry can never flip a saved like back off)
 *   K. a like survives a storage-layer reload — asserted in a SEPARATE process
 *      so it can only pass if the like was really written to the store
 *
 * The API route enforces the same rule by calling canConfirmHazard() before it
 * touches the store, so a direct API request cannot bypass it.
 *
 * Run: npm run test:policy
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const SUITE = process.argv[2];
const OUT = "/tmp/hs-policy-build";
const DATA = "/tmp/hs-policy-store";

const CHILD_ENV = {
  AUTH_DEV_MODE: "1",
  HS_STORE: "file", // local files in a temp dir — never the project store
  HS_DATA_DIR: DATA,
  HS_SEED: "0", // no seeded demo incidents for deterministic assertions
  UPSTASH_REDIS_REST_URL: "",
  UPSTASH_REDIS_REST_TOKEN: "",
  BLOB_READ_WRITE_TOKEN: "",
  BLOB_STORE_ID: "",
  VERCEL_OIDC_TOKEN: "",
  VERCEL: "",
};

if (!SUITE) {
  console.log("Compiling lib/ for tests…");
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.mkdirSync(DATA, { recursive: true });
  execSync(
    `npx tsc lib/kv.ts lib/store.ts lib/community-store.ts lib/community-policy.ts lib/auth.ts lib/seed-incidents.ts ` +
      `--outDir ${OUT} --module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck`,
    { stdio: "inherit" },
  );
  let failed = 0;
  for (const s of ["policy", "corroboration", "likes-write", "likes-read"]) {
    const r = spawnSync(process.execPath, [import.meta.filename, s], {
      stdio: "inherit",
      env: { ...process.env, ...CHILD_ENV },
    });
    if (r.status !== 0) failed += 1;
  }
  console.log(failed ? `\n${failed} suite(s) FAILED` : "\nAll community policy suites passed");
  process.exit(failed ? 1 : 0);
}

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL ${name} ${detail}`);
  }
}

/** Minimal valid incident for the store. */
function incidentInput(overrides = {}) {
  return {
    created_at: new Date().toISOString(),
    location: "Test Road, Test Town",
    lat: 31.1,
    lng: 77.1,
    incident_type: "Landslide",
    severity: "High",
    status: "Open",
    description: "There is a large landslide on the road near the village, with mud covering one lane.",
    summary: "Landslide covering one lane of the road.",
    confidence: 0.55,
    risk_factors: ["road blocked"],
    immediate_actions: ["Avoid the area"],
    avoid: ["Do not cross debris"],
    recommended_response: "Notify local emergency services.",
    requires_urgent_attention: false,
    severity_reasons: ["lane blocked"],
    needs_verification: true,
    verification_note: "On-site verification recommended.",
    origin: "ai",
    sources: [],
    evidence: [],
    pipeline: { totalMs: 10, saved_at: new Date().toISOString() },
    status_history: [{ status: "Open", at: new Date().toISOString() }],
    verification: "needs_review",
    verification_reasons: ["Nearby corroboration: no related reports found nearby."],
    publication: "review_only",
    reporter_label: "Community report",
    confirmations_yes: 0,
    confirmations_no: 0,
    ...overrides,
  };
}

/* ------------------------------- suite: policy ------------------------------ */

async function suitePolicy() {
  console.log("\n—— policy: who may confirm, and when a report becomes public ——");
  const p = await import(`${OUT}/community-policy.js`);

  check("threshold is three independent observations", p.PUBLICATION_THRESHOLD === 3);

  const own = { reporter_id: "user-1" };
  const anon = p.canConfirmHazard(own, null);
  check("C: anonymous cannot confirm", anon.allowed === false && anon.status === 401, JSON.stringify(anon));
  const self = p.canConfirmHazard(own, "user-1");
  check(
    "A: reporter cannot confirm own report",
    self.allowed === false && self.status === 403 && self.code === "own_report",
    JSON.stringify(self),
  );
  const other = p.canConfirmHazard(own, "user-2");
  check("B: a different signed-in user can confirm", other.allowed === true, JSON.stringify(other));

  // Legacy records with no reporter_id (pre-accounts demo data) stay confirmable.
  const legacy = p.canConfirmHazard({}, "user-2");
  check("incidents without a reporter stay confirmable by anyone signed in", legacy.allowed === true);

  const review = { publication: "review_only", verification: "needs_review" };
  check("review-only detection", p.isReviewOnly(review) === true);
  check("published reports are not review-only", p.isReviewOnly({ publication: "public", verification: "needs_review" }) === false);
  check("one independent observation is not enough", p.shouldPublishFromCorroboration(review, 1) === false);
  check("two independent observations are not enough", p.shouldPublishFromCorroboration(review, 2) === false);
  check("three independent observations publish", p.shouldPublishFromCorroboration(review, 3) === true);
  check(
    "seeded demo incidents never auto-publish",
    p.shouldPublishFromCorroboration({ ...review, origin: "seed" }, 5) === false,
  );
  check("remaining count math", p.corroborationRemaining(0) === 3 && p.corroborationRemaining(1) === 2 && p.corroborationRemaining(2) === 1 && p.corroborationRemaining(3) === 0);
  check("progress label caps at the threshold", p.corroborationProgressLabel(5) === "3 of 3 observations");
}

/* ---------------------------- suite: corroboration -------------------------- */

async function suiteCorroboration() {
  console.log("\n—— corroboration: store-level confirmation and publication rules ——");
  const auth = await import(`${OUT}/auth.js`);
  const store = await import(`${OUT}/store.js`);
  const community = await import(`${OUT}/community-store.js`);
  const policy = await import(`${OUT}/community-policy.js`);

  async function makeUser(phone, name) {
    const sent = await auth.sendOtp(phone);
    const verified = await auth.verifyOtp(phone, sent.devCode);
    if (!verified.ok) throw new Error(`could not create test user ${phone}`);
    await auth.updateUser(verified.user.id, { display_name: name, onboarded: true });
    return verified.user.id;
  }

  const reporter = await makeUser("919000000101", "Reporter One");
  const userB = await makeUser("919000000102", "Neighbour Two");
  const userC = await makeUser("919000000103", "Neighbour Three");
  check("test users are distinct", new Set([reporter, userB, userC]).size === 3);

  const incident = await store.addIncident(incidentInput({ reporter_id: reporter }));
  check("review-only report saved (never discarded)", incident.publication === "review_only" && incident.verification === "needs_review");
  check("report is attributed to its reporter", incident.reporter_id === reporter);

  // H: hidden from the public alert feed.
  const publicFeed = await store.listIncidents({ public: true });
  check("H: NEEDS REVIEW is absent from the public feed", publicFeed.every((i) => i.id !== incident.id));
  const queue = await store.listIncidents({ communityReview: true });
  check("it appears in the signed-in community review queue", queue.some((i) => i.id === incident.id));

  // A/B/C: the API gate.
  check("A: owner is refused at the policy gate", policy.canConfirmHazard(incident, reporter).allowed === false);
  check("B: another user is allowed", policy.canConfirmHazard(incident, userB).allowed === true);

  // G (part 1): legacy reporter confirmation written directly to the store.
  const legacySelf = await community.recordConfirmation(incident.id, reporter, "yes");
  check("legacy reporter record is stored but is not 'already'", legacySelf.already === false);

  // D: one response per user.
  const first = await community.recordConfirmation(incident.id, userB, "yes");
  check("D: first independent confirmation is recorded", first.already === false);
  const repeat = await community.recordConfirmation(incident.id, userB, "yes");
  check("D: a repeat from the same user is not recorded again", repeat.already === true);
  const afterRepeat = await community.confirmationCounts(incident.id, { excludeUserId: reporter });
  check("D: the repeat did not inflate the count", afterRepeat.yes === 1, JSON.stringify(afterRepeat));

  // E: two independent users are still not enough.
  await community.recordConfirmation(incident.id, userC, "yes");
  const twoIndependent = await community.confirmationCounts(incident.id, { excludeUserId: reporter });
  check("E: two independent observations counted", twoIndependent.yes === 2, JSON.stringify(twoIndependent));
  const stillNotEnough = await store.confirmIncident(incident.id, true, twoIndependent);
  check("E: two independent observations do NOT publish the report", stillNotEnough?.publication === "review_only");

  // E (continued): a third independent user satisfies the threshold.
  const userD = await makeUser("919000000104", "Neighbour Four");
  await community.recordConfirmation(incident.id, userD, "yes");
  const threeIndependent = await community.confirmationCounts(incident.id, { excludeUserId: reporter });
  check("E: three independent observations counted", threeIndependent.yes === 3, JSON.stringify(threeIndependent));
  const published = await store.confirmIncident(incident.id, true, threeIndependent);
  check("E: three independent observations publish the report", published?.publication === "public");
  check(
    "G: publication reason counts the independent observations only",
    (published?.verification_reasons ?? []).some((r) => r.includes("3 independent")),
    JSON.stringify(published?.verification_reasons),
  );

  // H: now public, and no longer a review item.
  const publicAfter = await store.listIncidents({ public: true });
  check("H: corroborated report is now in the public feed", publicAfter.some((i) => i.id === incident.id));
  const queueAfter = await store.listIncidents({ communityReview: true });
  check("H: it left the review queue once published", queueAfter.every((i) => i.id !== incident.id));

  // Independent "cleared" votes must not publish a review-only report.
  const clearedReport = await store.addIncident(incidentInput({ reporter_id: reporter }));
  await community.recordConfirmation(clearedReport.id, userB, "no");
  await community.recordConfirmation(clearedReport.id, userC, "no");
  const cleared = await community.confirmationCounts(clearedReport.id, { excludeUserId: reporter });
  check("independent 'cleared' responses are counted separately", cleared.no === 2 && cleared.yes === 0);
  const afterCleared = await store.confirmIncident(clearedReport.id, false, cleared);
  check("'cleared' responses never publish a review-only report", afterCleared?.publication === "review_only");
  check("and never auto-resolve one either", afterCleared?.status !== "Resolved", String(afterCleared?.status));

  // A NEEDS REVIEW report with 3 still-present + a major unresolved evidence
  // contradiction must not automatically become public.
  const contradictoryReport = await store.addIncident(
    incidentInput({
      reporter_id: reporter,
      evidence_contradiction: true,
      verification_reasons: ["Image and description are not fully consistent."],
      verification: "needs_review",
      publication: "review_only",
    }),
  );
  const contradictedCounts = { yes: 3, no: 0 };
  const contradictoryOutcome = await store.confirmIncident(contradictoryReport.id, true, contradictedCounts);
  check("3 still-present + unresolved evidence contradiction stays review-only", contradictoryOutcome?.publication === "review_only");
  check(
    "the contradiction gate is explained in plain language",
    policy.corroborationStateLabel(contradictoryReport, 3).includes("still needs review"),
  );
  check("a clean 3-observation report is eligible", policy.corroborationStateLabel({ ...contradictoryReport, evidence_contradiction: false }, 3).includes("Eligible"));
  check("2 still-present + 1 cleared is not eligible", policy.shouldPublishFromCorroboration({ ...contradictoryReport, evidence_contradiction: false }, 2) === false);

  // Confirmations are per-incident: the same user may confirm elsewhere.
  const otherIncident = await store.addIncident(incidentInput({ reporter_id: reporter, incident_type: "Rockfall" }));
  const elsewhere = await community.recordConfirmation(otherIncident.id, userB, "yes");
  check("a user's response is scoped per incident", elsewhere.already === false);

  const mine = await community.hasConfirmed(incident.id, userB);
  check("B: a user's own response is retrievable for the UI", mine?.response === "yes");
  const lastAt = await community.latestConfirmationAt(incident.id);
  check("latest real confirmation time is exposed", typeof lastAt === "string" && !Number.isNaN(Date.parse(lastAt)));
  const noneAt = await community.latestConfirmationAt("HS-does-not-exist");
  check("no confirmations = no 'last confirmed' time", noneAt === null);
}

/* ------------------------------ suite: likes -------------------------------- */

/**
 * Likes must be an explicit state, not a flip: the app retries requests (a
 * dropped connection, an outbox replay after coming back online), and a toggle
 * would remove a like that had already been saved. This suite writes, replays
 * and reads back through the real store.
 */
async function suiteLikesWrite() {
  console.log("\n—— likes: explicit intent, idempotent replays ——");
  const store = await import(`${OUT}/store.js`);
  const community = await import(`${OUT}/community-store.js`);

  const incident = await store.addIncident(incidentInput({ reporter_id: "reporter-likes" }));
  const added = await community.addComment(
    incident.id,
    "user-a",
    "User A",
    "The road is still blocked near the school after yesterday's slide.",
  );
  check("comment created for the like tests", added.ok === true, JSON.stringify(added));
  const commentId = added.comment.id;

  const first = await community.setCommentLike(commentId, "user-a", true);
  check("a like is recorded", first.ok === true && first.liked === true && first.count === 1, JSON.stringify(first));

  const replay = await community.setCommentLike(commentId, "user-a", true);
  check(
    "replaying the same like neither inflates nor removes it",
    replay.ok === true && replay.liked === true && replay.count === 1,
    JSON.stringify(replay),
  );

  const other = await community.setCommentLike(commentId, "user-b", true);
  check("a second user adds their own like", other.ok === true && other.count === 2, JSON.stringify(other));

  const unlike = await community.setCommentLike(commentId, "user-a", false);
  check(
    "unlike removes exactly one like",
    unlike.ok === true && unlike.liked === false && unlike.count === 1,
    JSON.stringify(unlike),
  );

  const unlikeReplay = await community.setCommentLike(commentId, "user-a", false);
  check(
    "replaying an unlike is idempotent",
    unlikeReplay.ok === true && unlikeReplay.liked === false && unlikeReplay.count === 1,
    JSON.stringify(unlikeReplay),
  );

  const unknown = await community.setCommentLike("cm_does_not_exist", "user-a", true);
  check("a like on an unknown comment is refused", unknown.ok === false, JSON.stringify(unknown));

  const restore = await community.setCommentLike(commentId, "user-a", true);
  check("likes restored for the persistence check", restore.ok === true && restore.count === 2, JSON.stringify(restore));

  fs.writeFileSync(
    `${DATA}/likes-fixture.json`,
    JSON.stringify({ incidentId: incident.id, commentId, userId: "user-a" }),
  );
}

/** Runs in a fresh process: only a real write to the store can pass this. */
async function suiteLikesRead() {
  console.log("\n—— likes: still present in a fresh process (persistence) ——");
  const community = await import(`${OUT}/community-store.js`);
  const fixture = JSON.parse(fs.readFileSync(`${DATA}/likes-fixture.json`, "utf8"));

  const counts = await community.likeCountsFor([{ id: fixture.commentId }]);
  check(
    "the like count survives a storage-layer reload",
    counts[fixture.commentId] === 2,
    JSON.stringify(counts),
  );
  const mine = await community.hasLikedComment(fixture.commentId, fixture.userId);
  check("the user's own like survives too", mine !== null, JSON.stringify(mine));
  const raw = fs.readFileSync(`${DATA}/.hillsense-community.json`, "utf8");
  check("the like record is present in the on-disk store", raw.includes(fixture.commentId));
  const comments = await community.listComments(fixture.incidentId);
  check("the comment itself persists as well", comments.some((c) => c.id === fixture.commentId));
}

if (SUITE === "policy") await suitePolicy();
if (SUITE === "corroboration") await suiteCorroboration();
if (SUITE === "likes-write") await suiteLikesWrite();
if (SUITE === "likes-read") await suiteLikesRead();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
