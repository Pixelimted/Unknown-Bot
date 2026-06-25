const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const db    = require("./db");
const utils = require("./utils");
const fs    = require("fs");
const path  = require("path");

const WARN_KICK_THRESHOLD = 3;
const WARN_BAN_THRESHOLD  = 5;
const MAX_TIMEOUT_MS      = 28 * 24 * 60 * 60 * 1000;

function isHigherOrEqual(mod, target) {
    if (!target.roles) return false;
    return mod.roles.highest.comparePositionTo(target.roles.highest) <= 0;
}

async function dmUser(user, guild, type, reason, duration) {
    try {
        const embed = new EmbedBuilder()
            .setColor(utils.actionColor(type))
            .setTitle(`You have been ${utils.actionLabel(type).toLowerCase()}ed in ${guild.name}`)
            .addFields({ name: "Reason", value: reason || "No reason provided" });
        if (duration) embed.addFields({ name: "Duration", value: utils.formatDuration(duration) });
        await user.send({ embeds: [embed] });
    } catch {}
}

async function handleWarnEscalation(interaction, targetMember, warnCount) {
    const guild  = interaction.guild;
    const reason = `Automatic escalation — reached ${warnCount} warning(s)`;

    if (warnCount >= WARN_BAN_THRESHOLD) {
        await dmUser(targetMember.user, guild, "ban", reason);
        await targetMember.ban({ reason, deleteMessageSeconds: 0 });
        const caseId   = db.addCase(guild.id, {
            type: "ban", targetId: targetMember.id, targetTag: targetMember.user.tag,
            modId: interaction.client.user.id, modTag: interaction.client.user.tag,
            reason, automatic: true,
        });
        await utils.postToLogs(guild, db.getCase(guild.id, caseId), targetMember.user, interaction.client.user);
        return "ban";
    }

    if (warnCount >= WARN_KICK_THRESHOLD) {
        await dmUser(targetMember.user, guild, "kick", reason);
        await targetMember.kick(reason);
        const caseId   = db.addCase(guild.id, {
            type: "kick", targetId: targetMember.id, targetTag: targetMember.user.tag,
            modId: interaction.client.user.id, modTag: interaction.client.user.tag,
            reason, automatic: true,
        });
        await utils.postToLogs(guild, db.getCase(guild.id, caseId), targetMember.user, interaction.client.user);
        return "kick";
    }

    return null;
}

function readAllCases(guildId) {
    try {
        const DATA_DIR = fs.existsSync("/data") ? "/data" : path.join(__dirname, "..", "data");
        const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "cases.json"), "utf8"));
        return Object.values(raw[guildId]?.entries || {});
    } catch {
        return [];
    }
}

const handlers = {};

// ── Ban ───────────────────────────────────────────────────────────────────────
handlers.ban = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const targetUser    = interaction.options.getUser("user");
    const reason        = interaction.options.getString("reason") || "No reason provided";
    const durationStr   = interaction.options.getString("duration");
    const deleteHistory = interaction.options.getInteger("delete_messages") ?? 0;
    const guild         = interaction.guild;

    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

    if (targetMember) {
        if (targetMember.id === interaction.user.id)  return utils.errorReply(interaction, "You cannot ban yourself.");
        if (targetMember.id === guild.ownerId)         return utils.errorReply(interaction, "You cannot ban the server owner.");
        if (!targetMember.bannable)                    return utils.errorReply(interaction, "I do not have permission to ban this user.");
        if (isHigherOrEqual(interaction.member, targetMember)) return utils.errorReply(interaction, "You cannot ban someone with a higher or equal role.");
    }

    let duration  = null;
    let expiresAt = null;

    if (durationStr) {
        duration = utils.parseDuration(durationStr);
        if (!duration) return utils.errorReply(interaction, "Invalid duration. Try something like `7d`, `30d`, `2h`.");
        expiresAt = new Date(Date.now() + duration);
    }

    await interaction.deferReply({ ephemeral: true });
    await dmUser(targetUser, guild, "ban", reason, duration);
    await guild.members.ban(targetUser.id, { reason, deleteMessageSeconds: deleteHistory * 86400 });

    const caseId = db.addCase(guild.id, {
        type: "ban", targetId: targetUser.id, targetTag: targetUser.tag,
        modId: interaction.user.id, modTag: interaction.user.tag,
        reason, duration, expiresAt: expiresAt?.getTime() || null,
        robloxUsername: db.getRobloxUsername(targetUser.id),
    });

    await utils.postToLogs(guild, db.getCase(guild.id, caseId), targetUser, interaction.user);

    return interaction.editReply({
        embeds: [
            new EmbedBuilder()
                .setColor(utils.COLORS.ban)
                .setTitle(`Ban — Case #${caseId}`)
                .addFields(
                    { name: "User",     value: `${targetUser.tag} (${targetUser.id})`, inline: true  },
                    { name: "Duration", value: utils.formatDuration(duration),         inline: true  },
                    { name: "Reason",   value: reason,                                 inline: false },
                )
                .setTimestamp()
        ],
    });
};

// ── Unban ─────────────────────────────────────────────────────────────────────
handlers.unban = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const userId = interaction.options.getString("userid").trim();
    const reason = interaction.options.getString("reason") || "No reason provided";
    const guild  = interaction.guild;

    await interaction.deferReply({ ephemeral: true });

    let targetUser;
    try {
        targetUser = await interaction.client.users.fetch(userId);
    } catch {
        return interaction.editReply({ content: "Could not find a user with that ID." });
    }

    try {
        await guild.members.unban(userId, reason);
    } catch {
        return interaction.editReply({ content: "This user is not banned or I was unable to unban them." });
    }

    const caseId = db.addCase(guild.id, {
        type: "unban", targetId: userId, targetTag: targetUser.tag,
        modId: interaction.user.id, modTag: interaction.user.tag, reason,
    });

    await utils.postToLogs(guild, db.getCase(guild.id, caseId), targetUser, interaction.user);

    return interaction.editReply({
        embeds: [
            new EmbedBuilder()
                .setColor(utils.COLORS.unban)
                .setTitle(`Unban — Case #${caseId}`)
                .addFields(
                    { name: "User",   value: `${targetUser.tag} (${userId})`, inline: true  },
                    { name: "Reason", value: reason,                          inline: false },
                )
                .setTimestamp()
        ],
    });
};

// ── Kick ──────────────────────────────────────────────────────────────────────
handlers.kick = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const targetUser   = interaction.options.getUser("user");
    const reason       = interaction.options.getString("reason") || "No reason provided";
    const guild        = interaction.guild;
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

    if (!targetMember)                                   return utils.errorReply(interaction, "That user is not in this server.");
    if (targetMember.id === interaction.user.id)          return utils.errorReply(interaction, "You cannot kick yourself.");
    if (targetMember.id === guild.ownerId)                return utils.errorReply(interaction, "You cannot kick the server owner.");
    if (!targetMember.kickable)                           return utils.errorReply(interaction, "I do not have permission to kick this user.");
    if (isHigherOrEqual(interaction.member, targetMember)) return utils.errorReply(interaction, "You cannot kick someone with a higher or equal role.");

    await interaction.deferReply({ ephemeral: true });
    await dmUser(targetUser, guild, "kick", reason);
    await targetMember.kick(reason);

    const caseId = db.addCase(guild.id, {
        type: "kick", targetId: targetUser.id, targetTag: targetUser.tag,
        modId: interaction.user.id, modTag: interaction.user.tag, reason,
        robloxUsername: db.getRobloxUsername(targetUser.id),
    });

    await utils.postToLogs(guild, db.getCase(guild.id, caseId), targetUser, interaction.user);

    return interaction.editReply({
        embeds: [
            new EmbedBuilder()
                .setColor(utils.COLORS.kick)
                .setTitle(`Kick — Case #${caseId}`)
                .addFields(
                    { name: "User",   value: `${targetUser.tag} (${targetUser.id})`, inline: true  },
                    { name: "Reason", value: reason,                                 inline: false },
                )
                .setTimestamp()
        ],
    });
};

// ── Mute ──────────────────────────────────────────────────────────────────────
handlers.mute = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const targetUser   = interaction.options.getUser("user");
    const durationStr  = interaction.options.getString("duration");
    const reason       = interaction.options.getString("reason") || "No reason provided";
    const guild        = interaction.guild;
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

    if (!targetMember)                                   return utils.errorReply(interaction, "That user is not in this server.");
    if (targetMember.id === interaction.user.id)          return utils.errorReply(interaction, "You cannot mute yourself.");
    if (targetMember.id === guild.ownerId)                return utils.errorReply(interaction, "You cannot mute the server owner.");
    if (!targetMember.moderatable)                        return utils.errorReply(interaction, "I do not have permission to mute this user.");
    if (isHigherOrEqual(interaction.member, targetMember)) return utils.errorReply(interaction, "You cannot mute someone with a higher or equal role.");

    const duration = utils.parseDuration(durationStr);
    if (!duration)                  return utils.errorReply(interaction, "Invalid duration. Try something like `10m`, `1h`, `7d`.");
    if (duration > MAX_TIMEOUT_MS)  return utils.errorReply(interaction, "Duration cannot exceed 28 days.");

    await interaction.deferReply({ ephemeral: true });
    await targetMember.timeout(duration, reason);
    await dmUser(targetUser, guild, "mute", reason, duration);

    const expiresAt = Date.now() + duration;
    db.addMute(guild.id, targetUser.id, expiresAt);

    const caseId = db.addCase(guild.id, {
        type: "mute", targetId: targetUser.id, targetTag: targetUser.tag,
        modId: interaction.user.id, modTag: interaction.user.tag,
        reason, duration, expiresAt,
    });

    await utils.postToLogs(guild, db.getCase(guild.id, caseId), targetUser, interaction.user);

    return interaction.editReply({
        embeds: [
            new EmbedBuilder()
                .setColor(utils.COLORS.mute)
                .setTitle(`Mute — Case #${caseId}`)
                .addFields(
                    { name: "User",     value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                    { name: "Duration", value: utils.formatDuration(duration),         inline: true },
                    { name: "Expires",  value: utils.relativeTimestamp(expiresAt),     inline: true },
                    { name: "Reason",   value: reason,                                 inline: false },
                )
                .setTimestamp()
        ],
    });
};

// ── Unmute ────────────────────────────────────────────────────────────────────
handlers.unmute = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const targetUser   = interaction.options.getUser("user");
    const reason       = interaction.options.getString("reason") || "No reason provided";
    const guild        = interaction.guild;
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

    if (!targetMember)                         return utils.errorReply(interaction, "That user is not in this server.");
    if (!targetMember.isCommunicationDisabled()) return utils.errorReply(interaction, "That user is not currently muted.");

    await interaction.deferReply({ ephemeral: true });
    await targetMember.timeout(null, reason);
    db.removeMute(guild.id, targetUser.id);

    const caseId = db.addCase(guild.id, {
        type: "unmute", targetId: targetUser.id, targetTag: targetUser.tag,
        modId: interaction.user.id, modTag: interaction.user.tag, reason,
    });

    await utils.postToLogs(guild, db.getCase(guild.id, caseId), targetUser, interaction.user);

    return interaction.editReply({
        embeds: [
            new EmbedBuilder()
                .setColor(utils.COLORS.unmute)
                .setTitle(`Unmute — Case #${caseId}`)
                .addFields(
                    { name: "User",   value: `${targetUser.tag} (${targetUser.id})`, inline: true  },
                    { name: "Reason", value: reason,                                 inline: false },
                )
                .setTimestamp()
        ],
    });
};

// ── Warn ──────────────────────────────────────────────────────────────────────
handlers.warn = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const targetUser   = interaction.options.getUser("user");
    const reason       = interaction.options.getString("reason");
    const guild        = interaction.guild;
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);

    if (targetMember) {
        if (targetMember.id === interaction.user.id)           return utils.errorReply(interaction, "You cannot warn yourself.");
        if (isHigherOrEqual(interaction.member, targetMember)) return utils.errorReply(interaction, "You cannot warn someone with a higher or equal role.");
    }

    await interaction.deferReply({ ephemeral: true });
    await dmUser(targetUser, guild, "warn", reason);

    const caseId = db.addCase(guild.id, {
        type: "warn", targetId: targetUser.id, targetTag: targetUser.tag,
        modId: interaction.user.id, modTag: interaction.user.tag, reason,
        robloxUsername: db.getRobloxUsername(targetUser.id),
    });

    const warnCount = db.getUserWarnCount(guild.id, targetUser.id);
    await utils.postToLogs(guild, db.getCase(guild.id, caseId), targetUser, interaction.user);

    let escalationNote = "";
    if (targetMember) {
        const escalated = await handleWarnEscalation(interaction, targetMember, warnCount);
        if (escalated === "ban")  escalationNote = `\nUser automatically **banned** after reaching ${WARN_BAN_THRESHOLD} warnings.`;
        if (escalated === "kick") escalationNote = `\nUser automatically **kicked** after reaching ${WARN_KICK_THRESHOLD} warnings.`;
    }

    return interaction.editReply({
        embeds: [
            new EmbedBuilder()
                .setColor(utils.COLORS.warn)
                .setTitle(`Warning — Case #${caseId}`)
                .addFields(
                    { name: "User",           value: `${targetUser.tag} (${targetUser.id})`, inline: true  },
                    { name: "Total Warnings", value: `${warnCount}`,                         inline: true  },
                    { name: "Reason",         value: reason + escalationNote,                inline: false },
                )
                .setTimestamp()
        ],
    });
};

// ── Unwarn ────────────────────────────────────────────────────────────────────
handlers.unwarn = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const caseId   = interaction.options.getInteger("caseid");
    const reason   = interaction.options.getString("reason") || "No reason provided";
    const guild    = interaction.guild;
    const caseData = db.getCase(guild.id, caseId);

    if (!caseData)                return utils.errorReply(interaction, `Case #${caseId} not found.`);
    if (caseData.type !== "warn") return utils.errorReply(interaction, `Case #${caseId} is not a warning.`);
    if (caseData.removed)         return utils.errorReply(interaction, `Case #${caseId} has already been removed.`);

    db.updateCase(guild.id, caseId, { removed: true, removedBy: interaction.user.id, removedReason: reason });
    return utils.successReply(interaction, `Warning #${caseId} removed.\nReason: ${reason}`);
};

// ── Note ──────────────────────────────────────────────────────────────────────
handlers.note = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const targetUser = interaction.options.getUser("user");
    const note       = interaction.options.getString("note");
    const guild      = interaction.guild;

    const caseId = db.addCase(guild.id, {
        type: "note", targetId: targetUser.id, targetTag: targetUser.tag,
        modId: interaction.user.id, modTag: interaction.user.tag, reason: note,
    });

    await utils.postToLogs(guild, db.getCase(guild.id, caseId), targetUser, interaction.user);
    return utils.successReply(interaction, `Note added to ${targetUser.tag} — Case #${caseId}`);
};

// ── Cases ─────────────────────────────────────────────────────────────────────
handlers.cases = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const targetUser = interaction.options.getUser("user");
    const filter     = interaction.options.getString("filter") || "all";
    const guild      = interaction.guild;

    let cases = db.getUserCases(guild.id, targetUser.id).filter(c => !c.removed);
    if (filter !== "all") cases = cases.filter(c => c.type === filter);

    if (!cases.length) {
        return utils.successReply(interaction, `No ${filter === "all" ? "" : filter + " "}cases found for **${targetUser.tag}**.`);
    }

    const roblox = db.getRobloxUsername(targetUser.id);
    const sorted = cases.sort((a, b) => b.createdAt - a.createdAt);

    const fields = sorted.slice(0, 10).map(c => ({
        name:   `Case #${c.id} — ${utils.actionLabel(c.type)}`,
        value:  `**Reason:** ${c.reason || "No reason provided"}\n**Mod:** ${c.modTag}\n**When:** ${utils.relativeTimestamp(c.createdAt)}`,
        inline: false,
    }));

    const embed = new EmbedBuilder()
        .setColor(utils.COLORS.info)
        .setTitle(`Cases for ${targetUser.tag}`)
        .setThumbnail(targetUser.displayAvatarURL({ size: 64 }))
        .addFields(
            { name: "Total Cases", value: `${cases.length}`,                                     inline: true },
            { name: "Warnings",    value: `${cases.filter(c => c.type === "warn").length}`,       inline: true },
            { name: "Roblox",      value: roblox || "Not linked",                                 inline: true },
        )
        .addFields(fields)
        .setFooter({ text: cases.length > 10 ? `Showing 10 of ${cases.length} cases` : `${cases.length} case(s) total` })
        .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
};

// ── Case ──────────────────────────────────────────────────────────────────────
handlers.case = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const id       = interaction.options.getInteger("id");
    const guild    = interaction.guild;
    const caseData = db.getCase(guild.id, id);

    if (!caseData) return utils.errorReply(interaction, `Case #${id} not found.`);

    let targetUser;
    try { targetUser = await interaction.client.users.fetch(caseData.targetId); }
    catch { targetUser = { tag: caseData.targetTag || "Unknown", id: caseData.targetId, displayAvatarURL: () => null }; }

    let modUser;
    try { modUser = await interaction.client.users.fetch(caseData.modId); }
    catch { modUser = { tag: caseData.modTag || "Unknown", id: caseData.modId }; }

    const embed = utils.buildCaseEmbed(caseData, targetUser, modUser);
    if (caseData.removed) {
        embed.addFields({ name: "Status", value: `Removed by <@${caseData.removedBy}> — ${caseData.removedReason}`, inline: false });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
};

// ── Viewlog ───────────────────────────────────────────────────────────────────
handlers.viewlog = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const limit    = interaction.options.getInteger("limit") || 10;
    const guild    = interaction.guild;
    const rawCases = readAllCases(guild.id);

    if (!rawCases.length) return utils.successReply(interaction, "No moderation cases found for this server.");

    const sorted = rawCases.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);

    const fields = sorted.map(c => ({
        name:   `#${c.id} — ${utils.actionLabel(c.type)}${c.automatic ? " (Auto)" : ""}`,
        value:  `**User:** ${c.targetTag}\n**Mod:** ${c.modTag}\n**Reason:** ${c.reason || "None"}\n**When:** ${utils.relativeTimestamp(c.createdAt)}`,
        inline: false,
    }));

    const embed = new EmbedBuilder()
        .setColor(utils.COLORS.info)
        .setTitle(`Recent Moderation Log — ${guild.name}`)
        .addFields(fields)
        .setFooter({ text: `Showing ${sorted.length} most recent case(s)` })
        .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
};

// ── Reason ────────────────────────────────────────────────────────────────────
handlers.reason = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const caseId   = interaction.options.getInteger("caseid");
    const reason   = interaction.options.getString("reason");
    const guild    = interaction.guild;
    const caseData = db.getCase(guild.id, caseId);

    if (!caseData) return utils.errorReply(interaction, `Case #${caseId} not found.`);

    if (caseData.modId !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return utils.errorReply(interaction, "You can only edit reasons on your own cases.");
    }

    db.updateCase(guild.id, caseId, { reason });
    return utils.successReply(interaction, `Case #${caseId} reason updated to:\n${reason}`);
};

// ── Roblox ────────────────────────────────────────────────────────────────────
handlers.roblox = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const sub        = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser("user");

    if (sub === "set") {
        const username = interaction.options.getString("username").trim();
        db.setRobloxUsername(targetUser.id, username);
        return utils.successReply(interaction, `Linked **${username}** to ${targetUser.tag}.`);
    }

    if (sub === "get") {
        const username = db.getRobloxUsername(targetUser.id);
        if (!username) return utils.errorReply(interaction, `${targetUser.tag} does not have a linked Roblox username.`);
        return utils.successReply(interaction, `${targetUser.tag} is linked to Roblox user **${username}**.`);
    }

    if (sub === "remove") {
        const existing = db.getRobloxUsername(targetUser.id);
        if (!existing) return utils.errorReply(interaction, `${targetUser.tag} does not have a linked Roblox username.`);
        db.setRobloxUsername(targetUser.id, null);
        return utils.successReply(interaction, `Removed Roblox link for ${targetUser.tag}.`);
    }
};

// ── Purge ─────────────────────────────────────────────────────────────────────
handlers.purge = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const amount     = interaction.options.getInteger("amount");
    const filterUser = interaction.options.getUser("user");
    const channel    = interaction.channel;

    await interaction.deferReply({ ephemeral: true });

    let messages = await channel.messages.fetch({ limit: 100 });
    if (filterUser) messages = messages.filter(m => m.author.id === filterUser.id);

    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const toDelete    = [...messages.values()].slice(0, amount).filter(m => m.createdTimestamp > twoWeeksAgo);

    if (!toDelete.length) return interaction.editReply({ content: "No eligible messages to delete. Messages older than 14 days cannot be bulk deleted." });

    await channel.bulkDelete(toDelete, true);
    return interaction.editReply({ content: `Deleted ${toDelete.length} message(s)${filterUser ? ` from ${filterUser.tag}` : ""}.` });
};

// ── Slowmode ──────────────────────────────────────────────────────────────────
handlers.slowmode = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const seconds = interaction.options.getInteger("seconds");
    const channel = interaction.options.getChannel("channel") || interaction.channel;

    await channel.setRateLimitPerUser(seconds);
    return utils.successReply(interaction, seconds === 0
        ? `Slowmode disabled in <#${channel.id}>.`
        : `Slowmode set to ${seconds}s in <#${channel.id}>.`
    );
};

// ── Lock ──────────────────────────────────────────────────────────────────────
handlers.lock = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const channel     = interaction.options.getChannel("channel") || interaction.channel;
    const reason      = interaction.options.getString("reason") || "No reason provided";
    const everyoneRole = interaction.guild.roles.everyone;

    await channel.permissionOverwrites.edit(everyoneRole, { SendMessages: false }, { reason });
    return utils.successReply(interaction, `<#${channel.id}> has been locked.\nReason: ${reason}`);
};

// ── Unlock ────────────────────────────────────────────────────────────────────
handlers.unlock = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const channel     = interaction.options.getChannel("channel") || interaction.channel;
    const everyoneRole = interaction.guild.roles.everyone;

    await channel.permissionOverwrites.edit(everyoneRole, { SendMessages: null });
    return utils.successReply(interaction, `<#${channel.id}> has been unlocked.`);
};

// ── Userinfo ──────────────────────────────────────────────────────────────────
handlers.userinfo = async (interaction) => {
    const targetUser   = interaction.options.getUser("user") || interaction.user;
    const guild        = interaction.guild;
    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    const roblox       = db.getRobloxUsername(targetUser.id);
    const cases        = db.getUserCases(guild.id, targetUser.id).filter(c => !c.removed);
    const warns        = cases.filter(c => c.type === "warn").length;

    const roles = targetMember
        ? targetMember.roles.cache
            .filter(r => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => `<@&${r.id}>`)
            .slice(0, 10)
            .join(" ") || "None"
        : "Not in server";

    const embed = new EmbedBuilder()
        .setColor(utils.COLORS.info)
        .setTitle(targetUser.tag)
        .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
        .addFields(
            { name: "ID",             value: targetUser.id,                                                            inline: true  },
            { name: "Account Created", value: utils.timestamp(targetUser.createdAt),                                   inline: true  },
            { name: "Joined Server",  value: targetMember ? utils.timestamp(targetMember.joinedAt) : "Not in server", inline: true  },
            { name: "Roblox",         value: roblox || "Not linked",                                                   inline: true  },
            { name: "Warnings",       value: `${warns}`,                                                               inline: true  },
            { name: "Total Cases",    value: `${cases.length}`,                                                        inline: true  },
            { name: "Roles",          value: roles,                                                                    inline: false },
        )
        .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
};

// ── Setup ─────────────────────────────────────────────────────────────────────
handlers.setup = async (interaction) => {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return utils.errorReply(interaction, "Only administrators can configure the bot.");
    }

    const sub   = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === "modrole") {
        const role = interaction.options.getRole("role");
        db.setGuildSettings(guild.id, { modRoleId: role.id });
        return utils.successReply(interaction, `Mod role set to <@&${role.id}>.`);
    }

    if (sub === "summarylog") {
        const channel = interaction.options.getChannel("channel");
        db.setGuildSettings(guild.id, { summaryLogChannelId: channel.id });
        return utils.successReply(interaction, `Summary log channel set to <#${channel.id}>.`);
    }

    if (sub === "detailedlog") {
        const channel = interaction.options.getChannel("channel");
        db.setGuildSettings(guild.id, { detailedLogChannelId: channel.id });
        return utils.successReply(interaction, `Detailed log channel set to <#${channel.id}>.`);
    }

    if (sub === "view") {
        const settings = db.getGuildSettings(guild.id);
        const embed = new EmbedBuilder()
            .setColor(utils.COLORS.info)
            .setTitle("Bot Configuration")
            .addFields(
                { name: "Mod Role",     value: settings.modRoleId           ? `<@&${settings.modRoleId}>`            : "Not set", inline: true },
                { name: "Summary Log",  value: settings.summaryLogChannelId  ? `<#${settings.summaryLogChannelId}>`  : "Not set", inline: true },
                { name: "Detailed Log", value: settings.detailedLogChannelId ? `<#${settings.detailedLogChannelId}>` : "Not set", inline: true },
                { name: "Auto-Kick at", value: `${WARN_KICK_THRESHOLD} warnings`, inline: true },
                { name: "Auto-Ban at",  value: `${WARN_BAN_THRESHOLD} warnings`,  inline: true },
            )
            .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
};

module.exports = handlers;

// ── Ingame ────────────────────────────────────────────────────────────────────
handlers.ingame = async (interaction) => {
    if (!await utils.hasModPermission(interaction)) return utils.noPermissionReply(interaction);

    const ingame  = require("./ingame");
    const command = interaction.options.getString("command").trim();

    if (!command) return utils.errorReply(interaction, "Please provide a command to run.");

    await interaction.deferReply();

    const { success, result } = await ingame.enqueue(command, interaction.channelId, interaction.user.id);

    const embed = new EmbedBuilder()
        .setColor(success ? utils.COLORS.success : utils.COLORS.error)
        .setTitle(success ? "Command Executed" : "Command Failed")
        .addFields(
            { name: "Command", value: `\`${command}\``,                    inline: false },
            { name: "Result",  value: result || "No output returned.",     inline: false },
            { name: "Ran by",  value: `${interaction.user.tag}`,           inline: true  },
            { name: "Queue",   value: `${ingame.pendingCount()} pending`,  inline: true  },
        )
        .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
};
