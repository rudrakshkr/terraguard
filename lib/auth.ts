/**
 * Authentication layer — phone + OTP.
 *
 * Design:
 *  - Users are identified by a stable UUID created on first successful OTP verify.
 *  - OTP codes are random 6-digit strings, stored HASHED (sha256) with expiry and
 *    attempt limits. Codes are NEVER returned to the client in production mode.
 *  - A dev-mode reveal is only active when `AUTH_DEV_MODE=1` (local development
 *    without an SMS provider). Production deployments must configure a real SMS
 *    provider via `SMS_PROVIDER_API_URL` + `SMS_PROVIDER_API_KEY`; until then the
 *    layer runs in dev mode and CLEARLY SAYS SO in the UI and API responses —
 *    it never pretends an SMS was delivered.
 *  - Sessions are opaque bearer tokens, hashed at rest, with a 30-day expiry.
 *  - No passwords exist anywhere in this system, so none can leak.
 *
 * Public profile handling: the API returns only `display_name` (and derived
 * initials) — phone numbers and emails never leave the server.
 *
 * Storage: lib/kv.ts — Redis mode (Upstash) runs every mutation as an atomic
 * compare-and-set loop so concurrent serverless instances stay consistent;
 * file mode is a JSON document for local dev.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import { kvMode, dataDir, kvLoadDoc, kvMutate } from "./kv";

const DATA_PATH = `${dataDir}/.hillsense-auth.json`.replace("//", "/");
const KV_KEY = "hillsense:auth:v1";

/** Dev mode: no SMS provider configured → codes are returned to the client for demo. */
export const DEV_MODE = process.env.AUTH_DEV_MODE === "1";

const OTP_TTL_MS = 5 * 60_000; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 24 * 3600_000; // 30 days
const RESEND_COOLDOWN_MS = 30_000; // 30s between sends to the same number

export interface OtpChallenge {
  phone: string; // E.164-ish, digits only e.g. "919876543210"
  code_hash: string; // sha256 hex of the 6-digit code
  created_at: string;
  expires_at: string;
  attempts: number;
  last_sent_at: string;
  dev_code?: string; // ONLY present in dev mode
}

export interface UserRecord {
  id: string; // stable UUID
  phone: string; // digits only, never exposed via API
  display_name: string;
  email?: string;
  avatar_url?: string | null; // public URL of the profile photo (blob storage)
  onboarded: boolean;
  created_at: string;
  location?: {
    full_address?: string;
    locality?: string;
    city?: string;
    district?: string;
    state?: string;
    pincode?: string;
    lat?: number;
    lng?: number;
    approximate?: boolean;
  };
}

export interface SessionRecord {
  token_hash: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}

interface AuthDb {
  otps: Record<string, OtpChallenge>;
  users: Record<string, UserRecord>; // by user id
  phone_index: Record<string, string>; // phone → user id
  sessions: Record<string, SessionRecord>; // token_hash → session
}

const EMPTY: AuthDb = { otps: {}, users: {}, phone_index: {}, sessions: {} };
let db: AuthDb | null = null;

async function fallback(): Promise<AuthDb> {
  try {
    return { ...EMPTY, ...(JSON.parse(await fs.readFile(DATA_PATH, "utf8")) as AuthDb) };
  } catch {
    return { ...EMPTY };
  }
}

async function persistFile(d: AuthDb): Promise<void> {
  if (kvMode !== "file") return;
  try {
    await fs.writeFile(DATA_PATH, JSON.stringify(d, null, 2));
  } catch {
    /* best-effort */
  }
}

async function loadDb(): Promise<AuthDb> {
  if (kvMode !== "file") {
    return kvLoadDoc<AuthDb>(KV_KEY, async () => ({ ...EMPTY }));
  }
  if (db) return db;
  db = await fallback();
  return db;
}

/** Atomic mutation shared by both backends (see lib/community-store.ts mutate). */
async function mutate<R>(fn: (d: AuthDb) => { doc: AuthDb; result: R }): Promise<R> {
  if (kvMode !== "file") {
    return kvMutate<AuthDb, R>(KV_KEY, async () => ({ ...EMPTY }), async (cur) => fn(cur));
  }
  const cur = await loadDb();
  const { doc, result } = fn(cur);
  db = doc;
  await persistFile(doc);
  return result;
}

/** Strip non-digits (keeps leading country code if provided as +91…). */
export function normalizePhone(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  // Accept 10-digit Indian numbers, or 11-13 with country code.
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 13) return digits;
  return null;
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function genCode(): string {
  // 6 digits, cryptographically random, no leading-zero bias issue since we pad.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Mask a phone for logs: 91XXXXXX210. */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return "***";
  return `${phone.slice(0, 2)}${"*".repeat(Math.max(0, phone.length - 5))}${phone.slice(-3)}`;
}

/**
 * Send an OTP for `phone`. In dev mode the code is returned so the demo can
 * complete the flow; in production the SMS provider is called and nothing is
 * returned to the client.
 */
export async function sendOtp(
  phone: string,
): Promise<{ ok: true; devCode?: string; devMode: boolean } | { ok: false; error: string; retryAfterSec?: number }> {
  const d = await loadDb();
  const now = Date.now();
  const existing = d.otps[phone];

  if (existing && existing.last_sent_at && now - new Date(existing.last_sent_at).getTime() < RESEND_COOLDOWN_MS) {
    const retryAfterSec = Math.ceil(
      (RESEND_COOLDOWN_MS - (now - new Date(existing.last_sent_at).getTime())) / 1000,
    );
    return { ok: false, error: `Please wait ${retryAfterSec}s before requesting another code.`, retryAfterSec };
  }

  const code = genCode();
  const created = new Date().toISOString();
  const challenge: OtpChallenge = {
    phone,
    code_hash: sha256(code),
    created_at: existing?.created_at ?? created,
    expires_at: new Date(now + OTP_TTL_MS).toISOString(),
    attempts: 0,
    last_sent_at: created,
  };

  // Deliver the SMS. If a provider is configured, call it; otherwise dev mode.
  let deliveredViaProvider = false;
  const providerUrl = process.env.SMS_PROVIDER_API_URL;
  const providerKey = process.env.SMS_PROVIDER_API_KEY;
  if (providerUrl && providerKey) {
    try {
      const res = await fetch(providerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${providerKey}` },
        body: JSON.stringify({
          to: `+${phone}`,
          // Adjust the template/body to your provider's contract.
          message: `HillSense: your verification code is ${code}. It expires in 5 minutes.`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      deliveredViaProvider = res.ok;
      if (!res.ok) {
        console.error(`[auth] SMS provider HTTP ${res.status} for ${maskPhone(phone)}`);
      }
    } catch (err) {
      console.error("[auth] SMS provider call failed:", err);
    }
    if (!deliveredViaProvider) {
      return { ok: false, error: "Could not send the SMS right now. Please try again in a moment." };
    }
  } else {
    if (!DEV_MODE) {
      return { ok: false, error: "SMS authentication is not configured. Set an SMS provider or enable AUTH_DEV_MODE only for local demos." };
    }
    console.log(`[auth] DEV MODE OTP for ${maskPhone(phone)}: ${code}`);
  }

  if (DEV_MODE && !deliveredViaProvider) challenge.dev_code = code;
  await mutate((cur) => ({
    doc: { ...cur, otps: { ...cur.otps, [phone]: challenge } },
    result: { ok: true as const, devMode: DEV_MODE && !deliveredViaProvider, ...(challenge.dev_code ? { devCode: challenge.dev_code } : {}) },
  }));
  return {
    ok: true,
    devMode: DEV_MODE && !deliveredViaProvider,
    ...(challenge.dev_code ? { devCode: challenge.dev_code } : {}),
  };
}

/** Verify a submitted code; on success create/return the user and a session token. */
export async function verifyOtp(
  phone: string,
  code: string,
): Promise<
  | { ok: true; token: string; user: UserRecord; isNew: boolean }
  | { ok: false; error: string }
> {
  const clean = (code || "").replace(/\D/g, "");
  const outcome = await mutate<
    | { ok: true; token: string; user: UserRecord; isNew: boolean }
    | { ok: false; error: string }
  >((cur) => {
    const challenge = cur.otps[phone];
    if (!challenge) return { doc: cur, result: { ok: false as const, error: "No code was requested for this number. Please request a new one." } };

    if (new Date(challenge.expires_at).getTime() < Date.now()) {
      const otps = { ...cur.otps };
      delete otps[phone];
      return { doc: { ...cur, otps }, result: { ok: false as const, error: "That code has expired. Please request a new one." } };
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      const otps = { ...cur.otps };
      delete otps[phone];
      return { doc: { ...cur, otps }, result: { ok: false as const, error: "Too many incorrect attempts. Please request a new code." } };
    }

    const attempts = challenge.attempts + 1;
    if (!clean || sha256(clean) !== challenge.code_hash) {
      const otps = { ...cur.otps, [phone]: { ...challenge, attempts } };
      const left = OTP_MAX_ATTEMPTS - attempts;
      return {
        doc: { ...cur, otps },
        result: {
          ok: false as const,
          error: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many incorrect attempts. Please request a new code.",
        },
      };
    }

    // Success — consume the challenge.
    const otps = { ...cur.otps };
    delete otps[phone];

    const existingId = cur.phone_index[phone];
    const isNew = !existingId;
    const user: UserRecord = existingId
      ? cur.users[existingId]
      : {
          id: crypto.randomUUID(),
          phone,
          display_name: "",
          onboarded: false,
          created_at: new Date().toISOString(),
        };
    const phone_index = { ...cur.phone_index, [phone]: user.id };
    const users = { ...cur.users, [user.id]: user };

    const token = crypto.randomBytes(32).toString("base64url");
    const nowIso = new Date().toISOString();
    const sessions = {
      ...cur.sessions,
      [sha256(token)]: {
        token_hash: sha256(token),
        user_id: user.id,
        created_at: nowIso,
        expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      },
    };
    return { doc: { ...cur, otps, users, phone_index, sessions }, result: { ok: true as const, token, user, isNew } };
  });
  return outcome;
}

/** Resolve the caller's session from a Bearer token. Returns null when invalid/expired. */
export async function userFromRequest(req: Request): Promise<UserRecord | null> {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  if (!token) return null;

  const tokenHash = sha256(token);
  return mutate<UserRecord | null>((cur) => {
    const session = cur.sessions[tokenHash];
    if (!session) return { doc: cur, result: null };
    if (new Date(session.expires_at).getTime() < Date.now()) {
      const sessions = { ...cur.sessions };
      delete sessions[tokenHash];
      return { doc: { ...cur, sessions }, result: null };
    }
    return { doc: cur, result: cur.users[session.user_id] ?? null };
  });
}

/** Persist profile edits (onboarding: name/email/location). Phone is immutable. */
export async function updateUser(
  userId: string,
  patch: Partial<Pick<UserRecord, "display_name" | "email" | "avatar_url" | "onboarded" | "location">>,
): Promise<UserRecord | null> {
  return mutate<UserRecord | null>((cur) => {
    const user = cur.users[userId];
    if (!user) return { doc: cur, result: null };
    const updated: UserRecord = { ...user, ...patch };
    return { doc: { ...cur, users: { ...cur.users, [userId]: updated } }, result: updated };
  });
}

export async function getUserById(userId: string): Promise<UserRecord | null> {
  const d = await loadDb();
  return d.users[userId] ?? null;
}

/** Public shape sent to clients — deliberately excludes phone/email. */
export function publicUser(u: UserRecord) {
  return {
    id: u.id,
    display_name: u.display_name || "HillSense user",
    initials: (u.display_name || "H")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join(""),
    ...(u.avatar_url ? { avatar_url: u.avatar_url } : {}),
    onboarded: u.onboarded,
    has_location: Boolean(u.location),
  };
}

/** Public avatar for comment attribution — empty name means "no profile". */
export function publicAvatar(u: UserRecord | null): { display_name: string; avatar_url?: string | null } | null {
  if (!u) return null;
  return { display_name: u.display_name || "HillSense user", avatar_url: u.avatar_url ?? null };
}

/** Delete a session (logout). */
export async function revokeToken(token: string): Promise<void> {
  const tokenHash = sha256(token);
  await mutate<void>((cur) => {
    const sessions = { ...cur.sessions };
    delete sessions[tokenHash];
    return { doc: { ...cur, sessions }, result: undefined };
  });
}

/** Wipe all users, OTP challenges and sessions (admin reset). */
export async function resetAuth(): Promise<void> {
  await mutate<void>(() => ({ doc: { ...EMPTY }, result: undefined }));
}