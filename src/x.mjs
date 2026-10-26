// Posting to X with the account's own keys (OAuth 1.0a user context, signed with HMAC-SHA1).
import { createHmac, randomBytes } from 'node:crypto';

const API = 'https://api.x.com/2';

// RFC 3986 encoding, which OAuth requires (encodeURIComponent leaves !'()* alone).
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function credentials(env = process.env) {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET } = env;
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_SECRET) return null;
  return { consumerKey: X_API_KEY, consumerSecret: X_API_SECRET, token: X_ACCESS_TOKEN, tokenSecret: X_ACCESS_SECRET };
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
