import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { alertsFor, message, phase, toBallot, tweetText, ukTime } from '../src/ballots.mjs';

// Real API response from 25 Oct 2026, trimmed to five fixtures.
const api = JSON.parse(readFileSync(new URL('./fixtures/api-2026-10-25.json', import.meta.url)));
const fixtures = api.data.getAllLatestLiveReports.data;
const ballots = fixtures.map(toBallot).filter(Boolean);
const manUtd = ballots.find((b) => b.id === '11452');
const at = (iso) => new Date(iso);

test('only fixtures with a ballot become ballots', () => {
  assert.deepEqual(ballots.map((b) => b.title).sort(), ['Arsenal v Manchester City', 'Arsenal v Manchester United']);
});

test('reads the real fields', () => {
  assert.deepEqual(manUtd, {
    id: '11452',
    title: 'Arsenal v Manchester United',
    home: true,
    opponentCode: 'MUN',
    competition: null,
    kickoff: '2026-12-20T16:30',
    status: 'open',
    opens: '2026-10-23T11:00',
    closes: '2026-10-26T12:00',
    link: 'https://www.eticketing.co.uk/arsenal/',
  });
});

test('names away and youth fixtures', () => {
  const fixture = (slug, venue) => ({
    id: 1,
    customTypeData: {
      fixtureDetails: { arsenalTeam: { slug }, opponent: { name: 'Chelsea' }, venueType1: venue },
      metaData: { fixtureTicketing: { ballot: 'open' } },
    },
  });
  assert.equal(toBallot(fixture('men', 'away')).title, 'Chelsea v Arsenal');
  assert.equal(toBallot(fixture('women', 'home')).title, 'Arsenal Women v Chelsea');
});

test('API times are UK time, in summer and winter', () => {
  assert.equal(ukTime('2026-10-23T11:00').toISOString(), '2026-10-23T10:00:00.000Z'); // BST
  assert.equal(ukTime('2026-12-20T16:30').toISOString(), '2026-12-20T16:30:00.000Z'); // GMT
  assert.equal(ukTime(null), null);
});

test('dates override a stale status', () => {
  const upcoming = { ...manUtd, status: 'comingSoon' };
  assert.equal(phase(upcoming, at('2026-10-23T09:59Z')), 'upcoming');
  assert.equal(phase(upcoming, at('2026-10-23T10:00Z')), 'open');
  assert.equal(phase(manUtd, at('2026-10-26T11:59Z')), 'open'); // closes 12:00 UK = 12:00 UTC (clocks went back 25 Oct)
  assert.equal(phase(manUtd, at('2026-10-26T12:00Z')), 'closed');
});

test('alert sequence: announced, open, closing soon, then nothing', () => {
  const b = { ...manUtd, status: 'comingSoon' };
  const sent = [];
  const step = (iso) => {
    const due = alertsFor(b, sent, at(iso));
    sent.push(...due);
    return due;
  };
  assert.deepEqual(step('2026-10-20T12:00Z'), ['announced']);
  assert.deepEqual(step('2026-10-21T12:00Z'), []);
  assert.deepEqual(step('2026-10-23T10:05Z'), ['open']);
  assert.deepEqual(step('2026-10-25T12:00Z'), []); // 24 h left
  assert.deepEqual(step('2026-10-26T01:00Z'), ['closing']); // 11 h left
  assert.deepEqual(step('2026-10-26T02:00Z'), []);
  assert.deepEqual(step('2026-10-26T13:00Z'), []); // closed
});

test('no closing reminder in the same run as the first open alert', () => {
  assert.deepEqual(alertsFor(manUtd, [], at('2026-10-26T06:00Z')), ['open']);
});

test('messages show UK times', () => {
  const m = message('open', manUtd);
  assert.equal(m.title, 'Ballot OPEN: Arsenal v Manchester United');
  assert.match(m.message, /Sun 20 Dec(,| at) 16:30/);
  assert.match(m.message, /Closes Mon 26 Oct(,| at) 12:00/);
});

test('tweet has the match, closing time and matchday hashtag, and no web address', () => {
  const text = tweetText({ ...manUtd, competition: 'Premier League' });
  assert.match(text, /^🚨 Ballot OPEN: Arsenal v Manchester United\n📅 Sun 20 Dec(,| at) 16:30 · Premier League\n⏳ Closes Mon 26 Oct(,| at) 12:00 UK time/);
  assert.match(text, /UK time\n\n#ARSMUN #Arsenal #COYG$/);
  assert.doesNotMatch(text, /https?:|www\.|\.co\.uk|\.com|ticketing site/);
  assert.ok([...text].length <= 280);
});

test('away hashtag puts the home side first; unknown clubs get no match tag', () => {
  assert.match(tweetText({ ...manUtd, home: false, title: 'Manchester United v Arsenal' }), /#MUNARS #Arsenal/);
  assert.match(tweetText({ ...manUtd, opponentCode: null }), /\n\n#Arsenal #COYG$/);
});
