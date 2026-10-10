const { SlashCommandBuilder } = require('@discordjs/builders');
const { isFactionModerator, buildFactionEmbed } = require('../../factionUi');

module.exports = {
    data: new SlashCommandBuilder().setName('register_faction').setDescription('Register a faction for this server [ MOD ]')
        .addStringOption(option => option.setName('name').setDescription('Faction name').setMinLength(1).setMaxLength(80).setRequired(true))
        .addStringOption(option => option.setName('description').setDescription('What players should know about this faction').setMinLength(1).setMaxLength(2000).setRequired(true))
        .addStringOption(option => option.setName('image_url').setDescription('Optional HTTPS image URL').setMaxLength(2048))
        .addBooleanOption(option => option.setName('public').setDescription('Show this command to everyone?')),
    async execute(service, interaction) {
        if (!isFactionModerator(service, interaction)) {
            await interaction.editReply('Only moderators and the server owner can register factions.');
            return;
        }
        try {
            const faction = await service.factions.register({
                name: interaction.options.getString('name'), description: interaction.options.getString('description'),
                image_url: interaction.options.getString('image_url'),
            });
            await interaction.editReply({ content: 'Faction registered. Players can view their relations with /renown.',
                embeds: [buildFactionEmbed(faction)], allowedMentions: { parse: [] } });
        } catch (error) { await interaction.editReply(error.message); }
    },
};
