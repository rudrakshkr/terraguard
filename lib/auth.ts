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
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const DATA_PATH = path.join(process.cwd(), ".hillsense-auth.json");

/** Dev mode: no SMS provider configured → codes are returned to the client for demo. */
export const DEV_MODE =
  process.env.AUTH_DEV_MODE === "1" ||
  (!process.env.SMS_PROVIDER_API_URL && !process.env.SMS_PROVIDER_API_KEY);

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

async function load(): Promise<AuthDb> {
  if (db) return db;
  try {
    db = { ...EMPTY, ...(JSON.parse(await fs.readFile(DATA_PATH, "utf8")) as AuthDb) };
  } catch {
    db = { ...EMPTY };
  }
  return db;
}

async function persist(): Promise<void> {
  if (!db) return;
  try {
    await fs.writeFile(DATA_PATH, JSON.stringify(db, null, 2));
  } catch {
    /* best-effort */
  }
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
  const d = await load();
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
    console.log(`[auth] DEV MODE OTP for ${maskPhone(phone)}: ${code}`);
  }

  if (DEV_MODE && !deliveredViaProvider) challenge.dev_code = code;
  d.otps[phone] = challenge;
  await persist();
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
  const d = await load();
  const challenge = d.otps[phone];
  if (!challenge) return { ok: false, error: "No code was requested for this number. Please request a new one." };

  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    delete d.otps[phone];
    await persist();
    return { ok: false, error: "That code has expired. Please request a new one." };
  }
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    delete d.otps[phone];
    await persist();
    return { ok: false, error: "Too many incorrect attempts. Please request a new code." };
  }

  challenge.attempts += 1;
  const clean = (code || "").replace(/\D/g, "");
  if (!clean || sha256(clean) !== challenge.code_hash) {
    await persist();
    const left = OTP_MAX_ATTEMPTS - challenge.attempts;
    return { ok: false, error: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many incorrect attempts. Please request a new code." };
  }

  // Success — consume the challenge.
  delete d.otps[phone];

  const existingId = d.phone_index[phone];
  const isNew = !existingId;
  const user: UserRecord = existingId
    ? d.users[existingId]
    : {
        id: crypto.randomUUID(),
        phone,
        display_name: "",
        onboarded: false,
        created_at: new Date().toISOString(),
      };
  d.phone_index[phone] = user.id;
  d.users[user.id] = user;

  const token = crypto.randomBytes(32).toString("base64url");
  const nowIso = new Date().toISOString();
  d.sessions[sha256(token)] = {
    token_hash: sha256(token),
    user_id: user.id,
    created_at: nowIso,
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  await persist();
  return { ok: true, token, user, isNew };
}

/** Resolve the caller's session from a Bearer token. Returns null when invalid/expired. */
export async function userFromRequest(req: Request): Promise<UserRecord | null> {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  if (!token) return null;

  const d = await load();
  const session = d.sessions[sha256(token)];
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    delete d.sessions[session.token_hash];
    await persist();
    return null;
  }
  return d.users[session.user_id] ?? null;
}

/** Persist profile edits (onboarding: name/email/location). Phone is immutable. */
export async function updateUser(
  userId: string,
  patch: Partial<Pick<UserRecord, "display_name" | "email" | "onboarded" | "location">>,
): Promise<UserRecord | null> {
  const d = await load();
  const user = d.users[userId];
  if (!user) return null;
  const updated: UserRecord = { ...user, ...patch };
  d.users[userId] = updated;
  await persist();
  return updated;
}

export async function getUserById(userId: string): Promise<UserRecord | null> {
  const d = await load();
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
    onboarded: u.onboarded,
    has_location: Boolean(u.location),
  };
}

/** Delete a session (logout). */
export async function revokeToken(token: string): Promise<void> {
  const d = await load();
  delete d.sessions[sha256(token)];
  await persist();
}
