# Hindsight — League of Legends Post-Game Analyser

Hindsight reads the Riot Match-V5 **timeline** for your recent ranked games and tells you
what went wrong, with a game clock and a map coordinate attached to each observation. It is
a rule engine, not a stats dashboard: every output is a specific, timestamped claim about a
specific moment — "you died at 29:47 with no friendly ward live anywhere on the map" —
rather than an aggregate you have to interpret.

The interesting engineering problem here isn't fetching the data. It's that **the timeline
doesn't contain the information the most useful rule needs**, and the project is built
around measuring how far a principled estimate can close that gap, then refusing to make
claims it can't support. See [Design notes](#design-notes).

Current stage: **data layer, rule engine, and a first web UI.** Run `npm run dev` and open
<http://localhost:3000>: every death from a player's last 20 games on the map, and for any one
death, which friendly wards were up and how sure the estimate of their position is.

---

## Quick start

```bash
npm install
cp .env.local.example .env.local   # then add your key from developer.riotgames.com
npm run analyze -- "gameName#tagLine"
```

The first run needs a Riot API key: it downloads the player's last 20 ranked games (remakes are
detected and replaced with older games). Everything fetched is saved to `/cache`, so after
that the same player can be analyzed offline, with `--offline` or once the key has expired.
The repo ships no match data; the cache and your labels stay on your machine.

Riot dev keys expire every 24 hours. When the key is missing or dead, `analyze` falls back
to the cache automatically rather than failing.

---

## Sample output

```
── NA1_1234567890 ─ 5 finding(s) ───────────────────────────
   [12:07] (WARN) Died holding 1,556 unspent gold
        You died at 12:07 carrying 1,556 gold you hadn't spent. Backing to buy before
        this fight would have turned it into items. (Gold read from the 12:00 snapshot.)
   [15:00] (WARN) Down 1,724 gold at 15 min
        At 15 minutes you had 4,543 gold to your lane opponent's 6,267. (Lane opponent
        taken to be Brand (red), from role order.)
   [20:23] (WARN) Death without vision
        Died at 20:23. The nearest friendly ward was about 6,124 units away; the rule
        counts 1,400 as close. Judged from 3 confidently placed wards. Killed by Veigar (red).
   ...

════════════════════════════════════════════════════════════
Done. 20 games analyzed, 1 remake(s) skipped — 21 read from cache, 0 fetched. 121 total finding(s).
```

---

## Accuracy

Measured over **36 ranked games / 2,801 deaths** (the 5 remakes in the cache are excluded).
The scripts that produce every number are in this repo (the games themselves aren't) — see
[Measuring it yourself](#measuring-it-yourself).

### Position estimation

Ward events carry no coordinates (see [Design notes](#design-notes)), so ward position must
be estimated from the placer's location. Accuracy is measured by **leave-one-out against
held-out ground truth**: every `CHAMPION_KILL` records the victim's exact coordinates at an
exact instant, so each death is removed from the anchor set, predicted, and compared to
truth. No death informs its own prediction.

| estimator | mean | median | p90 | within 1400u |
|---|---|---|---|---|
| baseline (60s frames only) | 1640 | 1041 | 3933 | 61.2% |
| **anchored (frames + event anchors)** | **1462** | **864** | **3536** | **66.5%** |

**Median error 1041 → 864 units (17.0% lower); mean 10.9% lower.**

Error is strongly a function of how far the nearest anchor is in time, which is what makes
a confidence gate possible. The p75 column is the calibration curve the rule uses:

| gap to nearest anchor | n | median err | p75 | p90 | worst-case bound |
|---|---|---|---|---|---|
| 0–2s | 375 | 201 | 418 | 727 | 900 |
| 2–5s | 451 | 437 | 778 | 1169 | 2250 |
| 5–10s | 540 | 727 | 1278 | 1823 | 4500 |
| 10–15s | 417 | 1173 | 1826 | 2932 | 6750 |
| 15–20s | 360 | 1682 | 3010 | 5500 | 9000 |
| 20–30s | 657 | 2072 | 3651 | 5428 | 13500 |

The worst-case bound (gap × max movement speed) is 2.2–3.7x the measured p75 error in every
row. Champions don't sprint in a straight line away from their last known point, so gating
on the bound throws away far more wards than it needs to.

### What that bought the rule

Three versions of the rule, run on the same **352 deaths** of the analyzed player:

| version | flagged | covered | abstained |
|---|---|---|---|
| naive: 60s frames, every ward trusted | 211 (59.9%) | 141 (40.1%) | 0 |
| gated on the worst-case bound | 20 (5.7%) | 9 (2.6%) | 323 (91.8%) |
| **gated on measured error (current)** | **133 (37.8%)** | **79 (22.4%)** | **140 (39.8%)** |

The naive version fires on nearly every death, which makes it useless. Gating on the
worst-case bound fails the other way: it refuses to judge 92% of deaths. Gating on the
measured curve cuts the flag rate from **59.9% to 37.8%**, positively *clears* 22.4% of
deaths, and abstains on 39.8%.

All three rows come from `npm run eval:rule`, which runs the rule's own code in each
configuration. On the original 16 games it reproduces the figures recorded while each
version was the live one (naive: 80 of 132 flagged; worst-case: 120 of 132 abstained).

### Honest limitations

- **Abstention is high (39.8%)** and that is the true cost of the missing ward coordinates.
  The rule stays silent rather than guessing. Reducing this requires better position
  estimation, not a looser threshold.
- **Precision is not yet measured.** The numbers above are estimator accuracy and decision
  rates — both machine-measurable. Whether a *flagged* death was genuinely a vision failure
  needs human judgement against a replay. Each match page has Right / Wrong / Can't tell
  buttons on every finding (saved to `labels.json`; `npm run score` reports precision), but
  the labels are not yet collected, so no precision figure is claimed here.
- **Ward lifetime is assumed, not observed.** `WARD_KILL` can't be matched to a specific
  ward, so wards expire on a timer. This biases toward assuming the player *had* vision.
- **Remakes are detected by game length.** The timeline has no remake flag, so games that
  ended before 5 minutes are skipped. `--games N` then reads further back through match history
  to replace them, looking at no more than 2N match IDs, so you still get N real games.

---

## Rules

| id | what it flags | needs position estimation? |
|---|---|---|
| `deaths-without-vision` | deaths with no friendly ward confidently live nearby | yes (gated) |
| `lane-differential` | gold/XP deficits vs. the lane opponent at 10 and 15 min | no |
| `died-with-unspent-gold` | deaths while carrying significant unspent gold | no |

The last two read `participantFrames` directly, so they are exact.

### Adding a rule

One new file and one registry line. No existing rule or engine code changes.

```ts
// src/lib/rules/rules/myRule.ts
export const myRule: Rule = {
  id: "my-rule",
  description: "What it looks for.",
  evaluate(ctx) { /* pure: ctx -> Finding[] */ return []; },
};
```

```ts
// src/lib/rules/registry.ts
export const rules: Rule[] = [ ...existing, myRule ];
```

---

## Design notes

**The ward-coordinate problem.** The obvious way to write "deaths without vision" is to
compare each death's coordinates to nearby ward coordinates. Inspecting a real timeline
before writing any rule logic showed that this is impossible:

```jsonc
// CHAMPION_KILL — exact coordinates ✓
{ "type":"CHAMPION_KILL", "timestamp":114953, "killerId":2, "victimId":6,
  "position":{ "x":1497, "y":12615 } }

// WARD_PLACED — who and when, but no position ✗
{ "type":"WARD_PLACED", "timestamp":17109, "creatorId":6, "wardType":"UNDEFINED" }
```

Riot records *who* placed a ward and *when*, never *where*. `wardType` is usually
`"UNDEFINED"`. So the rule as normally specified cannot be computed from this data at all.

**The response.** A ward is dropped at the champion who places it, so ward position is
estimated from the placer's position at that instant. Frames are only every 60 seconds,
which is far too coarse mid-fight — so the estimator also uses **event anchors**: kills,
deaths, objective takes and building kills all pin a champion to a known point at a known
time. Interpolating between those instead of between minute-marks is what produced the 17%
accuracy gain above.

**Confidence over coverage.** Estimated ward positions have a median error (864u) comparable
to the vision threshold itself (1400u), so a naive verdict is often noise. The rule
therefore emits a finding only when the underlying position estimate is trustworthy, and
**abstains otherwise**. A false accusation costs the player's trust; a missed one costs
nothing.

**A rejected idea, kept on the record.** `ITEM_PURCHASED` can only occur at the shop, so it
looked like a strong exact anchor at the fountain. Measured on the original 16 games, it made
median error *much* worse (954 → 2767u, against a frames-only baseline of 954u): linear interpolation from a fountain anchor drags estimates along a
straight line from spawn, but champions travel curved lane paths. It's noted in
`positionAnchors.ts` so it isn't rediscovered later.

---

## Architecture

```
src/app/         Next.js pages: home, player overview, single match
src/components/  the Rift map (SVG), match explorer, forms
src/lib/
  riot/          API client, config, rate limiter, timeline types
  cache/         disk cache for timelines + accounts
  timeline/      position estimation, champion names, game length/result
  rules/         Finding type, engine, registry, and the rules themselves
  analysis/      collecting a player's N real games (cache or live)
  report/        turning games into the plain data the pages render
  testing/       synthetic timeline builders for tests
scripts/         CLI entry points (analyze, eval, label, score, inspect)
cache/           fetched timelines, {matchId}.json  (gitignored)
```

The rule engine is **pure and framework-free**: `(timeline, puuid) => Finding[]`, no Next.js
imports, no I/O. It runs identically from a Node script or a server route, which is what
makes it testable and what makes the evaluation scripts possible.

Rate limiting respects both Riot dev-key windows (20 req/s and 100 req/2 min) via a sliding
window limiter, with 429/5xx retry on top. Timelines are cached to disk on first fetch and
never re-fetched.

---

## Commands

| command | what it does |
|---|---|
| `npm run analyze -- "<id>" [--games N] [--offline]` | analyze a player, print findings |
| `npm run analyze -- --list` | list cached accounts (offline-ready) |
| `npm run dev` | start the web UI at localhost:3000 |
| `npm test` | run the test suite (91 tests) |
| `npm run eval:position` | position accuracy vs. held-out ground truth |
| `npm run eval:uncertainty` | error as a function of anchor gap (calibration table) |
| `npm run eval:rule -- "<id>"` | flagged/covered/abstained for all three rule versions |
| `npm run label -- "<id>"` | write a `labels.json` worksheet to judge by hand (the match page buttons do the same; neither ever drops an existing answer) |
| `npm run score` | precision from the answers in `labels.json` |
| `npm run inspect` | dump a cached timeline's structure |

### Measuring it yourself

```bash
npm run eval:position      # the estimator table
npm run eval:uncertainty   # the calibration table
npm run eval:rule -- "gameName#tagLine"   # the three-version rule table
```

These run on whatever games are in your `/cache`. The tables above come from the author's 36
games, which aren't published, so your numbers will differ.

---

## Setup

1. `npm install`
2. `cp .env.local.example .env.local`
3. Add `RIOT_API_KEY` from [developer.riotgames.com](https://developer.riotgames.com/)
4. Set `RIOT_REGION` — `americas` (NA/BR/LAN/LAS), `europe` (EUW/EUNE/TR/RU),
   `asia` (KR/JP), or `sea` (OCE/SEA)

The key is server-side only and never reaches the client; `.env.local` is gitignored.
