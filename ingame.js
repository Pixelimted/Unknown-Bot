// ─── In-memory command queue ───────────────────────────────────────────────────
// Each entry lives here until the targeted Roblox server picks it up and
// reports back, or until the 30-second timeout fires. Commands are now
// tagged with a targetJobId so only the chosen server's bridge runs them.

const pending = new Map();
let counter   = 0;

function enqueue(command, targetJobId, channelId, userId) {
    const id = "cmd_" + Date.now() + "_" + (++counter);

    return new Promise(function (resolve) {
        const timeout = setTimeout(function () {
            if (!pending.has(id)) return;
            pending.delete(id);
            resolve({
                success: false,
                result:  "No Roblox server picked up the command within 30 seconds. The target server may have shut down or the bridge script isn't running.",
            });
        }, 30_000);

        pending.set(id, { resolve, timeout, command, targetJobId, channelId, userId, queuedAt: Date.now() });
    });
}

// only returns commands targeted at this specific jobId
function getPendingFor(jobId) {
    const out = [];
    for (const [id, data] of pending.entries()) {
        if (data.targetJobId === jobId) {
            out.push({ id: id, command: data.command });
        }
    }
    return out;
}

function resolve(id, result, success) {
    const entry = pending.get(id);
    if (!entry) return false;

    clearTimeout(entry.timeout);
    entry.resolve({ success: success, result: result });
    pending.delete(id);
    return true;
}

function pendingCount() {
    return pending.size;
}

module.exports = { enqueue, getPendingFor, resolve, pendingCount };
