const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    EmbedBuilder,
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
} = require("discord.js");

const express  = require("express");
const commands = require("./commands");
const handlers = require("./handler");
const db       = require("./db");
const ingame   = require("./ingame");
const servers  = require("./servers");

const TOKEN         = process.env.BOT_TOKEN;
const CLIENT_ID     = process.env.CLIENT_ID;
const ROBLOX_SECRET = process.env.ROBLOX_SECRET;
const PORT          = process.env.PORT || 3000;

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
    .setDescription("Pick a live Roblox server and run a Cmdr command in it")
    .toJSON();

const allCommands = commands.concat([ingameCommand]);

// ── Register commands ──────────────────────────────────────────────────────────

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async function () {
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: allCommands });
        console.log("[Bot] Slash commands registered.");
    } catch (err) {
        console.error("[Bot] Failed to register commands:", err);
    }
})();

// ── Ready ──────────────────────────────────────────────────────────────────────

client.once("clientReady", function (c) {
    console.log("[Bot] Logged in as " + c.user.tag);
    console.log("[Bot] Serving " + c.guilds.cache.size + " server(s).");

    setInterval(async function () {
        var expired = db.getExpiredMutes();
        for (var i = 0; i < expired.length; i++) {
            var item = expired[i];
            try {
                var guild  = await client.guilds.fetch(item.guildId);
                var member = await guild.members.fetch(item.userId).catch(function () { return null; });
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

client.on("interactionCreate", async function (interaction) {

    // ── Step 2: server picked from dropdown, open the command modal ────────────
    if (interaction.isStringSelectMenu() && interaction.customId === "ingame_pick_server") {
        const jobId = interaction.values[0];
        const server = servers.getServer(jobId);

        if (!server) {
            return interaction.update({ content: "That server is no longer live. Run `/ingame` again.", components: [] });
        }

        const modal = new ModalBuilder()
            .setCustomId("ingame_run_" + jobId)
            .setTitle("Run Command In Server");

        const input = new TextInputBuilder()
            .setCustomId("command_input")
            .setLabel("Cmdr Command")
            .setPlaceholder('e.g: ban Zenokei exploiting | announce "Hello!" | extinction')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));

        return interaction.showModal(modal);
    }

    // ── Step 3: command modal submitted, queue it for that specific server ─────
    if (interaction.isModalSubmit() && interaction.customId.startsWith("ingame_run_")) {
        const jobId   = interaction.customId.replace("ingame_run_", "");
        const command = interaction.fields.getTextInputValue("command_input").trim();

        if (!command) {
            return interaction.reply({ content: "No command entered.", ephemeral: true });
        }

        const server = servers.getServer(jobId);
        if (!server) {
            return interaction.reply({ content: "That server went offline before the command could run.", ephemeral: true });
        }

        await interaction.deferReply();

        const { success, result } = await ingame.enqueue(command, jobId, interaction.channelId, interaction.user.id);

        const embed = new EmbedBuilder()
            .setColor(success ? 0x2ECC71 : 0xE74C3C)
            .setTitle(success ? "Command Executed" : "Command Failed")
            .addFields(
                { name: "Command",  value: "`" + command + "`",                                          inline: false },
                { name: "Server",   value: (server.visitType || "Public") + " — " + server.players.length + " player(s)", inline: true },
                { name: "Result",   value: result || "No output returned.",                               inline: false },
                { name: "Ran by",   value: interaction.user.tag,                                          inline: true  },
            )
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    }

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
            await interaction.editReply(payload).catch(function () {});
        } else {
            await interaction.reply(payload).catch(function () {});
        }
    }
});

// ── Member leave log ───────────────────────────────────────────────────────────

client.on("guildMemberRemove", async function (member) {
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

// public stats endpoint needs CORS so the website (different domain) can fetch it
app.use("/stats", function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET");
    next();
});

app.use("/roblox", function (req, res, next) {
    if (ROBLOX_SECRET && req.headers["x-roblox-secret"] !== ROBLOX_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
});

// Roblox servers heartbeat here every ~15s so the bot knows which servers are live
app.post("/roblox/heartbeat", function (req, res) {
    var ok = servers.heartbeat(req.body);
    if (!ok) return res.status(400).json({ error: "Missing jobId" });
    res.json({ ok: true });
});

// Roblox polls this per-server, only gets commands targeted at its own jobId
app.get("/roblox/pending", function (req, res) {
    var jobId = req.query.jobId;
    if (!jobId) return res.status(400).json({ error: "Missing jobId query param" });
    res.json({ commands: ingame.getPendingFor(jobId) });
});

app.post("/roblox/result", function (req, res) {
    var id      = req.body.id;
    var result  = req.body.result;
    var success = req.body.success;

    if (!id) return res.status(400).json({ error: "Missing id" });

    var resolved = ingame.resolve(id, result || "No output", success);
    if (!resolved) return res.status(404).json({ error: "Command ID not found or already resolved" });

    res.json({ ok: true });
});

// public, read-only stats used by the landing page
app.get("/stats", function (req, res) {
    var caseStats  = db.getStats();
    var liveServers = servers.getLiveServers();

    var totalPlayers = 0;
    for (var i = 0; i < liveServers.length; i++) {
        totalPlayers += liveServers[i].players.length;
    }

    res.json({
        totalCases:    caseStats.totalCases,
        byType:        caseStats.byType,
        activeMutes:   caseStats.activeMutes,
        guildCount:    caseStats.guildCount,
        liveServers:   liveServers.length,
        totalPlayers:  totalPlayers,
        commandCount:  19,
        updatedAt:     Date.now(),
    });
});

app.get("/", function (req, res) {
    res.send("Unknown Moderation Bot running.");
});

app.listen(PORT, function () {
    console.log("[Server] Express on port " + PORT);
});

// ── Login ──────────────────────────────────────────────────────────────────────

client.login(TOKEN).catch(function (err) {
    console.error("[FATAL] Login failed: " + err.message);
    process.exit(1);
});

module.exports = { client };
