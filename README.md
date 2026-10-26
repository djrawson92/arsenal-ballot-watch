# Arsenal Ballot Watch

Every 15 minutes this checks Arsenal's fixture list for ticket ballots and sends a push notification to your phone through [ntfy](https://ntfy.sh):

- **Ballot coming:** the club has published ballot dates for a match.
- **Ballot OPEN:** the ballot is open. Tap the notification to go to the ticketing site and apply.
- **Ballot closing soon:** it's still open and closes within 12 hours.

Each alert is sent once per ballot. It runs on GitHub Actions, so no PC or server needs to stay on. It never logs in to your Arsenal account.

## Setup

1. **Phone:** install **ntfy** from the App Store. Tap **+**, then subscribe to a topic name that's hard to guess, for example `afc-ballots-7q2kx9`. Anyone who knows the name can read the alerts, so treat it like a password.
2. **GitHub secret:** in this repo, open **Settings → Secrets and variables → Actions → New repository secret**. Set the name to `NTFY_TOPIC` and the value to that topic name.
3. **First run:** open **Actions → Check for ballots → Run workflow**. Within about a minute your phone should get "Arsenal ballot monitor is running", listing any ballots that are open or coming up.
4. **Status page (optional):** open **Settings → Pages**, set Source to **Deploy from a branch**, then choose branch `main` and folder `/docs`. The page appears at `https://<your-username>.github.io/arsenal-ballot-watch/`.

To check the alerts still reach your phone at any time, go to **Actions → Check for ballots → Run workflow**, tick **Just send a test notification**, then run it. A test saves nothing.

If the Arsenal API can't be read 3 checks in a row, you get a "can't read the Arsenal site" warning, and another push when it works again.

## Where the data comes from

arsenal.com's ticket pages load fixtures in the browser from a public GraphQL API (`https://afc-prd.graph.arsenal.com/graphql`, query `getAllLatestLiveReports`). Each fixture's `fixtureTicketing` has:

- `ballot`: `notAvailable`, `open` or `closed`
- `ballotOpenDate` and `ballotCloseDate`: UK local times with no offset, e.g. `2026-10-23T11:00`
- `ballotLink`: the eticketing.co.uk page to apply on

The club seems to update `ballot` by hand, so when the dates say a ballot should be open or shut, the dates win (`src/ballots.mjs`). If the club starts using another status before a ballot opens, it's treated as "coming". `test/fixtures/` has a real API response from 25 Oct 2026.

## Files

- `src/api.mjs`: fetches every fixture from the API.
- `src/ballots.mjs`: turns fixtures into ballots and decides which alerts are due.
- `src/check.mjs`: one check; reads and writes `state.json`.
- `src/notify.mjs`: sends the ntfy push.
- `state.json`: ballots seen and alerts already sent. The workflow commits it when it changes.
- `docs/index.html`: the status page.

## Run it locally

Needs Node 20 or later, and no `npm install`.

```bash
npm test
DRY_RUN=1 npm run check   # prints alerts instead of sending them, and doesn't save state
```
