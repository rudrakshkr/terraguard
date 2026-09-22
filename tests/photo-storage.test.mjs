/**
 * Photo-storage tests (lib/avatar-store.ts).
 *
 * Regression under test: the JSON document store in lib/kv.ts writes to Vercel
 * Blob with access "private", but photo uploads asked for access "public". On a
 * private store every photo upload therefore threw and the reporter saw
 * "Could not store the report photo. Will retry." — blocking the whole report.
 *
 * Now the store probes public access once, falls back to private, and serves
 * those private bytes through /api/uploads/[id]. These tests exercise both
 * store types (and total failure) against an in-memory blob, so no network or
 * credentials are involved.
 *
 * Run: npm run test:photos
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const OUT = "/tmp/hs-photo-compile";

console.log("Compiling lib/ for tests…");
fs.rmSync(OUT, { recursive: true, force: true });
execSync(
  `npx tsc lib/kv.ts lib/avatar-store.ts --outDir ${OUT} --module commonjs --target es2022 ` +
    "--moduleResolution node --esModuleInterop --skipLibCheck",
  { stdio: "inherit" },
);

// Blob mode is decided from the environment at module load.
process.env.UPSTASH_REDIS_REST_URL = "";
process.env.UPSTASH_REDIS_REST_TOKEN = "";
process.env.BLOB_READ_WRITE_TOKEN = "";
process.env.BLOB_STORE_ID = "store_test_id";
process.env.VERCEL_OIDC_TOKEN = "test-oidc-token";
delete process.env.HS_STORE;

const require = createRequire(import.meta.url);
const kv = require(path.join(OUT, "kv.js"));
const av = require(path.join(OUT, "avatar-store.js"));

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

/* ------------------------- in-memory KV document store ---------------------- */
const docs = new Map();
kv.__setBlobAdapterForTests({
  async get(p) {
    return docs.get(p) ?? null;
  },
  async putNew(p, body) {
    if (docs.has(p)) throw new Error("Blob already exists");
    docs.set(p, body);
  },
  async put(p, body) {
    docs.set(p, body);
  },
  async del(p) {
    docs.delete(p);
  },
});

/** In-memory stand-in for @vercel/blob, per store access mode. */
function makeBlobStore({ allowPublic }) {
  const objects = new Map();
  const calls = [];
  return {
    objects,
    calls,
    client: {
      async put(p, body, opts) {
        calls.push(opts.access);
        if (opts.access === "public" && !allowPublic) {
          throw new Error("Cannot use public access on a private store.");
        }
        objects.set(p, Buffer.from(body));
        const kind = opts.access === "public" ? "public" : "private";
        return { url: `https://store.${kind}.blob.vercel-storage.com/${p}` };
      },
      async get(p) {
        const buf = objects.get(p);
        if (!buf) return null;
        return { statusCode: 200, stream: new Response(new Uint8Array(buf)).body };
      },
      async del(p) {
        objects.delete(p);
      },
    },
  };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 11, 12, 13, 14, 15, 16, 17]);
const jpegUrl = `data:image/jpeg;base64,${JPEG.toString("base64")}`;

console.log("\nmode:", kv.kvMode);
check("blob mode is active", kv.kvMode === "blob", kv.kvMode);

/* ------------------------ A. photo upload on a PRIVATE store --------------- */
console.log("\nA. private Blob store (the deployed configuration)");
let priv = makeBlobStore({ allowPublic: false });
av.__setBlobClientForTests(priv.client);
{
  const r = await av.putAvatar("user-1", jpegUrl, "image/jpeg");
  check("avatar upload succeeds instead of throwing", "url" in r, JSON.stringify(r));
  check("served through our own route", typeof r.url === "string" && r.url.startsWith("/api/uploads/av_"), r.url);
  check("public access is tried first", priv.calls[0] === "public", JSON.stringify(priv.calls));
  check("falls back to private access", priv.calls[1] === "private", JSON.stringify(priv.calls));

  const id = r.url.split("/").pop();
  const img = await av.getStoredImage(id);
  check("id resolves to a blob object", Boolean(img) && img.kind === "blob" && img.access === "private", JSON.stringify(img));

  const bytes = await av.readBlobObject(img.path, img.access);
  check("stored bytes round-trip exactly", Boolean(bytes) && bytes.equals(JPEG), bytes ? `${bytes.length} bytes` : "null");

  const before = priv.calls.length;
  const r2 = await av.putAvatar("user-1", `data:image/png;base64,${PNG.toString("base64")}`, "image/png");
  check("a second upload succeeds too", "url" in r2, JSON.stringify(r2));
  check("later uploads skip the failing public probe", priv.calls.slice(before)[0] === "private", JSON.stringify(priv.calls.slice(before)));
}

/* ------------------------- B. photo upload on a PUBLIC store --------------- */
console.log("\nB. public Blob store");
{
  const pub = makeBlobStore({ allowPublic: true });
  av.__setBlobClientForTests(pub.client);
  const r = await av.putAvatar("user-2", jpegUrl, "image/jpeg");
  check("upload succeeds", "url" in r, JSON.stringify(r));
  check("CDN url is kept for public objects", typeof r.url === "string" && r.url.startsWith("https://"), r.url);
  check("only one attempt needed", pub.calls.length === 1, JSON.stringify(pub.calls));
}

/* ---------------------- C. report photo + delete (private) ---------------- */
console.log("\nC. report photos on a private store");
{
  priv = makeBlobStore({ allowPublic: false });
  av.__setBlobClientForTests(priv.client);
  const rp = await av.putReportPhoto("user-3", jpegUrl, "image/jpeg");
  check("report photo stored", "url" in rp && rp.url.startsWith("/api/uploads/rp_"), JSON.stringify(rp));

  const id = rp.url.split("/").pop();
  const img = await av.getStoredImage(id);
  check("record exists for the serving route", Boolean(img) && img.kind === "blob", JSON.stringify(img));
  check("object is present in the store", priv.objects.has(img.path), img.path);

  await av.deleteAvatarByUrl(rp.url);
  check("delete removes the blob object", !priv.objects.has(img.path));
  check("delete removes the record", (await av.getStoredImage(id)) === null);
}

/* --------------------------- D. total store failure ------------------------ */
console.log("\nD. store unavailable");
{
  const broken = makeBlobStore({ allowPublic: false });
  broken.client.put = async () => {
    throw new Error("Blob store suspended");
  };
  broken.client.get = async () => null;
  av.__setBlobClientForTests(broken.client);

  const r = await av.putReportPhoto("user-4", jpegUrl, "image/jpeg");
  check("returns an error object instead of throwing", "error" in r, JSON.stringify(r));
  check("error is user-readable", typeof r.error === "string" && r.error.length > 10, r.error);
  check("error no longer promises a retry that cannot happen", !/will retry/i.test(r.error ?? ""), r.error);

  const a = await av.putAvatar("user-4", jpegUrl, "image/jpeg");
  check("avatars fail the same honest way", "error" in a, JSON.stringify(a));
}

/* ------------------- E. diagnostic surface (/api/storage-status) ----------- */
console.log("\nE. diagnostic reporting");
{
  const priv2 = makeBlobStore({ allowPublic: false });
  av.__setBlobClientForTests(priv2.client);
  check("mode is reported before any upload", av.photoStorageInfo().mode === "blob", JSON.stringify(av.photoStorageInfo()));
  check("access unknown until an upload happens", av.photoStorageInfo().access === undefined, JSON.stringify(av.photoStorageInfo()));

  const probe = await av.probePhotoStorage();
  check("probe reports success", probe.ok === true, JSON.stringify(probe));
  check("probe resolves the access mode", probe.access === "private", JSON.stringify(probe));
  check("probe is reported afterwards", av.photoStorageInfo().access === "private", JSON.stringify(av.photoStorageInfo()));

  const failing = makeBlobStore({ allowPublic: false });
  failing.client.put = async () => {
    throw new Error("Blob store suspended");
  };
  av.__setBlobClientForTests(failing.client);
  const badProbe = await av.probePhotoStorage();
  check("probe reports failure honestly", badProbe.ok === false && typeof badProbe.error === "string", JSON.stringify(badProbe));
}

/* ------------------------------- F. validation ----------------------------- */
console.log("\nF. validation and id safety");
{
  av.__setBlobClientForTests(makeBlobStore({ allowPublic: false }).client);
  check("unsupported type rejected", "error" in (await av.putAvatar("u", jpegUrl, "image/gif")));
  check(
    "oversized photo rejected",
    "error" in (await av.putReportPhoto("u", `data:image/jpeg;base64,${"A".repeat(9_000_000)}`, "image/jpeg")),
  );
  check("non-base64 payload rejected", "error" in (await av.putReportPhoto("u", "data:image/jpeg;base64,!!!!", "image/jpeg")));
  check("path traversal id rejected", (await av.getStoredImage("../../etc/passwd")) === null);
  check("unknown id returns null", (await av.getStoredImage("av_deadbeefdeadbeef")) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
