const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder } = require("discord.js");

const commands = require("./commands");
const handlers = require("./handler");
const db       = require("./db");

const TOKEN     = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    console.error("[FATAL] BOT_TOKEN or CLIENT_ID is missing from environment variables.");
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildModeration,
    ],
});

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log("[Bot] Slash commands registered.");
    } catch (err) {
        console.error("[Bot] Failed to register commands:", err);
    }
})();

client.once("clientReady", (c) => {
    console.log(`[Bot] Logged in as ${c.user.tag}`);
    console.log(`[Bot] Serving ${c.guilds.cache.size} server(s).`);

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

        const payload = {
            content: "Something went wrong while running that command. Please try again.",
            ephemeral: true,
        };

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload).catch(() => {});
        } else {
            await interaction.reply(payload).catch(() => {});
        }
    }
});

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

client.login(TOKEN).catch(err => {
    console.error("[FATAL] Login failed:", err.message);
    process.exit(1);
});
EOF
echo "done"
