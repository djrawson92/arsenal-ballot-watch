// One check: read Arsenal's fixtures, compare ballots with state.json, and push a
// phone notification for each ballot that's newly announced, newly open or about to close.
import { readFile, writeFile } from 'node:fs/promises';
import { fetchFixtures, fetchTicketArticle } from './api.mjs';
import { alertsFor, CLOSING_SOON_HOURS, formatUk, message, parseTicketArticle, phase, toBallot, tweetText, ukTime } from './ballots.mjs';
import { notify } from './notify.mjs';
import { credentials, keyHints, postTweet, whoAmI } from './x.mjs';

const STATE_FILE = new URL('../state.json', import.meta.url);
const FAILS_BEFORE_ALERT = 3;
const KEEPALIVE_DAYS = 30;
const FORGET_AFTER_DAYS = 7; // drop ballots this long after kick-off
const DRY_RUN = process.env.DRY_RUN === '1';
const TEST_NOTIFICATION = process.env.TEST_NOTIFICATION === 'true';
const TWEET_NOW = process.env.TWEET_NOW === 'true';
const X_CREDS = credentials(); // null until the four X_* secrets are added
const TWEETED = new Set(['announced', 'open', 'closing']); // alert kinds that are also posted to X
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

// Price range and results dates from the match's ticket article. Only fetched when an
// alert is about to go out; if anything fails, the alert just goes without them.
async function addTicketInfo(ballot) {
  try {
    const body = await fetchTicketArticle(ballot.id);
    if (body) Object.assign(ballot, parseTicketArticle(body));
  } catch (err) {
    console.warn(`no ticket info for ${ballot.title}: ${err.message}`);
  }
}

// A failed tweet is reported to the phone but never stops the check or the phone alert.
async function tweet(ballot, kind) {
  const text = tweetText(ballot, kind);
  if (DRY_RUN) return console.log('[dry run] would tweet:', JSON.stringify(text));
  try {
    const { id } = await postTweet(X_CREDS, text);
    console.log(`tweeted ${id}`);
  } catch (err) {
    console.error(`tweet failed: ${err.message}`);
    await send({ title: 'Couldn’t tweet the ballot', message: `${ballot.title}\n${err.message}`, tags: ['warning'] });
  }
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

  // Manual: post open ballots straight away, e.g. after changing the tweet format.
  if (TWEET_NOW) {
    if (!X_CREDS) throw new Error('Tweet now needs the four X_* secrets');
    const open = ballots.filter((b) => phase(b, now) === 'open');
    if (!open.length) console.log('no open ballots to tweet');
    for (const b of open) {
      await addTicketInfo(b);
      const closes = ukTime(b.closes);
      await tweet(b, closes && closes - now <= CLOSING_SOON_HOURS * 3_600_000 ? 'closing' : 'open');
    }
    return; // changes nothing in state.json
  }

  if (TEST_NOTIFICATION) {
    const lines = ballots.filter((b) => phase(b, now) !== 'closed').map((b) => `• ${b.title}: ${phase(b, now)}`);
    let x = 'X posting is off (no X keys set).';
    if (X_CREDS) {
      try {
        x = `X keys work: tweets will post as @${await whoAmI(X_CREDS)}.`;
      } catch (err) {
        const hints = keyHints();
        x = `X keys don’t work: ${err.message.replace(/\s+/g, ' ')}${hints.length ? `\n${hints.join('\n')}` : ''}`;
      }
    }
    console.log(x);
    const list = lines.length ? `Ballots right now:\n${lines.join('\n')}` : 'No ballots open or announced right now.';
    await send({
      title: 'Test notification',
      message: `The ballot monitor can read Arsenal’s fixtures and reach your phone.\n\n${list}\n\n${x}`,
      tags: ['test_tube'],
    });
    return; // a test changes nothing in state.json
  }

  const known = state.ballots ?? {};
  const firstRun = !state.seeded;
  for (const ballot of ballots) {
    const entry = (known[ballot.id] ??= { firstSeen: today(), sent: [] });
    const due = alertsFor(ballot, entry.sent, now);
    Object.assign(entry, ballot, { phase: phase(ballot, now) });
    if (due.length && !firstRun) await addTicketInfo(ballot);
    for (const kind of due) {
      if (!firstRun) {
        console.log(`${kind}: ${ballot.title}`);
        await send({ ...message(kind, ballot), click: ballot.link });
        if (TWEETED.has(kind) && X_CREDS) await tweet(ballot, kind);
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
