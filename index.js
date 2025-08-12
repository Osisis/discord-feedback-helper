import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

// =====================
// Env & Config
// =====================
const token = process.env.DISCORD_TOKEN;
const appId = process.env.APP_ID;
const guildId = process.env.GUILD_ID;
const formChannelId = process.env.FORM_CHANNEL_ID; // Panel lives here
const suggestionsChannelId = process.env.SUGGESTIONS_CHANNEL_ID; // Suggestions are posted here

// Staff roles allowed to view detailed results (comma separated). Default to the provided role id.
const STAFF_ROLE_IDS = (process.env.STAFF_ROLE_IDS ?? '1356279578200637490')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!token || !appId || !guildId || !formChannelId || !suggestionsChannelId) {
  console.error('Missing env vars. Required: DISCORD_TOKEN, APP_ID, GUILD_ID, FORM_CHANNEL_ID, SUGGESTIONS_CHANNEL_ID');
  process.exit(1);
}

// =====================
// Client
// =====================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// =====================
// Voting state (in-memory)
// =====================
// messageId -> { up: Set<userId>, down: Set<userId> }
const voteState = new Map();
function getVoteState(messageId) {
  if (!voteState.has(messageId)) voteState.set(messageId, { up: new Set(), down: new Set() });
  return voteState.get(messageId);
}
function buildVoteRow(messageId) {
  const state = getVoteState(messageId);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`vote:up:${messageId}`).setLabel(`👍 ${state.up.size}`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`vote:down:${messageId}`).setLabel(`👎 ${state.down.size}`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`vote:view:${messageId}`).setLabel('View results').setStyle(ButtonStyle.Secondary),
  );
}

// =====================
// (Optional) Deploy /feedback — not required for panel-only UX
// =====================
async function deployCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  const commands = [
    new SlashCommandBuilder()
      .setName('feedback')
      .setDescription('Open the feedback form (not required if panel is present)')
      .setDMPermission(false)
      .toJSON(),
  ];
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
  console.log('Slash commands deployed (guild).');
}

// =====================
// Post/refresh the static panel in the form channel
// =====================
async function upsertPanel() {
  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(formChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error('FORM_CHANNEL_ID must be a text channel.');

  const panelEmbed = new EmbedBuilder()
    .setTitle('Submit a Suggestion')
    .setDescription(
      `Click a button to open the form.

• **Submit (with name)** posts your Discord tag with the suggestion.
• **Submit Anonymously** hides your identity in the posted message.`
    )
    .setColor(0x5865F2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('fb_open:public').setLabel('Submit (with name)').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('fb_open:anon').setLabel('Submit Anonymously').setStyle(ButtonStyle.Secondary),
  );

  // Clean up older panels to avoid duplicates on redeploys
  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (recent) {
    const mine = recent.filter(m => m.author.id === client.user.id && (m.embeds?.[0]?.title === 'Submit a Suggestion'));
    for (const [, msg] of mine) { try { await msg.delete(); } catch {} }
  }

  const msg = await channel.send({ embeds: [panelEmbed], components: [row] });
  try { await msg.pin(); } catch {}
  console.log(`Feedback panel posted in #${channel.name} (${channel.id}).`);
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try { await deployCommands(); } catch (e) { console.warn('Deploy commands failed (ok if not needed):', e?.message || e); }
  try { await upsertPanel(); } catch (e) { console.error('Failed to post panel:', e?.message || e); }
});

// =====================
// Interactions
// =====================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // (Optional) /feedback → show the same buttons ephemerally
    if (interaction.isChatInputCommand() && interaction.commandName === 'feedback') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fb_open:public').setLabel('Submit (with name)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('fb_open:anon').setLabel('Submit Anonymously').setStyle(ButtonStyle.Secondary),
      );
      return interaction.reply({ content: 'Choose how to submit:', components: [row], flags: MessageFlags.Ephemeral });
    }

    // Panel buttons → open modal
    if (interaction.isButton() && interaction.customId.startsWith('fb_open:')) {
      const anon = interaction.customId.endsWith(':anon');
      const modal = new ModalBuilder().setCustomId(`fb_modal:${anon ? 1 : 0}`).setTitle('Submit Feedback');
      const text = new TextInputBuilder().setCustomId('text').setLabel('Your suggestion or feedback').setStyle(TextInputStyle.Paragraph).setMaxLength(1024).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(text));
      return interaction.showModal(modal);
    }

    // Modal submit → post to suggestions channel + attach button voting (starts at 0)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('fb_modal:')) {
      const anon = interaction.customId.endsWith(':1');
      const text = interaction.fields.getTextInputValue('text')?.trim();
      if (!text) return interaction.reply({ content: 'Please include some text.', flags: MessageFlags.Ephemeral });

      const guild = await client.guilds.fetch(guildId);
      const out = await guild.channels.fetch(suggestionsChannelId);
      if (!out?.isTextBased()) return interaction.reply({ content: 'Config error: target suggestions channel is invalid.', flags: MessageFlags.Ephemeral });

      // Display name: nickname > server display > global > username
      const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const displayName = member?.nickname || member?.displayName || interaction.user.globalName || interaction.user.username;

      const embed = new EmbedBuilder()
        .setTitle('New Suggestion')
        .setDescription(text)
        .setTimestamp(new Date())
        .setFooter({ text: anon ? 'Submitted anonymously' : `Submitted by ${displayName}` });

      // Send first, then add the voting buttons with messageId in the customId
      const sent = await out.send({ embeds: [embed] });
      const row = buildVoteRow(sent.id);
      await sent.edit({ components: [row] });

      return interaction.reply({ content: 'Thanks! Your suggestion was submitted.', flags: MessageFlags.Ephemeral });
    }

    // Handle voting button clicks (up / down / view)
    if (interaction.isButton() && interaction.customId.startsWith('vote:')) {
      const [, action, messageId] = interaction.customId.split(':'); // vote:up|down|view:messageId
      if (!action || !messageId) return interaction.deferUpdate();

      // VIEW RESULTS — staff only (ephemeral)
      if (action === 'view') {
        const isStaff = STAFF_ROLE_IDS.some((rid) => interaction.member?.roles?.cache?.has(rid));
        if (!isStaff) {
          return interaction.reply({ content: 'You are not authorized to view voting results.', flags: MessageFlags.Ephemeral });
        }
        const state = getVoteState(messageId);
        const upIds = Array.from(state.up);
        const downIds = Array.from(state.down);

        const fetchNames = async (ids) => {
          const names = await Promise.all(ids.map(async (id) => {
            try {
              const m = await interaction.guild.members.fetch(id);
              return m?.displayName ?? m?.user?.username ?? 'Unknown';
            } catch {
              return 'Unknown';
            }
          }));
          return names;
        };

        const upNames = await fetchNames(upIds);
        const downNames = await fetchNames(downIds);

        const summary = [
          `👍 Upvotes (${upIds.length}):`,
          upNames.length ? upNames.map(n => `• ${n}`).join('\n') : '• None',
          '',
          `👎 Downvotes (${downIds.length}):`,
          downNames.length ? downNames.map(n => `• ${n}`).join('\n') : '• None',
        ].join('\n');

        return interaction.reply({ content: summary, flags: MessageFlags.Ephemeral });
      }

      // UP / DOWN voting logic
      const state = getVoteState(messageId);
      const userId = interaction.user.id;

      if (action === 'up') {
        if (state.up.has(userId)) { state.up.delete(userId); } else { state.up.add(userId); state.down.delete(userId); }
      } else if (action === 'down') {
        if (state.down.has(userId)) { state.down.delete(userId); } else { state.down.add(userId); state.up.delete(userId); }
      }

      // Update the button labels with new counts
      try {
        const newRow = buildVoteRow(messageId);
        if (interaction.message?.id === messageId) {
          await interaction.message.edit({ components: [newRow] });
        } else {
          const channel = await interaction.guild.channels.fetch(suggestionsChannelId);
          const msg = await channel.messages.fetch(messageId);
          await msg.edit({ components: [newRow] });
        }
      } catch (e) {
        console.warn('Could not edit message to update votes:', e?.message || e);
      }

      return interaction.deferUpdate(); // acknowledge without a visible reply
    }
  } catch (err) {
    console.error('Interaction error:', err);
    if (interaction.isRepliable()) {
      try { await interaction.reply({ content: 'Sorry, something went wrong handling that action.', flags: MessageFlags.Ephemeral }); } catch {}
    }
  }
});

client.login(token);
