const HOMEBREW_DEFAULTS = {
    homebrewAutoVerdicts: 'off',
    homebrewApprovalLead: '3',
    homebrewDenialLead: '3',
    homebrewEarlyApprovalLead: '6',
    homebrewEarlyDenialLead: '6',
};

function getHomebrewSettings(config = {}) {
    const threshold = key => {
        const value = Number(config[key]);
        return Number.isSafeInteger(value) && value > 0 ? value : Number(HOMEBREW_DEFAULTS[key]);
    };
    return {
        autoVerdicts: config.homebrewAutoVerdicts === 'on',
        approvalLead: threshold('homebrewApprovalLead'),
        denialLead: threshold('homebrewDenialLead'),
        earlyApprovalLead: threshold('homebrewEarlyApprovalLead'),
        earlyDenialLead: threshold('homebrewEarlyDenialLead'),
    };
}

module.exports = { HOMEBREW_DEFAULTS, getHomebrewSettings };
