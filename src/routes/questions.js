const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csvtojson');
const fs = require('fs');
const Question = require('../models/Question');
const { protect, isAdmin } = require('../middleware/auth');

// Multer config for CSV uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './uploads/csv';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = [
        'text/csv',
        'application/vnd.ms-excel',
        'text/plain',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    // Also check extensions since sometimes mimetypes can be unreliable depending on the OS
    const fileExt = file.originalname.split('.').pop().toLowerCase();
    const allowedExts = ['csv', 'txt', 'doc', 'docx'];

    if (allowedMimeTypes.includes(file.mimetype) || allowedExts.includes(fileExt)) {
        cb(null, true);
    } else {
        cb(new Error('Only CSV, TXT, and Word files are allowed'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB Limit
});

// POST /api/admin/questions/bulk-upload
router.post('/bulk-upload', protect, isAdmin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const fileExt = req.file.originalname.split('.').pop().toLowerCase();
        let jsonArray = [];

        if (fileExt === 'csv' || fileExt === 'txt') {
            // For txt files, we assume they are formatted exactly like the CSV template. 
            jsonArray = await csv().fromFile(req.file.path);
        } else if (fileExt === 'doc' || fileExt === 'docx') {
            // Note: Word parsing requires a dedicated parser package (like 'mammoth') and a strict template configuration 
            // since plain text parsing cannot easily identify structured tables.
            fs.unlinkSync(req.file.path);
            return res.status(400).json({
                success: false,
                message: 'Word document (.docx) parsing is currently under development. To upload successfully right now, please use the .csv or .txt file format.'
            });
        } else {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ success: false, message: 'Unsupported file format' });
        }

        let currentNum = 1;
        const lastQuestions = await Question.find({ referenceId: { $regex: /^\d+$/ } }, { referenceId: 1 }).lean();
        if (lastQuestions.length > 0) {
            const maxNumber = Math.max(...lastQuestions.map(q => parseInt(q.referenceId, 10)));
            if (!isNaN(maxNumber)) {
                currentNum = maxNumber + 1;
            }
        }

        const successRows = [];
        const errorRows = [];

        for (let i = 0; i < jsonArray.length; i++) {
            const row = jsonArray[i];
            const qType = req.body.questionType ? req.body.questionType.toUpperCase().trim() : (row.questionType || '').toUpperCase().trim();
            const secType = req.body.sectionType || row.sectionType;
            const modelType = req.body.modelType || row.modelType || 'Default';

            try {
                if (!['MCQ', 'PROGRAMMING', 'DESCRIPTIVE', 'SQL', 'SHORT_ANSWER'].includes(qType)) {
                    throw new Error(`Invalid questionType: ${qType}`);
                }
                if (!secType) {
                    throw new Error('sectionType is required (select from UI or provide in CSV)');
                }

                let content = {};

                if (qType === 'MCQ') {
                    if (!row.question || !row.optionA || !row.optionB || !row.optionC || !row.optionD || !row.correctAnswer) {
                        throw new Error('MCQ requires question, optionA-D, and correctAnswer');
                    }
                    content.question = row.question;
                    const correctAnswerLetter = row.correctAnswer?.toUpperCase().trim();
                    const optsRaw = [row.optionA, row.optionB, row.optionC, row.optionD];

                    content.mcqOptions = optsRaw.map((opt, index) => {
                        const letter = String.fromCharCode(65 + index); // Map index 0->A, 1->B, 2->C, 3->D
                        return {
                            text: opt,
                            isCorrect: letter.includes(correctAnswerLetter) || correctAnswerLetter.includes(letter)
                        };
                    });

                    content.options = optsRaw;
                    content.correctAnswer = row.correctAnswer;
                } else if (qType === 'PROGRAMMING') {
                    if (!row.title || !row.description) {
                        throw new Error('PROGRAMMING requires title and description');
                    }
                    content.title = row.title;
                    content.description = row.description;
                    content.inputFormat = row.inputFormat;
                    content.outputFormat = row.outputFormat;
                    content.constraints = row.constraints;
                    content.sampleInput = row.sampleInput;
                    content.sampleOutput = row.sampleOutput;

                    let langsInput = row.allowedLanguages || row.languages || '';
                    if (langsInput) {
                        content.allowedLanguages = langsInput.split(/[,;|]+/).map(l => l.trim().toLowerCase()).filter(l => l);
                    } else {
                        // Default fallback if left blank
                        content.allowedLanguages = ['python', 'java', 'c', 'cpp'];
                    }
                } else if (qType === 'DESCRIPTIVE') {
                    if (!row.question) {
                        throw new Error('DESCRIPTIVE requires question');
                    }
                    content.question = row.question;
                    content.wordLimit = parseInt(row.wordLimit) || 500;
                } else if (qType === 'SQL') {
                    if (!row.title || !row.description) {
                        throw new Error('SQL requires title and description/question');
                    }
                    content.title = row.title || row.question;
                    content.description = row.description || row.question;
                    content.dbSchema = row.dbSchema;
                    content.dbSeed = row.dbSeed;
                    content.allowedLanguages = ['sql'];
                } else if (qType === 'SHORT_ANSWER') {
                    if (!row.question) {
                        throw new Error('SHORT_ANSWER requires question');
                    }
                    content.question = row.question;
                    content.keywords = row.keywords ? row.keywords.split(/[,;|]+/).map(k => k.trim()).filter(k => k) : [];
                }

                // Generic test case parsing for PROGRAMMING and SQL
                if ((qType === 'PROGRAMMING' || qType === 'SQL') && row.testCases) {
                    try {
                        // Support format: input1=expected1;input2=expected2
                        // OR if it's already JSON
                        if (row.testCases.startsWith('[')) {
                            content.testCases = JSON.parse(row.testCases);
                        } else {
                            content.testCases = row.testCases.split(';').map(tc => {
                                const [input, expected] = tc.split('=');
                                return { input: input || '', expectedOutput: expected || '', isHidden: false };
                            });
                        }
                    } catch (e) {
                        console.error('Test case parse error:', e);
                    }
                }


                let finalRefId = '';
                if (row.referenceId && row.referenceId.trim()) {
                    finalRefId = row.referenceId.trim();
                    const existing = await Question.findOne({ referenceId: finalRefId });
                    if (existing) {
                        throw new Error(`Reference ID ${finalRefId} already exists in database`);
                    }
                } else {
                    finalRefId = String(currentNum++);
                }

                const newQuestion = new Question({
                    referenceId: finalRefId,
                    questionType: qType,
                    sectionType: secType,
                    modelType: modelType,
                    difficulty: row.difficulty || 'Medium',
                    marks: parseInt(row.marks) || 1,
                    negativeMarks: parseFloat(row.negativeMarks) || 0,
                    eligibleYears: row.eligibleYears ? row.eligibleYears.split(/[,;|]+/).map(v => v.trim()).filter(v => v) : [],
                    minAcademicPercentage: parseFloat(row.minAcademicPercentage) || 0,
                    tags: row.tags ? row.tags.split(/[,;|]+/).map(v => v.trim()).filter(v => v) : [],
                    content,
                    sectionId: req.body.sectionId || row.sectionId || null,
                    createdBy: req.user._id
                });

                await newQuestion.validate();
                successRows.push(newQuestion);

            } catch (err) {
                errorRows.push({ rowNumber: i + 2, reason: err.message, data: row });
            }
        }

        if (successRows.length > 0) {
            await Question.insertMany(successRows);
        }

        // Cleanup temp file
        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            message: `Successfully uploaded ${successRows.length} questions. Failed: ${errorRows.length}`,
            successCount: successRows.length,
            failureCount: errorRows.length,
            errors: errorRows
        });

    } catch (err) {
        if (req.file) fs.unlinkSync(req.file.path);
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/admin/questions - Get questions banks
router.get('/', protect, isAdmin, async (req, res) => {
    try {
        const filters = {};
        if (req.query.sectionType) filters.sectionType = req.query.sectionType;
        if (req.query.modelType) filters.modelType = req.query.modelType;
        if (req.query.questionType) filters.questionType = req.query.questionType;
        if (req.query.difficulty) filters['content.difficulty'] = req.query.difficulty;

        const questions = await Question.find(filters).sort({ createdAt: -1 });
        res.json({ success: true, questions });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// PUT /api/admin/questions/:id - Update question
router.put('/:id', protect, isAdmin, async (req, res) => {
    try {
        const question = await Question.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!question) {
            return res.status(404).json({ success: false, message: 'Question not found' });
        }
        res.json({ success: true, question });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE /api/admin/questions/:id - Delete question
router.delete('/:id', protect, isAdmin, async (req, res) => {
    try {
        const question = await Question.findByIdAndDelete(req.params.id);
        if (!question) {
            return res.status(404).json({ success: false, message: 'Question not found' });
        }
        res.json({ success: true, message: 'Question deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/admin/questions/bulk-save-json - Bulk save edited questions from JSON
router.post('/bulk-save-json', protect, isAdmin, async (req, res) => {
    try {
        const { questions, sectionType, questionType, sectionId, folderName } = req.body;
        if (!questions || !Array.isArray(questions)) {
            return res.status(400).json({ success: false, message: 'Invalid questions data' });
        }

        let currentNum = 1;
        const lastQuestions = await Question.find({ referenceId: { $regex: /^\d+$/ } }, { referenceId: 1 }).lean();
        if (lastQuestions.length > 0) {
            const maxNumber = Math.max(...lastQuestions.map(q => parseInt(q.referenceId, 10)));
            if (!isNaN(maxNumber)) {
                currentNum = maxNumber + 1;
            }
        }

        const successRows = [];
        const errorRows = [];

        for (let i = 0; i < questions.length; i++) {
            const row = questions[i];
            const qType = questionType || (row.questionType || '').toUpperCase().trim();
            const secType = sectionType || row.sectionType;
            const modelType = row.modelType || 'Default';

            try {
                if (!['MCQ', 'PROGRAMMING', 'DESCRIPTIVE', 'SQL', 'SHORT_ANSWER'].includes(qType)) {
                    throw new Error(`Invalid questionType: ${qType}`);
                }
                if (!secType) {
                    throw new Error('sectionType is required');
                }

                let content = {};

                if (qType === 'MCQ') {
                    if (!row.question || !row.optionA || !row.optionB || !row.optionC || !row.optionD || !row.correctAnswer) {
                        throw new Error('MCQ requires question, optionA-D, and correctAnswer');
                    }
                    content.question = row.question;
                    const correctAnswerLetter = row.correctAnswer?.toUpperCase().trim();
                    const optsRaw = [row.optionA, row.optionB, row.optionC, row.optionD];

                    content.mcqOptions = optsRaw.map((opt, index) => {
                        const letter = String.fromCharCode(65 + index);
                        return {
                            text: opt,
                            isCorrect: letter.includes(correctAnswerLetter) || correctAnswerLetter.includes(letter)
                        };
                    });

                    content.options = optsRaw;
                    content.correctAnswer = row.correctAnswer;
                } else if (qType === 'PROGRAMMING') {
                    if (!row.title || !row.description) {
                        throw new Error('PROGRAMMING requires title and description');
                    }
                    content.title = row.title;
                    content.description = row.description;
                    content.inputFormat = row.inputFormat;
                    content.outputFormat = row.outputFormat;
                    content.constraints = row.constraints;
                    content.sampleInput = row.sampleInput;
                    content.sampleOutput = row.sampleOutput;

                    let langsInput = row.allowedLanguages || row.languages || '';
                    if (Array.isArray(langsInput)) {
                        content.allowedLanguages = langsInput.map(l => l.trim().toLowerCase()).filter(l => l);
                    } else if (typeof langsInput === 'string' && langsInput) {
                        content.allowedLanguages = langsInput.split(/[,;|]+/).map(l => l.trim().toLowerCase()).filter(l => l);
                    } else {
                        content.allowedLanguages = ['python', 'java', 'c', 'cpp'];
                    }
                } else if (qType === 'DESCRIPTIVE') {
                    if (!row.question) {
                        throw new Error('DESCRIPTIVE requires question');
                    }
                    content.question = row.question;
                    content.wordLimit = parseInt(row.wordLimit) || 500;
                } else if (qType === 'SQL') {
                    content.title = row.title || row.question;
                    content.description = row.description || row.question;
                    content.dbSchema = row.dbSchema;
                    content.dbSeed = row.dbSeed;
                    content.allowedLanguages = ['sql'];
                    content.testCases = row.testCases || [];
                } else if (qType === 'SHORT_ANSWER') {
                    if (!row.question) {
                        throw new Error('SHORT_ANSWER requires question');
                    }
                    content.question = row.question;
                    content.keywords = Array.isArray(row.keywords) ? row.keywords : (row.keywords || '').split(/[,;|]+/).map(k => k.trim()).filter(k => k);
                }

                let finalRefId = '';
                if (row.referenceId && row.referenceId.toString().trim()) {
                    finalRefId = row.referenceId.toString().trim();
                    const existing = await Question.findOne({ referenceId: finalRefId });
                    if (existing) {
                        throw new Error(`Reference ID ${finalRefId} already exists`);
                    }
                } else {
                    finalRefId = String(currentNum++);
                }

                const newQuestion = new Question({
                    referenceId: finalRefId,
                    questionType: qType,
                    sectionType: secType,
                    modelType: modelType,
                    difficulty: row.difficulty || 'Medium',
                    marks: parseInt(row.marks) || 1,
                    negativeMarks: parseFloat(row.negativeMarks) || 0,
                    eligibleYears: (typeof row.eligibleYears === 'string' && row.eligibleYears) ? row.eligibleYears.split(/[,;|]+/).map(v => v.trim()).filter(v => v) : (Array.isArray(row.eligibleYears) ? row.eligibleYears : []),
                    minAcademicPercentage: parseFloat(row.minAcademicPercentage) || 0,
                    tags: (typeof row.tags === 'string' && row.tags) ? row.tags.split(/[,;|]+/).map(v => v.trim()).filter(v => v) : (Array.isArray(row.tags) ? row.tags : []),
                    content,
                    sectionId: sectionId || row.sectionId || null,
                    sectionType: sectionType || row.sectionType || (folderName ? `${folderName}` : 'General'),
                    createdBy: req.user._id
                });

                await newQuestion.validate();
                successRows.push(newQuestion);
            } catch (err) {
                errorRows.push({ rowNumber: i + 1, reason: err.message, data: row });
            }
        }

        if (successRows.length > 0) {
            await Question.insertMany(successRows);
        }

        res.json({
            success: true,
            message: `Successfully saved ${successRows.length} questions. Failed: ${errorRows.length}`,
            successCount: successRows.length,
            failureCount: errorRows.length,
            errors: errorRows
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
