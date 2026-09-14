// Concurrency test for the KV CAS layer against a stubbed Upstash REST API.
process.env.UPSTASH_REDIS_REST_URL = "http://stub.local";
process.env.UPSTASH_REDIS_REST_TOKEN = "stub";

// ---- stub Redis with network latency ----
const store = new Map();
let forcedCasFails = 3; // inject a few lost races to exercise the retry loop
global.fetch = async (url, opts) => {
  await new Promise((r) => setTimeout(r, 2 + Math.random() * 8)); // simulated network
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
    await new Promise((r) => setTimeout(r, 1 + Math.random() * 5)); // widen race window
    const cur = store.get(key);
    // Faithful port of the CAS Lua script:
    const matches = cur == null ? prev === "__missing__" : cur === prev;
    if (matches && forcedCasFails > 0) { forcedCasFails--; return Response.json({ result: 0 }); } // inject lost races
    if (matches) { store.set(key, next); return Response.json({ result: 1 }); }
    return Response.json({ result: 0 });
  }
  return Response.json({ result: null, error: "unknown op" });
};

const { kvEnabled } = await import("/tmp/kvtest/kv.js");
const cs = await import("/tmp/kvtest/community-store.js");
const st = await import("/tmp/kvtest/store.js");
console.log("redis mode active:", kvEnabled);

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ FAIL ${name} ${detail}`); }
};

// ---- A: 12 concurrent confirmations from the SAME user (one-per-user) ----
await st.addIncident({ created_at: new Date().toISOString(), location: "Test Ghat", lat: 32.2, lng: 77.2,
  incident_type: "Landslide", severity: "High", status: "Open", description: "d", summary: "s",
  confidence: 0.5, risk_factors: [], immediate_actions: [], avoid: [], recommended_response: [],
  requires_urgent_attention: false, severity_reasons: [], needs_verification: false,
  verification_note: "", origin: "manual", sources: [], evidence: [], pipeline: { totalMs: 1 },
  status_history: [], verification: "verified", verification_reasons: [], publication: "public",
  reporter_label: "T", reporter_id: "u0", last_confirmed_at: new Date().toISOString(),
  confirmations_yes: 0, confirmations_no: 0 });
const incidents = await st.listIncidents();
const target = incidents.find((i) => i.location === "Test Ghat");

const resultsA = await Promise.all(Array.from({ length: 12 }, () =>
  cs.recordConfirmation(target.id, "user-A", "yes")));
const freshA = resultsA.filter((r) => !r.already);
const dbA = await cs.listConfirmations(target.id);
check("A: exactly 1 of 12 duplicate confirmations accepted", freshA.length === 1, `got ${freshA.length}`);
check("A: only 1 record persisted", dbA.length === 1, `got ${dbA.length}`);

// ---- B: 20 concurrent distinct users confirm + comment (no lost updates) ----
const [, bComments] = await Promise.all([
  Promise.all(Array.from({ length: 20 }, (_, i) => cs.recordConfirmation(target.id, `user-${i}`, i % 2 ? "no" : "yes"))),
  Promise.all(Array.from({ length: 20 }, (_, i) => cs.addComment(target.id, `user-${i}`, `Name${i}`, `observation ${i}`))),
]);
const dbB = await cs.listConfirmations(target.id);
check("B: all 20 distinct-user confirmations persisted (21 incl. user-A)", dbB.length === 21, `got ${dbB.length}`);
check("B: all 20 comments persisted", bComments.every((r) => r.ok) && (await cs.listComments(target.id)).length === 20);

// ---- C: 10 concurrent report submissions get unique sequential ids ----
const created = await Promise.all(Array.from({ length: 10 }, () => st.addIncident({
  created_at: new Date().toISOString(), location: "Conc Test", lat: 32.3, lng: 77.3,
  incident_type: "Flood", severity: "Low", status: "Open", description: "d", summary: "s",
  confidence: 0.5, risk_factors: [], immediate_actions: [], avoid: [], recommended_response: [],
  requires_urgent_attention: false, severity_reasons: [], needs_verification: false,
  verification_note: "", origin: "manual", sources: [], evidence: [], pipeline: { totalMs: 1 },
  status_history: [], verification: "verified", verification_reasons: [], publication: "public",
  reporter_label: "T", reporter_id: "u0", last_confirmed_at: new Date().toISOString(),
  confirmations_yes: 0, confirmations_no: 0 })));
const ids = created.map((i) => i.id);
check("C: 10 concurrent creates → 10 unique ids", new Set(ids).size === 10, ids.join(","));
const nums = ids.map((i) => parseInt(i.replace("HS-", ""), 10)).sort((a, b) => a - b);
const gapless = nums.every((n, k) => k === 0 || n === nums[k - 1] + 1);
check("C: ids gapless consecutive integers", gapless, ids.slice().sort().join(","));

// ---- D: aggregate counts recomputed from per-user records ----
const counts = await cs.confirmationCounts(target.id);
const yes = dbB.filter((c) => c.response === "yes").length;
const no = dbB.filter((c) => c.response === "no").length;
check("D: counts match records", counts.yes === yes && counts.no === no, `${JSON.stringify(counts)} vs yes=${yes} no=${no}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
