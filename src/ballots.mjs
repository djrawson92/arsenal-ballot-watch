// Turns fixtures from the API into ballots and decides which alerts each one needs.
// Alert kinds, each sent at most once per ballot:
//   announced: ballot dates published but not open yet
//   open:      ballot is open now
//   closing:   still open and closes within CLOSING_SOON_HOURS (only after an "open" alert)

export const CLOSING_SOON_HOURS = 12;
const NO_BALLOT = new Set(['', 'notavailable']);
// Standard three-letter codes, used for matchday hashtags like #ARSMUN. The API has none.
const CLUB_CODES = {
  'aston villa': 'AVL', bournemouth: 'BOU', brentford: 'BRE', 'brighton & hove albion': 'BHA', brighton: 'BHA',
  burnley: 'BUR', chelsea: 'CHE', 'crystal palace': 'CRY', everton: 'EVE', fulham: 'FUL', 'hull city': 'HUL',
  'ipswich town': 'IPS', 'leeds united': 'LEE', 'leicester city': 'LEI', liverpool: 'LIV', 'manchester city': 'MCI',
  'manchester united': 'MUN', 'newcastle united': 'NEW', 'nottingham forest': 'NFO', southampton: 'SOU',
  sunderland: 'SUN', 'tottenham hotspur': 'TOT', 'west ham united': 'WHU', 'wolverhampton wanderers': 'WOL',
  'real madrid cf': 'RMA', 'borussia dortmund': 'BVB', 'real betis': 'BET', 'sk slavia praha': 'SLA',
  'fc barcelona': 'BAR', 'bayern münchen': 'BAY', 'paris saint-germain': 'PSG', 'inter milan': 'INT', 'ac milan': 'MIL',
};

const TEAM_NAMES = { men: '', women: 'Women', 'mens-academy-u21s': 'U21', 'mens-academy-u18s': 'U18' };

// API times are UK wall-clock times without an offset, e.g. "2026-10-23T11:00".
export function ukTime(value) {
  if (!value) return null;
  const naive = new Date(`${value.length === 16 ? `${value}:00` : value}Z`);
  if (Number.isNaN(naive.getTime())) return null;
  const offset = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'shortOffset' })
    .formatToParts(naive)
    .find((p) => p.type === 'timeZoneName').value; // "GMT" or "GMT+1"
  const hours = Number(offset.replace('GMT', '') || 0);
  return new Date(naive.getTime() - hours * 3_600_000);
}

export function formatUk(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function toBallot(fixture) {
  const details = fixture.customTypeData?.fixtureDetails ?? {};
  const ticketing = fixture.customTypeData?.metaData?.fixtureTicketing ?? {};
  const status = String(ticketing.ballot ?? '').trim();
  // The club publishes the dates before it changes the status from "notAvailable"
  // (seen for Arsenal v Ipswich, 30 Oct 2026), so dates alone mean there's a ballot.
  if (NO_BALLOT.has(status.toLowerCase()) && !ticketing.ballotOpenDate) return null;

  const opponent = details.opponent?.name ?? 'TBC';
  const team = TEAM_NAMES[details.arsenalTeam?.slug] ?? details.arsenalTeam?.slug ?? '';
  const arsenal = team ? `Arsenal ${team}` : 'Arsenal';
  const home = details.venueType1 !== 'away';
  return {
    id: String(fixture.id),
    title: home ? `${arsenal} v ${opponent}` : `${opponent} v ${arsenal}`,
    home,
    opponentCode: team ? null : (CLUB_CODES[opponent.toLowerCase()] ?? null), // first team only
    competition: details.competition?.name ?? null,
    kickoff: details.fixtureDate ?? null,
    status,
    opens: ticketing.ballotOpenDate ?? null,
    closes: ticketing.ballotCloseDate ?? null,
    link: ticketing.ballotLink || ticketing.ticketLink || 'https://www.eticketing.co.uk/arsenal/',
  };
}

// The club flips the status by hand, so trust the dates when they say it should be open or shut.
export function phase(ballot, now) {
  const opens = ukTime(ballot.opens);
  const closes = ukTime(ballot.closes);
  const status = ballot.status.toLowerCase();
  if (status === 'closed' || (closes && now >= closes)) return 'closed';
  if (status === 'open' || (opens && now >= opens)) return 'open';
  return 'upcoming';
}

export function alertsFor(ballot, sent, now) {
  const p = phase(ballot, now);
  const closes = ukTime(ballot.closes);
  const alerts = [];
  if (p === 'upcoming' && !sent.includes('announced')) alerts.push('announced');
  if (p === 'open' && !sent.includes('open')) alerts.push('open');
  if (p === 'open' && sent.includes('open') && !sent.includes('closing') && closes && closes - now <= CLOSING_SOON_HOURS * 3_600_000) {
    alerts.push('closing');
  }
  return alerts;
}

export function message(kind, ballot) {
  const opens = ukTime(ballot.opens);
  const closes = ukTime(ballot.closes);
  const kickoff = ukTime(ballot.kickoff);
  const match = kickoff ? `${ballot.title} (${formatUk(kickoff)})` : ballot.title;
  const until = closes ? `Closes ${formatUk(closes)}.` : '';
  switch (kind) {
    case 'announced':
      return {
        title: `Ballot coming: ${ballot.title}`,
        message: [`${match}`, opens ? `Opens ${formatUk(opens)}.` : 'Opening date not announced yet.', until, ...extrasLine(ballot)].filter(Boolean).join('\n'),
        tags: ['soccer', 'calendar'],
        priority: 4,
      };
    case 'open':
      return {
        title: `Ballot OPEN: ${ballot.title}`,
        message: [match, `${until} Tap to apply.`.trim(), ...extrasLine(ballot)].join('\n'),
        tags: ['soccer', 'ticket'],
        priority: 5,
      };
    case 'closing':
      return { title: `Ballot closing soon: ${ballot.title}`, message: `${match}\n${until} Apply now if you haven’t.`, tags: ['soccer', 'hourglass'], priority: 5 };
  }
}

// Public tweet when a ballot is announced, opens or is about to close: a headline, then one
// fact per line, each with a small icon so it scans at a glance. No 📅: it always shows
// "JUL 17". No web address: X turns anything that looks like one into a link, and posts
// with links cost about 13 times as much. Few hashtags: the matchday tag (#ARSMUN) and two club tags.
export function tweetText(ballot, kind = 'open', now = new Date()) {
  const kickoff = ukTime(ballot.kickoff);
  const opens = ukTime(ballot.opens);
  const closes = ukTime(ballot.closes);
  const code = ballot.opponentCode;
  const matchTag = code ? `#${ballot.home ? `ARS${code}` : `${code}ARS`} ` : '';
  const ko = kickoff && `⚽ ${friendly(kickoff)}${ballot.competition ? ` · ${ballot.competition}` : ''}`;
  const price = ballot.priceRange && `💷 ${ballot.priceRange.replace(' – ', '–')}${ballot.category ? ` · Category ${ballot.category}` : ''}`;
  const r = ballot.results ?? {};
  const results = ['Silver', 'Red'].filter((g) => r[g]).map((g) => `${g} ${r[g]}`).join(' · ');
  const res = results && `📬 Results: ${results}`;

  const [headline, ...facts] = {
    announced: [
      `📢 Ballot dates are out: ${ballot.title}`,
      opens ? `🟢 Opens ${friendly(opens)}` : '🟢 Opening date to be confirmed',
      closes && `⏳ Closes ${friendly(closes)}`,
      ko, price, res,
    ],
    open: [`🚨 Ballot OPEN: ${ballot.title}`, closes && `⏳ Closes ${friendly(closes)}`, ko, price, res],
    closing: [`⏰ Last chance: ${ballot.title}`, closes && `⏳ Ballot closes ${closesWhen(closes, now)}`, ko, price],
  }[kind];
  return [headline, facts.filter(Boolean).join('\n'), `${matchTag}#Arsenal #COYG`].join('\n\n');
}

// "Sat 2 Jan, 3pm" / "Mon 9 Nov, 7:45pm": how fans write times, always UK time.
export function friendly(date) {
  const part = (o) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...o }).format(date);
  const day = part({ weekday: 'short', day: 'numeric', month: 'short' });
  const [h, m] = part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
  const time = `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
  return `${day}, ${time}`;
}

// "today, 12pm" when it closes on the same UK day, else the full date.
function closesWhen(closes, now) {
  const day = (d) => d.toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  return day(closes) === day(now) ? `today, ${friendly(closes).split(', ')[1]}` : friendly(closes);
}

// Price range and Silver/Red results dates from the match's ticket article, e.g.
// "Ballot price range £31.80 - £59.00" and the status table's "Successful applicants
// charged" column ("November 12 (approx.)"). Anything missing is just left out.
export function parseTicketArticle(body) {
  const text = (html) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const nodes = [];
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      if (n.type === 'TABLE' || n.tagName === 'P') nodes.push(n);
      for (const k in n) if (k !== 'tableHead' && k !== 'tableData') walk(n[k]);
    }
  })(body);

  let category = null;
  for (const n of nodes) {
    const m = n.tagName === 'P' && text(n.html).match(/\bCategory ([A-C])\b/);
    if (m) { category = m[1]; break; }
  }

  let priceRange = null;
  for (const n of nodes) {
    const m = n.tagName === 'P' && text(n.html).match(/Ballot price range\s*(£[\d.,]+)\s*[-–]\s*(£[\d.,]+)/i);
    if (m) { priceRange = `${m[1]} – ${m[2]}`; break; }
  }

  const results = {};
  for (const table of nodes.filter((n) => n.type === 'TABLE')) {
    const head = (table.tableHead?.[0] ?? []).map((c) => text(c?.html));
    const col = head.findIndex((h) => /charged|result/i.test(h));
    if (col < 0) continue;
    for (const row of table.tableData ?? []) {
      const group = text(row[0]?.html);
      const date = text(row[col]?.html).match(/([A-Z][a-z]+) (\d{1,2})/);
      if (/^(silver|red)$/i.test(group) && date) results[group[0].toUpperCase() + group.slice(1).toLowerCase()] = `${date[2]} ${date[1].slice(0, 3)}`;
    }
  }
  return { priceRange, category, results };
}

function extrasLine(ballot) {
  const r = ballot.results ?? {};
  const results = ['Silver', 'Red'].filter((g) => r[g]).map((g) => `${g} ${r[g]}`).join(' · ');
  return [ballot.priceRange && `Prices ${ballot.priceRange}`, results && `Results: ${results}`].filter(Boolean);
}
