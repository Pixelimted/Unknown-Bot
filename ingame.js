// ─── In-memory command queue ───────────────────────────────────────────────────
// Each entry lives here until Roblox picks it up and reports back,
// or until the 30-second timeout fires.

const pending = new Map();
let counter   = 0;

function enqueue(command, channelId, userId) {
    const id = `cmd_${Date.now()}_${++counter}`;

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            if (!pending.has(id)) return;
            pending.delete(id);
            resolve({
                success: false,
                result:  "No Roblox server picked up the command within 30 seconds. Make sure the DiscordCmdrBridge script is running in a live server.",
            });
        }, 30_000);

        pending.set(id, { resolve, timeout, command, channelId, userId, queuedAt: Date.now() });
    });
}

function getPending() {
    return [...pending.entries()].map(([id, data]) => ({
        id,
        command: data.command,
    }));
}

function resolve(id, result, success) {
    const entry = pending.get(id);
    if (!entry) return false;

    clearTimeout(entry.timeout);
    entry.resolve({ success, result });
    pending.delete(id);
    return true;
}

function pendingCount() {
    return pending.size;
}

module.exports = { enqueue, getPending, resolve, pendingCount };
