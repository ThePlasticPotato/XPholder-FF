const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { XPHOLDER_COLOUR } = require('./config.json');
const { FACTION_RANKS, getFactionStanding } = require('./factionRanks');

function isFactionModerator(service, interaction) {
    return service.isMod(interaction.member._roles) || interaction.user.id === interaction.guild.ownerId;
}

async function factionAutocomplete(service, interaction) {
    const query = interaction.options.getFocused().trim().normalize('NFKC').toLowerCase();
    const factions = await service.factions.list();
    await interaction.respond(factions.filter(faction => faction.name_key.includes(query)).slice(0, 25)
        .map(faction => ({ name: faction.name, value: `faction:${faction.faction_id}` })));
}

function factionOption(option) {
    return option.setName('faction').setDescription('Choose a registered faction or enter its exact name').setAutocomplete(true);
}

function buildFactionEmbed(faction) {
    const embed = new EmbedBuilder().setTitle(faction.name).setDescription(faction.description)
        .setColor(XPHOLDER_COLOUR);
    if (faction.image_url) { embed.setImage(faction.image_url); }
    return embed;
}

function renownProgressBar(renown) {
    const magnitude = Math.abs(renown);
    const filledCell = renown < 0 ? '🟥' : '🟩';
    const cellsPerSegment = 3;
    const segments = FACTION_RANKS.slice(1).map((rank, index) => {
        const start = FACTION_RANKS[index].renown;
        const progress = Math.max(0, Math.min(1, (magnitude - start) / (rank.renown - start)));
        // Even a small positive/negative amount is visible; only a completed
        // threshold fills the entire segment.
        const filled = progress > 0 ? Math.max(1, Math.floor(progress * cellsPerSegment)) : 0;
        return filledCell.repeat(filled) + '⬛'.repeat(cellsPerSegment - filled);
    });
    return segments.join(' │ ');
}

function renownProgressText(renown) {
    const legend = renown < 0 ?
        'Negative renown; red fill shows its magnitude. Rank remains Unknown.' :
        FACTION_RANKS.slice(1).map(rank => `${rank.name} ${rank.renown}`).join(' • ') +
            '\nSegments show renown only; quest and tier requirements still apply.';
    return `${renownProgressBar(renown)}\n${legend}`;
}

function buildRenownEmbed(service, character, faction) {
    const standing = getFactionStanding(service.levels, character, faction, service.config);
    return buildFactionEmbed(faction).addFields(
        { name: 'Character', value: character.name, inline: true },
        { name: 'Renown', value: String(standing.renown), inline: true },
        { name: 'Rank', value: standing.rank, inline: true },
        { name: 'Renown Progress', value: renownProgressText(standing.renown) },
        { name: 'Character Tier', value: `Tier ${standing.tier} (level ${standing.level})`, inline: true },
        { name: 'Faction Quests', value: String(standing.quests), inline: true },
        { name: 'Solo Challenges', value: String(standing.soloChallenges), inline: true },
        { name: standing.nextRank ? `Next Rank: ${standing.nextRank.name}` : 'Highest Rank',
            value: standing.nextRank ? standing.missing.map(item => `• ${item}`).join('\n') : 'All Champion requirements are met.' }
    );
}

function renownComponents(factions, index) {
    const pageStart = Math.floor(index / 25) * 25;
    const select = new StringSelectMenuBuilder().setCustomId('renown_select').setPlaceholder('Select a faction')
        .addOptions(factions.slice(pageStart, pageStart + 25).map((faction, offset) => ({
            label: faction.name, value: String(faction.faction_id), default: pageStart + offset === index,
        })));
    const buttons = [
        new ButtonBuilder().setCustomId('renown_previous').setLabel('Previous faction').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
        new ButtonBuilder().setCustomId('renown_next').setLabel('Next faction').setStyle(ButtonStyle.Secondary).setDisabled(index === factions.length - 1),
    ];
    if (factions.length > 25) {
        buttons.push(
            new ButtonBuilder().setCustomId('renown_previous_page').setLabel('Previous 25').setStyle(ButtonStyle.Secondary).setDisabled(pageStart === 0),
            new ButtonBuilder().setCustomId('renown_next_page').setLabel('Next 25').setStyle(ButtonStyle.Secondary).setDisabled(pageStart + 25 >= factions.length),
        );
    }
    return [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(buttons)];
}

module.exports = { isFactionModerator, factionAutocomplete, factionOption, buildFactionEmbed, buildRenownEmbed, renownComponents, renownProgressBar };
