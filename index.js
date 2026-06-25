const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    EmbedBuilder,
    SlashCommandBuilder,
    Events, // Added Events for correct Discord handling
} = require("discord.js");

const express  = require("express");
const commands = require("./commands");
const handlers = require("./handler");
const db       = require("./db");
const ingame   = require("./ingame");

const TOKEN         = process.env.BOT_TOKEN;
const CLIENT_ID     = process.env.CLIENT_ID;
const ROBLOX_SECRET = process.env.ROBLOX_SECRET;
const PORT          = process.env.PORT || 3000; // Railway automatically injects this variable

if (!TOKEN || !CLIENT_ID) {
    console.error("[FATAL] BOT_TOKEN or CLIENT_ID is missing.");
    process.exit(1);
}

// ── Discord client ─────────────────────────────────────────────────────────────

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildModeration,
    ],
});

// ── Slash command definitions ──────────────────────────────────────────────────

const ingameCommand = new SlashCommandBuilder()
    .setName("ingame")
    .setDescription("Run a Cmdr command in the Roblox game")
    .addStringOption(function(o) {
        return o
            .setName("command")
            .setDescription("Full Cmdr command e.g: ban Zenokei exploiting | announce Hello | extinction")
            .setRequired(true);
    })
    .toJSON();

const allCommands = commands.concat([ingameCommand]);

// ── Register commands ──────────────────────────────────────────────────────────

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async function() {
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: allCommands });
        console.log("[Bot] Slash commands registered.");
    } catch (err) {
        console.error("[Bot] Failed to register commands:", err);
    }
}());

// ── Ready ──────────────────────────────────────────────────────────────────────

// FIXED: "clientReady" is incorrect in discord.js v14. Changed to Events.ClientReady.
client.once(Events.ClientReady, function(c) {
    console.log("[Bot] Logged in as " + c.user.tag);
    console.log("[Bot] Serving " + c.guilds.cache.size + " server(s).");

    setInterval(async function() {
        var expired = db.getExpiredMutes();
        for (var i = 0; i < expired.length; i++) {
            var item = expired[i];
            try {
                var guild  = await client.guilds.fetch(item.guildId);
                var member = await guild.members.fetch(item.userId).catch(function() { return null; });
                if (member && member.isCommunicationDisabled()) {
                    await member.timeout(null, "Mute duration expired");
                }
                db.removeMute(item.guildId, item.userId);
                console.log("[Mute] Auto-unmuted " + item.userId + " in " + item.guildId);
            } catch (err) {
                console.error("[Mute] Failed to auto-unmute " + item.userId + ": " + err.message);
            }
        }
    }, 60000);
});

// ── Interactions ───────────────────────────────────────────────────────────────

client.on("interactionCreate", async function(interaction) {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild) {
        return interaction.reply({ content: "Commands must be used inside a server.", ephemeral: true });
    }

    var handler = handlers[interaction.commandName];
    if (!handler) return;

    try {
        await handler(interaction);
    } catch (err) {
        console.error("[Error] /" + interaction.commandName + " failed:", err);
        var payload = { content: "Something went wrong. Please try again.", ephemeral: true };
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload).catch(function() {});
        } else {
            await interaction.reply(payload).catch(function() {});
        }
    }
});

// ── Member leave log ───────────────────────────────────────────────────────────

client.on("guildMemberRemove", async function(member) {
    var settings  = db.getGuildSettings(member.guild.id);
    var channelId = settings.summaryLogChannelId;
    if (!channelId) return;

    try {
        var channel = await member.guild.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) return;

        var cases  = db.getUserCases(member.guild.id, member.id);
        var roblox = db.getRobloxUsername(member.id);

        await channel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x95A5A6)
                    .setTitle("Member Left")
                    .addFields(
                        { name: "User",            value: member.user.tag + " (" + member.id + ")", inline: true },
                        { name: "Roblox",          value: roblox || "Not linked",                   inline: true },
                        { name: "Cases on record", value: String(cases.length),                      inline: true },
                    )
                    .setThumbnail(member.user.displayAvatarURL({ size: 64 }))
                    .setTimestamp()
            ],
        });
    } catch (err) {}
});

// ── Express server ─────────────────────────────────────────────────────────────

var app = express();
app.use(express.json());

app.use("/roblox", function(req, res, next) {
    if (ROBLOX_SECRET && req.headers["x-roblox-secret"] !== ROBLOX_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
});

app.get("/roblox/pending", function(req, res) {
    res.json({ commands: ingame.getPending() });
});

app.post("/roblox/result", function(req, res) {
    var id      = req.body.id;
    var result  = req.body.result;
    var success = req.body.success;

    if (!id) return res.status(400).json({ error: "Missing id" });

    var resolved = ingame.resolve(id, result || "No output", success);
    if (!resolved) return res.status(404).json({ error: "Command ID not found or already resolved" });

    res.json({ ok: true });
});

app.get("/", function(req, res) {
    res.send("Unknown Moderation Bot running.");
});

// FIXED: Explicitly bind to '0.0.0.0' so Railway's proxy system can reach the application
app.listen(PORT, "0.0.0.0", function() {
    console.log("[Server] Express server actively listening on port " + PORT);
});

// ── Login ──────────────────────────────────────────────────────────────────────

client.login(TOKEN).catch(function(err) {
    console.error("[FATAL] Login failed: " + err.message);
    process.exit(1);
});

module.exports = { client };
