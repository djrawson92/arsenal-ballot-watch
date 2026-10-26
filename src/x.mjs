// Posting to X with the account's own keys (OAuth 1.0a user context, signed with HMAC-SHA1).
import { createHmac, randomBytes } from 'node:crypto';

const API = 'https://api.x.com/2';

// RFC 3986 encoding, which OAuth requires (encodeURIComponent leaves !'()* alone).
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const NAMES = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'];

// Secrets pasted on a phone often pick up spaces or line breaks.
export function credentials(env = process.env) {
  const [consumerKey, consumerSecret, token, tokenSecret] = NAMES.map((n) => (env[n] ?? '').replace(/\s+/g, ''));
  if (!consumerKey || !consumerSecret || !token || !tokenSecret) return null;
  return { consumerKey, consumerSecret, token, tokenSecret };
}

// Hints about which secret is probably the wrong kind of key, judged by its shape
// only (values are never printed). X's console also shows a Client ID, Client
// Secret and Bearer Token, which look similar but don't work here.
export function keyHints(env = process.env) {
  const v = Object.fromEntries(NAMES.map((n) => [n, (env[n] ?? '').replace(/\s+/g, '')]));
  const hints = [];
  for (const n of NAMES) {
    if (/^AAAAAAAA/.test(v[n]) || v[n].length > 90) hints.push(`${n} looks like the Bearer Token, which isn't used here.`);
    else if (/:\d+:ci$/.test(v[n])) hints.push(`${n} looks like the OAuth 2.0 Client ID, which isn't used here.`);
  }
  if (v.X_ACCESS_TOKEN && !/^\d+-\w+$/.test(v.X_ACCESS_TOKEN)) {
    hints.push('X_ACCESS_TOKEN should start with digits and a dash (e.g. 1849…-Ab3…). It doesn’t, so it’s probably another key.');
  }
  if (/^\d+-/.test(v.X_API_KEY) || /^\d+-/.test(v.X_API_SECRET)) hints.push('An Access Token is in X_API_KEY or X_API_SECRET; the boxes may be swapped.');
  if (v.X_API_KEY && (v.X_API_KEY.length < 18 || v.X_API_KEY.length > 30)) hints.push('X_API_KEY is an unusual length for an API Key (normally about 25 characters).');
  return hints;
}

// `params` are query/form parameters that must be signed too; a JSON body is not signed.
export function authHeader(method, url, creds, params = {}, nonce = randomBytes(16).toString('hex'), timestamp = Math.floor(Date.now() / 1000)) {
  const oauth = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp),
    oauth_token: creds.token,
    oauth_version: '1.0',
  };
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all)
    .map((k) => [enc(k), enc(all[k])])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const base = [method.toUpperCase(), enc(url), enc(paramString)].join('&');
  const signature = createHmac('sha1', `${enc(creds.consumerSecret)}&${enc(creds.tokenSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(', ');
}

async function call(method, path, creds, body) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: authHeader(method, url, creds), ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`X answered HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export async function postTweet(creds, text) {
  return (await call('POST', '/tweets', creds, { text })).data;
}

// Checks the keys without posting anything. Returns the account's @handle.
export async function whoAmI(creds) {
  return (await call('GET', '/users/me', creds)).data.username;
}
