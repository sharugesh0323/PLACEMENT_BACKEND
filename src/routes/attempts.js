const express = require('express');
const router = express.Router();
const Attempt = require('../models/Attempt');
const Assessment = require('../models/Assessment');
const User = require('../models/User');
const { protect, isAdmin } = require('../middleware/auth');

// POST /api/attempts/start - Start an attempt
router.post('/start', protect, async (req, res) => {
    try {
        const { assessmentId } = req.body;
        const assessment = await Assessment.findById(assessmentId);

        if (!assessment) {
            return res.status(404).json({ success: false, message: 'Assessment not found' });
        }

        const now = new Date();
        if (now < assessment.startTime) {
            return res.status(400).json({ success: false, message: 'Assessment has not started yet' });
        }
        if (now > assessment.endTime) {
            return res.status(400).json({ success: false, message: 'Assessment has ended' });
        }
        if (assessment.isGloballydisabled) {
            return res.status(400).json({ success: false, message: 'Assessment is currently disabled' });
        }

        const currentIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const currentUserAgent = req.headers['user-agent'];

        // Check existing active attempt
        const existingActive = await Attempt.findOne({
            studentId: req.user._id,
            assessmentId,
            status: 'active'
        });
        if (existingActive) {
            if (existingActive.ipAddress && (existingActive.ipAddress !== currentIp || existingActive.userAgent !== currentUserAgent)) {
                // Mismatch, auto-submit the existing one
                existingActive.status = 'auto_submitted';
                existingActive.kickoutReason = `Attempted resume from new IP/Device (Old IP: ${existingActive.ipAddress}, New IP: ${currentIp})`;
                existingActive.exitTime = new Date();

                // Calculate current score
                let score = 0;
                existingActive.answers.forEach(ans => {
                    const q = assessment.questions.find(q => q._id.toString() === ans.questionId?.toString());
                    if (q) {
                        if (q.type === 'mcq' && q.correctAnswer === ans.answer) {
                            score += q.maxMarks || 1;
                            ans.isCorrect = true;
                            ans.marksObtained = q.maxMarks || 1;
                        } else {
                            ans.isCorrect = false;
                            ans.marksObtained = 0;
                        }
                    }
                });

                existingActive.score = score;
                existingActive.percentage = assessment.totalMarks > 0 ? Math.round((score / assessment.totalMarks) * 100) : 0;
                await existingActive.save();

                const io = req.app.get('io');
                if (io) {
                    io.to('admins').emit('admin_alert', {
                        title: 'Malpractice Auto-Submit',
                        message: `${req.user.name} (${req.user.registerNo}) tried to access active test "${assessment.title}" from a DIFFERENT IP/Device. Test auto-submitted.`,
                        type: 'error'
                    });
                }

                return res.status(403).json({ success: false, message: 'Your ongoing assessment was auto-submitted because you attempted to access it from a different IP address or device.' });
            }

            return res.json({ success: true, attempt: existingActive, resumed: true });
        }

        const completedCount = await Attempt.countDocuments({
            studentId: req.user._id,
            assessmentId,
            status: { $in: ['completed', 'auto_submitted', 'time_expired', 'kicked'] }
        });

        const student = await User.findById(req.user._id);

        // Find specific extra attempts for this assessment
        const specificExtra = (student.extraAssessmentAttempts || [])
            .find(a => a.assessmentId.toString() === assessmentId.toString())?.extraCount || 0;

        const maxAttempts = (assessment.allowedAttempts || 1) + specificExtra + (student.extraAttempts || 0);

        if (completedCount >= maxAttempts) {
            return res.status(400).json({ success: false, message: 'Maximum attempts reached' });
        }

        // Check if permanently disqualified from this assessment
        const disqualifiedAttempt = await Attempt.findOne({
            studentId: req.user._id,
            assessmentId,
            permanentlyDisqualified: true
        });
        if (disqualifiedAttempt) {
            return res.status(403).json({
                success: false,
                message: 'You have been permanently disqualified from this assessment due to exceeding the maximum number of warnings. No re-attempts are allowed.'
            });
        }

        const attempt = await Attempt.create({
            studentId: req.user._id,
            assessmentId,
            entryTime: now,
            totalMarks: assessment.totalMarks,
            ipAddress: currentIp,
            userAgent: currentUserAgent,
            isExtraAttempt: completedCount >= assessment.allowedAttempts
        });

        // Notify admin via socket (both assessment room and general admins room)
        const io = req.app.get('io');
        const payload = {
            attemptId: attempt._id,
            studentId: req.user._id,
            studentName: req.user.name,
            registerNo: req.user.registerNo,
            department: req.user.department,
            batch: req.user.batch,
            assessmentId,
            assessmentName: assessment.title,
            entryTime: now
        };

        io.to(`assessment_${assessmentId}`).emit('student_entered', payload);
        io.to('admins').emit('student_entered', payload);

        res.status(201).json({ success: true, attempt });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/attempts/:id/submit - Submit attempt
router.post('/:id/submit', protect, async (req, res) => {
    try {
        const { answers, reason } = req.body;
        const attempt = await Attempt.findById(req.params.id);

        if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });
        if (attempt.studentId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const assessment = await Assessment.findById(attempt.assessmentId);
        if (!assessment) {
            return res.status(404).json({ success: false, message: 'Assessment no longer exists' });
        }

        let score = 0;

        // Grade MCQ answers
        const gradedAnswers = (answers || []).map(ans => {
            const question = assessment.questions.find(
                (q, idx) => idx === ans.questionIndex || (q._id && q._id.toString() === ans.questionId)
            );

            let isCorrect = false;
            let marksObtained = 0;

            if (question) {
                if (question.type === 'mcq' && question.correctAnswer) {
                    isCorrect = String(ans.answer).trim() === String(question.correctAnswer).trim();
                    marksObtained = isCorrect ? (question.maxMarks || 1) : 0;
                } else if (question.type === 'programming' || question.type === 'sql') {
                    // If they just ran the code, we might have passedTests in executionResult
                    const passed = ans.executionResult?.passedTests || 0;
                    const total = question.testCases?.length || 1;
                    marksObtained = Math.round((passed / total) * (question.maxMarks || 10));
                } else if (question.type === 'short_answer' || question.type === 'SHORT_ANSWER') {
                    const keywords = question.keywords || [];
                    if (keywords.length > 0) {
                        const studentAnswer = (ans.answer || '').toLowerCase();
                        const found = keywords.filter(k => studentAnswer.includes(k.toLowerCase())).length;
                        marksObtained = Math.round((found / keywords.length) * (question.maxMarks || 1));
                        isCorrect = found > 0;
                    }
                }
            }

            score += Math.round(marksObtained);
            return { ...ans, isCorrect, marksObtained: Math.round(marksObtained) };
        });

        const exitTime = new Date();
        const duration = Math.round((exitTime - attempt.entryTime) / 1000);

        attempt.answers = gradedAnswers;
        attempt.score = Math.round(score);
        attempt.percentage = assessment.totalMarks ? Math.round((Math.round(score) / assessment.totalMarks) * 100) : 0;
        attempt.exitTime = exitTime;
        attempt.duration = duration;
        attempt.status = reason ? 'auto_submitted' : 'completed';
        attempt.kickoutReason = reason || null;

        await attempt.save();

        // Notify admin
        const io = req.app.get('io');
        const payload = {
            attemptId: attempt._id,
            studentId: req.user._id,
            studentName: req.user.name,
            score,
            status: attempt.status,
            kickoutReason: reason,
            exitTime
        };

        io.to(`assessment_${attempt.assessmentId}`).emit('student_submitted', payload);
        io.to('admins').emit('student_submitted', payload);

        res.json({ success: true, attempt, score, percentage: attempt.percentage });
    } catch (error) {
        console.error('SUBMISSION CRASH:', error);
        res.status(500).json({ success: false, message: 'Submission failed: ' + error.message });
    }
});

// POST /api/attempts/:id/kickout - Admin kicks a student
router.post('/:id/kickout', protect, isAdmin, async (req, res) => {
    try {
        const { reason } = req.body;
        const attempt = await Attempt.findByIdAndUpdate(req.params.id, {
            status: 'auto_submitted',
            kickoutReason: reason || 'Kicked by admin',
            exitTime: new Date()
        }, { new: true });

        const io = req.app.get('io');
        io.to(`assessment_${attempt.assessmentId}`).emit('admin_kickout', {
            attemptId: attempt._id,
            studentId: attempt.studentId,
            reason
        });

        res.json({ success: true, attempt });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/attempts/:id/sync - Auto-save intermediate progress
router.post('/:id/sync', protect, async (req, res) => {
    try {
        const { answers, lastSavedQuestionIndex } = req.body;
        const attempt = await Attempt.findById(req.params.id);

        if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });
        if (attempt.studentId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        if (attempt.status !== 'active') {
            return res.status(400).json({ success: false, message: 'Attempt is not active' });
        }

        const assessment = await Assessment.findById(attempt.assessmentId);
        if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });

        // Map answers
        const mappedAnswers = (answers || []).map(ans => {
            const question = assessment.questions.find((q, idx) => idx === ans.questionIndex);
            return {
                questionId: question ? question._id : null,
                questionIndex: ans.questionIndex,
                answer: ans.answer,
                submittedCode: ans.submittedCode,
                language: ans.language,
                executionResult: ans.executionResult
            };
        });

        attempt.answers = mappedAnswers;
        if (lastSavedQuestionIndex !== undefined) {
            attempt.lastSavedQuestionIndex = lastSavedQuestionIndex;
        }
        await attempt.save();

        res.json({ success: true, message: 'Progress saved' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/attempts/:id/activity - Log student activity
router.post('/:id/activity', protect, async (req, res) => {
    try {
        const { event, details } = req.body;
        
        const updateDoc = {
            $push: { activityLog: { event, details, timestamp: new Date() } }
        };
        const incDoc = {};
        if (event === 'tab_switch') incDoc.tabSwitchCount = 1;
        if (event === 'fullscreen_exit') incDoc.fullscreenExitCount = 1;
        if (event === 'window_blur') incDoc.windowBlurCount = 1;
        
        if (Object.keys(incDoc).length > 0) {
            updateDoc.$inc = incDoc;
        }

        const attempt = await Attempt.findByIdAndUpdate(req.params.id, updateDoc, { new: true });
        if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });

        // Notify admin in real time
        const io = req.app.get('io');
        const payload = {
            attemptId: attempt._id.toString(),
            studentId: attempt.studentId.toString(),
            event,
            details,
            timestamp: new Date()
        };

        io.to(`assessment_${attempt.assessmentId}`).emit('student_activity', payload);
        io.to('admins').emit('student_activity', payload);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/attempts/:id/warning - Record a warning (strict mode)
router.post('/:id/warning', protect, async (req, res) => {
    try {
        const { reason } = req.body;
        const attemptDoc = await Attempt.findById(req.params.id);

        if (!attemptDoc) return res.status(404).json({ success: false, message: 'Attempt not found' });
        if (attemptDoc.studentId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const assessment = await Assessment.findById(attemptDoc.assessmentId);
        if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });

        const maxWarnings = assessment.maxWarnings || 3;
        const currentWarningCount = (attemptDoc.warningCount || 0) + 1;
        const shouldKickout = currentWarningCount > maxWarnings;

        const attempt = await Attempt.findByIdAndUpdate(req.params.id, {
            $inc: { warningCount: 1 },
            $push: {
                warnings: { reason, timestamp: new Date() },
                activityLog: { event: 'warning', details: `Warning ${currentWarningCount}/${maxWarnings}: ${reason}`, timestamp: new Date() }
            },
            $set: {
                permanentlyDisqualified: shouldKickout ? true : attemptDoc.permanentlyDisqualified
            }
        }, { new: true });

        // Notify admin
        const io = req.app.get('io');
        io.to(`assessment_${attempt.assessmentId}`).emit('student_warning', {
            attemptId: attempt._id.toString(),
            studentId: attempt.studentId.toString(),
            studentName: req.user.name,
            warningCount: attempt.warningCount,
            maxWarnings,
            reason,
            shouldKickout
        });
        io.to('admins').emit('student_warning', {
            attemptId: attempt._id.toString(),
            studentId: attempt.studentId.toString(),
            studentName: req.user.name,
            warningCount: attempt.warningCount,
            maxWarnings,
            reason,
            shouldKickout
        });

        res.json({
            success: true,
            warningCount: attempt.warningCount,
            maxWarnings,
            shouldKickout,
            permanentlyDisqualified: shouldKickout
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/attempts/my - Student's own attempts
router.get('/my', protect, async (req, res) => {
    try {
        const attempts = await Attempt.find({ studentId: req.user._id })
            .populate('assessmentId', 'title type department duration totalMarks')
            .sort({ createdAt: -1 });
        res.json({ success: true, attempts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/attempts/:id - Get single attempt detail
router.get('/:id', protect, async (req, res) => {
    try {
        const attempt = await Attempt.findById(req.params.id)
            .populate('studentId', 'name email registerNo department batch')
            .populate('assessmentId', 'title questions department type totalMarks allowViewAnswers');

        if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });

        // Students can only see their own
        if (req.user.role === 'student' && attempt.studentId?._id?.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        // Format depending on allowViewAnswers
        let formattedAttempt = attempt.toObject();

        if (req.user.role === 'student') {
            const allowView = attempt.assessmentId?.allowViewAnswers || false;

            if (!allowView) {
                // Strip correct answers and detailed responses
                if (formattedAttempt.assessmentId) {
                    formattedAttempt.assessmentId.questions = (formattedAttempt.assessmentId.questions || []).map(q => {
                        const { correctAnswer, testCases, ...safeQ } = q;
                        return safeQ;
                    });
                }
                // We still want to show the score, but not individual correct answers
                formattedAttempt.answers = (formattedAttempt.answers || []).map(a => {
                    const { answer, submittedCode, isCorrect, ...safeA } = a;
                    return safeA;
                });
            }
        }

        res.json({ success: true, attempt: formattedAttempt });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/attempts/student/:studentId/assessment/:assessmentId - Check for existing student attempt
router.get('/student/:studentId/assessment/:assessmentId', protect, isAdmin, async (req, res) => {
    try {
        const attempt = await Attempt.findOne({
            studentId: req.params.studentId,
            assessmentId: req.params.assessmentId
        }).sort({ createdAt: -1 }); // Get latest attempt if multiple (though normally only one)

        res.json({ success: true, attempt });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/attempts/:id/second-chance - Give a student another chance (continue or restart)
router.post('/:id/second-chance', protect, isAdmin, async (req, res) => {
    try {
        const { option } = req.body; // 'continue' or 'restart'
        const attempt = await Attempt.findById(req.params.id);

        if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found' });

        if (option === 'continue') {
            // Restore to active state with existing answers
            attempt.status = 'active';
            attempt.exitTime = undefined;
            attempt.duration = undefined;
            attempt.score = 0;
            attempt.percentage = 0;
            attempt.warningCount = 0; // Reset warnings for second chance
            attempt.permanentlyDisqualified = false;
            attempt.kickoutOverridden = true;
            attempt.activityLog.push({
                event: 'second_chance',
                details: 'Admin granted second chance: Continued from previous progress',
                timestamp: new Date()
            });
        } else if (option === 'restart') {
            // Full reset
            attempt.status = 'active';
            attempt.entryTime = new Date();
            attempt.exitTime = undefined;
            attempt.duration = undefined;
            attempt.score = 0;
            attempt.percentage = 0;
            attempt.answers = [];
            attempt.warningCount = 0;
            attempt.warnings = [];
            attempt.permanentlyDisqualified = false;
            attempt.tabSwitchCount = 0;
            attempt.fullscreenExitCount = 0;
            attempt.windowBlurCount = 0;
            attempt.activityLog = [{
                event: 'second_chance',
                details: 'Admin granted second chance: Restarted from scratch',
                timestamp: new Date()
            }];
        } else {
            return res.status(400).json({ success: false, message: 'Invalid option. Use "continue" or "restart".' });
        }

        await attempt.save();
        res.json({ success: true, message: `Access ${option === 'continue' ? 'restored' : 'reset'} successfully`, attempt });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
