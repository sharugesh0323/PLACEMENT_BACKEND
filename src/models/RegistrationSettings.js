const mongoose = require('mongoose');

const registrationSettingsSchema = new mongoose.Schema({
    isAutoApprovalEnabled: { type: Boolean, default: false },
    registrationLinkSecret: { type: String, default: 'default-secret' },
}, { timestamps: true });

module.exports = mongoose.model('RegistrationSettings', registrationSettingsSchema);
