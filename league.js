/**
 * league.js
 * ---------------------------------------------------------------------------
 * Turns "simulate a random opponent every time" into a real 20-team league:
 * persistent rival clubs, a proper double round-robin schedule (19 rivals x
 * 2 legs = 38 fixtures, one per game week), a live table, and a Golden Boot
 * race. This is what makes title races and relegation battles possible -
 * they're not scripted, they fall out of the same match engine being run
 * for every fixture in the division, every week.
 * ---------------------------------------------------------------------------
 */

import { createPlayer } from './attributes.js';
import { simulateMatch } from './match-engine.js';
import { generateManagerProfile, maybeSwitchTactic } from './manager-ai.js';
import { evaluateSackRisk } from './boardroom.js';
import { applyMatchStatsToPlayers } from './career.js';
import { assignBirthdate } from './calendar.js';

const RIVAL_NAMES = [
    'Ironbridge FC', 'Castlemoor Town', 'Redgate Athletic', 'Vale United', 'Harborne City',
    'Thornfield Rovers', 'Aldergate Wanderers', 'Kestrel Park', 'Millhaven Town', 'Oakcastle FC',
    'Brindlewood', 'Sable Harbour', 'Greymoor Athletic', 'Fenwick United', 'Stonebridge City',
    'Hollow Vale', 'Marchmont Rovers', 'Quillfield Town', 'Ashcombe United'
];

const SQUAD_TEMPLATE = [
    { position: 'GK', count: 2 },
    { position: 'CB', count: 4 },
    { position: 'FB', count: 4 },
    { position: 'CM', count: 5 },
    { position: 'LW', count: 3 },
    { position: 'ST', count: 3 }
]; // 21 players, 2+ per position - same depth as the human-managed club

/** Roll a fresh 20-team league: 19 rivals with real (persistent, full-depth) squads. */
export function generateRivals(referenceDate = new Date()) {
    return RIVAL_NAMES.map((name, idx) => {
        // Spread quality across the division so there's a real top/mid/bottom -
        // not every rival is the same strength.
        const tier = 3 + Math.round((idx / (RIVAL_NAMES.length - 1)) * 6) + (Math.random() < 0.5 ? -1 : 0);
        const baseTier = Math.max(2, Math.min(9, tier));
        const squad = [];
        let playerIdx = 0;
        SQUAD_TEMPLATE.forEach(({ position, count }) => {
            for (let i = 0; i < count; i++) {
                const roleOffset = i === 0 ? 1 : i === count - 1 ? -2 : 0;
                const qualityTier = Math.max(2, Math.min(9, baseTier + roleOffset + (Math.random() < 0.5 ? 0 : -1)));
                const age = 18 + Math.floor(Math.random() * 16);
                const player = createPlayer({
                    id: `${name}-${playerIdx}`, name: `${name.split(' ')[0]} ${position}${playerIdx}`,
                    position, age, qualityTier
                });
                // Real birthdate so rival-ai.js's weekly aging tick and
                // development.js's age-decline curve actually apply to
                // rivals, not just growth with no aging arc.
                player.birthdate = assignBirthdate(age, referenceDate);
                squad.push(player);
                playerIdx++;
            }
        });
        return {
            id: name, name, squad,
            tactic: ['possession', 'counter', 'press', 'defensive'][Math.floor(Math.random() * 4)],
            chemistry: 55 + Math.random() * 35,
            tacticalFamiliarity: 45 + Math.random() * 45,
            managerQuality: 40 + Math.random() * 50,
            budget: 5 + tier * 4 + Math.random() * 10,
            tier: baseTier, // used by rival-ai.js to scale replacement-signing quality to this club's level
            seasonFactor: 1.0,
            managerProfile: generateManagerProfile(),
            recentForm: []
        };
    });
}

/**
 * Roll each club's season-long over/underperformance factor. Call once at
 * the start of every season - this is THE lever for "no season feels
 * identical": the exact same squad can run hot one year, flat the next.
 */
export function rollSeasonFactors(clubs, yourClub) {
    clubs.forEach(c => { c.seasonFactor = 0.85 + Math.random() * 0.3; }); // 0.85 - 1.15
    if (yourClub) yourClub.seasonFactor = 0.9 + Math.random() * 0.2; // your club varies a bit less - still your squad, your tactics
}

/**
 * Standard circle-method double round-robin for n teams (n must be even).
 * Returns an array of 2*(n-1) rounds, each an array of [homeIdx, awayIdx] pairs.
 * With 20 teams this produces exactly 38 rounds - one per game week.
 */
export function generateSchedule(teamCount) {
    const teams = [...Array(teamCount).keys()];
    if (teamCount % 2 !== 0) teams.push(-1); // bye slot, not used here (we keep it even at 20)
    const n = teams.length;
    const rounds = [];
    const fixed = teams[0];
    let rotating = teams.slice(1);

    for (let r = 0; r < n - 1; r++) {
        const round = [];
        const all = [fixed, ...rotating];
        for (let i = 0; i < n / 2; i++) {
            const a = all[i], b = all[n - 1 - i];
            if (a !== -1 && b !== -1) {
                round.push(r % 2 === 0 ? [a, b] : [b, a]); // alternate home/away as rounds progress
            }
        }
        rounds.push(round);
        rotating.unshift(rotating.pop()); // rotate
    }

    // Second leg: same pairings, sides swapped.
    const secondLeg = rounds.map(round => round.map(([h, a]) => [a, h]));
    return [...rounds, ...secondLeg];
}

/** Fresh table row. */
function tableRow(id, name) {
    return { id, name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 };
}

export function initTable(yourClub, rivals) {
    const table = [tableRow('YOU', yourClub.name || 'Your Club'), ...rivals.map(r => tableRow(r.id, r.name))];
    return table;
}

function applyResult(table, homeId, awayId, homeGoals, awayGoals) {
    const home = table.find(t => t.id === homeId);
    const away = table.find(t => t.id === awayId);
    home.played++; away.played++;
    home.gf += homeGoals; home.ga += awayGoals;
    away.gf += awayGoals; away.ga += homeGoals;
    if (homeGoals > awayGoals) { home.won++; home.points += 3; away.lost++; }
    else if (awayGoals > homeGoals) { away.won++; away.points += 3; home.lost++; }
    else { home.drawn++; away.drawn++; home.points += 1; away.points += 1; }
}

/** Sort the table FM-style: points, then goal difference, then goals for. */
export function sortTable(table) {
    return [...table].sort((a, b) =>
        b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf
    );
}

/**
 * Simulate every fixture scheduled for this round. Your club's fixture is
 * simulated with full detail (events returned); the other 9 matches run
 * through the same engine "off-screen" so the table stays consistent with
 * how good those teams actually are - just without a play-by-play surfaced.
 *
 * @returns { yourResult, allResults, scorers: [{name, team, goals:1}] }
 */
export function simulateRound(round, teamsById, table, weather, isBigMatch = false, homeSubsForYou = [], awaySubsForYou = []) {
    const scorers = [];
    const boardroomEvents = [];
    let yourResult = null;
    let yourMatchResult = null;

    for (const [homeIdx, awayIdx] of round) {
        const homeTeam = teamsById[homeIdx];
        const awayTeam = teamsById[awayIdx];
        const involvesYou = homeTeam.id === 'YOU' || awayTeam.id === 'YOU';
        const result = simulateMatch({
            home: homeTeam, away: awayTeam, weather, isBigMatch,
            homeSubs: involvesYou && homeTeam.id === 'YOU' ? homeSubsForYou : [],
            awaySubs: involvesYou && awayTeam.id === 'YOU' ? awaySubsForYou : []
        });
        if (involvesYou) yourMatchResult = result;
        applyResult(table, homeTeam.id, awayTeam.id, result.homeGoals, result.awayGoals);
        applyMatchStatsToPlayers(result, homeTeam.squad, awayTeam.squad);

        // Track rival form for manager-ai reactions - skip 'YOU', app.js tracks that separately.
        const pushForm = (team, letter) => {
            if (team.id === 'YOU' || !team.recentForm) return;
            team.recentForm.push(letter);
            if (team.recentForm.length > 8) team.recentForm.shift();
        };
        if (result.homeGoals > result.awayGoals) { pushForm(homeTeam, 'W'); pushForm(awayTeam, 'L'); }
        else if (result.awayGoals > result.homeGoals) { pushForm(homeTeam, 'L'); pushForm(awayTeam, 'W'); }
        else { pushForm(homeTeam, 'D'); pushForm(awayTeam, 'D'); }

        result.events.filter(e => e.type === 'goal' && e.player).forEach(e => {
            scorers.push({ name: e.player, team: e.team === 'home' ? homeTeam.name : awayTeam.name });
        });

        if (homeTeam.id === 'YOU' || awayTeam.id === 'YOU') {
            yourResult = { ...result, homeTeam: homeTeam.name, awayTeam: awayTeam.name };
        }

        // Manager AI: each rival's persistent profile decides whether to react to their run of form.
        [homeTeam, awayTeam].forEach(team => {
            if (team.id !== 'YOU' && team.managerProfile) {
                team.tactic = maybeSwitchTactic(team);
            }
        });
    }

    // Boardroom pressure: evaluate every rival's job security now that the table is current.
    const sortedForBoardroom = sortTable(table);
    for (const rival of teamsById) {
        if (rival.id === 'YOU' || !rival.managerProfile) continue;
        const position = sortedForBoardroom.findIndex(t => t.id === rival.id) + 1;
        const event = evaluateSackRisk(rival, position, sortedForBoardroom.length, null);
        if (event) boardroomEvents.push({ club: rival.name, ...event });
    }

    return { yourResult, scorers, boardroomEvents, yourMatchResult };
}

/** Merge this round's scorers into a running Golden Boot leaderboard. */
export function updateGoldenBoot(leaderboard, scorers) {
    for (const s of scorers) {
        leaderboard[s.name] = (leaderboard[s.name] || 0) + 1;
    }
    return leaderboard;
}

export function topScorers(leaderboard, n = 5) {
    return Object.entries(leaderboard)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([name, goals]) => ({ name, goals }));
}
