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
  ModalBuilder,
  REST,
  Routes,
  SlashCommandBuilder, // optional; keep if you want /feedback available too
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

// === Env Vars ===
const token = process.env.DISCORD_TOKEN;
const appId = process.env.APP_ID;
const guildId = process.env.GUILD_ID;
const formChannelId = process.env.FORM_CHANNEL_ID;           // Channel that shows the panel with buttons
const suggestionsChannelId = process.env.SUGGESTIONS_CHANNEL_ID; // Channel where suggestions are posted

if (!token || !appId || !guildId || !formChannelId || !suggestionsChannelId) {
  console.error('Missing env vars. Required: DISCORD_TOKEN, APP_ID, GUILD_ID, FORM_CHANNEL_ID, SUGGESTIONS_CHANNEL_ID');
  process.exit(1);
}

// === Client ===
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// === (Optional) Deploy /feedback command — not required for panel-only UX ===
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

// === Post/refresh the static panel in the form channel ===
async function upsertPanel() {
  const guild = await client.guilds.fetch(guildId);
  const channel = await guild.channels.fetch(formChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error('FORM_CHANNEL_ID is not a text channel I can access.');
  }

  const panelEmbed = new EmbedBuilder()
    .setTitle('Submit a Suggestion')
    .setDescription(
      'Click a button to open the form.\n\n' +
      '• **Submit (with name)** posts your Discord tag with the suggestion.\n' +
      '• **Submit Anonymously** hides your identity in the posted message.'
    )
    .setColor(0x5865F2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fb_open:public')
      .setLabel('Submit (with name)')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('fb_open:anon')
      .setLabel('Submit Anonymously')
      .setStyle(ButtonStyle.Secondary),
  );

  // Clean up older panels to avoid duplicates on redeploys
  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (recent) {
    const mine = recent.filter(m =>
      m.author.id === client.user.id &&
      (m.embeds?.[0]?.title === 'Submit a Suggestion')
    );
    for (const [, msg] of mine) {
      try { await msg.delete(); } catch {}
    }
  }

  const msg = await channel.send({ embeds: [panelEmbed], components: [row] });
  try { await msg.pin(); } catch {} // best-effort; requires Manage Messages permission
  console.log(`Feedback panel posted in #${channel.name} (${channel.id}).`);
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    // Optional: keeping /feedback available; remove this call if you truly want no slash commands at all
    await deployCommands();
  } catch (e) {
    console.warn('Deploy commands failed (ok if not needed):', e?.message || e);
  }
  try {
    await upsertPanel();
  } catch (e) {
    console.error('Failed to post panel:', e?.message || e);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // (Optional) /feedback → show the same buttons ephemerally
    if (interaction.isChatInputCommand() && interaction.commandName === 'feedback') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fb_open:public').setLabel('Submit (with name)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('fb_open:anon').setLabel('Submit Anonymously').setStyle(ButtonStyle.Secondary),
      );
      return interaction.reply({ content: 'Choose how to submit:', components: [row], ephemeral: true });
    }

    // Panel buttons → open modal
    if (interaction.isButton() && interaction.customId.startsWith('fb_open:')) {
      const anon = interaction.customId.endsWith(':anon');
      const modal = new ModalBuilder()
        .setCustomId(`fb_modal:${anon ? 1 : 0}`)
        .setTitle('Submit Feedback');

      const text = new TextInputBuilder()
        .setCustomId('text')
        .setLabel('Your suggestion or feedback')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1024)
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(text);
      modal.addComponents(row);

      return interaction.showModal(modal);
    }

    // Modal submit → post to suggestions channel + add emoji reactions for voting
    if (interaction.isModalSubmit() && interaction.customId.startsWith('fb_modal:')) {
      const anon = interaction.customId.endsWith(':1');
      const text = interaction.fields.getTextInputValue('text')?.trim();
      if (!text) {
        return interaction.reply({ content: 'Please include some text.', ephemeral: true });
        }

      const guild = await client.guilds.fetch(guildId);
      const out = await guild.channels.fetch(suggestionsChannelId);
      if (!out?.isTextBased()) {
        return interaction.reply({ content: 'Config error: target suggestions channel is invalid.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('New Suggestion')
        .setDescription(text)
        .setTimestamp(new Date())
        .setFooter({ text: anon ? 'Submitted anonymously' : `Submitted by ${interaction.user.tag}` });

      // Send the suggestion and capture the message for voting reactions
      const message = await out.send({ embeds: [embed] });

      // === Emoji Voting (Option 1) ===
      try {
        await message.react('👍');
        await message.react('👎');
      } catch (e) {
        console.warn('Could not add reactions (check permissions):', e?.message || e);
      }

      return interaction.reply({ content: 'Thanks! Your suggestion was submitted.', ephemeral: true });
    }
  } catch (err) {
    console.error('Interaction error:', err);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({ content: 'Sorry, something went wrong handling that action.', ephemeral: true });
      } catch {}
    }
  }
});

client.login(token);
