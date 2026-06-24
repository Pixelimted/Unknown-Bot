const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = [

    // ── Ban ───────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Ban a user from the server")
        .addUserOption(o => o.setName("user").setDescription("User to ban").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason for the ban").setRequired(false))
        .addStringOption(o => o.setName("duration").setDescription("Duration (e.g. 7d, 30d) — leave blank for permanent").setRequired(false))
        .addIntegerOption(o => o.setName("delete_messages").setDescription("Delete message history (days, 0-7)").setMinValue(0).setMaxValue(7).setRequired(false)),

    // ── Unban ─────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("unban")
        .setDescription("Unban a user by their ID")
        .addStringOption(o => o.setName("userid").setDescription("User ID to unban").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason for the unban").setRequired(false)),

    // ── Kick ──────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("kick")
        .setDescription("Kick a user from the server")
        .addUserOption(o => o.setName("user").setDescription("User to kick").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason for the kick").setRequired(false)),

    // ── Mute ──────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("mute")
        .setDescription("Timeout a user (mute)")
        .addUserOption(o => o.setName("user").setDescription("User to mute").setRequired(true))
        .addStringOption(o => o.setName("duration").setDescription("Duration (e.g. 10m, 1h, 7d) — max 28d").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason for the mute").setRequired(false)),

    // ── Unmute ────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("unmute")
        .setDescription("Remove a timeout from a user")
        .addUserOption(o => o.setName("user").setDescription("User to unmute").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason for the unmute").setRequired(false)),

    // ── Warn ──────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("warn")
        .setDescription("Issue a warning to a user")
        .addUserOption(o => o.setName("user").setDescription("User to warn").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason for the warning").setRequired(true)),

    // ── Unwarn ────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("unwarn")
        .setDescription("Remove a warning from a user by case ID")
        .addIntegerOption(o => o.setName("caseid").setDescription("Case ID of the warning to remove").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason for removal").setRequired(false)),

    // ── Note ──────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("note")
        .setDescription("Add a private moderator note to a user (not visible to them)")
        .addUserOption(o => o.setName("user").setDescription("User to add a note to").setRequired(true))
        .addStringOption(o => o.setName("note").setDescription("Note content").setRequired(true)),

    // ── Cases ─────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("cases")
        .setDescription("View all moderation cases for a user")
        .addUserOption(o => o.setName("user").setDescription("User to look up").setRequired(true))
        .addStringOption(o =>
            o.setName("filter")
                .setDescription("Filter by action type")
                .addChoices(
                    { name: "All",      value: "all"    },
                    { name: "Bans",     value: "ban"    },
                    { name: "Kicks",    value: "kick"   },
                    { name: "Mutes",    value: "mute"   },
                    { name: "Warnings", value: "warn"   },
                    { name: "Notes",    value: "note"   },
                )
                .setRequired(false)
        ),

    // ── Case ──────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("case")
        .setDescription("View a specific moderation case by ID")
        .addIntegerOption(o => o.setName("id").setDescription("Case ID").setRequired(true)),

    // ── Viewlog ───────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("viewlog")
        .setDescription("View recent moderation activity across the server")
        .addIntegerOption(o => o.setName("limit").setDescription("Number of recent cases to show (max 15, default 10)").setMinValue(1).setMaxValue(15).setRequired(false)),

    // ── Reason ────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("reason")
        .setDescription("Edit the reason on an existing case")
        .addIntegerOption(o => o.setName("caseid").setDescription("Case ID to update").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("New reason").setRequired(true)),

    // ── Roblox ────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("roblox")
        .setDescription("Link or view a Roblox username for a Discord user")
        .addSubcommand(sub =>
            sub.setName("set")
                .setDescription("Link a Roblox username to a Discord user")
                .addUserOption(o => o.setName("user").setDescription("Discord user").setRequired(true))
                .addStringOption(o => o.setName("username").setDescription("Roblox username").setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName("get")
                .setDescription("Look up the linked Roblox username for a user")
                .addUserOption(o => o.setName("user").setDescription("Discord user").setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName("remove")
                .setDescription("Remove the Roblox link for a user")
                .addUserOption(o => o.setName("user").setDescription("Discord user").setRequired(true))
        ),

    // ── Purge ─────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("purge")
        .setDescription("Bulk delete messages in a channel")
        .addIntegerOption(o => o.setName("amount").setDescription("Number of messages to delete (1-100)").setMinValue(1).setMaxValue(100).setRequired(true))
        .addUserOption(o => o.setName("user").setDescription("Only delete messages from this user").setRequired(false)),

    // ── Slowmode ──────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("slowmode")
        .setDescription("Set slowmode for a channel")
        .addIntegerOption(o => o.setName("seconds").setDescription("Slowmode delay in seconds (0 to disable)").setMinValue(0).setMaxValue(21600).setRequired(true))
        .addChannelOption(o => o.setName("channel").setDescription("Channel to apply slowmode to (defaults to current)").setRequired(false)),

    // ── Lock ──────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("lock")
        .setDescription("Lock a channel so members cannot send messages")
        .addChannelOption(o => o.setName("channel").setDescription("Channel to lock (defaults to current)").setRequired(false))
        .addStringOption(o => o.setName("reason").setDescription("Reason for locking").setRequired(false)),

    // ── Unlock ────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("unlock")
        .setDescription("Unlock a previously locked channel")
        .addChannelOption(o => o.setName("channel").setDescription("Channel to unlock (defaults to current)").setRequired(false)),

    // ── Userinfo ──────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("userinfo")
        .setDescription("View detailed information about a user")
        .addUserOption(o => o.setName("user").setDescription("User to look up (defaults to yourself)").setRequired(false)),

    // ── Setup ─────────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Configure the moderation bot for this server")
        .addSubcommand(sub =>
            sub.setName("modrole")
                .setDescription("Set the moderator role")
                .addRoleOption(o => o.setName("role").setDescription("Mod role").setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName("summarylog")
                .setDescription("Set the summary mod-log channel")
                .addChannelOption(o => o.setName("channel").setDescription("Summary log channel").setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName("detailedlog")
                .setDescription("Set the detailed mod-log channel")
                .addChannelOption(o => o.setName("channel").setDescription("Detailed log channel").setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName("view")
                .setDescription("View current bot configuration")
        ),

].map(c => c.toJSON());
