# jailer 2 bot

Watches the Oslo cinema programmes and pushes an [ntfy](https://ntfy.sh) alert
the moment **Jailer 2** turns up — once when it is first listed, and again, at
max priority, when tickets go on sale.

## Sources

| Source | How it is read | Covers |
| --- | --- | --- |
| [filmweb.no](https://www.filmweb.no/program?location=Oslo) | The GraphQL API its programme page uses (`movieinfoqs.filmweb.no/graphql`) — the page itself is rendered client-side | Every Oslo chain: NF Kino, **ODEON Oslo**, Vega, Kunstnernes Hus |
| [nfkino.no](https://www.nfkino.no/kinoprogram-oslo) | The server-rendered Oslo programme HTML | NF Kino, now showing and coming soon |
| [odeonkino.no](https://www.odeonkino.no/) | **Not read directly** | — |

odeonkino.no answers every non-browser request with a Cloudflare challenge
(HTTP 403), so it cannot be scraped with a plain fetch. It does not need to be:
ODEON Oslo publishes its showtimes through filmweb, which this bot reads.

NF Kino is read twice on purpose (directly and via filmweb), so one scraper
breaking does not blind the bot.

### What counts as "added"

filmweb gives three signals, earliest first:

1. **The national film database** (`searchForMovies`) — a distributor has
   registered the film for Norway, often weeks before any cinema lists it
2. **Oslo's coming-soon / now-showing lists**
3. **Oslo showtimes** — tickets are bookable, with a link straight to them

On nfkino.no a film is listed once it has an entry on the programme, and on
sale once that entry links to `/screening/…` pages.

Titles are matched case- and accent-blind as a whole-word run, so `Jailer 2`
matches `Jailer 2 - Tamilfilm`, `JAILER II` and `Jailer 2 (Tamil)`, but never
the 2023 original `Jailer` (which *is* in filmweb's database) or `Jailer 21`.

## Notification rules

| Event | Action |
| --- | --- |
| First listed anywhere | 🎬 priority-4 push, with premiere date if known |
| Tickets on sale anywhere | 🚨 priority-5 push with the first screenings and a ticket link |
| Straight to on sale | only the on-sale push |
| Drops off and comes back | silent — each milestone alerts once, ever |
| A source fails 3 runs in a row | ⚠️ one "bot may be broken" push for that source |

Milestones are global, not per source: when both sources see the film, you get
one push naming both. A source that fails or returns a suspiciously short
programme (under 5 films) counts as broken, never as "not listed yet".

`state.json` is committed back by the workflow so state survives between runs.
A notification is only recorded as sent if ntfy accepted it — otherwise it
retries on the next run.

## Setup

The bot runs on GitHub Actions every 15 minutes.

**Settings → Secrets and variables → Actions:**

| Name | Kind | Notes |
| --- | --- | --- |
| `NTFY_TOPIC` | secret, required | **Treat it as a password** — anyone who knows it can read and post to it. Use something unguessable, e.g. `jailer2-oslo-7f3a91`. |
| `MOVIE` | variable, optional | Defaults to `Jailer 2`. Changing it starts fresh state for the new title. |
| `NTFY_SERVER` | variable, optional | Defaults to `https://ntfy.sh`. Set only if self-hosting. |

Install the ntfy app ([iOS](https://apps.apple.com/us/app/ntfy/id1625396347) /
[Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)) and
subscribe to the same topic.

**Verify the wiring:** Actions → Check cinemas → Run workflow → tick "Send a
test notification". Locally: `TEST_NOTIFICATION=1 NTFY_TOPIC=… pnpm check`.

## Local use

```sh
pnpm install
pnpm test
pnpm typecheck
STATE_PATH=/tmp/state.json pnpm check        # one live run
MOVIE="Meesaya Murukku 2" STATE_PATH=/tmp/s.json pnpm check   # a film that is on sale, to see it fire
```

## Caveats

- **Actions cron is best-effort** and can run several minutes late.
- **GitHub disables scheduled workflows after 60 days of repository
  inactivity.** GitHub emails you first — push any commit or re-enable it.
- Both scrapers are specific to today's markup / API. If either changes, the
  broken-bot alert is what tells you.
