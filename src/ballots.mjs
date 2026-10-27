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
  if (NO_BALLOT.has(status.toLowerCase())) return null;

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
        message: [`${match}`, opens ? `Opens ${formatUk(opens)}.` : 'Opening date not announced yet.', until].filter(Boolean).join('\n'),
        tags: ['soccer', 'calendar'],
        priority: 4,
      };
    case 'open':
      return { title: `Ballot OPEN: ${ballot.title}`, message: `${match}\n${until} Tap to apply.`.trim(), tags: ['soccer', 'ticket'], priority: 5 };
    case 'closing':
      return { title: `Ballot closing soon: ${ballot.title}`, message: `${match}\n${until} Apply now if you haven’t.`, tags: ['soccer', 'hourglass'], priority: 5 };
  }
}

// Public tweet when a ballot is announced, opens or is about to close. No web address: X turns
// anything that looks like one into a link, and posts with links cost about 13 times as much.
// Few hashtags: the matchday tag fans search (#ARSMUN), then two club tags.
export function tweetText(ballot, kind = 'open', now = new Date()) {
  const kickoff = ukTime(ballot.kickoff);
  const closes = ukTime(ballot.closes);
  const code = ballot.opponentCode;
  const matchTag = code ? `#${ballot.home ? `ARS${code}` : `${code}ARS`} ` : '';
  const ko = kickoff && `Kick-off ${formatUk(kickoff)}${ballot.competition ? ` (${ballot.competition})` : ''}`;
  const opens = ukTime(ballot.opens);
  const lines = {
    announced: [
      `🗓️ Ballot coming: ${ballot.title}`,
      opens ? `Opens ${formatUk(opens)} UK time` : 'Opening date to be confirmed',
      closes && `Closes ${formatUk(closes)} UK time`,
      ko,
    ],
    open: [`🚨 Ballot now open: ${ballot.title}`, ko, closes && `Closes ${formatUk(closes)} UK time`],
    closing: [`⏰ Last chance: ${ballot.title} ballot`, closes && `Closes ${closesWhen(closes, now)} UK time`, ko],
  }[kind];
  return [lines.filter(Boolean).join('\n'), `${matchTag}#Arsenal #COYG`].join('\n\n');
}

// "today at 12:00" when it closes on the same UK day, else the full date.
function closesWhen(closes, now) {
  const day = (d) => d.toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  if (day(closes) !== day(now)) return formatUk(closes);
  return `today at ${closes.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })}`;
}
