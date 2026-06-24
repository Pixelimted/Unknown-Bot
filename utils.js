const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const ms = require("ms");
const db = require("./db");

const COLORS = {
    ban:     0xE74C3C,
    kick:    0xE67E22,
    mute:    0xF1C40F,
    unmute:  0x2ECC71,
    warn:    0xE67E22,
    note:    0x95A5A6,
    unban:   0x2ECC71,
    info:    0x5865F2,
    success: 0x2ECC71,
    error:   0xE74C3C,
};

const ACTION_LABELS = {
    ban:    "Ban",
    kick:   "Kick",
    mute:   "Mute",
    unmute: "Unmute",
    warn:   "Warning",
    note:   "Note",
    unban:  "Unban",
};

function actionColor(type) {
    return COLORS[type] || COLORS.info;
}

function actionLabel(type) {
    return ACTION_LABELS[type] || type;
}

function parseDuration(str) {
    if (!str) return null;
    const result = ms(str);
    return typeof result === "number" ? result : null;
}

function formatDuration(ms_val) {
    if (!ms_val) return "Permanent";
    return ms(ms_val, { long: true });
}

function timestamp(date) {
    const unix = Math.floor((date instanceof Date ? date : new Date(date)).getTime() / 1000);
    return `<t:${unix}:f>`;
}

function relativeTimestamp(date) {
    const unix = Math.floor((date instanceof Date ? date : new Date(date)).getTime() / 1000);
    return `<t:${unix}:R>`;
}

// Build a consistent case embed for mod-log channels
function buildCaseEmbed(caseData, targetUser, modUser) {
    const type  = caseData.type;
    const color = actionColor(type);

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${actionLabel(type)} — Case #${caseData.id}`)
        .addFields(
            { name: "User",       value: `${targetUser.tag} (${targetUser.id})`, inline: true  },
            { name: "Moderator",  value: `${modUser.tag} (${modUser.id})`,       inline: true  },
            { name: "\u200b",     value: "\u200b",                               inline: true  },
            { name: "Reason",     value: caseData.reason || "No reason provided", inline: false },
        )
        .setThumbnail(targetUser.displayAvatarURL({ size: 64 }))
        .setFooter({ text: `Case #${caseData.id}` })
        .setTimestamp();

    if (caseData.duration) {
        embed.addFields({ name: "Duration", value: formatDuration(caseData.duration), inline: true });
    }
    if (caseData.expiresAt) {
        embed.addFields({ name: "Expires", value: `${timestamp(caseData.expiresAt)} (${relativeTimestamp(caseData.expiresAt)})`, inline: true });
    }
    if (caseData.robloxUsername) {
        embed.addFields({ name: "Roblox Username", value: caseData.robloxUsername, inline: true });
    }

    return embed;
}

// Build summary embed for the summary log channel
function buildSummaryEmbed(caseData, targetUser, modUser) {
    return new EmbedBuilder()
        .setColor(actionColor(caseData.type))
        .setDescription(
            `**${actionLabel(caseData.type)}** | Case #${caseData.id}\n` +
            `**User:** ${targetUser.tag}\n` +
            `**Moderator:** ${modUser.tag}\n` +
            `**Reason:** ${caseData.reason || "No reason provided"}`
        )
        .setTimestamp();
}

// Check if a member has permission to run mod commands
async function hasModPermission(interaction) {
    const member   = interaction.member;
    const settings = db.getGuildSettings(interaction.guildId);

    // Owner always passes
    if (interaction.guild.ownerId === member.id) return true;

    // Check mod role if configured
    const modRoleId = settings.modRoleId;
    if (modRoleId && member.roles.cache.has(modRoleId)) return true;

    // Check Discord permissions as fallback
    if (
        member.permissions.has(PermissionFlagsBits.KickMembers) ||
        member.permissions.has(PermissionFlagsBits.BanMembers)  ||
        member.permissions.has(PermissionFlagsBits.ModerateMembers)
    ) return true;

    return false;
}

function noPermissionReply(interaction) {
    return interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setColor(COLORS.error)
                .setDescription("You do not have permission to use this command.")
        ],
        ephemeral: true,
    });
}

function errorReply(interaction, message) {
    return interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setColor(COLORS.error)
                .setDescription(message)
        ],
        ephemeral: true,
    });
}

function successReply(interaction, message) {
    return interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setColor(COLORS.success)
                .setDescription(message)
        ],
        ephemeral: true,
    });
}

// Post to both mod-log channels
async function postToLogs(guild, caseData, targetUser, modUser) {
    const settings = db.getGuildSettings(guild.id);

    const detailedChannelId = settings[`${caseData.type}LogChannelId`] || settings.detailedLogChannelId;
    const summaryChannelId  = settings.summaryLogChannelId;

    if (detailedChannelId) {
        try {
            const ch = await guild.channels.fetch(detailedChannelId);
            if (ch?.isTextBased()) {
                await ch.send({ embeds: [buildCaseEmbed(caseData, targetUser, modUser)] });
            }
        } catch {}
    }

    if (summaryChannelId && summaryChannelId !== detailedChannelId) {
        try {
            const ch = await guild.channels.fetch(summaryChannelId);
            if (ch?.isTextBased()) {
                await ch.send({ embeds: [buildSummaryEmbed(caseData, targetUser, modUser)] });
            }
        } catch {}
    }
}

module.exports = {
    COLORS,
    actionLabel,
    actionColor,
    parseDuration,
    formatDuration,
    timestamp,
    relativeTimestamp,
    buildCaseEmbed,
    hasModPermission,
    noPermissionReply,
    errorReply,
    successReply,
    postToLogs,
};
