import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const appId = process.env.APP_ID;
const guildId = process.env.GUILD_ID;
const suggestionsChannelId = process.env.SUGGESTIONS_CHANNEL_ID;

if (!token || !appId || !guildId || !suggestionsChannelId) {
  console.error('Missing env vars. Check .env');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Deploy the /feedback command on startup (guild-scoped for instant availability)
async function deployCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  const commands = [
    new SlashCommandBuilder()
      .setName('feedback')
      .setDescription('Open the feedback form (submit with name or anonymously)')
      .setDMPermission(false)
      .toJSON(),
  ];
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
  console.log('Slash commands deployed (guild).');
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    await deployCommands();
  } catch (e) {
    console.error('Failed to deploy commands:', e);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // /feedback → show buttons (ephemeral)
    if (interaction.isChatInputCommand() && interaction.commandName === 'feedback') {
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
      await interaction.reply({ content: 'How would you like to submit?', components: [row], ephemeral: true });
      return;
    }

    // Button → open modal
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

      await interaction.showModal(modal);
      return;
    }

    // Modal submit → post embed to suggestions channel
    if (interaction.isModalSubmit() && interaction.customId.startsWith('fb_modal:')) {
      const anon = interaction.customId.endsWith(':1');
      const text = interaction.fields.getTextInputValue('text')?.trim();

      if (!text) {
        await interaction.reply({ content: 'Please include some text.', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('New Suggestion')
        .setDescription(text)
        .setTimestamp(new Date());

      if (anon) {
        embed.setFooter({ text: 'Submitted anonymously' });
      } else {
        embed.setFooter({ text: `Submitted by ${interaction.user.tag}` });
      }

      const channel = await interaction.guild.channels.fetch(suggestionsChannelId);
      if (!channel || !channel.isTextBased()) {
        await interaction.reply({ content: 'Config error: target channel is invalid.', ephemeral: true });
        return;
      }

      await channel.send({ embeds: [embed] });
      await interaction.reply({ content: 'Thanks! Your suggestion was submitted.', ephemeral: true });
      return;
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
