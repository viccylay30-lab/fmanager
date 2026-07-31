import { createPlayer, scoutingReport } from './attributes.js';
import { weeklyInjuryCheck, tickRecovery, injuryProfileLabel } from './injuries.js';
import { developPlayer, computeMarketValue } from './development.js';
import { generateRivals, rollSeasonFactors, generateSchedule, initTable, simulateRound, updateGoldenBoot, topScorers, sortTable } from './league.js';
import { detectNarratives, recordFormLetter, isGiantKilling } from './narrative.js';
import { seasonStartDate, weekToDate, formatMatchDate, isTransferWindowOpen, assignBirthdate, isBirthdayInRange } from './calendar.js';
import { generateIncomingBids, describeBidOutcome } from './transfers.js';
import { generateLoanRequests, sendOnLoan, tickLoanedPlayer, checkLoanReturn } from './loans.js';
import { evaluateYourJobSecurity } from './boardroom.js';
import { generateIndependentDivision, simulateIndependentRound, applyPromotionRelegation } from './divisions.js';
import { checkQualification, generateEuropeanBracket, playBracketFixture } from './europe.js';
import { closeOutPlayerSeason } from './career.js';
import { computeSeasonAwards } from './awards.js';
import { tickContract } from './contracts.js';
import { FORMATIONS, selectStartingXI, applySubstitution, pickSetPieceTakers } from './formations.js';
import { TRAINING_FOCI, trainingIntensityFor, applyWeeklyTrainingNudge, developmentGrowthMultiplier } from './training.js';
import { generateYouthIntake, promoteYouthPlayer } from './youth.js';
import { computeWeeklyWage, applyWeeklyFinances } from './finances.js';
import { needsContractDecision, startWageTalks } from './negotiations.js';
import { startNegotiation, makeOffer, walkAway } from './negotiation-engine.js';
import { STAFF_ROLES, generateStaffCandidates, computeStaffWageBill, effectiveCoachingQuality, physioQuality, scoutKnowledgeBonus, effectiveManagerQuality, assistantOppositionTip } from './staff.js';
import { generatePressConference, resolvePressTone } from './media.js';
import { INTERNATIONAL_BREAK_WEEKS, runInternationalWindow, internationalSummary } from './international.js';
import { tickRivalContracts, maintainRivalDepth } from './rival-ai.js';
import { assignHierarchy, computeHappiness, computeTeamDynamics, talkToPlayer, checkTransferRequestRisk, respondToTransferRequest } from './dynamics.js';

const BASE_YEAR = 2026; // Season 1 kicks off the real upcoming season, August 2026
const MAX_SQUAD_SIZE = 30; // real-football-style registration cap - without this, unlimited buying/promoting bloats the squad indefinitely

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

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
    formation: '4-3-3',
    plannedSubs: [],           // [{ outId, inId }] set on the Team Sheet, applied at halftime
    trainingFocus: 'balanced',
    youthSquad: [],
    financeLog: [],
    pressBoardModifier: 0,
    staff: { assistantManager: null, coaches: [], physio: null, scouts: [] },
    staffCandidates: {},       // { role: [candidates...] } - regenerated on demand in the Club tab
    pendingRenewals: [],       // player ids currently flagged for a contract decision this window
    pendingPreContractSignings: [], // rival players who've agreed to join on a free transfer once their current deal expires
    teamDynamics: { cohesion: 12, dressingRoomAtmosphere: 12, managerialSupport: 12 },
    activeTransferRequests: [], // player ids currently demanding a transfer, awaiting a manager response
    internationalReports: [],  // recent call-up results, most recent first
    pressConference: null,     // this week's { question, options } once generated
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
    // Migration: older saves only suffixed the CLUB id for Division 2, not the
    // players inside it - two same-named clubs in each division could
    // generate players with identical ids. Fix any save from before this was
    // caught (a real bug, found via the pre-contract-poaching feature cross-
    // referencing rival player ids into gameState.squad for the first time).
    if (parsed.otherDivision && Array.isArray(parsed.otherDivision.clubs)) {
        parsed.otherDivision.clubs.forEach(c => {
            c.squad.forEach(p => { if (!String(p.id).includes('-D2')) p.id = p.id + '-D2'; });
        });
    }
    if (parsed.europeBracket === undefined) parsed.europeBracket = null;
    if (!Array.isArray(parsed.lastSeasonAwards)) parsed.lastSeasonAwards = [];
    if (typeof parsed.squadReputation !== 'number') parsed.squadReputation = 100;
    if (typeof parsed.formation !== 'string' || !FORMATIONS[parsed.formation]) parsed.formation = '4-3-3';
    if (!Array.isArray(parsed.plannedSubs)) parsed.plannedSubs = [];
    if (typeof parsed.trainingFocus !== 'string' || !TRAINING_FOCI[parsed.trainingFocus]) parsed.trainingFocus = 'balanced';
    if (!Array.isArray(parsed.youthSquad)) parsed.youthSquad = [];
    if (!Array.isArray(parsed.financeLog)) parsed.financeLog = [];
    if (typeof parsed.pressBoardModifier !== 'number') parsed.pressBoardModifier = 0;
    if (!parsed.staff) parsed.staff = { assistantManager: null, coaches: [], physio: null, scouts: [] };
    if (!parsed.staffCandidates) parsed.staffCandidates = {};
    if (!Array.isArray(parsed.pendingRenewals)) parsed.pendingRenewals = [];
    if (!Array.isArray(parsed.pendingPreContractSignings)) parsed.pendingPreContractSignings = [];
    if (!parsed.teamDynamics) parsed.teamDynamics = { cohesion: 12, dressingRoomAtmosphere: 12, managerialSupport: 12 };
    if (!Array.isArray(parsed.activeTransferRequests)) parsed.activeTransferRequests = [];
    if (!Array.isArray(parsed.internationalReports)) parsed.internationalReports = [];
    if (parsed.pressConference === undefined) parsed.pressConference = null;
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
    return { facilities: gameState.facilities, coachingQuality: effectiveCoachingQuality(gameState.coachingQuality, gameState.staff) };
}

const TACTIC_AGGRESSION = { press: 18, counter: 14, possession: 10, defensive: 6 };

function homeTeam() {
    const available = gameState.squad.filter(p => !p.onLoanAt);
    const { startingXI, bench } = selectStartingXI(available, gameState.formation);
    const formation = FORMATIONS[gameState.formation] || FORMATIONS['4-3-3'];
    return {
        id: 'YOU', name: gameState.clubName || 'Your Club', squad: available, tactic: gameState.tactic,
        chemistry: gameState.chemistry, tacticalFamiliarity: gameState.tacticalFamiliarity,
        managerQuality: effectiveManagerQuality(gameState.managerQuality, gameState.staff),
        managerProfile: { aggression: TACTIC_AGGRESSION[gameState.tactic] ?? 12 },
        startingXI, bench, shapeMod: formation.shapeMod
    };
}

/** Resolve gameState.plannedSubs (out/in ids picked on the Team Sheet) against a live bench for this fixture. */
function resolvePlannedSubs(startingXI, bench) {
    const resolved = [];
    for (const sub of gameState.plannedSubs || []) {
        const inPlayer = bench.find(p => p.id === sub.inId);
        const stillInXI = startingXI.some(p => p.id === sub.outId);
        if (inPlayer && stillInXI) resolved.push({ outId: sub.outId, inPlayer });
    }
    return resolved.slice(0, 3); // realistic substitution limit
}

function initLeagueIfNeeded() {
    const referenceDate = weekToDate(gameState.season, gameState.week, BASE_YEAR);
    if (gameState.rivals && gameState.schedule && gameState.table) {
        if (!gameState.otherDivision) gameState.otherDivision = generateIndependentDivision(referenceDate);
        return;
    }
    gameState.rivals = generateRivals(referenceDate);
    rollSeasonFactors(gameState.rivals, homeTeam());
    gameState.schedule = generateSchedule(20); // index 0 = your club, 1-19 = rivals in generateRivals() order
    gameState.table = initTable(homeTeam(), gameState.rivals);
    gameState.goldenBoot = {};
    gameState.recentForm = [];
    gameState.lastPlayedWeek = 0;
    gameState.otherDivision = generateIndependentDivision(referenceDate);
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
    renderTeamSheet();
    renderTrainingPicker();
    renderYouthSquad();
    renderTeamDynamics();
    renderTransferRequests();
    renderRivalClubsList();
    renderFinances();
    renderStaffPanel();
    renderContractNegotiations();
    renderInternationalReport();
    renderPressConferenceButton();

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

// ---------------------------------------------------------------------------
// Team Sheet: formation, Starting XI/bench, halftime substitution planner,
// set-piece takers.
// ---------------------------------------------------------------------------

function renderTeamSheet() {
    const container = document.getElementById('team-sheet');
    if (!container) return;
    const { startingXI, bench } = selectStartingXI(gameState.squad.filter(p => !p.onLoanAt), gameState.formation);
    const takers = pickSetPieceTakers(startingXI);

    const formationOptions = Object.keys(FORMATIONS).map(key =>
        `<option value="${key}" ${gameState.formation === key ? 'selected' : ''}>${FORMATIONS[key].label}</option>`).join('');

    const xiRows = startingXI.map(p => `<div class="attr-row"><span>${p.position} - ${p.name}</span><span>${p.fitness}/20 fit</span></div>`).join('');
    const benchRows = bench.map(p => `<div class="attr-row"><span>${p.position} - ${p.name}</span><span>${p.fitness}/20 fit</span></div>`).join('');

    const subRows = (gameState.plannedSubs || []).map((sub, i) => {
        const out = startingXI.find(p => p.id === sub.outId);
        const inP = bench.find(p => p.id === sub.inId);
        return `<div class="attr-row"><span>${out ? out.name : '?'} ➜ ${inP ? inP.name : '?'} (HT)</span><span><button data-remove-sub="${i}" class="reject-btn" style="padding:2px 8px;font-size:11px;">Remove</button></span></div>`;
    }).join('');

    container.innerHTML = `
        <div class="attr-row"><span><strong>Formation</strong></span><span><select id="formation-select">${formationOptions}</select></span></div>
        <p style="margin:10px 0 4px;font-weight:700;">Starting XI</p>
        ${xiRows || '<p class="subtext">Not enough fit players to fill a Starting XI.</p>'}
        <p style="margin:10px 0 4px;font-weight:700;">Bench</p>
        ${benchRows || '<p class="subtext">No bench players available.</p>'}
        ${takers ? `<p style="margin:10px 0 4px;font-weight:700;">Set-Piece Takers</p>
        <div class="attr-row"><span>Corners</span><span>${takers.corners}</span></div>
        <div class="attr-row"><span>Free Kicks</span><span>${takers.freeKicks}</span></div>
        <div class="attr-row"><span>Penalties</span><span>${takers.penalties}</span></div>` : ''}
        <p style="margin:10px 0 4px;font-weight:700;">Planned Halftime Substitutions (max 3)</p>
        ${subRows || '<p class="subtext">None planned - full 90 for the Starting XI.</p>'}
        ${(gameState.plannedSubs || []).length < 3 && bench.length > 0 && startingXI.length > 0 ? `
        <div class="attr-row">
            <span><select id="sub-out-select">${startingXI.map(p => `<option value="${p.id}">${p.name} (out)</option>`).join('')}</select></span>
            <span><select id="sub-in-select">${bench.map(p => `<option value="${p.id}">${p.name} (in)</option>`).join('')}</select></span>
        </div>
        <button id="btn-add-sub" class="secondary-btn full-width" style="margin-top:6px;">Plan Substitution</button>` : ''}
        ${renderAssistantTipHtml()}
    `;

    document.getElementById('formation-select')?.addEventListener('change', (e) => {
        gameState.formation = e.target.value;
        gameState.plannedSubs = []; // a new shape invalidates prior sub plans tied to old XI slots
        saveGameState();
    });
    document.getElementById('btn-add-sub')?.addEventListener('click', () => {
        const outId = document.getElementById('sub-out-select').value;
        const inId = document.getElementById('sub-in-select').value;
        gameState.plannedSubs = [...(gameState.plannedSubs || []), { outId, inId }];
        saveGameState();
    });
    container.querySelectorAll('[data-remove-sub]').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.getAttribute('data-remove-sub'), 10);
            gameState.plannedSubs = (gameState.plannedSubs || []).filter((_, i) => i !== idx);
            saveGameState();
        });
    });
}

function renderAssistantTipHtml() {
    if (!gameState.staff?.assistantManager || !gameState.schedule) return '';
    const round = gameState.schedule[gameState.week - 1];
    if (!round) return '';
    const pair = round.find(([h, a]) => h === 0 || a === 0);
    if (!pair) return '';
    const teams = teamsById();
    const opponent = teams[pair[0] === 0 ? pair[1] : pair[0]];
    const tip = assistantOppositionTip(gameState.staff, opponent);
    return tip ? `<p style="margin:10px 0 4px;font-weight:700;">Assistant Manager's Notes</p><p class="subtext">${tip}</p>` : '';
}

function renderTrainingPicker() {
    const container = document.getElementById('training-picker');
    if (!container) return;
    container.innerHTML = Object.keys(TRAINING_FOCI).map(key => {
        const f = TRAINING_FOCI[key];
        return `<button class="tactic-option ${gameState.trainingFocus === key ? 'active' : ''}" data-focus="${key}" title="${f.description}">${f.label}</button>`;
    }).join('');
    container.querySelectorAll('[data-focus]').forEach(btn => {
        btn.addEventListener('click', () => {
            gameState.trainingFocus = btn.getAttribute('data-focus');
            saveGameState();
        });
    });
}

// ---------------------------------------------------------------------------
// Youth Academy
// ---------------------------------------------------------------------------

function renderYouthSquad() {
    const container = document.getElementById('youth-squad-list');
    if (!container) return;
    if (!gameState.youthSquad || gameState.youthSquad.length === 0) {
        container.innerHTML = '<p class="subtext">No youth prospects currently in the academy.</p>';
        return;
    }
    container.innerHTML = gameState.youthSquad.map(p => {
        const report = scoutingReport(p);
        return `<div class="decision-card">
            <div class="headline">${p.name} (${p.position}, age ${p.age}) - ${report.band}</div>
            <div class="detail">Scout confidence: ${report.confidence} | ${starString(report.stars)}</div>
            <div class="btn-row"><button class="accept-btn" data-promote="${p.id}">Promote to First Team</button></div>
        </div>`;
    }).join('');
    container.querySelectorAll('[data-promote]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-promote');
            if (gameState.squad.length >= MAX_SQUAD_SIZE) {
                showModal('Squad Full', `The squad is already at its ${MAX_SQUAD_SIZE}-player registration limit - offload someone before promoting a prospect.`);
                return;
            }
            const promoted = promoteYouthPlayer(gameState.youthSquad, gameState.squad, id);
            if (promoted) showModal('Player Promoted', `${promoted.name} has been promoted to the first-team squad.`);
            saveGameState();
        });
    });
}

// ---------------------------------------------------------------------------
// Finances
// ---------------------------------------------------------------------------

function renderFinances() {
    const container = document.getElementById('finance-ledger');
    if (!container) return;
    const wageBill = gameState.squad.reduce((s, p) => s + computeWeeklyWage(p), 0);
    const staffBill = computeStaffWageBill(gameState.staff);
    const summary = `<div class="attr-row"><span>Weekly wage bill (squad)</span><span>£${wageBill.toFixed(2)}M</span></div>
        <div class="attr-row"><span>Weekly staff wages</span><span>£${staffBill.toFixed(2)}M</span></div>
        <div class="attr-row"><span>Current balance</span><span>£${gameState.budget.toFixed(1)}M</span></div>`;
    const rows = (gameState.financeLog || []).slice(0, 8).map(e =>
        `<div class="attr-row"><span>S${e.season} W${e.week}</span><span>${e.net >= 0 ? '+' : ''}£${e.net.toFixed(2)}M ➜ £${e.balanceAfter.toFixed(1)}M</span></div>`
    ).join('');
    container.innerHTML = summary + `<p style="margin:10px 0 4px;font-weight:700;">Recent Weeks</p>` +
        (rows || '<p class="subtext">No finance history yet.</p>');
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

function renderStaffPanel() {
    const container = document.getElementById('staff-panel');
    if (!container) return;
    const s = gameState.staff;
    const currentRows = `
        <div class="attr-row"><span>Assistant Manager</span><span>${s.assistantManager ? `${s.assistantManager.name} (${s.assistantManager.quality})` : 'None'}</span></div>
        <div class="attr-row"><span>Coaches</span><span>${(s.coaches || []).map(c => `${c.name} (${c.quality})`).join(', ') || 'None'}</span></div>
        <div class="attr-row"><span>Physio</span><span>${s.physio ? `${s.physio.name} (${s.physio.quality})` : 'None'}</span></div>
        <div class="attr-row"><span>Scouts</span><span>${(s.scouts || []).map(c => `${c.name} (${c.quality})`).join(', ') || 'None'}</span></div>
    `;

    const roleButtons = Object.keys(STAFF_ROLES).map(role =>
        `<button class="secondary-btn" data-view-candidates="${role}">View ${STAFF_ROLES[role].label} Candidates</button>`).join('');

    let candidatesHtml = '';
    Object.entries(gameState.staffCandidates || {}).forEach(([role, candidates]) => {
        if (!candidates || candidates.length === 0) return;
        candidatesHtml += `<p style="margin:10px 0 4px;font-weight:700;">${STAFF_ROLES[role].label} Candidates</p>` +
            candidates.map(c => `<div class="decision-card">
                <div class="headline">${c.name} - Quality ${c.quality}/20</div>
                <div class="detail">Wage: £${c.wage.toFixed(3)}M/week</div>
                <div class="btn-row"><button class="accept-btn" data-hire="${role}:${c.id}">Hire</button></div>
            </div>`).join('');
    });

    container.innerHTML = currentRows + `<div class="btn-row" style="flex-wrap:wrap;gap:6px;margin-top:10px;">${roleButtons}</div>` + candidatesHtml;

    container.querySelectorAll('[data-view-candidates]').forEach(btn => {
        btn.addEventListener('click', () => {
            const role = btn.getAttribute('data-view-candidates');
            gameState.staffCandidates = { ...gameState.staffCandidates, [role]: generateStaffCandidates(role, 3) };
            saveGameState();
        });
    });
    container.querySelectorAll('[data-hire]').forEach(btn => {
        btn.addEventListener('click', () => {
            const [role, id] = btn.getAttribute('data-hire').split(':');
            const candidate = (gameState.staffCandidates[role] || []).find(c => c.id === id);
            if (!candidate) return;
            const max = STAFF_ROLES[role].max;
            if (role === 'assistantManager') gameState.staff.assistantManager = candidate;
            else if (role === 'physio') gameState.staff.physio = candidate;
            else {
                const key = role === 'coach' ? 'coaches' : 'scouts';
                gameState.staff[key] = [...(gameState.staff[key] || []), candidate].slice(-max);
            }
            gameState.staffCandidates = { ...gameState.staffCandidates, [role]: [] };
            showModal('Staff Hired', `${candidate.name} joins as ${STAFF_ROLES[role].label}.`);
            saveGameState();
        });
    });
}

// ---------------------------------------------------------------------------
// Contract negotiations
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rival Clubs: browse a rival's squad and approach any player in the final
// year of their contract for a free-transfer pre-contract agreement.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Dynamics: team-wide readings, hierarchy, and active transfer requests.
// ---------------------------------------------------------------------------

function renderTeamDynamics() {
    const container = document.getElementById('team-dynamics-panel');
    if (!container) return;
    const d = gameState.teamDynamics || { cohesion: 12, dressingRoomAtmosphere: 12, managerialSupport: 12 };
    const bar = (label, value) => `<div class="attr-row"><span>${label}</span><span>${value}/20</span></div>`;
    const hierarchyRows = [...gameState.squad]
        .filter(p => p.hierarchyStatus)
        .sort((a, b) => (b.ca || 0) - (a.ca || 0))
        .map(p => `<div class="attr-row"><span>${p.name}${p.isTeamLeader ? ' 👑' : ''}</span><span>${p.hierarchyStatus} - Happiness ${p.happiness?.overall ?? '-'}</span></div>`)
        .join('');
    container.innerHTML = `
        ${bar('Team Cohesion', d.cohesion)}
        ${bar('Dressing Room Atmosphere', d.dressingRoomAtmosphere)}
        ${bar('Managerial Support', d.managerialSupport)}
        <p style="margin:10px 0 4px;font-weight:700;">Squad Hierarchy</p>
        ${hierarchyRows || '<p class="subtext">Hierarchy is assigned at the end of the first month.</p>'}
    `;
}

function renderTransferRequests() {
    const container = document.getElementById('transfer-requests-panel');
    if (!container) return;
    const players = gameState.squad.filter(p => (gameState.activeTransferRequests || []).includes(p.id));
    if (players.length === 0) {
        container.innerHTML = '<p class="subtext">No players are currently unhappy enough to request a transfer.</p>';
        return;
    }
    container.innerHTML = players.map(p => `
        <div class="decision-card">
            <div class="headline">${p.name} wants to leave the club</div>
            <div class="detail">${p.hierarchyStatus ?? 'Squad player'} - Happiness ${p.happiness?.overall ?? '-'}/20 (playing time ${p.happiness?.playingTime ?? '-'}/20)</div>
            <div class="btn-row">
                <button class="reject-btn" data-tr-response="${p.id}:reject">Reject</button>
                <button class="secondary-btn" data-tr-response="${p.id}:reassure">Promise More Game Time</button>
                <button class="accept-btn" data-tr-response="${p.id}:allowSale">Listen to Offers</button>
            </div>
        </div>`).join('');

    container.querySelectorAll('[data-tr-response]').forEach(btn => {
        btn.addEventListener('click', () => {
            const [id, response] = btn.getAttribute('data-tr-response').split(':');
            const player = gameState.squad.find(p => String(p.id) === id);
            if (!player) return;
            const outcome = respondToTransferRequest(player, response);
            gameState.activeTransferRequests = gameState.activeTransferRequests.filter(pid => String(pid) !== id);
            showModal('Transfer Request', outcome.message);
            saveGameState();
        });
    });
}

function renderRivalClubsList() {
    const container = document.getElementById('rival-clubs-list');
    if (!container) return;
    container.innerHTML = [...gameState.rivals].sort((a, b) => (b.tier ?? 5) - (a.tier ?? 5)).map(club => `
        <div class="attr-row"><span>${club.name} (Tier ${club.tier ?? '-'})</span>
        <span><button class="secondary-btn" data-view-rival-club="${club.id}" style="padding:4px 10px;font-size:12px;">View Squad</button></span></div>
    `).join('');
    container.querySelectorAll('[data-view-rival-club]').forEach(btn => {
        btn.addEventListener('click', () => {
            const club = gameState.rivals.find(c => c.id === btn.getAttribute('data-view-rival-club'));
            if (club) openRivalSquadModal(club);
        });
    });
}

function openRivalSquadModal(club) {
    const rows = [...club.squad].sort((a, b) => (b.ca || 0) - (a.ca || 0)).map(p => {
        const eligible = needsContractDecision(p);
        const pending = gameState.pendingPreContractSignings.some(d => d.player.id === p.id);
        const action = pending
            ? `<span class="trait-tag">Pre-Contract Agreed</span>`
            : eligible
                ? `<button class="accept-btn" data-approach="${p.id}" style="padding:2px 8px;font-size:11px;">Approach</button>`
                : '';
        return `<div class="attr-row"><span>${p.position} - ${p.name} (age ${p.age})${p.isInjured ? ' 🩹' : ''}</span>
            <span>${p.contractYearsRemaining}yr left ${action}</span></div>`;
    }).join('');
    showModal(club.name, `Tier ${club.tier ?? '-'} club - ${club.squad.length} players. Players with 1 year left can be approached for a free-transfer pre-contract.`, rows, '');
    document.getElementById('modal-extra').querySelectorAll('[data-approach]').forEach(btn => {
        btn.addEventListener('click', () => {
            const player = club.squad.find(p => p.id === btn.getAttribute('data-approach'));
            if (player) openRivalPlayerOfferModal(player, club);
        });
    });
}

// ---------------------------------------------------------------------------
// Wage talks - iterative haggling shared by your own players' renewals and
// approaching a rival's player, instead of a single take-it-or-leave-it button.
// ---------------------------------------------------------------------------

let activeWageTalks = null; // { player, state, mode: 'renewal'|'poach', rivalClub, offerYears } - transient UI state

function openWageTalks(player, mode, rivalClub = null) {
    if (mode === 'poach' && gameState.squad.length + gameState.pendingPreContractSignings.length >= MAX_SQUAD_SIZE) {
        showModal('Squad Full', `Between your current squad and deals already agreed, you're at the ${MAX_SQUAD_SIZE}-player registration limit - offload someone before approaching another signing.`);
        return;
    }
    const state = startWageTalks(player, {
        forRivalPoach: mode === 'poach', rivalClub,
        myClubContext: { division: gameState.division, squadReputation: gameState.squadReputation }
    });
    activeWageTalks = { player, state, mode, rivalClub, offerYears: 2 };
    renderWageTalksModal();
}

function renderWageTalksModal() {
    const { player, state, mode, offerYears } = activeWageTalks;
    const body = `${player.name}${mode === 'poach' ? ` (${activeWageTalks.rivalClub.name})` : ''}  |  ` +
        `Current wage ~£${state.currentWage.toFixed(3)}M/wk  |  Demanding ~£${state.askingValue.toFixed(3)}M/wk  |  Round ${state.round}/4`;

    const yearPicker = `<div class="attr-row"><span>Contract length on offer</span><span>
        <button class="secondary-btn" data-set-years="2" style="padding:2px 8px;font-size:11px;${offerYears === 2 ? 'font-weight:700;' : ''}">2yr</button>
        <button class="secondary-btn" data-set-years="3" style="padding:2px 8px;font-size:11px;${offerYears === 3 ? 'font-weight:700;' : ''}">3yr</button>
    </span></div>`;

    let actions = '';
    if (state.status === 'open' || state.status === 'countered') {
        actions = `
            <button class="accept-btn" data-wt-offer="${state.currentWage.toFixed(4)}">Offer Current Wage</button>
            <button class="accept-btn" data-wt-offer="${(state.currentWage * 1.15).toFixed(4)}">Offer +15%</button>
            <button class="accept-btn" data-wt-offer="${state.askingValue.toFixed(4)}">Meet Demand</button>
            <button class="reject-btn" data-wt-walk="1">End Talks</button>
        `;
    }
    showModal(`Contract Talks: ${player.name}`, body, yearPicker, actions);

    document.getElementById('modal-extra').querySelectorAll('[data-set-years]').forEach(btn => {
        btn.addEventListener('click', () => {
            activeWageTalks.offerYears = parseInt(btn.getAttribute('data-set-years'), 10);
            renderWageTalksModal();
        });
    });

    document.getElementById('modal-actions').querySelectorAll('[data-wt-offer]').forEach(btn => {
        btn.addEventListener('click', () => {
            makeOffer(state, parseFloat(btn.getAttribute('data-wt-offer')));
            if (state.status === 'accepted') {
                if (mode === 'renewal') {
                    player.contractYearsRemaining = offerYears;
                    gameState.pendingRenewals = gameState.pendingRenewals.filter(pid => pid !== player.id);
                    document.getElementById('alert-overlay').classList.add('hidden');
                    showModal('Contract Agreed', `${player.name} signs a new ${offerYears}-year deal.`);
                } else {
                    player.preContractAgreedWith = 'YOU';
                    gameState.pendingPreContractSignings.push({ player, fromClubName: activeWageTalks.rivalClub.name, offerYears });
                    document.getElementById('alert-overlay').classList.add('hidden');
                    showModal('Pre-Contract Agreed', `${player.name} agrees to join on a free transfer once his current deal expires.`);
                }
                activeWageTalks = null;
                saveGameState();
            } else if (state.status === 'rejected') {
                document.getElementById('alert-overlay').classList.add('hidden');
                showModal('Talks Broken Off', `${player.name} isn't willing to move any closer - negotiations have ended.`);
                activeWageTalks = null;
            } else {
                renderWageTalksModal(); // countered - show the new demand, let the manager respond again
            }
        });
    });
    document.getElementById('modal-actions').querySelector('[data-wt-walk]')?.addEventListener('click', () => {
        document.getElementById('alert-overlay').classList.add('hidden');
        activeWageTalks = null;
    });
}

function openRivalPlayerOfferModal(player, club) {
    openWageTalks(player, 'poach', club);
}

function renderContractNegotiations() {
    const container = document.getElementById('contract-negotiations');
    if (!container) return;
    const players = gameState.squad.filter(p => (gameState.pendingRenewals || []).includes(p.id));
    if (players.length === 0) {
        container.innerHTML = '<p class="subtext">No contract situations need attention right now.</p>';
        return;
    }
    container.innerHTML = players.map(p => `
        <div class="decision-card">
            <div class="headline">${p.name} - ${p.contractYearsRemaining} year(s) remaining</div>
            <div class="detail">Current wage ~£${computeWeeklyWage(p).toFixed(3)}M/week</div>
            <div class="btn-row">
                <button class="accept-btn" data-negotiate="${p.id}">Open Contract Talks</button>
                <button class="reject-btn" data-letrundown="${p.id}">Let Run Down</button>
            </div>
        </div>`).join('');

    container.querySelectorAll('[data-negotiate]').forEach(btn => {
        btn.addEventListener('click', () => {
            const player = gameState.squad.find(p => String(p.id) === btn.getAttribute('data-negotiate'));
            if (player) openWageTalks(player, 'renewal');
        });
    });
    container.querySelectorAll('[data-letrundown]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-letrundown');
            const player = gameState.squad.find(p => String(p.id) === id);
            gameState.pendingRenewals = gameState.pendingRenewals.filter(pid => String(pid) !== id);
            if (player) showModal('Contract Situation', `${player.name} will run down his current deal.`);
            saveGameState();
        });
    });
}

// ---------------------------------------------------------------------------
// International duty report
// ---------------------------------------------------------------------------

function renderInternationalReport() {
    const container = document.getElementById('international-report');
    if (!container) return;
    if (!gameState.internationalReports || gameState.internationalReports.length === 0) {
        container.innerHTML = '<p class="subtext">No international call-ups yet this save.</p>';
        return;
    }
    container.innerHTML = gameState.internationalReports.slice(0, 15).map(r => `
        <div class="attr-row"><span>S${r.season} W${r.week} - ${r.playerName} vs ${r.opponent}</span>
        <span>${r.minutesPlayed}min${r.goals ? `, ${r.goals}g` : ''}${r.rating ? `, ${r.rating}★` : ', DNP'}</span></div>
    `).join('');
}

// ---------------------------------------------------------------------------
// Press conference
// ---------------------------------------------------------------------------

function renderPressConferenceButton() {
    const btn = document.getElementById('btn-press-conference');
    if (!btn) return;
    btn.disabled = !gameState.pressConference;
}

document.getElementById('btn-press-conference')?.addEventListener('click', () => {
    if (!gameState.pressConference) return;
    const pc = gameState.pressConference;
    const actions = pc.options.map(o => `<button class="accept-btn" data-tone="${o.key}">${o.label}</button>`).join('');
    showModal('Press Conference', pc.question, '', `<div class="btn-row" style="flex-wrap:wrap;">${actions}</div>`);
    document.getElementById('modal-actions').querySelectorAll('[data-tone]').forEach(btn => {
        btn.addEventListener('click', () => {
            const outcome = resolvePressTone(gameState, btn.getAttribute('data-tone'));
            gameState.pressConference = null;
            document.getElementById('alert-overlay').classList.add('hidden');
            showModal('Press Conference', outcome.headline);
            saveGameState();
        });
    });
});

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
        <div class="attr-row"><span>Contract remaining</span><span>${player.contractYearsRemaining ?? '-'} yrs</span></div>
        <div class="attr-row"><span>Squad Status</span><span>${player.hierarchyStatus ?? '-'}${player.isTeamLeader ? ' (Team Leader)' : ''}</span></div>
        ${player.happiness ? `<p style="margin:10px 0 4px;font-weight:700;">Happiness</p>
        <div class="attr-row"><span>Training / Playing Time / Contract</span><span>${player.happiness.training}/${player.happiness.playingTime}/${player.happiness.contract}</span></div>
        <div class="attr-row"><span>Club Fit / Treatment / Overall</span><span>${player.happiness.clubFit}/${player.happiness.treatment}/${player.happiness.overall}</span></div>` : ''}
        ${player.hasActiveTransferRequest ? `<div class="attr-row"><span style="color:var(--accent-red, #d33);">⚠ Wants to leave the club</span><span></span></div>` : ''}` : ''}
        <div class="attr-row"><span>Estimated value</span><span>£${value}M</span></div>
        <p style="margin:10px 0 4px;font-weight:700;">Technical</p>
        ${attrRows(player.attrs, ['finishing','passing','firstTouch','dribbling','crossing','tackling','technique','heading'])}
        <p style="margin:10px 0 4px;font-weight:700;">Mental</p>
        ${attrRows(player.attrs, ['decisions','anticipation','composure','vision','positioning','workRate','determination','teamwork','leadership','offTheBall'])}
        <p style="margin:10px 0 4px;font-weight:700;">Physical</p>
        ${attrRows(player.attrs, ['pace','acceleration','agility','balance','stamina','strength','jumpingReach'])}
        ${(player.internationalCaps || 0) > 0 ? (() => {
            const intl = internationalSummary(player);
            return `<p style="margin:10px 0 4px;font-weight:700;">International Duty</p>
            <div class="attr-row"><span>Caps / Goals / Avg Rating</span><span>${intl.caps} / ${intl.goals} / ${intl.avgRating ?? '-'}</span></div>
            ${intl.recent.map(h => `<div class="attr-row"><span>S${h.season} W${h.week} vs ${h.opponent}</span><span>${h.minutesPlayed}min${h.goals ? `, ${h.goals}g` : ''}${h.rating ? `, ${h.rating}★` : ''}</span></div>`).join('')}`;
        })() : ''}
        ${player.careerHistory && player.careerHistory.length > 0 ? `
        <p style="margin:10px 0 4px;font-weight:700;">Career History</p>
        ${[...player.careerHistory].reverse().map(h => `
            <div class="attr-row"><span>${crestHtml(h.clubName)}${h.season} - ${h.clubName}</span><span>${h.appearances}A ${h.goals}G ${h.assists}Ast ${h.avgRating ?? '-'}★${h.mvpCount ? ' 🏅'+h.mvpCount : ''}</span></div>
        `).join('')}` : ''}
    `;

    const actions = isMarket
        ? `<button class="confirm-btn" id="profile-sign-btn">Negotiate Transfer (est. £${value}M)</button>`
        : `<button class="secondary-btn" id="profile-praise-btn">Praise</button>
           <button class="reject-btn" id="profile-criticize-btn">Criticize</button>`;

    showModal(player.name, body, extra, actions);

    if (isMarket) {
        document.getElementById('profile-sign-btn').addEventListener('click', () => {
            document.getElementById('alert-overlay').classList.add('hidden');
            openTransferNegotiation(player);
        });
    } else {
        document.getElementById('profile-praise-btn')?.addEventListener('click', () => {
            const result = talkToPlayer(player, 'praise');
            document.getElementById('alert-overlay').classList.add('hidden');
            showModal('Talk to Player', result.message);
            saveGameState();
        });
        document.getElementById('profile-criticize-btn')?.addEventListener('click', () => {
            const result = talkToPlayer(player, 'criticize');
            document.getElementById('alert-overlay').classList.add('hidden');
            showModal('Talk to Player', result.message);
            saveGameState();
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

        p.isFatigued = (isEuropeWeek && !p.isInjured) || p.isFatigued; // international duty can also set this - don't clear it early

        const physio = physioQuality(gameState.staff);

        // --- Injury system: one weekly probabilistic check per player ---
        if (p.isInjured) {
            tickRecovery(p, physio);
        } else {
            weeklyInjuryCheck(
                p,
                { matchLoad: isEuropeWeek ? 2 : 1, trainingIntensity: trainingIntensityFor(gameState.trainingFocus), physioQuality: physio },
                { season: gameState.season, week: gameState.week }
            );
            applyWeeklyTrainingNudge(p, gameState.trainingFocus, gameState.coachingQuality);
        }

        // --- Development: monthly, non-linear CA/PA growth roll ---
        if (isMonthTick) {
            developPlayer(p, club(), { season: gameState.season, week: gameState.week }, developmentGrowthMultiplier(gameState.trainingFocus));
        }
    });

    // --- Dynamics: hierarchy is a slow-moving thing (monthly); happiness,
    // team-wide readings, and the transfer-request escalation check run
    // every week, same cadence as morale used to move on its own.
    if (isMonthTick) assignHierarchy(gameState.squad);
    gameState.squad.forEach(p => {
        p.happiness = computeHappiness(p, {
            facilities: gameState.facilities, coachingQuality: effectiveCoachingQuality(gameState.coachingQuality, gameState.staff),
            clubDivision: gameState.division, clubReputation: gameState.squadReputation
        });
        // Happiness is the underlying "true" satisfaction reading; morale
        // drifts toward it rather than snapping to it, so the existing
        // match-result morale nudges (a win/loss bump) still have a real
        // short-term effect and aren't just overwritten every week.
        p.morale = clamp((p.morale ?? 12) + (p.happiness.overall - (p.morale ?? 12)) * 0.3, 1, 20);

        // Promise-keeping: a reassured player gets one real chance - if their
        // playing-time share hasn't actually improved a few weeks later, the
        // broken promise costs more trust than never promising at all.
        if (p.promiseMinutesMade) {
            p.promiseWeeksWaited = (p.promiseWeeksWaited || 0) + 1;
            if (p.promiseWeeksWaited >= 4) {
                const share = clamp((p.recentMinutes || 0) / (90 * 4), 0, 1);
                const kept = share >= 0.35;
                p.treatmentScore = clamp((p.treatmentScore ?? 12) + (kept ? 1.5 : -4), 1, 20);
                if (!kept) p.morale = clamp(p.morale - 3, 1, 20);
                gameState.boardroomFeed = [{ club: gameState.clubName, type: kept ? 'promise_kept' : 'promise_broken',
                    headline: kept ? `Promise to ${p.name} honored - his playing time picked up as agreed.`
                        : `Broken promise to ${p.name} - his playing time never improved as agreed.`,
                    detail: '' }, ...gameState.boardroomFeed].slice(0, 10);
                p.promiseMinutesMade = false;
                p.promiseWeeksWaited = 0;
            }
        }

        if (!p.hasActiveTransferRequest && checkTransferRequestRisk(p)) {
            gameState.activeTransferRequests = [...new Set([...gameState.activeTransferRequests, p.id])];
            gameState.inboxHasUnseen = true;
        }
    });
    {
        const squadIds = new Set(gameState.squad.map(p => p.id));
        gameState.activeTransferRequests = (gameState.activeTransferRequests || []).filter(id => squadIds.has(id));
    }
    {
        const recentWinPct = gameState.recentForm.length > 0
            ? gameState.recentForm.filter(r => r === 'W').length / gameState.recentForm.length : 0.5;
        gameState.teamDynamics = computeTeamDynamics(gameState.squad, recentWinPct);
    }

    // --- Rival clubs get the same weekly injury risk, real aging, and
    // monthly development your own squad does - previously frozen in time,
    // immune to injuries, and never actually losing anyone to contract
    // expiry. Depth is topped up on the same monthly cadence so an injury
    // wave (or, at rollover, several contracts expiring at once) doesn't
    // quietly hollow a club out over a long save.
    const livingLeagueClubs = [...gameState.rivals, ...(gameState.otherDivision ? gameState.otherDivision.clubs : [])];
    livingLeagueClubs.forEach(clubEntry => {
        clubEntry.squad.forEach(p => {
            // Backward-compat for saves generated before rivals had real
            // birthdates: assign one lazily rather than skip aging forever.
            if (!p.birthdate) p.birthdate = assignBirthdate(p.age, currentDate);
            if (isBirthdayInRange(p.birthdate, prevDate, currentDate)) p.age += 1;

            if (p.isInjured) {
                tickRecovery(p, 0); // no staff/physio system modeled for rival clubs
            } else {
                weeklyInjuryCheck(p, { matchLoad: 1, trainingIntensity: 'normal', physioQuality: 0 }, { season: gameState.season, week: gameState.week });
            }
            if (isMonthTick) {
                const rivalClubProxy = { facilities: clamp((clubEntry.tier ?? 5) * 2, 4, 20), coachingQuality: clamp((clubEntry.tier ?? 5) * 2, 4, 20) };
                developPlayer(p, rivalClubProxy, { season: gameState.season, week: gameState.week }, 1.0);
            }
        });
        if (isMonthTick) maintainRivalDepth(clubEntry, currentDate);
    });

    // --- Finances: wages, sponsorship, and matchday income run every week ---
    {
        const round = gameState.schedule ? gameState.schedule[gameState.week - 1] : null;
        const isHomeThisWeek = round ? round.some(([h, a]) => h === 0) : false;
        applyWeeklyFinances(gameState, { staffWageBill: computeStaffWageBill(gameState.staff), isHomeFixtureThisWeek: isHomeThisWeek });
    }

    // --- International duty: real FIFA-window weeks, a report, not a job ---
    if (INTERNATIONAL_BREAK_WEEKS.includes(gameState.week)) {
        const reports = runInternationalWindow(gameState.squad, gameState.season, gameState.week);
        if (reports.length > 0) {
            gameState.internationalReports = [...reports.map(r => ({ season: gameState.season, week: gameState.week, ...r })), ...gameState.internationalReports].slice(0, 30);
            gameState.inboxHasUnseen = true;
            const lines = reports.map(r => `${r.playerName}: ${r.minutesPlayed}min${r.goals ? `, ${r.goals}g` : ''}${r.rating ? `, ${r.rating} rating` : ''} vs ${r.opponent}`);
            showModal('International Break', `Call-ups this window:\n${lines.join('\n')}`);
        }
    }

    // --- Weekly press conference ---
    gameState.pressConference = generatePressConference(gameState);

    // --- Contract negotiation window: flag anyone entering their final year ---
    gameState.pendingRenewals = gameState.squad.filter(needsContractDecision).map(p => p.id);

    // --- Transfer window activity: incoming bids and loan requests ---
    if (windowType) {
        const newBids = generateIncomingBids(gameState, windowType);
        const newLoans = generateLoanRequests(gameState, windowType);
        gameState.pendingBids = [...gameState.pendingBids, ...newBids].slice(-8);
        gameState.pendingLoanRequests = [...gameState.pendingLoanRequests, ...newLoans].slice(-8);
        if (newBids.length > 0 || newLoans.length > 0) {
            gameState.inboxHasUnseen = true;
        }
        if (newBids.length > 0) {
            showModal('Transfer Interest', `${newBids.length} new bid(s) received - check your Inbox.`);
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

        // --- Fix: close the off-season birthday gap ---
        // weekToDate() only advances continuously WITHIN a season (weekly
        // Saturdays); the jump from this season's last matchday to next
        // season's real kickoff date is a genuine ~3-4 month gap that the
        // normal per-week isBirthdayInRange(prevDate, currentDate) check
        // above never spans - prevDate/currentDate are only ever 7 days
        // apart. Left alone, any player whose birthday falls in that
        // off-season window would NEVER age up, for their entire time in
        // the save. One extra sweep here, across the actual gap, catches it.
        const nextSeasonStartDate = seasonStartDate(closingSeason + 1, BASE_YEAR);
        const closeSeasonGapBirthday = (p) => {
            if (p.birthdate && isBirthdayInRange(p.birthdate, currentDate, nextSeasonStartDate)) p.age += 1;
        };
        gameState.squad.forEach(closeSeasonGapBirthday);
        gameState.youthSquad.forEach(closeSeasonGapBirthday);
        gameState.rivals.forEach(r => r.squad.forEach(closeSeasonGapBirthday));
        if (gameState.otherDivision) {
            gameState.otherDivision.clubs.forEach(c => c.squad.forEach(closeSeasonGapBirthday));
        }

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

        // --- Rival clubs: same contract expiry + depth-maintenance rivals now
        // get every week during the season (see the weekly loop above), run
        // once more here at rollover so any player whose deal just ran out
        // gets replaced before next season's schedule locks in. ---
        const livingLeagueClubsAtRollover = [...gameState.rivals, ...(gameState.otherDivision ? gameState.otherDivision.clubs : [])];
        livingLeagueClubsAtRollover.forEach(clubEntry => {
            tickRivalContracts(clubEntry);
            maintainRivalDepth(clubEntry, currentDate);
        });

        // --- Pre-contract signings complete now that the old club's contract
        // tick has actually released the player (tickRivalContracts forced
        // their expiry above rather than letting the old club re-sign them).
        if (gameState.pendingPreContractSignings.length > 0) {
            gameState.pendingPreContractSignings.forEach(deal => {
                const player = deal.player;
                if (gameState.squad.length >= MAX_SQUAD_SIZE) {
                    // A hard backstop for the rare case where several
                    // pre-contracts were agreed in the same season and
                    // collectively would overflow the registration cap -
                    // the player already left their old club, so this is a
                    // real (if unusual) outcome, not silently discarded.
                    gameState.boardroomFeed = [{ club: gameState.clubName, type: 'pre_contract_fell_through',
                        headline: `${player.name}'s move fell through - the squad was already full when his old contract expired`,
                        detail: `Free to speak to other clubs.` }, ...gameState.boardroomFeed].slice(0, 10);
                    return;
                }
                player.contractYearsRemaining = deal.offerYears;
                player.preContractAgreedWith = null;
                player.injuryHistory = player.injuryHistory || [];
                player.recentMinutes = 0;
                player.appearances = player.appearances || 0;
                gameState.squad.push(player);
                gameState.boardroomFeed = [{ club: gameState.clubName, type: 'pre_contract_arrival',
                    headline: `${player.name} joins on a free transfer from ${deal.fromClubName}`,
                    detail: `Pre-contract agreed earlier in the season - ${deal.offerYears}-year deal.` }, ...gameState.boardroomFeed].slice(0, 10);
            });
            gameState.pendingPreContractSignings = [];
        }

        // --- Youth academy: fresh intake every season, scaled by facilities/coaching ---
        const intake = generateYouthIntake(gameState.facilities, effectiveCoachingQuality(gameState.coachingQuality, gameState.staff), Date.now());
        const rolloverReferenceDate = weekToDate(gameState.season, gameState.week, BASE_YEAR);
        intake.forEach(p => { p.birthdate = assignBirthdate(p.age, rolloverReferenceDate); });
        gameState.youthSquad = [...(gameState.youthSquad || []), ...intake].slice(0, 20); // cap the pool so it doesn't grow forever unmanaged
        if (intake.length > 0) {
            gameState.boardroomFeed = [{ club: gameState.clubName, type: 'youth_intake',
                headline: `Youth intake: ${intake.length} new prospect(s) join the academy`,
                detail: 'Check the Club tab to review and promote them.' }, ...gameState.boardroomFeed].slice(0, 10);
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

    // Resolve this fixture's Starting XI + planned halftime substitutions against
    // the live squad (teams[0] is always your club - see teamsById()).
    const yourTeam = teams[0];
    const resolvedSubs = resolvePlannedSubs(yourTeam.startingXI, yourTeam.bench);
    const opponentPairForSubs = round.find(([h, a]) => h === 0 || a === 0);
    const youAreHomeForSubs = opponentPairForSubs && opponentPairForSubs[0] === 0;

    const { yourResult, scorers, boardroomEvents, yourMatchResult } = simulateRound(
        round, teams, gameState.table, weather, isBigMatch,
        youAreHomeForSubs ? resolvedSubs : [], youAreHomeForSubs ? [] : resolvedSubs
    );
    updateGoldenBoot(gameState.goldenBoot, scorers);
    if (gameState.otherDivision) {
        simulateIndependentRound(gameState.otherDivision, gameState.week, weather);
    }
    if (boardroomEvents && boardroomEvents.length > 0) {
        gameState.boardroomFeed = [...boardroomEvents, ...gameState.boardroomFeed].slice(0, 10);
    }

    // Minutes/appearances/fitness now reflect who actually featured in the
    // Starting XI or came on as a substitute - not the whole fit squad.
    const subbedOffIds = new Set((yourMatchResult?.subEvents || []).filter(e => e.team === (youAreHomeForSubs ? 'home' : 'away')).map(e => e.outId));
    const subbedInNames = new Set((yourMatchResult?.subEvents || []).filter(e => e.team === (youAreHomeForSubs ? 'home' : 'away')).map(e => e.inName));
    const featuredIds = new Set([...yourTeam.startingXI.map(p => p.id)]);

    gameState.squad.forEach(p => {
        if (p.isInjured || p.onLoanAt) return;
        const wasStarter = featuredIds.has(p.id);
        const wasSubOn = subbedInNames.has(p.name);
        if (wasStarter) {
            const minutes = subbedOffIds.has(p.id) ? 45 : 90;
            p.recentMinutes = (p.recentMinutes || 0) + minutes;
            p.appearances = (p.appearances || 0) + 1;
            p.fitness = Math.max(4, p.fitness - (minutes === 90 ? 2 : 1));
            p.sharpness = Math.min(20, p.sharpness + 1);
        } else if (wasSubOn) {
            p.recentMinutes = (p.recentMinutes || 0) + 45;
            p.appearances = (p.appearances || 0) + 1;
            p.fitness = Math.max(4, p.fitness - 1);
            p.sharpness = Math.min(20, p.sharpness + 1);
        } else {
            // Didn't feature this week - rest helps fitness recover a little.
            p.fitness = Math.min(20, p.fitness + 1);
        }
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

// ---------------------------------------------------------------------------
// Transfer fee negotiation - haggling over a market/scouted candidate
// instead of paying a fixed sticker price.
// ---------------------------------------------------------------------------

let activeTransferNegotiation = null; // { player, state, baseValue } - transient UI state, not persisted

function openTransferNegotiation(player) {
    const baseValue = computeMarketValue(player);
    // Clubs ask a premium over "true" value - a real negotiation starts with
    // some room to talk down, not a fixed sticker price.
    const markup = 1.05 + Math.random() * 0.25;
    const askingPrice = Math.round(baseValue * markup * 10) / 10;
    const toughness = clamp(0.25 + (player.ca - 100) / 150, 0.2, 0.85); // better players, tougher selling club
    activeTransferNegotiation = { player, state: startNegotiation(askingPrice, toughness), baseValue };
    renderTransferNegotiationModal();
}

function renderTransferNegotiationModal() {
    const { player, state, baseValue } = activeTransferNegotiation;
    const body = `Estimated value: £${baseValue}M  |  Current asking price: £${state.askingValue.toFixed(1)}M  |  Round ${state.round}/4`;

    let actions = '';
    if (state.status === 'open' || state.status === 'countered') {
        actions = `
            <button class="accept-btn" data-tf-offer="${(state.askingValue * 0.8).toFixed(2)}">Offer £${(state.askingValue * 0.8).toFixed(1)}M</button>
            <button class="accept-btn" data-tf-offer="${(state.askingValue * 0.92).toFixed(2)}">Offer £${(state.askingValue * 0.92).toFixed(1)}M</button>
            <button class="accept-btn" data-tf-offer="${state.askingValue.toFixed(2)}">Meet Asking Price</button>
            <button class="reject-btn" data-tf-walk="1">Walk Away</button>
        `;
    }
    showModal(`Negotiating: ${player.name}`, body, '', actions);

    document.getElementById('modal-actions').querySelectorAll('[data-tf-offer]').forEach(btn => {
        btn.addEventListener('click', () => {
            makeOffer(state, parseFloat(btn.getAttribute('data-tf-offer')));
            if (state.status === 'accepted') {
                finalizeTransfer(player, state.finalValue);
                activeTransferNegotiation = null;
            } else if (state.status === 'rejected') {
                document.getElementById('alert-overlay').classList.add('hidden');
                showModal('Talks Broken Off', `The selling club won't move any further - negotiations for ${player.name} have ended.`);
                activeTransferNegotiation = null;
            } else {
                renderTransferNegotiationModal(); // countered - show the new asking price, let the manager respond again
            }
        });
    });
    document.getElementById('modal-actions').querySelector('[data-tf-walk]')?.addEventListener('click', () => {
        walkAway(state);
        document.getElementById('alert-overlay').classList.add('hidden');
        activeTransferNegotiation = null;
    });
}

export function finalizeTransfer(player, agreedPrice) {
    if (gameState.squad.length >= MAX_SQUAD_SIZE) {
        document.getElementById('alert-overlay').classList.add('hidden');
        showModal('Transfer Failed', `Deal agreed at £${agreedPrice.toFixed(1)}M, but the squad is already at its ${MAX_SQUAD_SIZE}-player registration limit - offload someone first.`);
        return;
    }
    if (gameState.budget < agreedPrice) {
        document.getElementById('alert-overlay').classList.add('hidden');
        showModal('Transfer Failed', `Deal agreed at £${agreedPrice.toFixed(1)}M, but the club can't afford it - insufficient funds.`);
        return;
    }
    gameState.budget -= agreedPrice;
    gameState.transferMarket = gameState.transferMarket.filter(p => p.id !== player.id);
    player.scoutKnowledge = 95; // fully known once he's your player
    gameState.squad.push(player);
    triggerAIEvent(player, 'TRANSFER_IN', 'Player successfully acquired on the transfer market.');
    document.getElementById('alert-overlay').classList.add('hidden');
    showModal('Deal Agreed!', `${player.name} joins for £${agreedPrice.toFixed(1)}M.`);
    saveGameState();
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

export function scoutMarketCandidate() {
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
    candidate.scoutKnowledge = Math.min(90, 15 + Math.floor(Math.random() * 25) + scoutKnowledgeBonus(gameState.staff));
    candidate.birthdate = assignBirthdate(candidate.age, weekToDate(gameState.season, gameState.week, BASE_YEAR));
    gameState.transferMarket.push(candidate);
    saveGameState();
    return candidate;
}

document.getElementById('btn-scout-market').addEventListener('click', scoutMarketCandidate);

function startWithClub(name, tier, reputation, division = 1) {
    gameState.clubName = name;
    gameState.squadReputation = reputation;
    gameState.division = division;
    gameState.squad = generateSquadForClub(tier);
    document.getElementById('club-select-overlay').classList.add('hidden');
    initLeagueIfNeeded();
    saveGameState();
    updateUI();
}

if (IS_NEW_GAME) {
    let selectedDivision = 1;
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
            startWithClub(c.name, c.tier, c.reputation, selectedDivision);
        });
    });
    document.getElementById('btn-start-custom-club').addEventListener('click', () => {
        const name = document.getElementById('custom-club-name').value.trim() || 'Your Club';
        startWithClub(name, 5, 90, selectedDivision); // custom clubs start as a reasonable mid-table side
    });

    document.querySelectorAll('[data-division-choice]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedDivision = parseInt(btn.getAttribute('data-division-choice'), 10);
            document.querySelectorAll('[data-division-choice]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
    document.querySelector('[data-division-choice="1"]')?.classList.add('active');

    document.getElementById('btn-preview-leagues')?.addEventListener('click', () => {
        const sample1 = generateRivals(new Date());
        const sample2 = generateRivals(new Date());
        const rows = (label, clubs) => `<p style="margin:10px 0 4px;font-weight:700;">${label}</p>` +
            [...clubs].sort((a, b) => (b.tier ?? 5) - (a.tier ?? 5)).map(c =>
                `<div class="attr-row"><span>${c.name}</span><span>Tier ${c.tier ?? '-'}/9</span></div>`).join('');
        showModal(
            'League Preview',
            'A representative sample of each division\'s club spread - the exact 19 clubs will be re-rolled fresh when you start, but the tier distribution (a handful of big clubs, a competitive mid-table, a few strugglers) will look like this.',
            rows('Division 1 - Top Flight (sample)', sample1) + rows('Division 2 - Second Tier (sample)', sample2),
            ''
        );
    });

    document.getElementById('club-select-overlay').classList.remove('hidden');
} else {
    updateUI();
}
