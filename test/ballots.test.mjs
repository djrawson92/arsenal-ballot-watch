import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { alertsFor, friendly, message, parseTicketArticle, phase, toBallot, tweetText, ukTime } from '../src/ballots.mjs';

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

test('away hashtag puts the home side first; unknown clubs get no match tag', () => {
  assert.match(tweetText({ ...manUtd, home: false, title: 'Manchester United v Arsenal' }), /#MUNARS #Arsenal/);
  assert.match(tweetText({ ...manUtd, opponentCode: null }), /\n\n#Arsenal #COYG$/);
});

test('dates published while the status still says notAvailable count as an announced ballot', () => {
  // Real shape from 30 Oct 2026 (Arsenal v Ipswich).
  const fixture = {
    id: 11444,
    customTypeData: {
      fixtureDetails: { arsenalTeam: { slug: 'men' }, fixtureDate: '2027-01-02T15:00', opponent: { name: 'Ipswich Town' }, venueType1: 'home' },
      metaData: { fixtureTicketing: { ballot: 'notAvailable', ballotOpenDate: '2026-11-06T12:00', ballotCloseDate: '2026-11-09T12:00' } },
    },
  };
  const b = toBallot(fixture);
  assert.equal(b.title, 'Arsenal v Ipswich Town');
  assert.equal(phase(b, at('2026-10-30T14:00Z')), 'upcoming');
  assert.deepEqual(alertsFor(b, [], at('2026-10-30T14:00Z')), ['announced']);
  assert.equal(phase(b, at('2026-11-06T12:00Z')), 'open'); // dates win even if the status is never updated
  assert.equal(toBallot({ ...fixture, customTypeData: { ...fixture.customTypeData, metaData: { fixtureTicketing: { ballot: 'notAvailable' } } } }), null);
});

// Real ticket-article nodes for Arsenal v Ipswich, 30 Oct 2026 (price paragraph and status table).
const ipswichArticle = JSON.parse(readFileSync(new URL('./fixtures/article-ipswich-2026-10-30.json', import.meta.url)));

test('reads the price range and Silver/Red results dates from the ticket article', () => {
  assert.deepEqual(parseTicketArticle(ipswichArticle), { priceRange: '£31.80 – £59.00', category: 'C', results: { Silver: '12 Nov', Red: '17 Nov' } });
  assert.deepEqual(parseTicketArticle([]), { priceRange: null, category: null, results: {} });
});

const ipswich = {
  id: '11444', title: 'Arsenal v Ipswich Town', home: true, opponentCode: 'IPS', competition: 'Premier League',
  kickoff: '2027-01-02T15:00', opens: '2026-11-06T12:00', closes: '2026-11-09T12:00',
  priceRange: '£31.80 – £59.00', category: 'C', results: { Silver: '12 Nov', Red: '17 Nov' },
};

test('times read the way fans write them', () => {
  assert.equal(friendly(at('2027-01-02T15:00Z')), 'Sat 2 Jan, 3pm');
  assert.equal(friendly(at('2026-11-09T12:00Z')), 'Mon 9 Nov, 12pm');
  assert.equal(friendly(at('2026-11-24T19:45Z')), 'Tue 24 Nov, 7:45pm');
  assert.equal(friendly(at('2026-10-23T10:00Z')), 'Fri 23 Oct, 11am'); // BST
  assert.equal(friendly(at('2026-11-07T00:00Z')), 'Sat 7 Nov, 12am');
});

test('open tweet: headline, then one fact per line, then hashtags', () => {
  assert.equal(tweetText(ipswich, 'open'), [
    '🚨 Ballot OPEN: Arsenal v Ipswich Town',
    '',
    '⏳ Closes Mon 9 Nov, 12pm',
    '⚽ Sat 2 Jan, 3pm · Premier League',
    '💷 £31.80–£59.00 · Category C',
    '📬 Results: Silver 12 Nov · Red 17 Nov',
    '',
    '#ARSIPS #Arsenal #COYG',
  ].join('\n'));
});

test('announced tweet leads with the opening time', () => {
  assert.equal(tweetText(ipswich, 'announced'), [
    '📢 Ballot dates are out: Arsenal v Ipswich Town',
    '',
    '🟢 Opens Fri 6 Nov, 12pm',
    '⏳ Closes Mon 9 Nov, 12pm',
    '⚽ Sat 2 Jan, 3pm · Premier League',
    '💷 £31.80–£59.00 · Category C',
    '📬 Results: Silver 12 Nov · Red 17 Nov',
    '',
    '#ARSIPS #Arsenal #COYG',
  ].join('\n'));
  assert.match(tweetText({ ...ipswich, opens: null }, 'announced'), /\n🟢 Opening date to be confirmed\n/);
});

test('last-chance tweet says "today" on the closing day and skips results', () => {
  const text = tweetText(ipswich, 'closing', at('2026-11-09T01:00Z'));
  assert.match(text, /^⏰ Last chance: Arsenal v Ipswich Town\n\n⏳ Ballot closes today, 12pm\n⚽ /);
  assert.doesNotMatch(text, /Results/);
  assert.match(tweetText(ipswich, 'closing', at('2026-11-08T23:30Z')), /closes Mon 9 Nov, 12pm/); // still Sunday in the UK
});

test('every tweet stays short, has no web address, and never duplicates another', () => {
  const texts = ['announced', 'open', 'closing'].map((k) => tweetText(ipswich, k));
  for (const t of texts) {
    assert.ok([...t].length <= 280, t);
    assert.doesNotMatch(t, /https?:|www\.|\.co\.uk|\.com|📅/);
  }
  assert.equal(new Set(texts).size, 3);
  // Missing extras just drop their lines; away games put the home side first in the tag.
  assert.doesNotMatch(tweetText(manUtd, 'open'), /💷|📬/);
  assert.match(tweetText({ ...manUtd, home: false, title: 'Manchester United v Arsenal' }), /#MUNARS #Arsenal/);
  assert.match(tweetText({ ...manUtd, opponentCode: null }), /\n\n#Arsenal #COYG$/);
});

