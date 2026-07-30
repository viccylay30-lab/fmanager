import { createPlayer, scoutingReport } from './attributes.js';
import { weeklyInjuryCheck, tickRecovery, injuryProfileLabel } from './injuries.js';
import { developPlayer, computeMarketValue } from './development.js';
import { generateRivals, rollSeasonFactors, generateSchedule, initTable, simulateRound, updateGoldenBoot, topScorers, sortTable } from './league.js';
import { detectNarratives, recordFormLetter, isGiantKilling } from './narrative.js';
import { seasonStartDate, weekToDate, formatMatchDate, isTransferWindowOpen, isDeadlineWeek, assignBirthdate, isBirthdayInRange } from './calendar.js';
import { generateIncomingBids, describeBidOutcome, counterBid } from './transfers.js';
import { generateLoanRequests, sendOnLoan, tickLoanedPlayer, checkLoanReturn } from './loans.js';
import { evaluateYourJobSecurity } from './boardroom.js';
import { generateIndependentDivision, simulateIndependentRound, applyPromotionRelegation } from './divisions.js';
import { checkQualification, generateEuropeanBracket, playBracketFixture } from './europe.js';
import { closeOutPlayerSeason } from './career.js';
import { computeSeasonAwards } from './awards.js';
import { tickContract } from './contracts.js';
import { tickRivalSquadContracts, fillSquadGaps, replenishBudget, simulateRivalTransferWindow } from './rival-transfers.js';

const BASE_YEAR = 2026; // Season 1 kicks off the real upcoming season, August 2026

function withBirthdate(player) {
    player.birthdate = assignBirthdate(player.age, seasonStartDate(1, BASE_YEAR));
    return player;
}

/** Simple generated "logo": a hash-based color + initial, since there's no image asset pipeline. */
function crestHtml(clubName) {
    let hash = 0;
    for (let i = 0; i < clubName.length; i++) hash = clubName.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    const initial = clubName.trim()[0] || '?';
    return `<span class="crest" style="background:hsl(${hue},55%,40%)">${initial}</span>`;
}

const PRESET_CLUBS = [
    { name: 'Riverside United', tier: 8, reputation: 150, desc: 'Established top-flight club, big expectations' },
    { name: 'Ashford Town', tier: 6, reputation: 100, desc: 'Solid mid-table club, room to grow' },
    { name: 'Millbrook FC', tier: 4, reputation: 60, desc: 'Newly promoted underdogs, low expectations' }
];

const STORAGE_KEY = 'fm_30yr_pwa_state_v2'; // bumped: v1 saves predate the attribute system

const SQUAD_TEMPLATE = [
    { position: 'GK', count: 2 },
    { position: 'CB', count: 4 },
    { position: 'FB', count: 4 },
    { position: 'CM', count: 5 },
    { position: 'LW', count: 3 },
    { position: 'ST', count: 3 }
]; // 21 players total, 2+ at every position - a real squad, not a skeleton

const FIRST_NAMES = ['Marcus', 'Declan', 'Lucas', 'Samir', 'Jordan', 'Theo', 'Owen', 'Rafael', 'Kwabena', 'Milo', 'Andres', 'Femi', 'Callum', 'Nico', 'Ezra', 'Dante', 'Kofi', 'Aleksander', 'Ruben', 'Tobias', 'Ivo'];
const LAST_NAMES = ['Vance', 'Cole', 'Silva', 'Nasri', 'Pick', 'Marsh', 'Petit', 'Costa', 'Owusu', 'Bergman', 'Reyes', 'Adeyemi', 'Whitfield', 'Rossi', 'Adler', 'Moreau', 'Boateng', 'Novak', 'Diaz', 'Lindqvist', 'Santos'];

function generateSquadForClub(baseTier) {
    let nameIdx = 0;
    const players = [];
    let id = 1;

    SQUAD_TEMPLATE.forEach(({ position, count }) => {
        for (let i = 0; i < count; i++) {
            // First player at each position is the starter (above club average),
            // last is fringe depth (below average) - real squads have a spine and a bench.
            const roleOffset = i === 0 ? 1 : i === count - 1 ? -2 : 0;
            const qualityTier = Math.max(2, Math.min(9, baseTier + roleOffset + (Math.random() < 0.5 ? 0 : -1)));
            const age = position === 'GK' ? 24 + Math.floor(Math.random() * 12) : 18 + Math.floor(Math.random() * 16);
            const name = `${FIRST_NAMES[nameIdx % FIRST_NAMES.length]} ${LAST_NAMES[(nameIdx * 3) % LAST_NAMES.length]}`;
            nameIdx++;
            const p = createPlayer({ id: id++, name, age, position, qualityTier });
            p.scoutKnowledge = 95; // you know your own players well - no scouting fog on your squad
            p.birthdate = assignBirthdate(age, seasonStartDate(1, BASE_YEAR));
            players.push(p);
        }
    });
    return players;
}

function freshSquad(baseTier = 7) {
    return generateSquadForClub(baseTier);
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
    division: 1,        // 1 = top flight, 2 = second tier
    otherDivision: null, // the OTHER tier, simulated independently in parallel
    europeBracket: null, // real qualification-based knockout bracket, or null if not qualified
    lastSeasonAwards: [],
    goldenBoot: {},
    recentForm: [],     // last 8 results as 'W'/'D'/'L', for club-crisis detection
    lastPlayedWeek: 0,  // guards against double-simulating the same round
    pendingBids: [],
    pendingLoanRequests: [],
    boardroomFeed: [],
    newsHasUnseen: false,
    inboxHasUnseen: false,
    squadReputation: 100, // rough proxy for "how big a club are you" - used to judge personal-terms appeal
    competitions: {
        league: "Championship (7th)",
        cup: "3rd Round",
        europe: "UEL (League Stage)"
    },
    squad: freshSquad(),
    clubName: 'Your Club',
    transferMarket: [
        withBirthdate(createPlayer({ id: 101, name: 'Kylian Jr', age: 19, position: 'ST', qualityTier: 8 })),
        withBirthdate(createPlayer({ id: 102, name: 'Mateo Pedri', age: 22, position: 'CM', qualityTier: 7 }))
    ]
};

const IS_NEW_GAME = !localStorage.getItem(STORAGE_KEY);
let gameState = loadState();
if (!IS_NEW_GAME) initLeagueIfNeeded();

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
    if (typeof parsed.newsHasUnseen !== 'boolean') parsed.newsHasUnseen = false;
    if (typeof parsed.inboxHasUnseen !== 'boolean') parsed.inboxHasUnseen = false;
    if (typeof parsed.clubName !== 'string') parsed.clubName = 'Your Club';
    if (typeof parsed.division !== 'number') parsed.division = 1;
    if (!parsed.otherDivision) parsed.otherDivision = null; // rebuilt by initLeagueIfNeeded if missing
    if (parsed.europeBracket === undefined) parsed.europeBracket = null;
    if (!Array.isArray(parsed.lastSeasonAwards)) parsed.lastSeasonAwards = [];
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

const TACTIC_AGGRESSION = { press: 18, counter: 14, possession: 10, defensive: 6 };

function homeTeam() {
    return {
        id: 'YOU', name: gameState.clubName || 'Your Club', squad: gameState.squad.filter(p => !p.onLoanAt), tactic: gameState.tactic,
        chemistry: gameState.chemistry, tacticalFamiliarity: gameState.tacticalFamiliarity,
        managerQuality: gameState.managerQuality,
        managerProfile: { aggression: TACTIC_AGGRESSION[gameState.tactic] ?? 12 }
    };
}

function initLeagueIfNeeded() {
    if (gameState.rivals && gameState.schedule && gameState.table) {
        if (!gameState.otherDivision) gameState.otherDivision = generateIndependentDivision();
        return;
    }
    gameState.rivals = generateRivals();
    rollSeasonFactors(gameState.rivals, homeTeam());
    gameState.schedule = generateSchedule(20); // index 0 = your club, 1-19 = rivals in generateRivals() order
    gameState.table = initTable(homeTeam(), gameState.rivals);
    gameState.goldenBoot = {};
    gameState.recentForm = [];
    gameState.lastPlayedWeek = 0;
    gameState.otherDivision = generateIndependentDivision();
}

/** Build the index-0..19 team array the schedule references, index 0 always your live squad. */
function teamsById() {
    return [homeTeam(), ...gameState.rivals];
}

const WEATHER_OPTIONS = ['clear', 'clear', 'clear', 'rain', 'wind', 'heat'];

function updateUI() {
    document.getElementById('club-header').innerHTML = `${crestHtml(gameState.clubName || 'Your Club')}${gameState.clubName || 'Your Club'}`;
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
    renderUpcomingFixtures();
    renderGoldenBoot();
    renderStoryFeed(false);
    renderInbox();
    renderTacticPicker();

    const divisionLabel = document.getElementById('division-label');
    if (divisionLabel) divisionLabel.textContent = `Division ${gameState.division}`;

    document.getElementById('league-unread-dot').classList.toggle('hidden', !gameState.newsHasUnseen);
    document.getElementById('inbox-unread-dot').classList.toggle('hidden', !gameState.inboxHasUnseen);
}

const TACTIC_LABELS = { possession: 'Possession', counter: 'Counter-Attack', press: 'High Press', defensive: 'Defensive' };

function renderTacticPicker() {
    const container = document.getElementById('tactic-picker');
    const label = document.getElementById('tactic-familiarity-label');
    if (!container) return;
    container.innerHTML = Object.keys(TACTIC_LABELS).map(t =>
        `<button class="tactic-option ${gameState.tactic === t ? 'active' : ''}" data-tactic="${t}">${TACTIC_LABELS[t]}</button>`
    ).join('');
    label.textContent = `Familiarity: ${Math.round(gameState.tacticalFamiliarity)}%`;

    container.querySelectorAll('.tactic-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const newTactic = btn.getAttribute('data-tactic');
            if (newTactic === gameState.tactic) return;
            gameState.tactic = newTactic;
            // Switching system disrupts familiarity - the squad needs time to relearn it.
            gameState.tacticalFamiliarity = Math.max(20, gameState.tacticalFamiliarity * 0.4);
            saveGameState();
        });
    });
}

function renderInbox() {
    const bidList = document.getElementById('bid-list');
    const loanList = document.getElementById('loan-list');
    if (!bidList || !loanList) return;

    bidList.innerHTML = gameState.pendingBids.length === 0
        ? '<p class="subtext">No active bids for your players.</p>'
        : gameState.pendingBids.map(bid => `
            <div class="decision-card">
                <div class="headline">${crestHtml(bid.rivalName)}${bid.rivalName} bid £${bid.offerAmount}M for ${bid.playerName}</div>
                <div class="detail">Market value ~£${bid.marketValue}M${bid.personalTermsAgreed ? ' | Personal terms already agreed with the player' : ''}</div>
                <div class="btn-row">
                    <button class="accept-btn" data-bid="${bid.id}" data-action="accept">Accept</button>
                    <button class="accept-btn" style="background:var(--accent-warning)" data-bid="${bid.id}" data-action="counter">Counter</button>
                    <button class="reject-btn" data-bid="${bid.id}" data-action="reject">Reject</button>
                </div>
            </div>`).join('');

    loanList.innerHTML = gameState.pendingLoanRequests.length === 0
        ? '<p class="subtext">No loan requests for your players.</p>'
        : gameState.pendingLoanRequests.map(req => `
            <div class="decision-card">
                <div class="headline">${crestHtml(req.rivalName)}${req.rivalName} want ${req.playerName} on loan</div>
                <div class="detail">${req.durationWeeks >= 38 ? 'Season-long' : 'Half-season'} loan, no fee</div>
                <div class="btn-row">
                    <button class="accept-btn" data-loan="${req.id}" data-action="accept">Accept</button>
                    <button class="reject-btn" data-loan="${req.id}" data-action="reject">Reject</button>
                </div>
            </div>`).join('');

    bidList.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.getAttribute('data-action');
            const bidId = btn.getAttribute('data-bid');
            if (action === 'counter') resolveCounter(bidId);
            else resolveBid(bidId, action === 'accept');
        });
    });
    loanList.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => resolveLoan(btn.getAttribute('data-loan'), btn.getAttribute('data-action') === 'accept'));
    });
}

function resolveCounter(bidId) {
    const bid = gameState.pendingBids.find(b => b.id === bidId);
    if (!bid) return;
    const counterAmount = Math.round(bid.marketValue * 1.15 * 10) / 10;
    const outcome = counterBid(bid, counterAmount);

    if (outcome.accepted) {
        const player = gameState.squad.find(p => p.id === bid.playerId);
        gameState.squad = gameState.squad.filter(p => p.id !== bid.playerId);
        gameState.budget += outcome.finalAmount;
        if (player) triggerAIEvent(player, 'TRANSFER_OUT', outcome.headline);
    }

    gameState.pendingBids = gameState.pendingBids.filter(b => b.id !== bidId);
    showModal(outcome.accepted ? 'Deal Improved' : 'Negotiation Failed', outcome.headline);
    saveGameState();
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
    card.addEventListener('click', () => openPlayerProfile(player, isMarket));
    return card;
}

function attrRows(attrs, keys) {
    return keys.map(k => `<div class="attr-row"><span>${k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())}</span><span>${attrs[k]}</span></div>`).join('');
}

function openPlayerProfile(player, isMarket) {
    const report = scoutingReport(player);
    const value = computeMarketValue(player);

    const body = `${player.position} | Age ${player.age} | ${report.band} (${starString(report.stars)}, ${report.confidence} scouting confidence)`;

    const extra = `
        <div class="attr-row"><span><strong>Status</strong></span><span>${player.isInjured ? `Injured (${player.injuryWeeksRemaining}w left)` : player.onLoanAt ? `On loan at ${player.onLoanAt}` : player.isFatigued ? 'Fatigued' : 'Available'}</span></div>
        <div class="attr-row"><span>Injury record</span><span>${injuryProfileLabel(player)}</span></div>
        <div class="attr-row"><span>Form / Morale / Fitness / Sharpness</span><span>${player.form}/${player.morale}/${player.fitness}/${player.sharpness}</span></div>
        ${!isMarket ? `<div class="attr-row"><span>Appearances</span><span>${player.appearances || 0}</span></div>
        <div class="attr-row"><span>Contract remaining</span><span>${player.contractYearsRemaining ?? '-'} yrs</span></div>` : ''}
        <div class="attr-row"><span>Estimated value</span><span>£${value}M</span></div>
        <p style="margin:10px 0 4px;font-weight:700;">Technical</p>
        ${attrRows(player.attrs, ['finishing','passing','firstTouch','dribbling','crossing','tackling','technique','heading'])}
        <p style="margin:10px 0 4px;font-weight:700;">Mental</p>
        ${attrRows(player.attrs, ['decisions','anticipation','composure','vision','positioning','workRate','determination','teamwork','leadership','offTheBall'])}
        <p style="margin:10px 0 4px;font-weight:700;">Physical</p>
        ${attrRows(player.attrs, ['pace','acceleration','agility','balance','stamina','strength','jumpingReach'])}
        ${player.careerHistory && player.careerHistory.length > 0 ? `
        <p style="margin:10px 0 4px;font-weight:700;">Career History</p>
        ${[...player.careerHistory].reverse().map(h => `
            <div class="attr-row"><span>${crestHtml(h.clubName)}${h.season} - ${h.clubName}</span><span>${h.appearances}A ${h.goals}G ${h.assists}Ast ${h.avgRating ?? '-'}★${h.mvpCount ? ' 🏅'+h.mvpCount : ''}</span></div>
        `).join('')}` : ''}
    `;

    const actions = isMarket
        ? `<button class="confirm-btn" id="profile-sign-btn">Sign for £${value}M</button>`
        : '';

    showModal(player.name, body, extra, actions);

    if (isMarket) {
        document.getElementById('profile-sign-btn').addEventListener('click', () => {
            document.getElementById('alert-overlay').classList.add('hidden');
            buyPlayer(player);
        });
    }
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

    gameState.tacticalFamiliarity = Math.min(100, gameState.tacticalFamiliarity + 2.5); // squad relearns the system week by week

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

    // --- Transfer window activity: incoming bids, loan requests, and AI-to-AI transfers ---
    if (windowType) {
        const deadline = isDeadlineWeek(currentDate);
        const newBids = generateIncomingBids(gameState, windowType, deadline);
        const newLoans = generateLoanRequests(gameState, windowType, deadline);
        gameState.pendingBids = [...gameState.pendingBids, ...newBids].slice(-8);
        gameState.pendingLoanRequests = [...gameState.pendingLoanRequests, ...newLoans].slice(-8);
        if (newBids.length > 0 || newLoans.length > 0) {
            gameState.inboxHasUnseen = true;
        }
        if (newBids.length > 0) {
            showModal('Transfer Interest', `${newBids.length} new bid(s) received - check your Inbox.`);
        }

        // Rival-to-rival transfers now run WEEKLY during any open window (previously
        // only once a year at season rollover, which meant the January window never
        // saw any AI-to-AI business at all, and yearly volume was far too low to feel
        // like a real transfer market). Deadline week roughly doubles activity.
        if (Math.random() < (deadline ? 0.9 : 0.35)) {
            const dealCap = deadline ? 5 : 2;
            const div1Deals = simulateRivalTransferWindow(gameState.rivals, dealCap);
            const div2Deals = gameState.otherDivision ? simulateRivalTransferWindow(gameState.otherDivision.clubs, dealCap) : [];
            const allDeals = [...div1Deals, ...div2Deals];
            if (allDeals.length > 0) {
                gameState.boardroomFeed = [
                    ...allDeals.map(e => ({ club: '', type: 'rival_transfer', headline: e.headline, detail: '' })),
                    ...gameState.boardroomFeed
                ].slice(0, 10);
                gameState.newsHasUnseen = true;
            }
        }
    }

    if (isEuropeWeek) {
        if (gameState.europeBracket && !gameState.europeBracket.eliminated && !gameState.europeBracket.champion) {
            const weather = WEATHER_OPTIONS[Math.floor(Math.random() * WEATHER_OPTIONS.length)];
            const outcome = playBracketFixture(gameState.europeBracket, homeTeam(), weather);
            if (outcome) {
                gameState.newsHasUnseen = true;
                showModal('European Fixture', outcome.headline);
            }
        }
        gameState.competitions.europe = gameState.europeBracket
            ? (gameState.europeBracket.champion ? `${gameState.europeBracket.competition} Champions!`
                : gameState.europeBracket.eliminated ? `Out of the ${gameState.europeBracket.competition}`
                : `${gameState.europeBracket.competition} - ${gameState.europeBracket.stage}`)
            : 'Not qualified';
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
        const closingSeason = gameState.season; // the season that just concluded

        // Awards must be computed BEFORE closeOutPlayerSeason resets seasonStats.
        // Only the top flight (Division 1) awards a "best player" - matches
        // real football's prestige competitions being top-tier-only.
        const div1Clubs = gameState.division === 1
            ? [{ name: gameState.clubName, squad: gameState.squad, budget: (gameState.squadReputation ?? 100) / 2 }, ...gameState.rivals]
            : gameState.otherDivision.clubs;
        const div1Table = gameState.division === 1 ? gameState.table : gameState.otherDivision.table;
        gameState.lastSeasonAwards = computeSeasonAwards(div1Clubs, div1Table);

        gameState.squad.forEach(p => closeOutPlayerSeason(p, closingSeason, gameState.clubName));
        gameState.rivals.forEach(r => r.squad.forEach(p => closeOutPlayerSeason(p, closingSeason, r.name)));
        if (gameState.otherDivision) {
            gameState.otherDivision.clubs.forEach(c => c.squad.forEach(p => closeOutPlayerSeason(p, closingSeason, c.name)));
        }

        // Contract countdown for your squad - expired players leave for free.
        const contractEvents = [];
        gameState.squad.forEach(p => {
            const event = tickContract(p);
            if (event) contractEvents.push(event);
        });
        gameState.squad = gameState.squad.filter(p => p.contractYearsRemaining > 0);
        if (contractEvents.length > 0) {
            gameState.boardroomFeed = [...contractEvents.map(e => ({ club: gameState.clubName, ...e })), ...gameState.boardroomFeed].slice(0, 10);
        }

        // Safety net: contract expiries can hollow out a position entirely if
        // left unmanaged (a real risk caught in testing - a squad can end up
        // with just 1 GK and 1 CB, one injury away from being unplayable).
        // Auto-sign free-agent backfills to a viable minimum, framed as the
        // club registering emergency cover - doesn't replace good squad
        // management, just prevents a genuinely broken game state.
        const MIN_PER_POSITION = { GK: 2, CB: 2, FB: 2, CM: 2, LW: 1, ST: 2 };
        const emergencySignings = [];
        Object.entries(MIN_PER_POSITION).forEach(([position, minCount]) => {
            const current = gameState.squad.filter(p => p.position === position).length;
            for (let i = current; i < minCount; i++) {
                const signing = createPlayer({
                    id: 'emergency' + Date.now() + Math.random(),
                    name: generateScoutName(), age: 22 + Math.floor(Math.random() * 8),
                    position, qualityTier: 4
                });
                signing.scoutKnowledge = 95;
                signing.birthdate = assignBirthdate(signing.age, weekToDate(gameState.season, gameState.week, BASE_YEAR));
                gameState.squad.push(signing);
                emergencySignings.push(signing.name);
            }
        });
        if (emergencySignings.length > 0) {
            gameState.boardroomFeed = [{ club: gameState.clubName, type: 'emergency_signing',
                headline: `Emergency squad registration: ${emergencySignings.join(', ')} signed on free transfers`,
                detail: 'The squad had dropped dangerously thin at one or more positions.' }, ...gameState.boardroomFeed].slice(0, 10);
        }

        // --- Rival AI squad management: contracts, gap-filling, and AI-to-AI transfers ---
        // Makes rival clubs a living league instead of a static roster - a rival
        // that loses a player to injury, contract expiry, or a sale to you no
        // longer just plays a player short forever. AI-to-AI transfers themselves
        // now run weekly during open windows (see the window-activity block above),
        // not just once here - this block only handles contract/gap bookkeeping.
        const rivalNews = [];
        [...gameState.rivals, ...(gameState.otherDivision ? gameState.otherDivision.clubs : [])].forEach(club => {
            tickRivalSquadContracts(club);
            const signings = fillSquadGaps(club);
            replenishBudget(club);
            if (signings.length > 0) {
                rivalNews.push({ club: club.name, type: 'squad_refresh', headline: `${club.name} sign ${signings.join(', ')}`, detail: 'Rebuilding squad depth after departures.' });
            }
        });
        if (rivalNews.length > 0) {
            gameState.boardroomFeed = [...rivalNews.slice(0, 6), ...gameState.boardroomFeed].slice(0, 10);
        }

        gameState.week = 1;
        gameState.season++;
        gameState.competitions.cup = DEFAULT_STATE.competitions.cup;
        const qualifiedFor = checkQualification(gameState.leaguePosition, gameState.division);
        gameState.europeBracket = qualifiedFor ? generateEuropeanBracket(qualifiedFor) : null;
        gameState.competitions.europe = qualifiedFor ? `${qualifiedFor} - Round of 8` : 'Not qualified';
        gameState.leaguePoints = 0;
        gameState.squad.forEach(p => { p.isFatigued = false; });

        // New season: fresh schedule, reset table, re-roll every club's season-long
        // over/underperformance factor - this is what keeps seasons from feeling identical.
        // Rival clubs and their manager-ai profiles PERSIST across seasons (a manager's
        // personality doesn't reset every year) - only the season-scoped state resets.

        // --- Promotion/relegation: swap bottom 3 of Division 1 with top 3 of Division 2 ---
        let promotionNews = null;
        if (gameState.otherDivision) {
            const topTable = gameState.division === 1 ? gameState.table : gameState.otherDivision.table;
            const topClubs = gameState.division === 1 ? gameState.rivals : gameState.otherDivision.clubs;
            const bottomTable = gameState.division === 1 ? gameState.otherDivision.table : gameState.table;
            const bottomClubs = gameState.division === 1 ? gameState.otherDivision.clubs : gameState.rivals;

            const pr = applyPromotionRelegation(topTable, topClubs, bottomTable, bottomClubs);
            const newDivision1Clubs = pr.newTopClubs, newDivision2Clubs = pr.newBottomClubs;

            if (gameState.division === 1 && pr.youRelegated) {
                gameState.division = 2;
                gameState.rivals = newDivision2Clubs;
                gameState.otherDivision.clubs = newDivision1Clubs;
                promotionNews = `Relegated to Division 2 after finishing bottom 3.`;
            } else if (gameState.division === 2 && pr.youPromoted) {
                gameState.division = 1;
                gameState.rivals = newDivision1Clubs;
                gameState.otherDivision.clubs = newDivision2Clubs;
                promotionNews = `Promoted to Division 1! Time to test yourselves at the top level.`;
            } else if (gameState.division === 1) {
                gameState.rivals = newDivision1Clubs;
                gameState.otherDivision.clubs = newDivision2Clubs;
            } else {
                gameState.rivals = newDivision2Clubs;
                gameState.otherDivision.clubs = newDivision1Clubs;
            }

            gameState.otherDivision.schedule = generateSchedule(20);
            gameState.otherDivision.table = gameState.otherDivision.clubs.map(c => ({ id: c.id, name: c.name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }));
            rollSeasonFactors(gameState.otherDivision.clubs, null);
        }

        rollSeasonFactors(gameState.rivals, homeTeam());
        gameState.rivals.forEach(r => { r.recentForm = []; });
        gameState.schedule = generateSchedule(20);
        gameState.table = initTable(homeTeam(), gameState.rivals);
        gameState.goldenBoot = {};
        gameState.recentForm = [];
        gameState.lastPlayedWeek = 0;
        if (promotionNews) showModal('Promotion & Relegation', promotionNews);

        if (gameState.season > 30) {
            showModal('Career Completed', 'You have successfully completed 30 glorious years as an Elite Football Manager!');
            gameState.season = 30;
        } else {
            const winner = gameState.lastSeasonAwards[0];
            const awardLine = winner ? ` Season's Best Player: ${winner.name} (${winner.club}) - ${winner.goals}G ${winner.assists}A, avg ${winner.avgRating}.` : '';
            showModal('New Season Started!', `Welcome to Season ${gameState.season + 2025}/26 campaign. Player aging and development metrics calculated.${awardLine}`);
        }
    }
    saveGameState();
}

function playFixture() {
    if (!gameState.schedule || !gameState.table) return; // league not initialized yet (club not chosen)
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
    if (gameState.otherDivision) {
        simulateIndependentRound(gameState.otherDivision, gameState.week, weather);
    }
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
    gameState.newsHasUnseen = true;
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
        <tr class="${t.id === 'YOU' ? 'you-row' : ''}" data-club-id="${t.id}">
            <td>${i + 1}</td><td>${crestHtml(t.name)}${t.name}</td><td>${t.played}</td>
            <td>${t.gf - t.ga}</td><td>${t.points}</td>
        </tr>`).join('');
    container.innerHTML = `<table><thead><tr><th>#</th><th>Club</th><th>P</th><th>GD</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table>`;

    container.querySelectorAll('tr[data-club-id]').forEach(row => {
        row.addEventListener('click', () => {
            const id = row.getAttribute('data-club-id');
            if (id !== 'YOU') openRivalScoutReport(id);
        });
    });
}

function openRivalScoutReport(rivalId) {
    const rival = gameState.rivals.find(r => r.id === rivalId);
    if (!rival) return;

    const formStr = (rival.recentForm || []).join('') || 'No results yet';
    const squadRows = rival.squad.map(p => {
        const report = scoutingReport(p);
        return `<div class="attr-row"><span>${p.name} (${p.position})</span><span>${starString(report.stars)} ${report.band}</span></div>`;
    }).join('');

    const extra = `
        <div class="attr-row"><span>Current tactic (scouted)</span><span>${TACTIC_LABELS[rival.tactic] || rival.tactic}</span></div>
        <div class="attr-row"><span>Recent form</span><span>${formStr}</span></div>
        <p style="margin:10px 0 4px;font-weight:700;">Scouted squad</p>
        ${squadRows}
    `;
    showModal(`${crestHtml(rival.name)}${rival.name}`, 'Scouting report - ability is estimated, not exact.', extra);
}

function renderUpcomingFixtures() {
    const container = document.getElementById('upcoming-fixtures');
    if (!container || !gameState.schedule) return;
    const teams = teamsById();
    const rows = [];
    for (let w = gameState.week; w < Math.min(gameState.week + 6, gameState.schedule.length + 1); w++) {
        const round = gameState.schedule[w - 1];
        if (!round) continue;
        const pair = round.find(([h, a]) => h === 0 || a === 0);
        if (!pair) continue;
        const isHome = pair[0] === 0;
        const opponent = teams[isHome ? pair[1] : pair[0]];
        const date = formatMatchDate(weekToDate(gameState.season, w, BASE_YEAR));
        rows.push(`<div class="attr-row"><span>${date}</span><span>${isHome ? 'vs' : '@'} ${crestHtml(opponent.name)}${opponent.name}</span></div>`);
    }
    container.innerHTML = rows.length ? rows.join('') : '<p class="subtext">No more fixtures scheduled this season.</p>';
}

function findPlayerByName(name) {
    const own = gameState.squad.find(p => p.name === name);
    if (own) return { player: own, isMarket: false };
    for (const rival of gameState.rivals) {
        const found = rival.squad.find(p => p.name === name);
        if (found) return { player: found, isMarket: false };
    }
    return null;
}

function renderGoldenBoot() {
    const container = document.getElementById('golden-boot-list');
    if (!container) return;
    const scorers = topScorers(gameState.goldenBoot, 5);
    container.innerHTML = scorers.length === 0
        ? '<p class="subtext">No goals recorded yet.</p>'
        : scorers.map((s, i) => `<div class="player-card" data-scorer="${i}"><div class="player-info"><div class="player-name">${s.name}</div></div><div class="player-rating">${s.goals}</div></div>`).join('');

    container.querySelectorAll('[data-scorer]').forEach((el, i) => {
        el.addEventListener('click', () => {
            const found = findPlayerByName(scorers[i].name);
            if (found) openPlayerProfile(found.player, found.isMarket);
        });
    });
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

function showModal(title, body, extraHtml = '', actionsHtml = '') {
    document.getElementById('modal-title').innerHTML = title;
    document.getElementById('modal-body').textContent = body;
    document.getElementById('modal-extra').innerHTML = extraHtml;
    document.getElementById('modal-actions').innerHTML = actionsHtml;
    document.getElementById('alert-overlay').classList.remove('hidden');
}

document.querySelectorAll('.tab-trigger').forEach(button => {
    button.addEventListener('click', () => {
        document.querySelectorAll('.tab-trigger').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        button.classList.add('active');
        const target = button.getAttribute('data-target');
        document.getElementById(target).classList.add('active');

        if (target === 'tab-league' && gameState.newsHasUnseen) {
            gameState.newsHasUnseen = false;
            document.getElementById('league-unread-dot').classList.add('hidden');
            saveGameState();
        }
        if (target === 'tab-inbox' && gameState.inboxHasUnseen) {
            gameState.inboxHasUnseen = false;
            document.getElementById('inbox-unread-dot').classList.add('hidden');
            saveGameState();
        }
    });
});

document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('alert-overlay').classList.add('hidden');
});

document.getElementById('btn-advance-week').addEventListener('click', advanceWeek);
document.getElementById('btn-simulate-match').addEventListener('click', playFixture);
const SCOUT_FIRST_NAMES = ['Marco', 'Diego', 'Kwame', 'Lucas', 'Yusuf', 'Tomas', 'Bruno', 'Elias', 'Idris', 'Mateus', 'Rafael', 'Kian', 'Noah', 'Enzo', 'Amadou', 'Viktor', 'Theo', 'Jonas'];
const SCOUT_LAST_NAMES = ['Carvalho', 'Nwosu', 'Ferreira', 'Adebayo', 'Kovac', 'Almeida', 'Osei', 'Larsson', 'Moreno', 'Haidara', 'Petrov', 'Silva', 'Dumont', 'Okafor', 'Reyes', 'Bakker', 'Costa', 'Sørensen'];

function generateScoutName() {
    const first = SCOUT_FIRST_NAMES[Math.floor(Math.random() * SCOUT_FIRST_NAMES.length)];
    const last = SCOUT_LAST_NAMES[Math.floor(Math.random() * SCOUT_LAST_NAMES.length)];
    return `${first} ${last}`;
}

document.getElementById('btn-view-other-division').addEventListener('click', () => {
    if (!gameState.otherDivision) return;
    const sorted = sortTable(gameState.otherDivision.table);
    const otherNum = gameState.division === 1 ? 2 : 1;
    const rows = sorted.map((t, i) => `<div class="attr-row"><span>${i + 1}. ${t.name}</span><span>${t.points} pts</span></div>`).join('');
    showModal(`Division ${otherNum}`, 'Standings', rows);
});

document.getElementById('btn-scout-market').addEventListener('click', () => {
    gameState.budget -= 0.5;
    const tier = 3 + Math.floor(Math.random() * 7);
    const positions = ['ST', 'CM', 'CB', 'LW', 'FB', 'GK'];
    const candidate = createPlayer({
        id: 'scout' + Date.now(),
        name: generateScoutName(),
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

function startWithClub(name, tier, reputation) {
    gameState.clubName = name;
    gameState.squadReputation = reputation;
    gameState.squad = generateSquadForClub(tier);
    document.getElementById('club-select-overlay').classList.add('hidden');
    initLeagueIfNeeded();
    saveGameState();
}

if (IS_NEW_GAME) {
    const presetList = document.getElementById('club-preset-list');
    presetList.innerHTML = PRESET_CLUBS.map((c, i) => `
        <div class="club-preset-card">
            ${crestHtml(c.name)}
            <div class="info"><div class="name">${c.name}</div><div class="desc">${c.desc}</div></div>
            <button data-preset="${i}">Select</button>
        </div>`).join('');
    presetList.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const c = PRESET_CLUBS[btn.getAttribute('data-preset')];
            startWithClub(c.name, c.tier, c.reputation);
        });
    });
    document.getElementById('btn-start-custom-club').addEventListener('click', () => {
        const name = document.getElementById('custom-club-name').value.trim() || 'Your Club';
        startWithClub(name, 5, 90); // custom clubs start as a reasonable mid-table side
    });
    document.getElementById('club-select-overlay').classList.remove('hidden');
} else {
    updateUI();
}
