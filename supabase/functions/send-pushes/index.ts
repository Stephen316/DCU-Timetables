// Sends what queue_pushes() (phase37_web_push.sql) put in the outbox, as Web Push.
//
// Woken by that job through pg_net, with PUSH_FUNCTION_KEY as its bearer token; deployed
// with JWT verification off, since that key isn't a JWT. Takes rows with claim_pushes(), as
// the service role, so two runs never send one twice. A subscription the push service says
// is gone (404, 410) is deleted, along with what was waiting for it. So is one made with an
// older key (see `staleKey`), once the same run has shown the current key is accepted. Any
// other failure is tried again on a later run, three times in all.
//
// Secrets (docs/PUSH.md): PUSH_FUNCTION_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { Buffer } from 'node:buffer';
import { createECDH } from 'node:crypto';

const BATCH = 200;
/** Stops taking new batches with room to spare before the platform's wall-clock limit. */
const BUDGET_MS = 100_000;
/** A class or deadline notification is worth little after a few hours. */
const TTL_SECONDS = 6 * 60 * 60;

// Trimmed, like the function key below: pasted secrets can carry a stray space or line break.
webpush.setVapidDetails(
  // Who the push services can contact about these messages: the public site, by default.
  Deno.env.get('VAPID_SUBJECT')?.trim() || 'https://dculive.ie/',
  Deno.env.get('VAPID_PUBLIC_KEY')!.trim(),
  Deno.env.get('VAPID_PRIVATE_KEY')!.trim(),
);

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

/** What claim_pushes() returns. */
interface Row {
  id: number;
  payload: Payload;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

type Payload =
  | { type: 'verdict'; eventKey: string; state: 'cancelled' | 'moved' | 'running'; room?: string | null; start?: string | null; note?: string | null; by?: string | null; names: Record<string, string> }
  | { type: 'crowd'; eventKey: string; count: number; names: Record<string, string> }
  | { type: 'deadline'; id: string; moduleKey: string; title: string; dueAt: string; kind: string; names: Record<string, string> }
  | { type: 'reminder'; when: 'day' | 'soon'; id: string; moduleKey: string; title: string; dueAt: string; kind: string; names: Record<string, string> }
  | { type: 'alert'; eventKey: string; start: string; moved: boolean | null; room?: string | null; title?: string | null; place?: string | null; names: Record<string, string> };

/** What the service worker shows (mobile/public/sw.js): `path` is under the app's folder. */
interface Notice {
  title: string;
  body: string;
  tag: string;
  path: string;
}

Deno.serve(async (req) => {
  // Trimmed: a key pasted from Terminal can carry its line break into the secret.
  const key = Deno.env.get('PUSH_FUNCTION_KEY')?.trim();
  if (!key || req.headers.get('Authorization') !== `Bearer ${key}`) return new Response('not allowed', { status: 401 });
  if (new URL(req.url).searchParams.has('check')) return Response.json(checkKeys());

  const started = Date.now();
  let sent = 0;
  let failed = 0;
  const stale = new Set<string>();
  while (Date.now() - started < BUDGET_MS) {
    const { data, error } = await db.rpc('claim_pushes', { p_limit: BATCH });
    if (error) return new Response(error.message, { status: 500 });
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;

    const results = await Promise.all(rows.map((row) => send(row, stale)));
    sent += results.filter(Boolean).length;
    failed += results.filter((ok) => !ok).length;
  }

  // A key mismatch reads the same whether the subscription is old or this function's own key
  // is wrong. A push accepted in this run settles which: the key is good, so the refused
  // subscriptions were made with another one, and no browser can send to them again. With no
  // push accepted, a wrong secret would otherwise delete every subscription, so they're kept.
  let dropped = 0;
  if (sent > 0 && stale.size > 0) {
    const { error } = await db.from('push_subscriptions').delete().in('id', [...stale]);
    if (!error) dropped = stale.size;
  }
  console.log('send-pushes', { sent, failed, dropped });
  return Response.json({ sent, failed, dropped });
});

/**
 * Whether the push service refused the subscription for being made with another VAPID key.
 * Apple's answer, the one seen here; other services word it differently and fall through to
 * the ordinary retry until one is seen.
 */
function staleKey(status: number | undefined, body: string | undefined): boolean {
  return status === 400 && (body ?? '').includes('VapidPkHashMismatch');
}

/**
 * Whether `endpoint` is a browser vendor's push service (phase 42 checks the same list when
 * a subscription is saved). Anything else is not a browser's endpoint, and this function
 * must not send requests to it: the host is the student's to choose, not ours to trust.
 */
function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return (
    host === 'fcm.googleapis.com' ||
    host === 'updates.push.services.mozilla.com' ||
    host === 'web.push.apple.com' ||
    host.endsWith('.notify.windows.com')
  );
}

async function send(row: Row, stale: Set<string>): Promise<boolean> {
  if (!isPushServiceEndpoint(row.endpoint)) {
    // Not from any browser. Removed rather than retried, with what was waiting for it.
    console.warn('send-pushes: refused an endpoint outside the push services', { subscription: row.subscription_id });
    await db.from('push_subscriptions').delete().eq('id', row.subscription_id);
    return false;
  }
  try {
    await webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      JSON.stringify(notice(row.payload)),
      { TTL: ttl(row.payload), urgency: 'high' },
    );
    await db.from('push_outbox').update({ sent_at: new Date().toISOString(), error: null }).eq('id', row.id);
    return true;
  } catch (e) {
    const { statusCode: status, body } = e as { statusCode?: number; body?: string };
    if (status === 404 || status === 410) {
      await db.from('push_subscriptions').delete().eq('id', row.subscription_id);
    } else {
      if (staleKey(status, body)) stale.add(row.subscription_id);
      // Left claimed: a later run takes it again once the claim runs out. The push service's
      // own status and reason, not web-push's "unexpected response code", which says neither.
      const message = e instanceof Error ? e.message : String(e);
      const detail = status ? `${status} ${body ?? ''} (${message})` : message;
      await db.from('push_outbox').update({ error: detail.trim().slice(0, 500) }).eq('id', row.id);
    }
    return false;
  }
}

/**
 * `?check`: which VAPID public key this function signs as, by its first and last 8
 * characters, and whether the private key is that key's other half. Apple's
 * VapidPkHashMismatch means the public key differs from the one the phone subscribed with
 * (the website's EXPO_PUBLIC_VAPID_PUBLIC_KEY). Shows nothing secret: the private key only
 * goes in, as the public key it works out to.
 */
function checkKeys() {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')?.trim() ?? '';
  const ends = (k: string) => ({ starts: k.slice(0, 8), ends: k.slice(-8), length: k.length });
  let fromPrivate = '';
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(Deno.env.get('VAPID_PRIVATE_KEY')?.trim() ?? '', 'base64url'));
    fromPrivate = ecdh.getPublicKey('base64url');
  } catch {
    fromPrivate = '';
  }
  return { publicKey: ends(publicKey), privateKeyGives: ends(fromPrivate), pairMatches: fromPrivate !== '' && fromPrivate === publicKey };
}

/** How long the push service may hold it: a class alert is worth nothing once the class has started. */
function ttl(p: Payload): number {
  if (p.type !== 'alert') return TTL_SECONDS;
  return Math.max(60, Math.floor((new Date(p.start).getTime() - Date.now()) / 1000));
}

// MARK: - Wording

const KINDS: Record<string, string> = { L: 'lecture', T: 'tutorial', P: 'lab', S: 'seminar', W: 'workshop' };

/**
 * "Materials Engineering lab", from the event key and what the student's app calls the
 * module. Reads the activity code as the app's parseActivityCode does: the module is what
 * comes before "[" in the first segment, the kind is the second segment's first letter.
 */
function className(eventKey: string, names: Record<string, string>): string {
  const code = (eventKey.split('|')[0] ?? '').trim().split(' ')[0].replace(/^,+|,+$/g, '');
  const segments = code.split('/').filter((s) => s.length > 0);
  const first = segments[0] ?? '';
  const module = first.includes('[') ? first.slice(0, first.indexOf('[')) : first;
  const kind = KINDS[(segments[1] ?? '').charAt(0).toUpperCase()] ?? 'class';
  const name = module ? names[module] ?? module : null;
  return name ? `${name} ${kind}` : `your ${kind}`;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Tue 14:00", as Dublin keeps time. */
function when(iso: string): string {
  return new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

/** "17:00". */
function clock(iso: string): string {
  return new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

/** The day in Dublin, to tell today from tomorrow. */
function dublinDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** "Fri 7 Nov, 17:00". */
function due(iso: string): string {
  return new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

function notice(p: Payload): Notice {
  if (p.type === 'alert') {
    // "Fund. of Prof. Dev." over "In 15 mins · SA301": the week grid's short name and the
    // room's code, as the phone sent them. A class moved by an organiser says where it went.
    const minutes = Math.round((new Date(p.start).getTime() - Date.now()) / 60_000);
    const when = minutes <= 1 ? 'Starting now' : `In ${minutes} mins`;
    const title = p.title || capitalised(className(p.eventKey, p.names));
    const room = (p.moved && p.room) || p.place || '';
    const moved = p.moved ? `moved to ${clock(p.start)}` : '';
    return { title, body: [when, moved, room].filter((part) => part !== '').join(' · '), tag: `class:${p.eventKey}`, path: '' };
  }
  if (p.type === 'reminder') {
    const module = p.names[p.moduleKey] ?? p.moduleKey;
    const day = dublinDay(new Date(p.dueAt)) === dublinDay(new Date()) ? 'today' : 'tomorrow';
    const title = p.when === 'soon' ? `${p.title} is due at ${clock(p.dueAt)}` : `${p.title} is due ${day} at ${clock(p.dueAt)}`;
    return { title, body: module, tag: `deadline:${p.id}`, path: 'deadlines' };
  }
  if (p.type === 'deadline') {
    const module = p.names[p.moduleKey] ?? p.moduleKey;
    return { title: `New deadline: ${p.title}`, body: `${module} · due ${due(p.dueAt)}`, tag: `deadline:${p.id}`, path: 'deadlines' };
  }
  const what = capitalised(className(p.eventKey, p.names));
  const start = p.eventKey.split('|')[1] ?? '';
  const at = start ? when(start) : '';
  const tag = `class:${p.eventKey}`;
  if (p.type === 'crowd') {
    return { title: `${what} reported cancelled`, body: `${p.count} classmates say ${at} is off.`, tag, path: '' };
  }
  const by = p.by ? ` — ${p.by}` : '';
  const note = p.note ? ` ${p.note}` : '';
  switch (p.state) {
    case 'cancelled':
      return { title: `${what} cancelled`, body: `${at} is off${by}.${note}`, tag, path: '' };
    case 'moved': {
      const parts = [p.start ? when(p.start) : null, p.room ? `in ${p.room}` : null].filter(Boolean).join(' ');
      return { title: `${what} moved`, body: `${parts ? `Now ${parts}` : `${at} has moved`}${by}.${note}`, tag, path: '' };
    }
    case 'running':
      return { title: `${what} is on after all`, body: `${at} is going ahead${by}.${note}`, tag, path: '' };
  }
}
