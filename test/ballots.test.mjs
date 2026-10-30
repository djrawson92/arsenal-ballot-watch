import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { alertsFor, message, parseTicketArticle, phase, toBallot, tweetText, ukTime } from '../src/ballots.mjs';

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

test('tweet has the match, kick-off, closing time and matchday hashtag, and no web address', () => {
  const text = tweetText({ ...manUtd, competition: 'Premier League' });
  assert.match(text, /^🚨 Ballot now open: Arsenal v Manchester United\nKick-off Sun 20 Dec(,| at) 16:30 \(Premier League\)\nCloses Mon 26 Oct(,| at) 12:00 UK time\n\n#ARSMUN #Arsenal #COYG$/);
  assert.equal([...text.matchAll(/\p{Extended_Pictographic}/gu)].length, 1, 'one emoji only');
  assert.doesNotMatch(text, /https?:|www\.|\.co\.uk|\.com|ticketing site/);
  assert.ok([...text].length <= 280);
});

test('away hashtag puts the home side first; unknown clubs get no match tag', () => {
  assert.match(tweetText({ ...manUtd, home: false, title: 'Manchester United v Arsenal' }), /#MUNARS #Arsenal/);
  assert.match(tweetText({ ...manUtd, opponentCode: null }), /\n\n#Arsenal #COYG$/);
});

test('closing-soon tweet leads with the deadline, saying "today" on the day', () => {
  const b = { ...manUtd, competition: 'Premier League' };
  assert.match(tweetText(b, 'closing', at('2026-10-26T01:00Z')), /^⏰ Last chance: Arsenal v Manchester United ballot\nCloses today at 12:00 UK time\nKick-off Sun 20 Dec(,| at) 16:30 \(Premier League\)\n\n#ARSMUN #Arsenal #COYG$/);
  assert.match(tweetText(b, 'closing', at('2026-10-25T23:30Z')), /Closes Mon 26 Oct(,| at) 12:00 UK time/); // still Sunday in the UK
  assert.notEqual(tweetText(b, 'closing'), tweetText(b, 'open')); // X rejects exact duplicates
});

test('announced tweet gives the opening time, or says it is to be confirmed', () => {
  const b = { ...manUtd, status: 'comingSoon', competition: 'Premier League' };
  const text = tweetText(b, 'announced');
  assert.match(text, /^🗓️ Ballot coming: Arsenal v Manchester United\nOpens Fri 23 Oct(,| at) 11:00 UK time\nCloses Mon 26 Oct(,| at) 12:00 UK time\nKick-off Sun 20 Dec(,| at) 16:30 \(Premier League\)\n\n#ARSMUN #Arsenal #COYG$/);
  assert.equal([...text.matchAll(/\p{Extended_Pictographic}/gu)].length, 1, 'one emoji only');
  assert.match(tweetText({ ...b, opens: null }, 'announced'), /\nOpening date to be confirmed\n/);
  assert.equal(new Set(['announced', 'open', 'closing'].map((k) => tweetText(b, k))).size, 3); // never duplicates
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
  assert.deepEqual(parseTicketArticle(ipswichArticle), { priceRange: '£31.80 – £59.00', results: { Silver: '12 Nov', Red: '17 Nov' } });
  assert.deepEqual(parseTicketArticle([]), { priceRange: null, results: {} });
});

test('price and results lines appear in announced and open tweets, not the last-chance one', () => {
  const b = { ...manUtd, competition: 'Premier League', ...parseTicketArticle(ipswichArticle) };
  for (const kind of ['announced', 'open']) {
    const text = tweetText(b, kind);
    assert.match(text, /\nPrices £31\.80 – £59\.00\nResults: Silver 12 Nov · Red 17 Nov\n\n#ARSMUN/);
    assert.equal([...text.matchAll(/\p{Extended_Pictographic}/gu)].length, 1, 'one emoji only');
    assert.ok([...text].length <= 280);
  }
  assert.doesNotMatch(tweetText(b, 'closing'), /Prices|Results/);
  assert.match(message('open', b).message, /Prices £31\.80 – £59\.00\nResults: Silver 12 Nov · Red 17 Nov$/);
  assert.doesNotMatch(tweetText(manUtd, 'open'), /Prices|Results/); // nothing found, nothing shown
});

