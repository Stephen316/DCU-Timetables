// Creates an account only once the DCU mailbox has been proved (phase50_verify_before_account.sql).
//
//   POST { action: 'request', email, password }  store a pending sign-up, email the link
//   POST { action: 'resend',  email }            a fresh link for a sign-up still pending
//   POST { action: 'confirm', token }            the link's button: create the account, confirmed
//
// Nothing reaches auth.users before `confirm`. `request` and `resend` answer the same way for
// every address (a registered one gets an "you already have an account" email instead of a
// link), so the response never says which addresses exist.
//
// Deployed with JWT verification OFF — the caller is a signed-out student. Secrets
// (docs/SIGN_IN.md): RESEND_API_KEY, MAIL_FROM, SIGNUP_ENC_KEY (32 random bytes, base64).
// Optional: VERIFY_URL. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const VERIFY_URL = Deno.env.get('VERIFY_URL')?.trim() || 'https://app.dculive.ie/signup';
const MAIL_FROM = Deno.env.get('MAIL_FROM')?.trim() || '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY')?.trim() || '';
const ENC_KEY = Deno.env.get('SIGNUP_ENC_KEY')?.trim() || '';

const LINK_LIFETIME_MS = 60 * 60 * 1000;
/** A second request for the same address inside this window sends nothing. */
const RESEND_AFTER_MS = 60 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// MARK: - Rules (the same ones the app and the database hooks apply)

/** Domain compared whole, never by suffix: `dcu.ie.attacker.com` and `notdcu.ie` must fail. */
function isDCUAddress(address: string): boolean {
  const domain = /^[^@\s]+@([^@\s]+)$/.exec(address)?.[1];
  return domain === 'dcu.ie' || domain === 'mail.dcu.ie';
}

async function isAllowed(address: string): Promise<boolean> {
  if (isDCUAddress(address)) return true;
  // A handful of rows, compared here: `ilike` would treat `_` in an address as a wildcard.
  const { data } = await db.from('auth_domain_exceptions').select('email');
  return (data ?? []).some((row: { email: string }) => row.email.toLowerCase() === address);
}

/** 8+ characters with a capital, a lower-case letter and a number, as PasswordValidation. */
function passwordOk(password: string): boolean {
  return password.length >= 8 && password.length <= 72 && /\p{Lu}/u.test(password) && /\p{Ll}/u.test(password) && /\p{N}/u.test(password);
}

// MARK: - Crypto

const encoder = new TextEncoder();

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

async function sha256(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}

async function aesKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromB64(ENC_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** The password has to be replayed into createUser, so it is encrypted, not hashed. */
async function seal(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(), encoder.encode(plain)));
  return `${toB64(iv)}.${toB64(cipher)}`;
}

async function open(sealed: string): Promise<string> {
  const [iv, cipher] = sealed.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await aesKey(), fromB64(cipher));
  return new TextDecoder().decode(plain);
}

function newToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

// MARK: - Mail

async function sendMail(to: string, subject: string, html: string, text: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to, subject, html, text }),
  });
  if (!res.ok) throw new Error(`mail provider answered ${res.status}`);
}

function linkMail(link: string) {
  return {
    subject: 'Confirm your DCU Live account',
    text: `Open this link and press "Confirm my account":\n\n${link}\n\nIt works for one hour. If you didn't ask for this, ignore this email — no account was made.`,
    html: `<p>Open the link and press <b>Confirm my account</b>.</p><p><a href="${link}">Confirm your DCU Live account</a></p><p style="color:#666">It works for one hour. If you didn't ask for this, ignore this email — no account was made.</p>`,
  };
}

const ALREADY_MAIL = {
  subject: 'You already have a DCU Live account',
  text: 'Someone (hopefully you) tried to create a DCU Live account with this address, but it already has one. Open the app and sign in — or tap "Forgot password?" to reset it. If this wasn\'t you, ignore this email.',
  html: '<p>Someone (hopefully you) tried to create a DCU Live account with this address, but it already has one.</p><p>Open the app and sign in — or tap <b>Forgot password?</b> to reset it.</p><p style="color:#666">If this wasn\'t you, ignore this email.</p>',
};

// MARK: - Actions

/** Stores (or refreshes) the pending row and returns the link to email, or null if throttled. */
async function issueLink(address: string, secret: string | null): Promise<string | null> {
  const { data: existing } = await db.from('pending_signups').select('secret, sent_at').eq('email', address).maybeSingle();
  if (existing && Date.now() - new Date(existing.sent_at).getTime() < RESEND_AFTER_MS) return null;
  const sealed = secret ?? existing?.secret;
  if (!sealed) return null; // a resend with nothing pending: say nothing
  const token = newToken();
  const { error } = await db.from('pending_signups').upsert({
    email: address,
    secret: sealed,
    token_hash: await sha256(token),
    sent_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + LINK_LIFETIME_MS).toISOString(),
  });
  if (error) throw error;
  // In the fragment, so the token is never sent to the page's host or written to its logs.
  return `${VERIFY_URL}#t=${token}`;
}

async function request(address: string, password: string | undefined): Promise<Response> {
  if (!(await isAllowed(address))) return reply({ error: 'Sign up with your DCU address (@dcu.ie or @mail.dcu.ie).' }, 403);
  if (password !== undefined && !passwordOk(password)) {
    return reply({ error: 'Use at least 8 characters, with a capital, a lower-case letter and a number.' }, 400);
  }
  const { data: exists } = await db.rpc('auth_email_exists', { address });
  if (exists) {
    await sendMail(address, ALREADY_MAIL.subject, ALREADY_MAIL.html, ALREADY_MAIL.text);
  } else {
    const link = await issueLink(address, password === undefined ? null : await seal(password));
    if (link) {
      const mail = linkMail(link);
      await sendMail(address, mail.subject, mail.html, mail.text);
    }
  }
  return reply({ status: 'sent' });
}

async function confirm(token: string): Promise<Response> {
  const { data: row } = await db.from('pending_signups').select('email, secret, expires_at').eq('token_hash', await sha256(token)).maybeSingle();
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return reply({ error: "That link has expired or was already used. Go back to the app and create the account again." }, 410);
  }
  // Checked again: the exception list or the rules may have changed in the hour since.
  if (!(await isAllowed(row.email))) return reply({ error: 'Sign up with your DCU address.' }, 403);

  const { error } = await db.auth.admin.createUser({ email: row.email, password: await open(row.secret), email_confirm: true });
  // "Already registered" means someone else got there first; the pending row is spent either way.
  if (error && !/already|registered|exists/i.test(error.message)) {
    console.error('createUser failed', error.message);
    return reply({ error: "Couldn't create the account. Try the link again in a moment." }, 500);
  }
  await db.from('pending_signups').delete().eq('email', row.email);
  return reply({ status: 'created' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return reply({ error: 'POST only.' }, 405);
  if (!RESEND_KEY || !MAIL_FROM || !ENC_KEY) return reply({ error: 'Sign-up is not set up yet.' }, 503);

  let body: { action?: string; email?: string; password?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return reply({ error: 'Bad request.' }, 400);
  }

  try {
    const address = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    switch (body.action) {
      case 'request':
        if (!address || typeof body.password !== 'string') return reply({ error: 'Email and password are needed.' }, 400);
        return await request(address, body.password);
      case 'resend':
        if (!address) return reply({ error: 'Email is needed.' }, 400);
        return await request(address, undefined);
      case 'confirm':
        if (typeof body.token !== 'string' || !/^[0-9a-f]{64}$/.test(body.token)) return reply({ error: 'That link is not valid.' }, 400);
        return await confirm(body.token);
      default:
        return reply({ error: 'Unknown action.' }, 400);
    }
  } catch (error) {
    console.error('signup failed', error instanceof Error ? error.message : error);
    return reply({ error: 'Something went wrong. Try again in a moment.' }, 500);
  }
});
