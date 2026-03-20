const express = require('express');
const router = express.Router();
const axios = require('axios');
const { protect } = require('../middleware/auth');
const { executeCode, isDockerAvailable, getSupportedLanguages, DOCKER_IMAGES } = require('../services/dockerExecutor');

// Language mapping for Piston API (fallback)
const PISTON_LANGUAGE_MAP = {
    'c': 'c',
    'cpp': 'cpp',
    'java': 'java',
    'python': 'python3',
    'javascript': 'javascript',
    'typescript': 'typescript',
    'go': 'go',
    'rust': 'rust',
    'csharp': 'csharp',
    'php': 'php',
    'ruby': 'ruby',
    'sql': null
};

/**
 * Execute code using Docker (preferred) or Piston API (fallback)
 */
async function runCode(language, code, stdin, extraFiles = {}) {
    const lang = language?.toLowerCase();

    // Try Docker first if the language is supported
    if (DOCKER_IMAGES[lang]) {
        const dockerReady = await isDockerAvailable();
        if (dockerReady) {
            console.log(`🐳 Running ${lang} code via Docker...`);
            const result = await executeCode(lang, code, stdin, extraFiles);
            return {
                stdout: result.stdout,
                stderr: result.stderr,
                exitCode: result.exitCode,
                executionTime: result.executionTime,
                timedOut: result.timedOut,
                engine: 'docker'
            };
        } else {
            console.log(`⚠️ Docker not available, falling back to Piston API for ${lang}`);
        }
    }

    // Fallback to Piston API
    const pistonLang = PISTON_LANGUAGE_MAP[lang];
    if (!pistonLang) {
        throw new Error(`Language '${language}' is not supported`);
    }

    console.log(`🌐 Running ${lang} code via Piston API...`);

    let fileName = 'solution';
    if (lang === 'java') {
        const publicMatch = code.match(/public\s+class\s+(\w+)/);
        const anyClassMatch = code.match(/class\s+(\w+)/);
        fileName = (publicMatch ? publicMatch[1] : (anyClassMatch ? anyClassMatch[1] : 'Main')) + '.java';
    } else if (lang === 'python') {
        fileName = 'solution.py';
    } else if (lang === 'c') {
        fileName = 'solution.c';
    }

    const response = await axios.post('https://emkc.org/api/v2/piston/execute', {
        language: pistonLang,
        version: '*',
        files: [{ name: fileName, content: code }],
        stdin: stdin || ''
    }, { timeout: 15000 });

    const { run } = response.data;
    return {
        stdout: run.stdout || '',
        stderr: run.stderr || '',
        exitCode: run.code || 0,
        executionTime: 0,
        timedOut: false,
        engine: 'piston'
    };
}

// POST /api/compiler/run - Execute code
router.post('/run', protect, async (req, res) => {
    try {
        const { code, language, stdin, testCases, extraFiles } = req.body;
        const lang = language?.toLowerCase();

        if (!code || !lang) {
            return res.status(400).json({ success: false, message: 'Code and language are required' });
        }

        // Check if language is supported by Docker OR Piston
        if (!DOCKER_IMAGES[lang] && !PISTON_LANGUAGE_MAP[lang]) {
            return res.status(400).json({ success: false, message: `Language '${language}' not supported` });
        }

        const results = [];
        const inputs = testCases?.length
            ? testCases.map(tc => ({ input: tc.input, expected: tc.expectedOutput, isHidden: tc.isHidden }))
            : [{ input: stdin || '', expected: null, isHidden: false }];

        for (const tc of inputs) {
            try {
                const result = await runCode(lang, code, tc.input, extraFiles);

                const output = result.stdout + result.stderr;
                let passed = false;
                let status = 'Accepted';

                if (result.timedOut) {
                    status = 'Time Limit Exceeded';
                } else if (result.exitCode !== 0) {
                    status = result.stderr?.includes('MemoryError') || result.stderr?.includes('memory')
                        ? 'Memory Limit Exceeded'
                        : 'Runtime Error';
                } else {
                    passed = tc.expected ? result.stdout.trim() === tc.expected.trim() : true;
                    if (tc.expected && !passed) {
                        status = 'Wrong Answer';
                    }
                }

                results.push({
                    input: tc.input,
                    expectedOutput: tc.expected,
                    actualOutput: output,
                    passed,
                    status,
                    isHidden: tc.isHidden,
                    time: result.executionTime,
                    memory: 0,
                    engine: result.engine
                });
            } catch (err) {
                console.error('Code Execution Error:', err.message);
                results.push({
                    input: tc.input,
                    error: err.message,
                    passed: false,
                    status: 'Execution Error'
                });
            }
        }

        const passedTests = results.filter(r => r.passed).length;
        const totalTests = results.length;

        res.json({
            success: true,
            results,
            passedTests,
            totalTests,
            summary: `${passedTests}/${totalTests} test cases passed`
        });

    } catch (error) {
        console.error('Compiler Error:', error.message);
        res.status(500).json({ success: false, message: 'Code execution service unavailable: ' + error.message });
    }
});

// GET /api/compiler/languages - Get supported languages
router.get('/languages', protect, async (req, res) => {
    const dockerReady = await isDockerAvailable();
    const dockerLangs = getSupportedLanguages();
    const allLangs = Object.keys(PISTON_LANGUAGE_MAP);

    const languages = allLangs.map(lang => ({
        name: lang.charAt(0).toUpperCase() + lang.slice(1),
        key: lang,
        engine: dockerLangs.includes(lang) && dockerReady ? 'docker' : 'piston',
        dockerSupported: dockerLangs.includes(lang)
    }));

    res.json({ success: true, languages, dockerAvailable: dockerReady });
});

// GET /api/compiler/status - Check Docker engine status
router.get('/status', protect, async (req, res) => {
    const dockerReady = await isDockerAvailable();
    const dockerLangs = getSupportedLanguages();

    res.json({
        success: true,
        docker: {
            available: dockerReady,
            supportedLanguages: dockerLangs
        },
        piston: {
            available: true,
            supportedLanguages: Object.keys(PISTON_LANGUAGE_MAP)
        }
    });
});

module.exports = router;
