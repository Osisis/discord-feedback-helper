js
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);

    const channel = client.channels.cache.get(process.env.FORM_CHANNEL_ID);
    if (channel) {
        const embed = new EmbedBuilder()
            .setTitle('Submit a Suggestion')
            .setDescription('Click one of the buttons below to submit a suggestion.')
            .setColor(0x00AE86);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('suggest_with_name')
                .setLabel('Submit (with name)')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('suggest_anonymous')
                .setLabel('Submit Anonymously')
                .setStyle(ButtonStyle.Secondary)
        );

        channel.send({ embeds: [embed], components: [row] });
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        const isAnonymous = interaction.customId === 'suggest_anonymous';

        const modal = new ModalBuilder()
            .setCustomId(`modal_${interaction.customId}`)
            .setTitle('Submit Suggestion');

        const suggestionInput = new TextInputBuilder()
            .setCustomId('suggestion_input')
            .setLabel('Your suggestion')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(suggestionInput));

        await interaction.showModal(modal);
    } else if (interaction.isModalSubmit()) {
        const text = interaction.fields.getTextInputValue('suggestion_input');
        const anon = interaction.customId.includes('anonymous');

        const out = client.channels.cache.get(process.env.SUGGESTIONS_CHANNEL_ID);
        const embed = new EmbedBuilder()
            .setTitle('New Suggestion')
            .setDescription(text)
            .setTimestamp(new Date())
            .setFooter({ text: anon ? 'Submitted anonymously' : `Submitted by ${interaction.user.tag}` });

        const message = await out.send({ embeds: [embed] });

        await message.react('👍');
        await message.react('👎');
        const botUser = client.user;
        await message.reactions.cache.get('👍')?.users.remove(botUser.id);
        await message.reactions.cache.get('👎')?.users.remove(botUser.id);

        return interaction.reply({
            content: 'Thanks! Your suggestion was submitted.',
            flags: MessageFlags.Ephemeral
        });
    }
});

client.login(process.env.TOKEN);
