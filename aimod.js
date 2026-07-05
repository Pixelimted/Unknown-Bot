// ── AI Moderation (beta) ────────────────────────────────────────────────────
// Scans messages for patterns commonly associated with problem behavior and
// flags them to a review channel. This never takes action on its own —
// a human moderator always decides what happens next. It's a heuristic
// scanner, not a call out to an external AI model, so it stays honest about
// what it actually catches: known slur variants, scam/phishing patterns,
// and mass-mention spam. It will miss things and it will occasionally flag
// something harmless — that's why it only flags, never acts.

const db = require("./db");
const { EmbedBuilder } = require("discord.js");

// Deliberately conservative lists. False negatives are safer than false
// positives here since a human reviews every flag.
const SLUR_PATTERNS = [
    /\bn[i1!]gg(?:er|a)\b/i,
    /\bf[a4]gg?[o0]t\b/i,
    /\br[e3]t[a4]rd(?:ed)?\b/i,
];

const SCAM_PATTERNS = [
    /free\s+(nitro|robux|gift\s?card)/i,
    /steamcommunity\.[a-z]{2,}\.[a-z]{2,}/i,
    /discord\.gg\/[a-z0-9]+.{0,20}(free|nitro|steam)/i,
    /click here.{0,20}(claim|verify|reward)/i,
];

const MASS_MENTION_THRESHOLD = 8;

function scanMessage(content) {
    for (const pattern of SLUR_PATTERNS) {
        if (pattern.test(content)) return { flagged: true, reason: "Possible slur or targeted slur variant" };
    }
    for (const pattern of SCAM_PATTERNS) {
        if (pattern.test(content)) return { flagged: true, reason: "Possible scam or phishing link" };
    }
    const mentionCount = (content.match(/<@!?\d+>/g) || []).length;
    if (mentionCount >= MASS_MENTION_THRESHOLD) {
        return { flagged: true, reason: `Mass mention spam (${mentionCount} mentions in one message)` };
    }
    return { flagged: false };
}

async function handleMessage(message) {
    if (message.author.bot) return;
    if (!message.guild) return;

    const settings = db.getGuildSettings(message.guild.id);
    if (!settings.aiModerationEnabled) return;

    const reviewChannelId = settings.aiModerationChannelId || settings.detailedLogChannelId;
    if (!reviewChannelId) return;

    const result = scanMessage(message.content || "");
    if (!result.flagged) return;

    try {
        const channel = await message.guild.channels.fetch(reviewChannelId);
        if (!channel || !channel.isTextBased()) return;

        const embed = new EmbedBuilder()
            .setColor(0xc99a4a)
            .setTitle("Flagged for review — AI Moderation (beta)")
            .addFields(
                { name: "User",    value: `${message.author.tag} (${message.author.id})`, inline: true },
                { name: "Channel", value: `<#${message.channel.id}>`,                       inline: true },
                { name: "Reason",  value: result.reason,                                   inline: false },
                { name: "Message", value: (message.content || "").slice(0, 500) || "(no text content)", inline: false },
                { name: "Link",    value: `[Jump to message](${message.url})`,              inline: false },
            )
            .setFooter({ text: "This is a flag only. No action was taken automatically." })
            .setTimestamp();

        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error("[AI Moderation] Failed to post flag:", err.message);
    }
}

module.exports = { handleMessage, scanMessage };
