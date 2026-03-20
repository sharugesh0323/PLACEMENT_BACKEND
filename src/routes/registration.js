const express = require('express');
const router = express.Router();
const RegistrationSettings = require('../models/RegistrationSettings');
const RegistrationRequest = require('../models/RegistrationRequest');
const User = require('../models/User');
const { protect, isAdmin } = require('../middleware/auth');
const crypto = require('crypto');

// Get Settings
router.get('/settings', protect, isAdmin, async (req, res) => {
    try {
        let settings = await RegistrationSettings.findOne();
        if (!settings) {
            settings = await RegistrationSettings.create({
                isAutoApprovalEnabled: false,
                registrationLinkSecret: crypto.randomBytes(16).toString('hex')
            });
        }
        res.json({ success: true, settings });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update Settings
router.get('/toggle', protect, isAdmin, async (req, res) => {
    try {
        let settings = await RegistrationSettings.findOne();
        if (!settings) {
            settings = await RegistrationSettings.create({
                isAutoApprovalEnabled: true,
                registrationLinkSecret: crypto.randomBytes(16).toString('hex')
            });
        } else {
            settings.isAutoApprovalEnabled = !settings.isAutoApprovalEnabled;
            await settings.save();
        }
        res.json({ success: true, settings });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Refresh Link Secret
router.post('/refresh-link', protect, isAdmin, async (req, res) => {
    try {
        let settings = await RegistrationSettings.findOne();
        if (!settings) {
            settings = await RegistrationSettings.create({
                isAutoApprovalEnabled: false,
                registrationLinkSecret: crypto.randomBytes(16).toString('hex')
            });
        } else {
            settings.registrationLinkSecret = crypto.randomBytes(16).toString('hex');
            await settings.save();
        }
        res.json({ success: true, settings });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Validate Secret and Fetch Metadata
router.get('/validate/:secret', async (req, res) => {
    try {
        const settings = await RegistrationSettings.findOne();
        if (!settings || settings.registrationLinkSecret !== req.params.secret) {
            return res.status(403).json({ success: false, message: 'Invalid or expired registration link' });
        }

        // Fetch distinct departments from all registered admins
        const departments = await User.find({ role: 'admin' }).distinct('department');
        
        res.json({ 
            success: true, 
            departments: departments.filter(d => d && d.trim() !== '') // Remove null/empty/whitespace departments
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Public Registration
router.post('/register', async (req, res) => {
    try {
        const { secret, studentData } = req.body;

        const settings = await RegistrationSettings.findOne();
        if (!settings || settings.registrationLinkSecret !== secret) {
            return res.status(403).json({ success: false, message: 'Invalid or expired registration link' });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email: studentData.email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }

        const existingRegNo = await User.findOne({ registerNo: studentData.registerNo });
        if (existingRegNo) {
            return res.status(400).json({ success: false, message: 'Register number already exists' });
        }

        // Set default password: jjcet + registerNo
        const defaultPassword = `jjcet${studentData.registerNo.toLowerCase()}`;
        studentData.password = defaultPassword;

        if (settings.isAutoApprovalEnabled) {
            // Add directly to User model
            const newUser = await User.create(studentData);
            res.json({ success: true, message: 'Registration successful! You can now login.', user: newUser });
        } else {
            // Add to RegistrationRequest model
            const request = await RegistrationRequest.create(studentData);
            res.json({ success: true, message: 'Registration submitted! Awaiting admin approval.', request });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get Pending Requests
router.get('/requests', protect, isAdmin, async (req, res) => {
    try {
        const requests = await RegistrationRequest.find({ status: 'pending' }).sort('-createdAt');
        res.json({ success: true, requests });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get Approved Requests
router.get('/requests/approved', protect, isAdmin, async (req, res) => {
    try {
        const requests = await RegistrationRequest.find({ status: 'approved' }).sort('-updatedAt');
        res.json({ success: true, requests });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Sync/Reset Password from request (for login fix)
router.post('/sync-password/:id', protect, isAdmin, async (req, res) => {
    try {
        const request = await RegistrationRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ success: false, message: 'Source request not found' });

        const user = await User.findOne({ email: request.email });
        if (!user) return res.status(404).json({ success: false, message: 'User account not found' });

        // Explicitly set to default pattern for consistency
        user.password = `jjcet${user.registerNo.toLowerCase()}`;
        await user.save();
        res.json({ success: true, message: 'User password reset to default (jjcet + registerNo)' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Approve Request
router.post('/approve/:id', protect, isAdmin, async (req, res) => {
    try {
        const request = await RegistrationRequest.findById(req.id || req.params.id);
        if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

        // Create user
        const userData = request.toObject();
        delete userData._id;
        delete userData.status;
        delete userData.createdAt;
        delete userData.updatedAt;

        const newUser = await User.create(userData);
        request.status = 'approved';
        await request.save();

        res.json({ success: true, message: 'Student approved and added!', user: newUser });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Reject/Remove Request
router.delete('/requests/:id', protect, isAdmin, async (req, res) => {
    try {
        const request = await RegistrationRequest.findById(req.id || req.params.id);
        if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

        await RegistrationRequest.findByIdAndDelete(req.id || req.params.id);
        res.json({ success: true, message: 'Request removed' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
