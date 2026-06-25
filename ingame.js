const pendingCommands = new Map(); // commandId -> { resolve, channelId, userId, command }

let commandCounter = 0;

function queueCommand(command, channelId, userId) {
    const id = `cmd_${++commandCounter}_${Date.now()}`;
    return new Promise((resolve) => {
        pendingCommands.set(id, { resolve, channelId, userId, command, queuedAt: Date.now() });
        // Auto-expire after 30 seconds if Roblox never picks it up
        setTimeout(() => {
            if (pendingCommands.has(id)) {
                pendingCommands.get(id).resolve({ success: false, result: "Command timed out — no Roblox server picked it up within 30 seconds." });
                pendingCommands.delete(id);
            }
        }, 30_000);
    });
}

function getPendingCommands() {
    const out = [];
    for (const [id, data] of pendingCommands.entries()) {
        out.push({ id, command: data.command });
    }
    return out;
}

function resolveCommand(id, result, success) {
    const entry = pendingCommands.get(id);
    if (!entry) return false;
    entry.resolve({ success, result });
    pendingCommands.delete(id);
    return true;
}

module.exports = { queueCommand, getPendingCommands, resolveCommand };
