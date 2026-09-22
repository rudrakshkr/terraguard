/**
 * Persistence tests — users, sessions and profiles survive a serverless
 * "cold start" (fresh process, fresh module state) on BOTH remote backends,
 * and the Vercel file-mode guard refuses to pretend writes persisted.
 *
 * Suites (each a clean child process, like kv-concurrency.test.mjs):
 *   upstash-writer  → sign up, session, profile write (shared stub Redis fixture)
 *   upstash-reload  → NEW process, same fixture: token valid, user+profile intact
 *   blob-writer     → same flow against the in-memory blob fixture
 *   blob-reload     → NEW process, same fixture: token valid, user+profile intact
 *   vercel-guard    → VERCEL=1 without a remote backend: mode=file,
 *                     persistent=false, writes throw instead of silently losing data
 *
 * Run: npm run test:persistence
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const SUITE = process.argv[2]; // undefined = parent (compile + spawn all)
const OUT = "/tmp/kvtest-compile";
const FIXTURE = "/tmp/hs-persist-fixture.json"; // stub "remote" backend contents
const META = "/tmp/hs-persist-meta.json"; // token/user handed from writer → reloader

const CHILD_ENV = {
  AUTH_DEV_MODE: "1",
  BLOB_READ_WRITE_TOKEN: "",
  BLOB_STORE_ID: "",
  VERCEL_OIDC_TOKEN: "",
  UPSTASH_REDIS_REST_URL: "",
  UPSTASH_REDIS_REST_TOKEN: "",
};

if (!SUITE) {
  fs.rmSync(FIXTURE, { force: true });
  fs.rmSync(META, { force: true });
  console.log("Compiling lib/ for tests…");
  fs.rmSync(OUT, { recursive: true, force: true });
  execSync(
    `npx tsc lib/kv.ts lib/store.ts lib/community-store.ts lib/auth.ts lib/seed-incidents.ts ` +
      `--outDir ${OUT} --module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck`,
    { stdio: "inherit" },
  );
  let failed = 0;
  for (const s of ["upstash-writer", "upstash-reload", "blob-writer", "blob-reload", "vercel-guard"]) {
    const r = spawnSync(process.execPath, [import.meta.filename, s], {
      stdio: "inherit",
      env: { ...process.env, ...CHILD_ENV },
    });
    if (r.status !== 0) failed += 1;
  }
  console.log(failed ? `\n${failed} suite(s) FAILED` : "\nAll persistence suites passed");
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

/** Stub remote backend persisted to FIXTURE so a fresh process sees the same data. */
function loadFixture() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(FIXTURE, "utf8"))));
  } catch {
    return new Map();
  }
}
function saveFixture(map) {
  fs.writeFileSync(FIXTURE, JSON.stringify(Object.fromEntries(map)));
}

/** The full profile written by the writer suites and asserted by the reloaders. */
const PROFILE = {
  display_name: "Asha Persistence",
  email: "asha@example.com",
  location: {
    full_address: "Jail Road, Civil Lines, Ludhiana, Ludhiana District, Punjab, 141001, India",
    locality: "Civil Lines",
    city: "Ludhiana",
    district: "Ludhiana District",
    state: "Punjab",
    pincode: "141001",
    lat: 30.9102,
    lng: 75.8513,
    approximate: false,
  },
};

async function suiteWriter(kind) {
  console.log(`\n—— ${kind}: writer (sign up → session → profile) ——`);
  if (kind === "upstash") {
    process.env.UPSTASH_REDIS_REST_URL = "http://stub.local";
    process.env.UPSTASH_REDIS_REST_TOKEN = "stub";
    const store = loadFixture();
    global.fetch = async (_url, opts) => {
      const cmd = JSON.parse(opts.body);
      const [op] = cmd;
      if (op === "GET") return Response.json({ result: store.get(cmd[1]) ?? null });
      if (op === "SET") {
        store.set(cmd[1], cmd[2]);
        saveFixture(store);
        return Response.json({ result: "OK" });
      }
      if (op === "EVAL") {
        const [, , , key, prev, next] = cmd;
        const cur = store.get(key);
        const matches = cur == null ? prev === "__missing__" : cur === prev;
        if (matches) {
          store.set(key, next);
          saveFixture(store);
          return Response.json({ result: 1 });
        }
        return Response.json({ result: 0 });
      }
      return Response.json({ result: null, error: "unknown op" });
    };
  } else {
    process.env.BLOB_STORE_ID = "store_test";
    process.env.VERCEL_OIDC_TOKEN = "oidc-test";
    const kv = await import(`${OUT}/kv.js`);
    const files = loadFixture(); // path → body
    kv.__setBlobAdapterForTests({
      async get(path) {
        return files.get(path) ?? null;
      },
      async putNew(path, body) {
        if (files.has(path)) throw new Error("Blob already exists");
        files.set(path, body);
        saveFixture(files);
      },
      async put(path, body) {
        files.set(path, body);
        saveFixture(files);
      },
      async del(path) {
        files.delete(path);
        saveFixture(files);
      },
    });
  }

  const auth = await import(`${OUT}/auth.js`);
  const kv = await import(`${OUT}/kv.js`);

  check(`${kind}-W: remote mode active`, kv.kvMode === kind, `got ${kv.kvMode}`);
  check(`${kind}-W: storage reported persistent`, kv.storagePersistent === true);

  const phone = kind === "upstash" ? "919000000001" : "919000000002";
  const sent = await auth.sendOtp(phone);
  check(`${kind}-W: otp issued (dev mode)`, sent.ok === true && typeof sent.devCode === "string");
  const verified = await auth.verifyOtp(phone, sent.devCode);
  check(`${kind}-W: verifyOtp creates user + session`, verified.ok === true && verified.token.length > 20);
  check(`${kind}-W: user has stable UUID`, typeof verified.user.id === "string" && verified.user.id.length > 10);

  // Session resolves in the SAME process first.
  const same = await auth.userFromRequest(new Request("http://x", { headers: { authorization: `Bearer ${verified.token}` } }));
  check(`${kind}-W: session resolves to the same user`, same?.id === verified.user.id);

  // Profile write: every location field must round-trip.
  const updated = await auth.updateUser(verified.user.id, { ...PROFILE, onboarded: true });
  check(`${kind}-W: profile saved`, updated?.display_name === PROFILE.display_name);
  check(`${kind}-W: full location persisted`, JSON.stringify(updated?.location) === JSON.stringify(PROFILE.location));

  fs.writeFileSync(
    META,
    JSON.stringify({ kind, phone, token: verified.token, user_id: verified.user.id, profile: PROFILE }),
  );
}

async function suiteReload(kind) {
  console.log(`\n—— ${kind}: reload (fresh process = serverless cold start) ——`);
  if (kind === "upstash") {
    process.env.UPSTASH_REDIS_REST_URL = "http://stub.local";
    process.env.UPSTASH_REDIS_REST_TOKEN = "stub";
    const store = loadFixture();
    global.fetch = async (_url, opts) => {
      const cmd = JSON.parse(opts.body);
      const [op] = cmd;
      if (op === "GET") return Response.json({ result: store.get(cmd[1]) ?? null });
      if (op === "SET") {
        store.set(cmd[1], cmd[2]);
        saveFixture(store);
        return Response.json({ result: "OK" });
      }
      if (op === "EVAL") {
        const [, , , key, prev, next] = cmd;
        const cur = store.get(key);
        const matches = cur == null ? prev === "__missing__" : cur === prev;
        if (matches) {
          store.set(key, next);
          saveFixture(store);
          return Response.json({ result: 1 });
        }
        return Response.json({ result: 0 });
      }
      return Response.json({ result: null, error: "unknown op" });
    };
  } else {
    process.env.BLOB_STORE_ID = "store_test";
    process.env.VERCEL_OIDC_TOKEN = "oidc-test";
    const kv = await import(`${OUT}/kv.js`);
    const files = loadFixture();
    kv.__setBlobAdapterForTests({
      async get(path) {
        return files.get(path) ?? null;
      },
      async putNew(path, body) {
        if (files.has(path)) throw new Error("Blob already exists");
        files.set(path, body);
        saveFixture(files);
      },
      async put(path, body) {
        files.set(path, body);
        saveFixture(files);
      },
      async del(path) {
        files.delete(path);
        saveFixture(files);
      },
    });
  }

  const auth = await import(`${OUT}/auth.js`);
  const kv = await import(`${OUT}/kv.js`);
  const meta = JSON.parse(fs.readFileSync(META, "utf8"));
  check(`${kind}-R: correct suite pairing`, meta.kind === kind);
  check(`${kind}-R: remote mode active in fresh process`, kv.kvMode === kind);

  // Fresh module state (db cache = null) — everything must come from storage.
  const user = await auth.userFromRequest(new Request("http://x", { headers: { authorization: `Bearer ${meta.token}` } }));
  check(`${kind}-R: session token still valid after reload`, user !== null);
  check(`${kind}-R: same user id returned`, user?.id === meta.user_id);
  check(`${kind}-R: display name persisted`, user?.display_name === meta.profile.display_name);
  check(`${kind}-R: email persisted`, user?.email === meta.profile.email);
  check(`${kind}-R: full location persisted (all fields)`,
    JSON.stringify(user?.location) === JSON.stringify(meta.profile.location));

  const byId = await auth.getUserById(meta.user_id);
  check(`${kind}-R: getUserById agrees`, byId?.id === meta.user_id && byId?.location?.pincode === meta.profile.location.pincode);

  // Second profile edit must also survive another reload (fixture persists it).
  const edited = await auth.updateUser(meta.user_id, { display_name: "Asha Edited" });
  check(`${kind}-R: profile edit saved`, edited?.display_name === "Asha Edited");
}

async function suiteVercelGuard() {
  console.log("\n—— vercel-guard: no remote backend on Vercel must fail loudly ——");
  process.env.VERCEL = "1";
  delete process.env.VERCEL_ENV;

  const kv = await import(`${OUT}/kv.js`);
  check("VG: file mode detected", kv.kvMode === "file", `got ${kv.kvMode}`);
  check("VG: storage NOT persistent", kv.storagePersistent === false);
  check("VG: runtime detected as vercel", kv.storageRuntime === "vercel");
  check("VG: clear configuration error exposed",
    typeof kv.persistenceProblem === "string" &&
      kv.persistenceProblem.includes("Persistent storage is not configured"),
    kv.persistenceProblem ?? "(none)");

  const auth = await import(`${OUT}/auth.js`);
  let otpThrew = "";
  try {
    const sent = await auth.sendOtp("919000000009");
    if (!sent.ok) otpThrew = sent.error;
  } catch (err) {
    otpThrew = String(err);
  }
  check("VG: auth write refuses instead of silently losing data",
    otpThrew.includes("Persistent storage is not configured"), otpThrew || "(no error)");

  const st = await import(`${OUT}/store.js`);
  let incidentThrew = "";
  try {
    await st.addIncident({
      created_at: new Date().toISOString(), location: "x", lat: 1, lng: 1,
      incident_type: "Landslide", severity: "Low", status: "Open", description: "d",
      summary: "s", confidence: 0.5, risk_factors: [], immediate_actions: [], avoid: [],
      recommended_response: [], requires_urgent_attention: false, severity_reasons: [],
      needs_verification: false, verification_note: "", origin: "manual", sources: [],
      evidence: [], pipeline: { totalMs: 1 }, status_history: [], verification: "verified",
      verification_reasons: [], publication: "public", reporter_label: "t", reporter_id: "u",
    });
  } catch (err) {
    incidentThrew = String(err);
  }
  check("VG: incident write refuses too", incidentThrew.includes("Persistent storage is not configured"), incidentThrew || "(no error)");

  const cs = await import(`${OUT}/community-store.js`);
  let communityThrew = "";
  try {
    await cs.addComment("HS-1001", "u", "n", "b");
  } catch (err) {
    communityThrew = String(err);
  }
  check("VG: community write refuses too", communityThrew.includes("Persistent storage is not configured"), communityThrew || "(no error)");
}

if (SUITE === "upstash-writer") await suiteWriter("upstash");
if (SUITE === "upstash-reload") await suiteReload("upstash");
if (SUITE === "blob-writer") await suiteWriter("blob");
if (SUITE === "blob-reload") await suiteReload("blob");
if (SUITE === "vercel-guard") await suiteVercelGuard();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
