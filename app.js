import { createPlayer, scoutingReport } from './attributes.js';
import { weeklyInjuryCheck, tickRecovery, injuryProfileLabel } from './injuries.js';
import { developPlayer, computeMarketValue } from './development.js';
import { generateRivals, rollSeasonFactors, generateSchedule, initTable, simulateRound, updateGoldenBoot, topScorers, sortTable } from './league.js';
import { detectNarratives, recordFormLetter, isGiantKilling } from './narrative.js';
import { seasonStartDate, weekToDate, formatMatchDate, isTransferWindowOpen, assignBirthdate, isBirthdayInRange } from './calendar.js';
import { generateIncomingBids, describeBidOutcome } from './transfers.js';
import { generateLoanRequests, sendOnLoan, tickLoanedPlayer, checkLoanReturn } from './loans.js';
import { evaluateYourJobSecurity } from './boardroom.js';

const BASE_YEAR = 2026; // Season 1 kicks off the real upcoming season, August 2026

function withBirthdate(player) {
    player.birthdate = assignBirthdate(player.age, seasonStartDate(1, BASE_YEAR));
    return player;
}

const STORAGE_KEY = 'fm_30yr_pwa_state_v2'; // bumped: v1 saves predate the attribute system

function freshSquad() {
    // Same headline names as before, now built as full FM-style attribute players.
    const roster = [
        { id: 1, name: 'Marcus Vance', age: 24, position: 'ST', qualityTier: 8 },
        { id: 2, name: 'Declan Cole', age: 27, position: 'CM', qualityTier: 8 },
        { id: 3, name: 'Lucas Silva', age: 33, position: 'CB', qualityTier: 7 },
        { id: 4, name: 'Samir Nasri Jr', age: 21, position: 'LW', qualityTier: 6 },
        { id: 5, name: 'Jordan Pick', age: 30, position: 'GK', qualityTier: 7 },
        { id: 6, name: 'Theo Marsh', age: 25, position: 'CB', qualityTier: 6 },
        { id: 7, name: 'Owen Petit', age: 22, position: 'FB', qualityTier: 6 },
        { id: 8, name: 'Rafael Costa', age: 29, position: 'CM', qualityTier: 7 }
    ];
    return roster.map(r => {
        const p = createPlayer(r);
        p.scoutKnowledge = 95; // you know your own players well - no scouting fog on your squad
        p.birthdate = assignBirthdate(r.age, seasonStartDate(1, BASE_YEAR));
        return p;
    });
}

const DEFAULT_STATE = {
    season: 1,
    week: 1,
    budget: 50.0,
    morale: 100,
    facilities: 12,
    coachingQuality: 12,
    tactic: 'possession',
    chemistry: 68,
    tacticalFamiliarity: 55,
    managerQuality: 72,
    leaguePoints: 0,
    leaguePosition: 7,
    rivals: null,       // populated on first load by initLeagueIfNeeded()
    schedule: null,     // 38-round double round-robin, index 0 = your club
    table: null,
    goldenBoot: {},
    recentForm: [],     // last 8 results as 'W'/'D'/'L', for club-crisis detection
    lastPlayedWeek: 0,  // guards against double-simulating the same round
    pendingBids: [],
    pendingLoanRequests: [],
    boardroomFeed: [],
    squadReputation: 100, // rough proxy for "how big a club are you" - used to judge personal-terms appeal
    competitions: {
        league: "Championship (7th)",
        cup: "3rd Round",
        europe: "UEL (League Stage)"
    },
    squad: freshSquad(),
    transferMarket: [
        withBirthdate(createPlayer({ id: 101, name: 'Kylian Jr', age: 19, position: 'ST', qualityTier: 8 })),
        withBirthdate(createPlayer({ id: 102, name: 'Mateo Pedri', age: 22, position: 'CM', qualityTier: 7 }))
    ]
};

let gameState = loadState();
initLeagueIfNeeded();

function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    // Migration safety net for any future field additions.
    if (!parsed.competitions) parsed.competitions = { ...DEFAULT_STATE.competitions };
    if (typeof parsed.facilities !== 'number') parsed.facilities = 12;
    if (typeof parsed.coachingQuality !== 'number') parsed.coachingQuality = 12;
    if (typeof parsed.tactic !== 'string') parsed.tactic = 'possession';
    if (typeof parsed.chemistry !== 'number') parsed.chemistry = 68;
    if (typeof parsed.tacticalFamiliarity !== 'number') parsed.tacticalFamiliarity = 55;
    if (typeof parsed.managerQuality !== 'number') parsed.managerQuality = 72;
    if (typeof parsed.leaguePoints !== 'number') parsed.leaguePoints = 0;
    if (typeof parsed.leaguePosition !== 'number') parsed.leaguePosition = 7;
    if (!Array.isArray(parsed.pendingBids)) parsed.pendingBids = [];
    if (!Array.isArray(parsed.pendingLoanRequests)) parsed.pendingLoanRequests = [];
    if (!Array.isArray(parsed.boardroomFeed)) parsed.boardroomFeed = [];
    if (typeof parsed.squadReputation !== 'number') parsed.squadReputation = 100;
    parsed.squad.forEach(p => {
        if (!p.birthdate) p.birthdate = assignBirthdate(p.age, weekToDate(parsed.season, parsed.week, BASE_YEAR));
    });
    return parsed;
}

function saveGameState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState));
    updateUI();
}

function club() {
    return { facilities: gameState.facilities, coachingQuality: gameState.coachingQuality };
}

function homeTeam() {
    return {
        id: 'YOU', name: 'Your Club', squad: gameState.squad.filter(p => !p.onLoanAt), tactic: gameState.tactic,
        chemistry: gameState.chemistry, tacticalFamiliarity: gameState.tacticalFamiliarity,
        managerQuality: gameState.managerQuality
    };
}

function initLeagueIfNeeded() {
    if (gameState.rivals && gameState.schedule && gameState.table) return;
    gameState.rivals = generateRivals();
    rollSeasonFactors(gameState.rivals, homeTeam());
    gameState.schedule = generateSchedule(20); // index 0 = your club, 1-19 = rivals in generateRivals() order
    gameState.table = initTable(homeTeam(), gameState.rivals);
    gameState.goldenBoot = {};
    gameState.recentForm = [];
    gameState.lastPlayedWeek = 0;
}

/** Build the index-0..19 team array the schedule references, index 0 always your live squad. */
function teamsById() {
    return [homeTeam(), ...gameState.rivals];
}

const WEATHER_OPTIONS = ['clear', 'clear', 'clear', 'rain', 'wind', 'heat'];

function updateUI() {
    document.getElementById('stat-season').textContent = gameState.season;
    document.getElementById('stat-week').textContent = `${gameState.week}/38`;
    const currentDate = weekToDate(gameState.season, gameState.week, BASE_YEAR);
    document.getElementById('stat-date').textContent = formatMatchDate(currentDate);
    const windowType = isTransferWindowOpen(currentDate);
    document.getElementById('window-status').textContent = windowType
        ? `${windowType === 'summer' ? 'Summer' : 'Winter'} window OPEN` : 'Window closed';
    document.getElementById('stat-budget').textContent = `£${gameState.budget.toFixed(1)}M`;
    document.getElementById('stat-morale').textContent = `${gameState.morale}%`;

    document.getElementById('comp-league').textContent = gameState.competitions.league;
    document.getElementById('comp-cup').textContent = gameState.competitions.cup;
    document.getElementById('comp-europe').textContent = gameState.competitions.europe;

    const squadContainer = document.getElementById('squad-list');
    squadContainer.innerHTML = '';
    gameState.squad.forEach(player => squadContainer.appendChild(createPlayerCard(player, false)));

    const transferContainer = document.getElementById('transfer-list');
    transferContainer.innerHTML = '';
    gameState.transferMarket.forEach(player => transferContainer.appendChild(createPlayerCard(player, true)));

    renderLeagueTable();
    renderGoldenBoot();
    renderStoryFeed(false);
    renderInbox();
}

function renderInbox() {
    const bidList = document.getElementById('bid-list');
    const loanList = document.getElementById('loan-list');
    if (!bidList || !loanList) return;

    bidList.innerHTML = gameState.pendingBids.length === 0
        ? '<p class="subtext">No active bids for your players.</p>'
        : gameState.pendingBids.map(bid => `
            <div class="decision-card">
                <div class="headline">${bid.rivalName} bid £${bid.offerAmount}M for ${bid.playerName}</div>
                <div class="detail">Market value ~£${bid.marketValue}M${bid.personalTermsAgreed ? ' | Personal terms already agreed with the player' : ''}</div>
                <div class="btn-row">
                    <button class="accept-btn" data-bid="${bid.id}" data-action="accept">Accept</button>
                    <button class="reject-btn" data-bid="${bid.id}" data-action="reject">Reject</button>
                </div>
            </div>`).join('');

    loanList.innerHTML = gameState.pendingLoanRequests.length === 0
        ? '<p class="subtext">No loan requests for your players.</p>'
        : gameState.pendingLoanRequests.map(req => `
            <div class="decision-card">
                <div class="headline">${req.rivalName} want ${req.playerName} on loan</div>
                <div class="detail">${req.durationWeeks >= 38 ? 'Season-long' : 'Half-season'} loan, no fee</div>
                <div class="btn-row">
                    <button class="accept-btn" data-loan="${req.id}" data-action="accept">Accept</button>
                    <button class="reject-btn" data-loan="${req.id}" data-action="reject">Reject</button>
                </div>
            </div>`).join('');

    bidList.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => resolveBid(btn.getAttribute('data-bid'), btn.getAttribute('data-action') === 'accept'));
    });
    loanList.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => resolveLoan(btn.getAttribute('data-loan'), btn.getAttribute('data-action') === 'accept'));
    });
}

function resolveBid(bidId, accept) {
    const bid = gameState.pendingBids.find(b => b.id === bidId);
    if (!bid) return;
    const outcome = describeBidOutcome(bid, accept);

    if (accept) {
        const player = gameState.squad.find(p => p.id === bid.playerId);
        gameState.squad = gameState.squad.filter(p => p.id !== bid.playerId);
        gameState.budget += bid.offerAmount;
        if (player) triggerAIEvent(player, 'TRANSFER_OUT', outcome.headline);
    } else {
        const player = gameState.squad.find(p => p.id === bid.playerId);
        if (player) {
            player.morale = Math.max(1, player.morale + outcome.moraleDelta);
        }
    }

    gameState.pendingBids = gameState.pendingBids.filter(b => b.id !== bidId);
    showModal(accept ? 'Transfer Accepted' : 'Bid Rejected', outcome.headline);
    saveGameState();
}

function resolveLoan(loanId, accept) {
    const req = gameState.pendingLoanRequests.find(r => r.id === loanId);
    if (!req) return;

    if (accept) {
        const player = gameState.squad.find(p => p.id === req.playerId);
        if (player) {
            sendOnLoan(player, req, gameState.week);
            showModal('Loan Agreed', `${player.name} joins ${req.rivalName} on loan.`);
        }
    } else {
        showModal('Loan Declined', `${req.rivalName}'s loan request for ${req.playerName} was turned down.`);
    }

    gameState.pendingLoanRequests = gameState.pendingLoanRequests.filter(r => r.id !== loanId);
    saveGameState();
}

function starString(stars) {
    const full = Math.floor(stars);
    const half = stars - full >= 0.5;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
}

function createPlayerCard(player, isMarket) {
    const card = document.createElement('div');
    card.className = 'player-card';

    const report = scoutingReport(player);
    const price = isMarket ? computeMarketValue(player) : null;

    let statusTag = '';
    if (player.isInjured) {
        statusTag = `<span class="trait-tag" style="color:var(--accent-danger)">Injured (${player.injuryWeeksRemaining}w)</span>`;
    } else if (player.isFatigued) {
        statusTag = `<span class="trait-tag" style="color:var(--accent-warning)">Fatigued</span>`;
    }

    card.innerHTML = `
        <div class="player-info">
            <div class="player-name-row">
                <span class="player-pos-badge">${player.position}</span>
                <span class="player-name">${player.name}</span>
            </div>
            <div class="player-meta">
                <span>Age: ${player.age}</span>
                <span class="trait-tag" title="${report.confidence} scouting confidence">${report.band}</span>
                ${statusTag}
                ${isMarket ? `<span>Cost: £${price}M</span>` : `<span title="${injuryProfileLabel(player)}">${injuryProfileLabel(player)}</span>`}
            </div>
        </div>
        <div class="player-rating" title="Scout rating - true ability is never shown directly">${starString(report.stars)}</div>
    `;
    if (isMarket) {
        card.addEventListener('click', () => buyPlayer(player));
    }
    return card;
}

async function triggerAIEvent(player, type, context) {
    const ticker = document.getElementById('breaking-news-ticker');
    const tickerText = document.getElementById('ticker-text');
    const rulingDisplay = document.getElementById('ai-ruling-display');

    ticker.classList.remove('hidden');
    tickerText.textContent = `Connecting to Sky Sports & FA Disciplinary Stream for ${player.name} (${type})...`;

    try {
        const response = await fetch('/api/generate-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player, type, context, gameState })
        });

        if (!response.ok) throw new Error('Network response failed');
        const data = await response.json();

        tickerText.textContent = data.mediaHeadline;
        rulingDisplay.innerHTML = `<strong>${data.mediaHeadline}</strong><br><br>${data.newsReport}<br><br><em>Ruling:</em> ${data.officialRuling}`;
        showModal(data.mediaHeadline, data.officialRuling);

    } catch (err) {
        console.error('AI Synchronization Error:', err);
        tickerText.textContent = 'OFFLINE MODE: Local Media engine active. FA Committee reviewing incidents locally.';
        rulingDisplay.textContent = `Local Sanction: Warning issued regarding ${player.name}'s recent conduct under 2026/27 rules.`;
    }
}

// FA Cup round checkpoints, keyed by the week they kick in
const CUP_ROUNDS = [
    { week: 12, label: '4th Round' },
    { week: 18, label: '5th Round' },
    { week: 24, label: 'Quarter-Final' },
    { week: 30, label: 'Semi-Final' },
    { week: 36, label: 'Final' }
];

function advanceWeek() {
    // Safety net: if the manager forgot to hit "Play Fixture" this week, play it now so no round is skipped.
    if (gameState.lastPlayedWeek !== gameState.week) {
        playFixture();
    }

    const prevDate = weekToDate(gameState.season, gameState.week, BASE_YEAR);
    gameState.week++;
    const currentDate = weekToDate(gameState.season, gameState.week, BASE_YEAR);
    const windowType = isTransferWindowOpen(currentDate);

    const isEuropeWeek = gameState.week % 4 === 0;
    const isMonthTick = gameState.week % 4 === 0; // reuse the same 4-week cadence as a "month" for development

    gameState.squad.forEach(p => {
        // Real-world aging: increment age exactly on the player's actual birthday, not a blanket season bump.
        if (isBirthdayInRange(p.birthdate, prevDate, currentDate)) {
            p.age += 1;
        }

        if (p.onLoanAt) {
            tickLoanedPlayer(p);
            const returnedFrom = checkLoanReturn(p, gameState.week);
            if (returnedFrom) {
                showModal('Loan Spell Ended', `${p.name} has returned from ${returnedFrom}.`);
            }
        }

        p.isFatigued = isEuropeWeek && !p.isInjured;

        // --- Injury system: one weekly probabilistic check per player ---
        if (p.isInjured) {
            tickRecovery(p);
        } else {
            weeklyInjuryCheck(
                p,
                { matchLoad: isEuropeWeek ? 2 : 1, trainingIntensity: 'normal' },
                { season: gameState.season, week: gameState.week }
            );
        }

        // --- Development: monthly, non-linear CA/PA growth roll ---
        if (isMonthTick) {
            developPlayer(p, club(), { season: gameState.season, week: gameState.week });
        }
    });

    // --- Transfer window activity: incoming bids and loan requests ---
    if (windowType) {
        const newBids = generateIncomingBids(gameState, windowType);
        const newLoans = generateLoanRequests(gameState, windowType);
        gameState.pendingBids = [...gameState.pendingBids, ...newBids].slice(-8);
        gameState.pendingLoanRequests = [...gameState.pendingLoanRequests, ...newLoans].slice(-8);
        if (newBids.length > 0) {
            showModal('Transfer Interest', `${newBids.length} new bid(s) received - check your Inbox.`);
        }
    }

    if (isEuropeWeek) {
        gameState.competitions.europe = `UEL (Matchday ${gameState.week / 4}/8)`;
    }

    const cupCheckpoint = CUP_ROUNDS.find(r => r.week === gameState.week);
    if (cupCheckpoint) {
        gameState.competitions.cup = cupCheckpoint.label;
    }

    if (gameState.week % 5 === 0 && gameState.squad.length > 0) {
        const randomPlayer = gameState.squad[Math.floor(Math.random() * gameState.squad.length)];
        triggerAIEvent(randomPlayer, 'CONDUCT_REVIEW', 'Routine mid-season behavioral check.');
    }

    if (gameState.week > 38) {
        gameState.week = 1;
        gameState.season++;
        gameState.competitions.cup = DEFAULT_STATE.competitions.cup;
        gameState.competitions.europe = DEFAULT_STATE.competitions.europe;
        gameState.leaguePoints = 0;
        gameState.squad.forEach(p => { p.isFatigued = false; });

        // New season: fresh schedule, reset table, re-roll every club's season-long
        // over/underperformance factor - this is what keeps seasons from feeling identical.
        // Rival clubs and their manager-ai profiles PERSIST across seasons (a manager's
        // personality doesn't reset every year) - only the season-scoped state resets.
        rollSeasonFactors(gameState.rivals, homeTeam());
        gameState.rivals.forEach(r => { r.recentForm = []; });
        gameState.schedule = generateSchedule(20);
        gameState.table = initTable(homeTeam(), gameState.rivals);
        gameState.goldenBoot = {};
        gameState.recentForm = [];
        gameState.lastPlayedWeek = 0;

        if (gameState.season > 30) {
            showModal('Career Completed', 'You have successfully completed 30 glorious years as an Elite Football Manager!');
            gameState.season = 30;
        } else {
            showModal('New Season Started!', `Welcome to Season ${gameState.season + 2025}/26 campaign. Player aging and development metrics calculated.`);
        }
    }
    saveGameState();
}

function playFixture() {
    if (gameState.lastPlayedWeek === gameState.week) {
        showModal('Already Played', `This week's fixture is done - advance to Week ${gameState.week + 1} to play the next one.`);
        return;
    }

    const round = gameState.schedule[gameState.week - 1];
    const teams = teamsById();
    const weather = WEATHER_OPTIONS[Math.floor(Math.random() * WEATHER_OPTIONS.length)];
    const isBigMatch = gameState.competitions.cup.includes('Final') || gameState.competitions.cup.includes('Semi') ||
        gameState.competitions.europe.includes('8/8');

    const { yourResult, scorers, boardroomEvents } = simulateRound(round, teams, gameState.table, weather, isBigMatch);
    updateGoldenBoot(gameState.goldenBoot, scorers);
    if (boardroomEvents && boardroomEvents.length > 0) {
        gameState.boardroomFeed = [...boardroomEvents, ...gameState.boardroomFeed].slice(0, 10);
    }

    // Everyone fit plays 90 - this game is abstracted at squad level, not a full lineup screen.
    gameState.squad.forEach(p => {
        if (p.isInjured || p.onLoanAt) return;
        p.recentMinutes = (p.recentMinutes || 0) + 90;
        p.appearances = (p.appearances || 0) + 1;
        p.fitness = Math.max(4, p.fitness - 2);
        p.sharpness = Math.min(20, p.sharpness + 1);
    });

    const youWereHome = yourResult.homeTeam === 'Your Club';
    const yourGoals = youWereHome ? yourResult.homeGoals : yourResult.awayGoals;
    const oppGoals = youWereHome ? yourResult.awayGoals : yourResult.homeGoals;
    const outcome = yourGoals > oppGoals ? 'W' : yourGoals < oppGoals ? 'L' : 'D';
    recordFormLetter(gameState.recentForm, outcome);

    if (outcome === 'W') {
        gameState.squad.forEach(p => { p.morale = Math.min(20, p.morale + 1); p.form = Math.min(20, p.form + 1); });
    } else if (outcome === 'L') {
        gameState.squad.forEach(p => { p.morale = Math.max(1, p.morale - 1); p.form = Math.max(1, p.form - 1); });
    }

    // Figure out which rival you actually played, for giant-killing detection.
    const opponentPair = round.find(([h, a]) => h === 0 || a === 0);
    const opponentTeam = teams[opponentPair[0] === 0 ? opponentPair[1] : opponentPair[0]];
    const giantKilling = isBigMatch && isGiantKilling(gameState.squad, opponentTeam.squad, outcome === 'W');

    const sorted = sortTable(gameState.table);
    const yourStanding = sorted.findIndex(t => t.id === 'YOU') + 1;
    gameState.leaguePosition = yourStanding;
    gameState.leaguePoints = sorted.find(t => t.id === 'YOU').points;
    gameState.competitions.league = `League (${yourStanding}${ordinalSuffix(yourStanding)})`;

    const scoreLine = `${yourResult.homeTeam} ${yourResult.homeGoals} - ${yourResult.awayGoals} ${yourResult.awayTeam}`;
    document.getElementById('ticker-text').textContent = scoreLine;
    document.getElementById('ai-ruling-display').innerHTML =
        `<strong>${scoreLine}</strong><br>xG: ${yourResult.homeXG} - ${yourResult.awayXG} | Weather: ${weather}<br><br>Result: ${outcome === 'W' ? 'WIN' : outcome === 'D' ? 'DRAW' : 'LOSS'} | Now ${yourStanding}${ordinalSuffix(yourStanding)} in the table`;
    document.getElementById('breaking-news-ticker').classList.remove('hidden');
    showModal('Full Time', scoreLine + (giantKilling ? ' — GIANT KILLING!' : ''));

    const goalEvent = yourResult.events.find(e => (youWereHome ? e.team === 'home' : e.team === 'away') && e.type === 'goal');
    if (goalEvent) {
        const scorer = gameState.squad.find(p => p.name === goalEvent.player);
        if (scorer) triggerAIEvent(scorer, 'MATCHDAY_INCIDENT', `Scored in a ${yourResult.homeGoals}-${yourResult.awayGoals} match, weather: ${weather}.`);
    }

    gameState.lastPlayedWeek = gameState.week;
    renderStoryFeed(giantKilling);
    saveGameState();
}

function renderStoryFeed(giantKilling) {
    const stories = detectNarratives({
        table: gameState.table, week: gameState.week, season: gameState.season,
        recentForm: gameState.recentForm, goldenBoot: gameState.goldenBoot,
        yourSquad: gameState.squad, lastMatchWasCupUpset: giantKilling
    });
    const feed = document.getElementById('story-feed');
    if (!feed) return;

    const jobSecurity = evaluateYourJobSecurity(gameState);
    const securityCard = `<div class="story-card" style="border-left-color:${jobSecurity.securityPct <= 45 ? 'var(--accent-danger)' : 'var(--accent-warning)'}">
        <div class="headline">Your job security: ${jobSecurity.status} (${jobSecurity.securityPct}%)</div>
        <div class="detail">${jobSecurity.streak} games without a win${jobSecurity.inRelegationZone ? ' | In the relegation zone' : ''}</div>
    </div>`;

    const boardroomCards = gameState.boardroomFeed.slice(0, 5).map(e =>
        `<div class="story-card"><div class="headline">${e.headline}</div><div class="detail">${e.detail || ''}</div></div>`
    ).join('');

    const storyCards = stories.length === 0
        ? '<p class="subtext">No major storylines yet this season.</p>'
        : stories.map(s => `<div class="story-card"><div class="headline">${s.headline}</div><div class="detail">${s.detail}</div></div>`).join('');

    feed.innerHTML = securityCard + boardroomCards + storyCards;
}

function renderLeagueTable() {
    const container = document.getElementById('league-table');
    if (!container || !gameState.table) return;
    const sorted = sortTable(gameState.table);
    const rows = sorted.map((t, i) => `
        <tr class="${t.id === 'YOU' ? 'you-row' : ''}">
            <td>${i + 1}</td><td>${t.name}</td><td>${t.played}</td>
            <td>${t.gf - t.ga}</td><td>${t.points}</td>
        </tr>`).join('');
    container.innerHTML = `<table><thead><tr><th>#</th><th>Club</th><th>P</th><th>GD</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderGoldenBoot() {
    const container = document.getElementById('golden-boot-list');
    if (!container) return;
    const scorers = topScorers(gameState.goldenBoot, 5);
    container.innerHTML = scorers.length === 0
        ? '<p class="subtext">No goals recorded yet.</p>'
        : scorers.map(s => `<div class="player-card"><div class="player-info"><div class="player-name">${s.name}</div></div><div class="player-rating">${s.goals}</div></div>`).join('');
}

function ordinalSuffix(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

function buyPlayer(player) {
    const price = computeMarketValue(player);
    if (gameState.budget >= price) {
        gameState.budget -= price;
        gameState.transferMarket = gameState.transferMarket.filter(p => p.id !== player.id);
        player.scoutKnowledge = 95; // fully known once he's your player
        gameState.squad.push(player);
        triggerAIEvent(player, 'TRANSFER_IN', 'Player successfully acquired on the transfer market.');
        saveGameState();
    } else {
        showModal('Transfer Failed', `Insufficient funds - this deal needs £${price}M.`);
    }
}

function showModal(title, body) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').textContent = body;
    document.getElementById('alert-overlay').classList.remove('hidden');
}

document.querySelectorAll('.tab-trigger').forEach(button => {
    button.addEventListener('click', () => {
        document.querySelectorAll('.tab-trigger').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        button.classList.add('active');
        document.getElementById(button.getAttribute('data-target')).classList.add('active');
    });
});

document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('alert-overlay').classList.add('hidden');
});

document.getElementById('btn-advance-week').addEventListener('click', advanceWeek);
document.getElementById('btn-simulate-match').addEventListener('click', playFixture);
document.getElementById('btn-scout-market').addEventListener('click', () => {
    gameState.budget -= 0.5;
    const tier = 3 + Math.floor(Math.random() * 7);
    const positions = ['ST', 'CM', 'CB', 'LW', 'FB', 'GK'];
    const candidate = createPlayer({
        id: 'scout' + Date.now(),
        name: 'Prospect ' + Math.floor(Math.random() * 900),
        age: 17 + Math.floor(Math.random() * 8),
        position: positions[Math.floor(Math.random() * positions.length)],
        qualityTier: tier
    });
    // Scouting uncertainty: a fresh, cheaply-scouted prospect starts with low
    // scoutKnowledge, so the star rating shown may be well off their true CA.
    candidate.scoutKnowledge = 15 + Math.floor(Math.random() * 25);
    candidate.birthdate = assignBirthdate(candidate.age, weekToDate(gameState.season, gameState.week, BASE_YEAR));
    gameState.transferMarket.push(candidate);
    saveGameState();
});

updateUI();
