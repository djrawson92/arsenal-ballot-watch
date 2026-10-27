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

To post the open ballots to X straight away (e.g. after changing the tweet wording), run the workflow with **Tweet the open ballots now** ticked. It posts publicly and saves nothing.

To check the alerts still reach your phone at any time, go to **Actions → Check for ballots → Run workflow**, tick **Just send a test notification**, then run it. A test saves nothing.

If the Arsenal API can't be read 3 checks in a row, you get a "can't read the Arsenal site" warning, and another push when it works again.

## Backup timer (cron-job.org)

GitHub often skips scheduled runs on small repos (one run in nine hours on 26 Oct 2026), so a free [cron-job.org](https://cron-job.org) job also starts the check every 15 minutes:

- `POST https://api.github.com/repos/djrawson92/arsenal-ballot-watch/actions/workflows/check.yml/dispatches` with body `{"ref":"main"}`
- Headers: `Authorization: Bearer <GitHub fine-grained token>`, `Accept: application/vnd.github+json`, `Content-Type: application/json`, `X-GitHub-Api-Version: 2022-11-28`
- The token only has **Actions: Read and write** on this repo. **It expires**, and when it does, cron-job.org starts showing 401 errors: generate a new one and paste it into the Authorization header.

A successful call returns 204. Extra runs are harmless: they queue one at a time, and each alert is sent only once.

## Posting to X (optional)

When a ballot opens, the monitor can also tweet it from an X account, for example:

> 🚨 Ballot now open: Arsenal v Manchester United
> Kick-off Sun 20 Dec, 16:30 (Premier League)
> Closes Mon 26 Oct, 12:00 UK time
>
> #ARSMUN #Arsenal #COYG

The matchday hashtag (#ARSMUN, or #MUNARS away) uses the club codes in `src/ballots.mjs`. A club missing from that list just gets no match tag.

It also tweets a "Last chance" reminder when a ballot has 12 hours left, at the same time as your closing-soon push. Tweets carry no web address. X turns anything that looks like one into a link, and a post with a link costs about $0.20 instead of about $0.015. Tweeting stays off until all four X secrets below are set.

1. **Make the account.** Make it obviously unofficial: no club crest or club photos, and a name such as "AFC Ballot Alerts (unofficial)". In the bio, say it's automated and who runs it, e.g. "Unofficial, automated alerts when Arsenal ticket ballots open. Run by @yourname. Not affiliated with Arsenal FC."
2. **Label it as automated.** On the bot account, go to **Settings → Your account → Account information → Automation** and link it to your personal account. X's rules require this.
3. **Get developer access.** Sign in to the X Developer Console (developer.x.com) as the bot account and create an app. Add a payment card and buy a small amount of credit. X charges per post, and $5 lasts years at this rate.
4. **Allow posting.** In the app's **User authentication settings**, set permissions to **Read and write**. Do this before step 5, because keys made earlier stay read-only.
5. **Make the keys.** Under **Keys and tokens**, generate the **API Key and Secret** and the **Access Token and Secret**.
6. **Add four repo secrets** (Settings → Secrets and variables → Actions): `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN` and `X_ACCESS_SECRET`.
7. **Check them for free.** Run the workflow with **Just send a test notification** ticked. The push ends with "X keys work: tweets will post as @handle" or says what's wrong. This posts nothing.

If a tweet fails, for example because the credit has run out, you get a "Couldn't tweet the ballot" push. The phone alert still goes out as normal.

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
- `src/x.mjs`: signs and sends X API requests.
- `state.json`: ballots seen and alerts already sent. The workflow commits it when it changes.
- `docs/index.html`: the status page.

## Run it locally

Needs Node 20 or later, and no `npm install`.

```bash
npm test
DRY_RUN=1 npm run check   # prints alerts instead of sending them, and doesn't save state
```
