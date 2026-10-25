// One check: read Arsenal's fixtures, compare ballots with state.json, and push a
// phone notification for each ballot that's newly announced, newly open or about to close.
import { readFile, writeFile } from 'node:fs/promises';
import { fetchFixtures } from './api.mjs';
import { alertsFor, formatUk, message, phase, toBallot, ukTime } from './ballots.mjs';
import { notify } from './notify.mjs';

const STATE_FILE = new URL('../state.json', import.meta.url);
const FAILS_BEFORE_ALERT = 3;
const KEEPALIVE_DAYS = 30;
const FORGET_AFTER_DAYS = 7; // drop ballots this long after kick-off
const DRY_RUN = process.env.DRY_RUN === '1';
const DAY = 86_400_000;

const today = () => new Date().toISOString().slice(0, 10);

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function send(alert) {
  if (DRY_RUN) return console.log('[dry run] would notify:', JSON.stringify(alert));
  await notify(alert);
}

async function main() {
  const now = new Date();
  const state = await loadState();
  const before = JSON.stringify(state);

  let fixtures;
  try {
    fixtures = await fetchFixtures();
  } catch (err) {
    state.failStreak = (state.failStreak ?? 0) + 1;
    console.error(`check failed (${state.failStreak} in a row): ${err.message}`);
    if (state.failStreak === FAILS_BEFORE_ALERT) {
      await send({
        title: 'Ballot monitor can’t read the Arsenal site',
        message: `${err.message}\n\nYou won’t get ballot alerts until this is fixed.`,
        tags: ['warning'],
      });
    }
    await save(state, before);
    process.exitCode = 1;
    return;
  }

  if ((state.failStreak ?? 0) >= FAILS_BEFORE_ALERT) {
    await send({ title: 'Ballot monitor is working again', message: 'It can read the Arsenal site again.', tags: ['white_check_mark'] });
  }
  state.failStreak = 0;

  const ballots = fixtures.map(toBallot).filter(Boolean);
  console.log(`read ${fixtures.length} fixtures, ${ballots.length} with a ballot`);

  const known = state.ballots ?? {};
  const firstRun = !state.seeded;
  for (const ballot of ballots) {
    const entry = (known[ballot.id] ??= { firstSeen: today(), sent: [] });
    const due = alertsFor(ballot, entry.sent, now);
    Object.assign(entry, ballot, { phase: phase(ballot, now) });
    for (const kind of due) {
      if (!firstRun) {
        console.log(`${kind}: ${ballot.title}`);
        await send({ ...message(kind, ballot), click: ballot.link });
      }
      entry.sent.push(kind);
    }
  }

  // Forget ballots for matches that have been played.
  for (const [id, entry] of Object.entries(known)) {
    const kickoff = ukTime(entry.kickoff);
    if (kickoff && now - kickoff > FORGET_AFTER_DAYS * DAY) delete known[id];
  }
  state.ballots = known;

  if (firstRun) {
    state.seeded = true;
    const live = ballots.filter((b) => phase(b, now) !== 'closed');
    const lines = live.map((b) => {
      const p = phase(b, now);
      const when = p === 'open' ? `OPEN, closes ${formatUk(ukTime(b.closes))}` : `opens ${b.opens ? formatUk(ukTime(b.opens)) : 'TBC'}`;
      return `• ${b.title}: ${when}`;
    });
    await send({
      title: 'Arsenal ballot monitor is running',
      message: lines.length
        ? `Ballots right now:\n${lines.join('\n')}\n\nYou’ll be alerted when new ones are announced or open.`
        : 'No ballots are open or announced right now. You’ll be alerted when one is.',
      click: live.find((b) => phase(b, now) === 'open')?.link ?? 'https://www.arsenal.com/tickets/men',
      tags: ['soccer'],
    });
  }

  // GitHub pauses scheduled workflows in repos with no commits for 60 days.
  const lastAlive = state.lastAlive ? new Date(state.lastAlive) : new Date(0);
  if (now - lastAlive > KEEPALIVE_DAYS * DAY) state.lastAlive = today();

  await save(state, before);
}

async function save(state, before) {
  if (JSON.stringify(state) === before) return;
  if (DRY_RUN) return console.log('[dry run] state changed, not saving');
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

await main();
