const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Docker image configuration for each language
const DOCKER_IMAGES = {
    python: {
        image: 'placement-python',
        fileName: 'solution.py',
        buildDir: path.join(__dirname, '..', '..', 'docker', 'python'),
        cmd: ['python3', '/code/solution.py']
    },
    c: {
        image: 'placement-c',
        fileName: 'solution.c',
        buildDir: path.join(__dirname, '..', '..', 'docker', 'c'),
        cmd: ['sh', '-c', 'gcc -O2 -o /tmp/solution /code/solution.c && /tmp/solution']
    },
    java: {
        image: 'placement-java',
        fileName: 'Main.java',
        buildDir: path.join(__dirname, '..', '..', 'docker', 'java'),
        cmd: ['sh', '-c', 'javac -J-Xms32m -J-Xmx64m -d /tmp /code/Main.java && java -Xms32m -Xmx64m -cp /tmp Main']
    },
    sql: {
        image: 'placement-sql',
        fileName: 'solution.sql',
        buildDir: path.join(__dirname, '..', '..', 'docker', 'sql'),
        cmd: ['python3', '/opt/runner.py']
    }
};

// Execution limits
const LIMITS = {
    timeout: 10000,      // 10 seconds max execution time
    memoryMB: 128,       // 128 MB max memory
    cpus: '0.5',         // Half a CPU core
    maxOutputSize: 65536  // 64 KB max output
};

/**
 * Check if a Docker image exists locally
 */
function imageExists(imageName) {
    return new Promise((resolve) => {
        exec(`docker image inspect ${imageName}`, (err) => {
            resolve(!err);
        });
    });
}

/**
 * Build Docker image if it doesn't exist
 */
async function ensureImage(language) {
    const config = DOCKER_IMAGES[language];
    if (!config) throw new Error(`Language '${language}' is not supported`);

    const exists = await imageExists(config.image);
    if (!exists) {
        console.log(`🐳 Building Docker image: ${config.image}...`);
        return new Promise((resolve, reject) => {
            exec(
                `docker build -t ${config.image} "${config.buildDir}"`,
                { timeout: 120000 },
                (err, stdout, stderr) => {
                    if (err) {
                        console.error(`❌ Docker build failed for ${config.image}:`, stderr);
                        reject(new Error(`Failed to build ${config.image}: ${stderr}`));
                    } else {
                        console.log(`✅ Docker image built: ${config.image}`);
                        resolve();
                    }
                }
            );
        });
    }
}

/**
 * Execute code in a Docker container
 * @param {string} language - Programming language
 * @param {string} code - Source code to execute
 * @param {string} stdin - Standard input
 * @param {Object} extraFiles - Optional extra files to write to the execution directory
 * @returns {Promise<{stdout, stderr, exitCode, executionTime, timedOut}>}
 */
async function executeCode(language, code, stdin = '', extraFiles = {}) {
    const config = { ...DOCKER_IMAGES[language] }; // Create a shallow copy
    if (!config) throw new Error(`Language '${language}' is not supported`);

    let finalFileName = config.fileName;
    let finalCmd = [...config.cmd];

    // Java specific: Detect the main class name to avoid "class X is public, should be declared in a file named X.java"
    if (language === 'java') {
        let className = 'Main';
        // Improved Regex: Find public class name, ignoring comments and annotations
        const publicClassMatch = code.match(/(?:public\s+)?class\s+([A-Za-z0-9_$]+)\s*(?:extends|implements|\{)/);

        // Specifically look for 'public class' which MANDATES the filename match
        const explicitPublicMatch = code.match(/public\s+class\s+([A-Za-z0-9_$]+)/);

        if (explicitPublicMatch) {
            className = explicitPublicMatch[1];
        } else if (publicClassMatch) {
            // If no public class, but we found a class, let's see if it has a main method
            const mainMethodRegex = /public\s+static\s+void\s+main\s*\(\s*String/m;
            if (mainMethodRegex.test(code)) {
                // If it has a main method, use the first class we found
                className = publicClassMatch[1];
            }
        }

        finalFileName = `${className}.java`;
        finalCmd = ['sh', '-c', `javac -J-Xms32m -J-Xmx64m -d /tmp /code/${finalFileName} && java -Xms32m -Xmx64m -cp /tmp ${className}`];
    }

    // Ensure the Docker image is available
    await ensureImage(language);

    // Create a unique temp directory for this execution
    const execId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const tempDir = path.join(os.tmpdir(), 'placement_compiler', execId);

    try {
        // Create temp directory and write the code file
        fs.mkdirSync(tempDir, { recursive: true });
        fs.writeFileSync(path.join(tempDir, finalFileName), code, 'utf8');

        // Write any extra files (e.g., schema.sql, seed.sql for SQL)
        if (extraFiles && typeof extraFiles === 'object') {
            for (const [name, content] of Object.entries(extraFiles)) {
                if (content) {
                    fs.writeFileSync(path.join(tempDir, name), content, 'utf8');
                }
            }
        }

        return await runContainer({ ...config, fileName: finalFileName, cmd: finalCmd }, tempDir, stdin, execId);
    } finally {
        // Cleanup temp directory
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            // Ignore cleanup errors
        }
    }
}

/**
 * Run a Docker container with the given configuration
 */
function runContainer(config, tempDir, stdin, containerId) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let finished = false;

        // Docker run command with security constraints
        const args = [
            'run',
            '--rm',                                    // Auto-remove container
            '--name', containerId,                     // Container name for cleanup
            '--network', 'none',                       // No network access
            '--memory', `${LIMITS.memoryMB}m`,         // Memory limit
            '--cpus', LIMITS.cpus,                     // CPU limit
            '--pids-limit', '50',                      // Limit processes
            '--read-only',                             // Read-only filesystem
            '--tmpfs', '/tmp:exec,size=10m',           // Small writable /tmp
            '-v', `${tempDir}:/code:ro`,               // Mount code as read-only
            '-i',                                      // Interactive (for stdin)
            config.image,                              // Image name
            ...config.cmd                              // Command to run
        ];

        const proc = spawn('docker', args, {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // Send stdin
        if (stdin) {
            proc.stdin.write(stdin);
        }
        proc.stdin.end();

        // Collect stdout
        proc.stdout.on('data', (data) => {
            if (stdout.length < LIMITS.maxOutputSize) {
                stdout += data.toString();
            }
        });

        // Collect stderr
        proc.stderr.on('data', (data) => {
            if (stderr.length < LIMITS.maxOutputSize) {
                stderr += data.toString();
            }
        });

        // Timeout handler
        const timer = setTimeout(() => {
            timedOut = true;
            // Force kill the container
            exec(`docker kill ${containerId}`, () => { });
            if (!finished) {
                finished = true;
                resolve({
                    stdout: stdout.substring(0, LIMITS.maxOutputSize),
                    stderr: 'Time Limit Exceeded',
                    exitCode: -1,
                    executionTime: LIMITS.timeout,
                    timedOut: true
                });
            }
        }, LIMITS.timeout);

        proc.on('close', (exitCode) => {
            clearTimeout(timer);
            if (!finished) {
                finished = true;
                const executionTime = Date.now() - startTime;
                resolve({
                    stdout: stdout.substring(0, LIMITS.maxOutputSize),
                    stderr: stderr.substring(0, LIMITS.maxOutputSize),
                    exitCode: exitCode || 0,
                    executionTime,
                    timedOut: false
                });
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            if (!finished) {
                finished = true;
                resolve({
                    stdout: '',
                    stderr: `Execution error: ${err.message}`,
                    exitCode: -1,
                    executionTime: Date.now() - startTime,
                    timedOut: false
                });
            }
        });
    });
}

/**
 * Build all configured Docker images
 */
async function buildAllImages() {
    console.log('🐳 Pre-building Docker images for code execution...');
    for (const [lang, config] of Object.entries(DOCKER_IMAGES)) {
        try {
            await ensureImage(lang);
        } catch (err) {
            console.error(`⚠️  Failed to build image for ${lang}:`, err.message);
        }
    }
}

/**
 * Check if Docker daemon is available
 */
function isDockerAvailable() {
    return new Promise((resolve) => {
        exec('docker info', { timeout: 5000 }, (err) => {
            resolve(!err);
        });
    });
}

/**
 * Get supported languages
 */
function getSupportedLanguages() {
    return Object.keys(DOCKER_IMAGES);
}

module.exports = {
    executeCode,
    buildAllImages,
    isDockerAvailable,
    getSupportedLanguages,
    DOCKER_IMAGES,
    LIMITS
};
