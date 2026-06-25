const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, SlashCommandBuilder } = require("discord.js");

const commands  = require("./commands");
const handlers  = require("./handler");
const db        = require("./db");
const ingame    = require("./ingame");

const TOKEN     = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const ROBLOX_SECRET = process.env.ROBLOX_SECRET; // shared secret so only your game can POST

if (!TOKEN || !CLIENT_ID) {
    console.error("[FATAL] BOT_TOKEN or CLIENT_ID is missing.");
    process.exit(1);
}

// ─── Discord Client ────────────────────────────────────────────────────────────

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildModeration,
    ],
});

// ─── Register Commands ─────────────────────────────────────────────────────────

const ingameCommand = new SlashCommandBuilder()
    .setName("ingame")
    .setDescription("Run a Cmdr command in-game. Use quotes for arguments with spaces.")
    .addStringOption(o =>
        o.setName("command")
            .setDescription('Full command as you'd type in Cmdr. e.g: ban Zenokei exploiting | announce "Hello!" | live Summer true')
            .setRequired(true)
    )
    .toJSON();

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), {
            body: [...commands, ingameCommand],
        });
        console.log("[Bot] Slash commands registered.");
    } catch (err) {
        console.error("[Bot] Failed to register commands:", err);
    }
})();

// ─── Ready ────────────────────────────────────────────────────────────────────

client.once("clientReady", (c) => {
    console.log(`[Bot] Logged in as ${c.user.tag}`);
    console.log(`[Bot] Serving ${c.guilds.cache.size} server(s).`);

    // Auto-unmute checker — every 60 seconds
    setInterval(async () => {
        const expired = db.getExpiredMutes();
        for (const { guildId, userId } of expired) {
            try {
                const guild  = await client.guilds.fetch(guildId);
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member?.isCommunicationDisabled()) {
                    await member.timeout(null, "Mute duration expired");
                }
                db.removeMute(guildId, userId);
                console.log(`[Mute] Auto-unmuted ${userId} in ${guildId}`);
            } catch (err) {
                console.error(`[Mute] Failed to auto-unmute ${userId}:`, err.message);
            }
        }
    }, 60_000);
});

// ─── Interactions ──────────────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild) {
        return interaction.reply({ content: "Commands must be used inside a server.", ephemeral: true });
    }

    const handler = handlers[interaction.commandName];
    if (!handler) return;

    try {
        await handler(interaction);
    } catch (err) {
        console.error(`[Error] /${interaction.commandName} failed:`, err);
        const payload = { content: "Something went wrong. Please try again.", ephemeral: true };
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload).catch(() => {});
        } else {
            await interaction.reply(payload).catch(() => {});
        }
    }
});

// ─── Member leave log ──────────────────────────────────────────────────────────

client.on("guildMemberRemove", async (member) => {
    const settings  = db.getGuildSettings(member.guild.id);
    const channelId = settings.summaryLogChannelId;
    if (!channelId) return;

    try {
        const channel = await member.guild.channels.fetch(channelId);
        if (!channel?.isTextBased()) return;

        const cases  = db.getUserCases(member.guild.id, member.id);
        const roblox = db.getRobloxUsername(member.id);

        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x95A5A6)
                    .setTitle("Member Left")
                    .addFields(
                        { name: "User",            value: `${member.user.tag} (${member.id})`, inline: true },
                        { name: "Roblox",          value: roblox || "Not linked",              inline: true },
                        { name: "Cases on record", value: `${cases.length}`,                   inline: true },
                    )
                    .setThumbnail(member.user.displayAvatarURL({ size: 64 }))
                    .setTimestamp()
            ],
        });
    } catch {}
});

// ─── Express (Roblox HTTP bridge) ─────────────────────────────────────────────

const express = require("express");
const app     = express();
app.use(express.json());

// Middleware — validate the shared secret on all /roblox routes
app.use("/roblox", (req, res, next) => {
    if (ROBLOX_SECRET && req.headers["x-roblox-secret"] !== ROBLOX_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
});

// Roblox polls this every 2 seconds to get pending commands
app.get("/roblox/pending", (req, res) => {
    res.json({ commands: ingame.getPendingCommands() });
});

// Roblox POSTs the result back here after running a command
app.post("/roblox/result", (req, res) => {
    const { id, result, success } = req.body;
    if (!id) return res.status(400).json({ error: "Missing id" });

    const resolved = ingame.resolve(id, result ?? "No output", success ?? true);
    if (!resolved) return res.status(404).json({ error: "Command ID not found or already resolved" });

    res.json({ ok: true });
});

app.get("/", (_req, res) => res.send("Unknown Moderation Bot running."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Server] Express on port ${PORT}`));

// ─── Login ─────────────────────────────────────────────────────────────────────

client.login(TOKEN).catch(err => {
    console.error("[FATAL] Login failed:", err.message);
    process.exit(1);
});

module.exports = { client };
