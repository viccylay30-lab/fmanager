# Football Manager PWA — Upgrade Spec: COMPLETED

All 10 items from the original spec are done and individually tested (via
the Node harness pattern in the session that built them - copy app.js, fix
relative imports, export needed functions, mock document/localStorage,
run a real multi-season simulation before moving to the next item).

## Completed this session

- **3.1 Rival squad depth** - 21-player depth-chart squads for every rival, same structure as your own club.
- **1.1 Promotion/relegation** - real two-division system with a proper swap at season end. A genuine bug was caught and fixed: both divisions drew club names from the same fixed pool, causing ID collisions that silently corrupted the swap (rivals count drifted from 19 to 17 after 2 rollovers). Fixed with forced ID uniqueness per division.
- **1.2 European competition** - real qualification (Div 1 top 4 = Champions League, 5th-6th = Europa League) and an 8-team knockout bracket simulated through the actual match engine. No more cosmetic ticker.
- **1.3 Upcoming fixtures screen** - real dates, opponents, crests, home/away markers in the League tab.
- **2.1 remainder** - Golden Boot entries are now clickable, open the real player profile (own or rival player, looked up by name).
- **3.2 Crests everywhere** - Inbox bid/loan cards, rival scouting modal, league table, club header.
- **3.3 Chasing-the-game tied to your tactic** - your own aggression in "chasing the game" now derives from your selected tactic (press=18, counter=14, possession=10, defensive=6) instead of a flat neutral default.
- **2.2 Career history** - assists and per-match player ratings built from scratch (neither existed before), accumulated into permanent season-by-season, club-by-club career history shown in the player profile modal.
- **2.3 Influence-weighted awards** - end-of-season best player award weighted by contribution share + average rating + how far the club overperformed its expected station, not just raw rating. Verified: a striker on a small club that finished 1st despite low expectations correctly topped a strong club's players.
- **3.4 Contract renewals** - contracts count down and resolve (renew or expire) based on loyalty vs ambition. A genuine bug was caught and fixed: every player started with an identical 3-year contract, causing the entire squad to expire simultaneously and collapse from 21 to 7 players in one season. Fixed with randomized 1-4 year initial contract lengths.

## New files this session
`divisions.js`, `europe.js`, `career.js`, `awards.js`, `contracts.js` - all wired into `app.js`'s season-rollover flow and `league.js`'s match simulation choke point.

## Known simplifications / good next targets
- Europe uses a small fixed pool of one-off continental opponents, not a persistent European league structure.
- Contract renewal is fully automatic (no negotiation UI) - a player either re-signs or leaves, no user input.
- Awards are Division 1 only, matching real football's top-tier prestige competitions, by design.
- ~~No auto-replacement when a player's contract expires~~ - FIXED: a combined 8-season regression test surfaced a real risk (squad dropped to 1 GK, 1 CB - one injury from unplayable). Added a minimum-viable-squad-depth safety net that auto-signs free-agent backfills at season rollover if any position drops below a functional minimum (GK≥2, CB≥2, FB≥2, CM≥2, LW≥1, ST≥2). Verified clean across 10 full seasons - squad settles at a stable ~12 players, never below minimum, while still preserving real pressure to actively manage transfers for anything beyond bare-minimum depth.

## Rival AI squad management (added after initial spec completion)

Rivals were previously completely static - contracts never expired, no
replacements were ever signed, and no club ever bought or sold a player.
Built `rival-transfers.js` to fix this:

- **Rival contract expiry** - same `tickContract` logic as your squad, now applied to every rival.
- **Gap-filling replacement signings** - if contract expiry drops a position below a viable minimum, the club signs a free-agent replacement scaled to its budget.
- **Rival-to-rival transfers** - up to 4 AI-to-AI deals per division per season, a club with a genuine gap buying from a club with genuine surplus at that position.

Two real bugs caught and fixed during testing:
1. The gap-detection used `.find()` on `Object.entries()`, which always returned GK first (since GK sits at its minimum of 2 almost universally) - meaning every buyer only ever "looked for" a GK, and since GK surplus essentially never exists, **zero transfers ever executed** despite real surplus existing at other positions (confirmed directly in test output - CB:4, CM:5 surplus visible while GK masked it). Fixed by checking all gap positions per buyer, not just the first.
2. After fixing #1, the same player was found transferring **three times within a single window**, bouncing between three different clubs - nothing stopped an already-sold player from being re-selected as "weakest at position" on their new club within the same function call. Fixed with an `alreadyMoved` set tracked per call.

Verified clean across 8 seasons: 48 real rival-to-rival transfers, zero
double-moves, squads never below viable minimum, and news events correctly
prioritized in the boardroom feed (transfers over routine squad refreshes).

## Transfer window overhaul (self-critique → fixes)

After building the transfer/loan/rival-transfer systems, a self-assessment
identified 5 real weaknesses. All fixed and tested:

1. **Winter window had zero rival-to-rival activity** - transfers only ran once/year at season rollover (representing summer only). Moved to a weekly check during any open window. Verified: 28 winter-window transfers over 3 seasons (previously 0).
2. **Volume too low** - was ~6 transfers/season across the whole league. Now runs weekly with a 35% chance (90% during deadline week) instead of once/year. Verified: 52 transfers over 3 seasons (~17/season), a ~3x increase.
3. **No negotiation depth** - bids were one-shot accept/reject. Added a "Counter" button (15% above market value) that the rival accepts or rejects based on their budget and a realism-preserving probability - never a guaranteed yes even within budget. Verified: ~58% acceptance on a reasonable counter, 0% on an unreasonable one.
4. **Loans and transfers didn't know about each other** - a club could theoretically target a player currently out on loan elsewhere. Added `onLoanAt` exclusion to both incoming-bid generation and rival-to-rival transfer target selection. Verified directly: 200 bid-generation rolls against a forced-on-loan player, zero bids generated.
5. **No deadline day spike** - added `isDeadlineWeek()` (final week of each window) which roughly triples incoming-bid probability, doubles loan-request probability, and pushes rival-transfer activity from 35% to 90% weekly chance with a higher deal cap. Confirmed: 40 of 52 transfers in the 3-season test landed specifically in deadline weeks.

Final 5-season combined regression: clean, no crashes, no rival ever dropped below viable squad depth despite the higher transfer volume.
