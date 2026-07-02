
const fs   = require("fs");
const path = require("path");

const DATA_DIR = fs.existsSync("/data") ? "/data" : path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CASES_FILE    = path.join(DATA_DIR, "cases.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const ROBLOX_FILE   = path.join(DATA_DIR, "roblox.json");
const MUTES_FILE    = path.join(DATA_DIR, "mutes.json");

let casesCache    = null;
let settingsCache = null;
let robloxCache   = null;
let mutesCache    = null;

function read(file, cacheRef) {
    if (cacheRef.val) return cacheRef.val;
    if (!fs.existsSync(file)) fs.writeFileSync(file, "{}");
    try { cacheRef.val = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { cacheRef.val = {}; }
    return cacheRef.val;
}

function write(file, cacheRef, data) {
    cacheRef.val = data;
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─── Cases ────────────────────────────────────────────────────────────────────

const casesRef    = { val: null };
const settingsRef = { val: null };
const robloxRef   = { val: null };
const mutesRef    = { val: null };

function getCases()             { return read(CASES_FILE,    casesRef);    }
function saveCases(d)           { write(CASES_FILE,    casesRef,    d);    }
function getSettings()          { return read(SETTINGS_FILE, settingsRef); }
function saveSettings(d)        { write(SETTINGS_FILE, settingsRef, d);    }
function getRoblox()            { return read(ROBLOX_FILE,   robloxRef);   }
function saveRoblox(d)          { write(ROBLOX_FILE,   robloxRef,   d);    }
function getMutes()             { return read(MUTES_FILE,    mutesRef);    }
function saveMutes(d)           { write(MUTES_FILE,    mutesRef,    d);    }

function nextCaseId(guildId) {
    const cases = getCases();
    if (!cases[guildId]) cases[guildId] = { counter: 0, entries: {} };
    cases[guildId].counter += 1;
    saveCases(cases);
    return cases[guildId].counter;
}

function addCase(guildId, data) {
    const cases = getCases();
    if (!cases[guildId]) cases[guildId] = { counter: 0, entries: {} };
    const id = nextCaseId(guildId);
    cases[guildId].entries[id] = { id, ...data, createdAt: Date.now() };
    saveCases(cases);
    return id;
}

function getCase(guildId, id) {
    const cases = getCases();
    return cases[guildId]?.entries?.[id] || null;
}

function getUserCases(guildId, userId) {
    const cases = getCases();
    const entries = cases[guildId]?.entries || {};
    return Object.values(entries).filter(c => c.targetId === userId);
}

function getUserWarnCount(guildId, userId) {
    return getUserCases(guildId, userId).filter(c => c.type === "warn").length;
}

function updateCase(guildId, id, updates) {
    const cases = getCases();
    if (!cases[guildId]?.entries?.[id]) return false;
    cases[guildId].entries[id] = { ...cases[guildId].entries[id], ...updates };
    saveCases(cases);
    return true;
}

function getGuildSettings(guildId) {
    const s = getSettings();
    return s[guildId] || {};
}

function setGuildSettings(guildId, updates) {
    const s = getSettings();
    s[guildId] = { ...(s[guildId] || {}), ...updates };
    saveSettings(s);
}

function getRobloxUsername(userId) {
    const r = getRoblox();
    return r[userId] || null;
}

function setRobloxUsername(userId, username) {
    const r = getRoblox();
    r[userId] = username;
    saveRoblox(r);
}

function addMute(guildId, userId, expiresAt) {
    const m = getMutes();
    if (!m[guildId]) m[guildId] = {};
    m[guildId][userId] = expiresAt;
    saveMutes(m);
}

function removeMute(guildId, userId) {
    const m = getMutes();
    if (m[guildId]) {
        delete m[guildId][userId];
        saveMutes(m);
    }
}

function getExpiredMutes() {
    const m    = getMutes();
    const now  = Date.now();
    const list = [];
    for (const [guildId, users] of Object.entries(m)) {
        for (const [userId, expiresAt] of Object.entries(users)) {
            if (expiresAt !== null && expiresAt <= now) {
                list.push({ guildId, userId });
            }
        }
    }
    return list;
}

function getStats() {
    const cases = getCases();
    const mutes = getMutes();

    let totalCases = 0;
    const byType = { ban: 0, kick: 0, mute: 0, warn: 0, note: 0, unban: 0, unmute: 0 };

    for (const guildId in cases) {
        const entries = cases[guildId].entries || {};
        for (const id in entries) {
            totalCases += 1;
            const type = entries[id].type;
            if (byType[type] !== undefined) byType[type] += 1;
        }
    }

    let activeMutes = 0;
    const now = Date.now();
    for (const guildId in mutes) {
        for (const userId in mutes[guildId]) {
            if (mutes[guildId][userId] > now) activeMutes += 1;
        }
    }

    return {
        totalCases: totalCases,
        byType: byType,
        activeMutes: activeMutes,
        guildCount: Object.keys(cases).length,
    };
}

module.exports = {
    addCase, getCase, getUserCases, getUserWarnCount, updateCase,
    getGuildSettings, setGuildSettings,
    getRobloxUsername, setRobloxUsername,
    addMute, removeMute, getExpiredMutes,
    getStats,
};
