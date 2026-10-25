// Push notification through ntfy (https://ntfy.sh). JSON publishing keeps
// non-ASCII text (curly quotes, accented names) intact.
export async function notify({ title, message, click, tags, priority }) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) throw new Error('NTFY_TOPIC is not set');
  const server = process.env.NTFY_SERVER || 'https://ntfy.sh';

  const res = await fetch(server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title, message, click, tags, priority }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ntfy answered HTTP ${res.status}: ${await res.text()}`);
}
