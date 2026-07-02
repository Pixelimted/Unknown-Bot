// ─── Live server tracking ───────────────────────────────────────────────────────
// Each Roblox server heartbeats here every ~15s with its JobId and player list.
// Entries expire automatically if a server stops heartbeating (crashed / shut down).

const HEARTBEAT_TIMEOUT_MS = 45_000; // consider a server dead after 45s of silence

const servers = new Map(); // jobId -> { jobId, placeId, visitType, players, updatedAt }

function heartbeat(data) {
    if (!data || !data.jobId) return false;

    servers.set(data.jobId, {
        jobId:     data.jobId,
        placeId:   data.placeId || null,
        visitType: data.visitType || "Public", // Public | Private | Reserved | Friend
        players:   Array.isArray(data.players) ? data.players : [],
        updatedAt: Date.now(),
    });

    return true;
}

function pruneDead() {
    const now = Date.now();
    for (const [jobId, server] of servers.entries()) {
        if (now - server.updatedAt > HEARTBEAT_TIMEOUT_MS) {
            servers.delete(jobId);
        }
    }
}

function getLiveServers() {
    pruneDead();
    return [...servers.values()].sort(function (a, b) {
        return b.players.length - a.players.length; // most populated first
    });
}

function getServer(jobId) {
    pruneDead();
    return servers.get(jobId) || null;
}

// clear dead entries on an interval too, not just on read
setInterval(pruneDead, 15_000);

module.exports = { heartbeat, getLiveServers, getServer };
