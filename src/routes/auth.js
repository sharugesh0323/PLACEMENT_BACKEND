const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });
};

// POST /api/auth/login - Student or Admin login
router.post('/login', async (req, res) => {
    try {
        let { identifier, password, role } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({ success: false, message: 'Please provide identifier and password' });
        }

        identifier = identifier.trim();
        password = password.trim();

        console.log(`Login attempt for: ${identifier}`);

        // Find user by email or registerNo (Case Insensitive)
        const user = await User.findOne({
            $or: [{ email: identifier.toLowerCase() }, { registerNo: identifier.toLowerCase() }]
        }).select('+password');

        if (!user) {
            console.log(`User not found: ${identifier}`);
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        console.log(`User found: ${user.email}, Role: ${user.role}`);

        // Role check if provided
        if (role && user.role !== role) {
            return res.status(403).json({ success: false, message: 'Access denied for this role' });
        }

        const isMatch = await user.comparePassword(password);
        console.log(`Password match for ${identifier}: ${isMatch}`);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        if (!user.isActive) {
            return res.status(403).json({ success: false, message: 'Account is deactivated. Contact admin.' });
        }

        const reqIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const device = req.headers['user-agent'] || 'Unknown Device';

        if (user.role === 'student') {
            if (!user.firstLoginIp) {
                user.firstLoginIp = reqIp;
            } else if (user.firstLoginIp !== reqIp) {
                // IP mismatch block
                user.ipLogs.push({ ip: reqIp, device, status: 'blocked' });
                user.securityAlerts.push({
                    reason: 'Login attempt from different IP',
                    ip: reqIp,
                    timestamp: new Date()
                });
                await user.save({ validateBeforeSave: false });
                return res.status(403).json({
                    success: false,
                    message: 'Login blocked: Unrecognized IP address/device detected. Admin has been notified.'
                });
            }
            user.ipLogs.push({ ip: reqIp, device, status: 'success' });
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save({ validateBeforeSave: false });

        const token = generateToken(user._id);

        res.json({
            success: true,
            token,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                registerNo: user.registerNo,
                role: user.role,
                department: user.department,
                batch: user.batch,
                year: user.year,
                section: user.section
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/auth/me - Get logged in user
router.get('/me', protect, async (req, res) => {
    res.json({ success: true, user: req.user });
});

// POST /api/auth/change-password
router.post('/change-password', protect, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const user = await User.findById(req.user._id).select('+password');

        const isMatch = await user.comparePassword(oldPassword);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Old password is incorrect' });
        }

        user.password = newPassword;
        await user.save();

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// PUT /api/auth/update-profile
router.put('/update-profile', protect, async (req, res) => {
    try {
        const {
            name, email, profileImage, cgpa, mobileNo,
            fatherName, motherName, address,
            currentArrears, historyOfArrears, semesterResults, socialLinks
        } = req.body;
        const user = await User.findById(req.user._id);

        if (name) user.name = name;
        if (email) user.email = email.toLowerCase();
        if (profileImage !== undefined) user.profileImage = profileImage;
        if (cgpa !== undefined) user.cgpa = cgpa;
        if (mobileNo !== undefined) user.mobileNo = mobileNo;
        if (fatherName !== undefined) user.fatherName = fatherName;
        if (motherName !== undefined) user.motherName = motherName;
        if (address !== undefined) user.address = address;
        if (currentArrears !== undefined) user.currentArrears = currentArrears;
        if (historyOfArrears !== undefined) user.historyOfArrears = historyOfArrears;
        if (semesterResults !== undefined) user.semesterResults = semesterResults;
        if (socialLinks !== undefined) user.socialLinks = socialLinks;

        await user.save();

        // Return full user object (excluding sensitive fields handled by toJSON)
        const updatedUser = await User.findById(user._id).select('-password');

        res.json({
            success: true,
            user: updatedUser
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: 'Email already exists' });
        }
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// PUT /api/auth/change-password
router.put('/change-password', protect, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const user = await User.findById(req.user._id).select('+password');

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const isMatch = await user.comparePassword(oldPassword);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid current password' });
        }

        user.password = newPassword;
        await user.save();

        res.json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
