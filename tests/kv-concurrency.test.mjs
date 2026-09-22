/**
 * Concurrency tests for the KV layer (lib/kv.ts) — both remote backends.
 *
 *  Suite 1: UPSTASH mode — stubs the REST API with a faithful Lua CAS port,
 *           simulated network latency, and injected lost races.
 *  Suite 2: BLOB mode — in-memory adapter honoring create-only puts with
 *           latency, so the lease/serialization logic is exercised for real.
 *
 * Run: npm run test:kv
 * Each suite runs in its own child process — kv.ts detects the backend from
 * env at module load, and compiled CommonJS modules cache on first import.
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const SUITE = process.argv[2]; // "upstash" | "blob" | undefined (parent: run both)
const OUT = "/tmp/kvtest-compile";

if (!SUITE) {
  // Parent: compile once, then run each suite in a clean child process.
  console.log("Compiling lib/ for tests…");
  fs.rmSync(OUT, { recursive: true, force: true });
  execSync(
    `npx tsc lib/kv.ts lib/store.ts lib/community-store.ts lib/auth.ts lib/seed-incidents.ts ` +
      `--outDir ${OUT} --module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck`,
    { stdio: "inherit" },
  );
  let failed = 0;
  for (const s of ["upstash", "blob"]) {
    const r = spawnSync(process.execPath, [import.meta.filename, s], {
      stdio: "inherit",
      env: { ...process.env, BLOB_READ_WRITE_TOKEN: "", BLOB_STORE_ID: "", UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "" },
    });
    if (r.status !== 0) failed += 1;
  }
  console.log(failed ? `\n${failed} suite(s) FAILED` : "\nAll suites passed");
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

const INCIDENT_INPUT = {
  created_at: new Date().toISOString(),
  location: "Test Ghat",
  lat: 32.2,
  lng: 77.2,
  incident_type: "Landslide",
  severity: "High",
  status: "Open",
  description: "d",
  summary: "s",
  confidence: 0.5,
  risk_factors: [],
  immediate_actions: [],
  avoid: [],
  recommended_response: [],
  requires_urgent_attention: false,
  severity_reasons: [],
  needs_verification: false,
  verification_note: "",
  origin: "manual",
  sources: [],
  evidence: [],
  pipeline: { totalMs: 1 },
  status_history: [],
  verification: "verified",
  verification_reasons: [],
  publication: "public",
  reporter_label: "T",
  reporter_id: "u0",
  last_confirmed_at: new Date().toISOString(),
  confirmations_yes: 0,
  confirmations_no: 0,
};

/* =============================== SUITE 1: UPSTASH =============================== */

async function suiteUpstash() {
  console.log("\n—— Suite 1: Upstash CAS mode ——");
  process.env.UPSTASH_REDIS_REST_URL = "http://stub.local";
  process.env.UPSTASH_REDIS_REST_TOKEN = "stub";
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_STORE_ID;

  const store = new Map();
  let forcedCasFails = 3; // inject lost races to exercise the retry loop
  global.fetch = async (url, opts) => {
    await new Promise((r) => setTimeout(r, 2 + Math.random() * 8));
    const cmd = JSON.parse(opts.body);
    const [op] = cmd;
    if (op === "GET") return Response.json({ result: store.get(cmd[1]) ?? null });
    if (op === "SET") {
      if (cmd[3] === "NX") {
        if (store.has(cmd[1])) return Response.json({ result: null });
        store.set(cmd[1], cmd[2]);
        return Response.json({ result: "OK" });
      }
      store.set(cmd[1], cmd[2]);
      return Response.json({ result: "OK" });
    }
    if (op === "EVAL") {
      const [, , , key, prev, next] = cmd;
      await new Promise((r) => setTimeout(r, 1 + Math.random() * 5));
      const cur = store.get(key);
      const matches = cur == null ? prev === "__missing__" : cur === prev;
      if (matches && forcedCasFails > 0) {
        forcedCasFails--;
        return Response.json({ result: 0 });
      }
      if (matches) {
        store.set(key, next);
        return Response.json({ result: 1 });
      }
      return Response.json({ result: 0 });
    }
    return Response.json({ result: null, error: "unknown op" });
  };

  // fresh process — module-level mode detection picks up the env above
  const kv = await import(`${OUT}/kv.js`);
  const cs = await import(`${OUT}/community-store.js`);
  const st = await import(`${OUT}/store.js`);

  console.log("mode:", kv.kvMode, "| shared:", kv.kvEnabled);
  check("S1: upstash mode active", kv.kvMode === "upstash");

  await st.addIncident({ ...INCIDENT_INPUT });
  const target = (await st.listIncidents()).find((i) => i.location === "Test Ghat");

  // A: duplicate suppression under contention
  const resultsA = await Promise.all(
    Array.from({ length: 12 }, () => cs.recordConfirmation(target.id, "user-A", "yes")),
  );
  const dbA = await cs.listConfirmations(target.id);
  check("S1-A: exactly 1 of 12 same-user confirmations accepted",
    resultsA.filter((r) => !r.already).length === 1);
  check("S1-A: only 1 record persisted", dbA.length === 1, `got ${dbA.length}`);

  // B: no lost updates across concurrent users
  await Promise.all([
    Promise.all(Array.from({ length: 20 }, (_, i) =>
      cs.recordConfirmation(target.id, `u-${i}`, i % 2 ? "no" : "yes"))),
    Promise.all(Array.from({ length: 20 }, (_, i) =>
      cs.addComment(target.id, `u-${i}`, `N${i}`, `obs ${i}`))),
  ]);
  const dbB = await cs.listConfirmations(target.id);
  check("S1-B: all 21 confirmations persisted (no lost updates)", dbB.length === 21, `got ${dbB.length}`);
  check("S1-B: all 20 comments persisted", (await cs.listComments(target.id)).length === 20);

  // C: concurrent report creation — unique, gapless ids
  const created = await Promise.all(
    Array.from({ length: 10 }, () => st.addIncident({ ...INCIDENT_INPUT, location: "Conc" })),
  );
  const ids = created.map((i) => i.id);
  check("S1-C: 10 concurrent creates → 10 unique ids", new Set(ids).size === 10);
  const nums = ids.map((i) => parseInt(i.replace("HS-", ""), 10)).sort((a, b) => a - b);
  check("S1-C: ids gapless consecutive", nums.every((n, k) => k === 0 || n === nums[k - 1] + 1), ids.join(","));

  // D: aggregates recomputed from records
  const counts = await cs.confirmationCounts(target.id);
  check("S1-D: counts match records",
    counts.yes === dbB.filter((c) => c.response === "yes").length &&
    counts.no === dbB.filter((c) => c.response === "no").length);
}

/* ================================ SUITE 2: BLOB ================================= */

async function suiteBlob() {
  console.log("\n—— Suite 2: Vercel Blob lease mode ——");
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.BLOB_STORE_ID = "store_test";
  process.env.VERCEL_OIDC_TOKEN = "oidc-test";

  const kv = await import(`${OUT}/kv.js`);
  const cs = await import(`${OUT}/community-store.js`);
  const st = await import(`${OUT}/store.js`);

  // In-memory blob with latency; putNew fails when the path exists.
  const files = new Map();
  let putNewCollisions = 0;
  const lat = () => new Promise((r) => setTimeout(r, 1 + Math.random() * 4));
  kv.__setBlobAdapterForTests({
    async get(path) {
      await lat();
      return files.get(path) ?? null;
    },
    async putNew(path, body) {
      await lat();
      if (files.has(path)) {
        putNewCollisions++;
        throw new Error("Blob already exists");
      }
      files.set(path, body);
    },
    async put(path, body) {
      await lat();
      files.set(path, body);
    },
    async del(path) {
      await lat();
      files.delete(path);
    },
  });

  console.log("mode:", kv.kvMode, "| shared:", kv.kvEnabled);
  check("S2: blob mode active", kv.kvMode === "blob");

  await st.addIncident({ ...INCIDENT_INPUT });
  const target = (await st.listIncidents()).find((i) => i.location === "Test Ghat");

  // A: 12 concurrent same-user confirmations — lease must serialize
  const resultsA = await Promise.all(
    Array.from({ length: 12 }, () => cs.recordConfirmation(target.id, "user-A", "yes")),
  );
  const dbA = await cs.listConfirmations(target.id);
  check("S2-A: exactly 1 of 12 same-user confirmations accepted",
    resultsA.filter((r) => !r.already).length === 1);
  check("S2-A: only 1 record persisted", dbA.length === 1, `got ${dbA.length}`);
  check("S2-A: lease contention actually exercised", putNewCollisions > 0, `${putNewCollisions} collisions`);

  // B: distinct users, mixed ops
  await Promise.all([
    Promise.all(Array.from({ length: 20 }, (_, i) =>
      cs.recordConfirmation(target.id, `b-${i}`, i % 2 ? "no" : "yes"))),
    Promise.all(Array.from({ length: 20 }, (_, i) =>
      cs.addComment(target.id, `b-${i}`, `N${i}`, `obs ${i}`))),
  ]);
  const dbB = await cs.listConfirmations(target.id);
  check("S2-B: all 21 confirmations persisted (no lost updates)", dbB.length === 21, `got ${dbB.length}`);
  check("S2-B: all 20 comments persisted", (await cs.listComments(target.id)).length === 20);

  // C: concurrent incident creation under a single lease key
  const created = await Promise.all(
    Array.from({ length: 10 }, () => st.addIncident({ ...INCIDENT_INPUT, location: "ConcBlob" })),
  );
  const ids = created.map((i) => i.id);
  check("S2-C: 10 concurrent creates → 10 unique ids", new Set(ids).size === 10, ids.join(","));

  // D: aggregate integrity
  const counts = await cs.confirmationCounts(target.id);
  check("S2-D: counts match records",
    counts.yes === dbB.filter((c) => c.response === "yes").length &&
    counts.no === dbB.filter((c) => c.response === "no").length);

  // E: a stored document that predates a feature must not break it. Production
  // stores created before comment likes existed have no `comment_likes` key —
  // reading it as-is threw and the request answered 500.
  files.set(
    "hillsense/data/hillsense:community:v1.json",
    JSON.stringify({
      confirmations: [],
      comments: [{
        id: "cm_legacy",
        incident_id: target.id,
        user_id: "legacy-user",
        author_name: "Legacy User",
        body: "written before likes existed",
        created_at: new Date().toISOString(),
      }],
    }),
  );
  const legacyLike = await cs.setCommentLike("cm_legacy", "legacy-user", true);
  check(
    "S2-E: a like works on a document without comment_likes",
    legacyLike.ok === true && legacyLike.count === 1,
    JSON.stringify(legacyLike),
  );
  const legacyCounts = await cs.likeCountsFor([{ id: "cm_legacy" }]);
  check("S2-E: the legacy like is readable again", legacyCounts.cm_legacy === 1, JSON.stringify(legacyCounts));
  const legacyReplay = await cs.setCommentLike("cm_legacy", "legacy-user", true);
  check("S2-E: replaying it stays idempotent", legacyReplay.ok === true && legacyReplay.count === 1, JSON.stringify(legacyReplay));
  const legacyComments = await cs.listComments(target.id);
  check("S2-E: the legacy comment is still readable", legacyComments.some((c) => c.id === "cm_legacy"));
}

/* ==================================== run ======================================= */

if (SUITE === "upstash") await suiteUpstash();
if (SUITE === "blob") await suiteBlob();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
