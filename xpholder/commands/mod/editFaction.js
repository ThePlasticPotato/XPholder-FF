const { SlashCommandBuilder } = require('@discordjs/builders');
const { isFactionModerator, factionAutocomplete, factionOption, buildFactionEmbed } = require('../../factionUi');

module.exports = {
    data: new SlashCommandBuilder().setName('edit_faction').setDescription('Edit a registered faction [ MOD ]')
        .addStringOption(option => factionOption(option).setRequired(true))
        .addStringOption(option => option.setName('name').setDescription('New faction name').setMinLength(1).setMaxLength(80))
        .addStringOption(option => option.setName('description').setDescription('New faction description').setMinLength(1).setMaxLength(2000))
        .addStringOption(option => option.setName('image_url').setDescription('New HTTPS image URL').setMaxLength(2048))
        .addBooleanOption(option => option.setName('remove_image').setDescription('Remove the existing faction image'))
        .addBooleanOption(option => option.setName('public').setDescription('Show this command to everyone?')),
    autocomplete: factionAutocomplete,
    async execute(service, interaction) {
        if (!isFactionModerator(service, interaction)) {
            await interaction.editReply('Only moderators and the server owner can edit factions.');
            return;
        }
        try {
            const faction = await service.factions.find(interaction.options.getString('faction'));
            if (!faction) { await interaction.editReply('That faction is not registered in this server.'); return; }
            const changes = {};
            for (const key of ['name', 'description', 'image_url']) {
                const value = interaction.options.getString(key);
                if (value !== null) { changes[key] = value; }
            }
            if (interaction.options.getBoolean('remove_image')) {
                if (changes.image_url) { await interaction.editReply('Choose either a new image or remove_image.'); return; }
                changes.image_url = '';
            }
            if (!Object.keys(changes).length) { await interaction.editReply('Provide a name, description, image, or remove_image to edit.'); return; }
            const updated = await service.factions.edit(faction.faction_id, changes);
            await interaction.editReply({ content: 'Faction updated.', embeds: [buildFactionEmbed(updated)], allowedMentions: { parse: [] } });
        } catch (error) { await interaction.editReply(error.message); }
    },
};
