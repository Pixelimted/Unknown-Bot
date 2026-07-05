// ── Prefix commands ──────────────────────────────────────────────────────────
// Lets moderators type e.g. "!ban @user reason" instead of the slash command.
// These are aliases only — they call the exact same handler functions as the
// slash commands, so there is exactly one place moderation logic lives.
//
// Because handlers are built expecting a Discord.js Interaction object
// (interaction.options.getUser(), interaction.reply(), etc), this builds a
// small compatibility shim so a plain Message can be passed through the same
// code path without forking any logic.

const db = require("./db");

// Maps prefix command name -> [slash command name, ordered arg names]
// Arg parsing here is intentionally simple: whitespace-split, with the last
// arg allowed to contain spaces (treated as the reason/message).
const PREFIX_COMMAND_MAP = {
    ban:         { command: "ban",         args: ["user", "reason"] },
    unban:       { command: "unban",       args: ["userid", "reason"] },
    kick:        { command: "kick",        args: ["user", "reason"] },
    mute:        { command: "mute",        args: ["user", "duration", "reason"] },
    unmute:      { command: "unmute",      args: ["user", "reason"] },
    warn:        { command: "warn",        args: ["user", "reason"] },
    note:        { command: "note",        args: ["user", "note"] },
    cases:       { command: "cases",       args: ["user"] },
    viewlog:     { command: "viewlog",     args: ["limit"] },
    purge:       { command: "purge",       args: ["amount"] },
    slowmode:    { command: "slowmode",    args: ["seconds"] },
    lock:        { command: "lock",        args: ["reason"] },
    unlock:      { command: "unlock",      args: [] },
    userinfo:    { command: "userinfo",    args: ["user"] },
};

function parseArgs(rawArgs, argNames) {
    const parts = rawArgs.trim().length ? rawArgs.trim().split(/\s+/) : [];
    const result = {};

    for (let i = 0; i < argNames.length; i++) {
        if (i === argNames.length - 1) {
            // last named arg absorbs everything remaining (reason/note/message)
            result[argNames[i]] = parts.slice(i).join(" ") || null;
        } else {
            result[argNames[i]] = parts[i] || null;
        }
    }

    return result;
}

async function resolveUserArg(message, raw) {
    if (!raw) return null;

    const mention = raw.match(/^<@!?(\d+)>$/);
    if (mention) {
        return message.client.users.fetch(mention[1]).catch(() => null);
    }
    if (/^\d{15,20}$/.test(raw)) {
        return message.client.users.fetch(raw).catch(() => null);
    }
    return null;
}

// Builds a minimal object that mimics the parts of a Discord.js
// ChatInputCommandInteraction that the existing handlers actually use.
function buildFakeInteraction(message, parsedArgs, resolvedUsers, resolvedChannels) {
    let deferredMessage = null;
    let hasReplied = false;

    return {
        guild:       message.guild,
        guildId:     message.guild.id,
        user:        message.author,
        member:      message.member,
        channelId:   message.channel.id,
        channel:     message.channel,
        client:      message.client,
        deferred:    false,
        replied:     false,

        options: {
            getUser:    (name) => resolvedUsers[name] || null,
            getString:  (name) => (parsedArgs[name] !== undefined ? parsedArgs[name] : null),
            getInteger: (name) => (parsedArgs[name] !== undefined && parsedArgs[name] !== null ? parseInt(parsedArgs[name], 10) : null),
            getBoolean: (name) => (parsedArgs[name] === "true" || parsedArgs[name] === "yes"),
            getChannel: (name) => resolvedChannels[name] || null,
            getRole:    () => null,
            getSubcommand: () => null,
        },

        deferReply: async function () {
            deferredMessage = await message.reply({ content: "Working on it..." });
            this.deferred = true;
            return deferredMessage;
        },

        reply: async function (payload) {
            hasReplied = true;
            return message.reply(normalizeReplyPayload(payload));
        },

        editReply: async function (payload) {
            if (deferredMessage) {
                return deferredMessage.edit(normalizeReplyPayload(payload));
            }
            hasReplied = true;
            return message.reply(normalizeReplyPayload(payload));
        },
    };
}

function normalizeReplyPayload(payload) {
    // Interaction replies support { ephemeral: true } which Message.reply
    // doesn't understand — strip anything Message-incompatible.
    if (typeof payload === "string") return payload;
    const { ephemeral, ...rest } = payload || {};
    return rest;
}

async function handlePrefixCommand(message, prefix, handlers) {
    const withoutPrefix = message.content.slice(prefix.length).trim();
    const [cmdName, ...rest] = withoutPrefix.split(/\s+/);
    const rawArgs = withoutPrefix.slice(cmdName.length).trim();

    const mapping = PREFIX_COMMAND_MAP[cmdName.toLowerCase()];
    if (!mapping) return false;

    const handler = handlers[mapping.command];
    if (!handler) return false;

    const parsedArgs = parseArgs(rawArgs, mapping.args);

    const resolvedUsers = {};
    if (mapping.args.includes("user")) {
        resolvedUsers.user = await resolveUserArg(message, parsedArgs.user);
        if (mapping.args.includes("user") && !resolvedUsers.user && ["ban", "kick", "mute", "unmute", "warn", "note", "cases", "userinfo"].includes(mapping.command)) {
            await message.reply("Could not find that user. Mention them or use their ID.");
            return true;
        }
    }

    const resolvedChannels = {}; // prefix commands don't support channel args yet, slash-only for those

    const fakeInteraction = buildFakeInteraction(message, parsedArgs, resolvedUsers, resolvedChannels);

    try {
        await handler(fakeInteraction);
    } catch (err) {
        console.error(`[Prefix] /${mapping.command} via prefix failed:`, err);
        await message.reply("Something went wrong running that command.").catch(() => {});
    }

    return true;
}

async function maybeHandlePrefixMessage(message, handlers) {
    if (message.author.bot) return false;
    if (!message.guild) return false;

    const settings = db.getGuildSettings(message.guild.id);
    const prefix = settings.commandPrefix;
    if (!prefix) return false;

    if (!message.content.startsWith(prefix)) return false;

    return handlePrefixCommand(message, prefix, handlers);
}

module.exports = { maybeHandlePrefixMessage, PREFIX_COMMAND_MAP };
