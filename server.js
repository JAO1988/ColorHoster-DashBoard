const express = require('express');
const fs = require('fs');
const path = require('path');
const toml = require('toml');
const tomlify = require('tomlify-j0.4');
const { Tail } = require('tail');

// Import the new LED Tester Utility
const ColorHosterLEDTester = require('./utils/config_tester');

const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.json());
app.use(express.static('public'));

// Load project path from the local config file
const serverConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
const projectPath = serverConfig.projectPath;

// Settings API: Reads TOML
app.get('/api/settings', (req, res) => {
    try {
        const configPath = path.join(projectPath, 'colorhoster.toml');
        const config = toml.parse(fs.readFileSync(configPath, 'utf-8'));

        // Fallback to old key just in case it hasn't been updated yet, but prefer 'brightness'
        const isBright = config.brightness !== undefined ? config.brightness : config.brightness_enabled;

        res.json({
            port: config.port,
            brightness: isBright
        });
    } catch (e) {
        res.status(500).json({ error: "Could not read TOML at " + projectPath });
    }
});

// Apply API: Writes changes
app.post('/api/settings/apply', (req, res) => {
    const { port, brightness } = req.body;
    try {
        const configPath = path.join(projectPath, 'colorhoster.toml');
        const config = toml.parse(fs.readFileSync(configPath, 'utf-8'));

        // Clean up old key if it exists
        if (config.brightness_enabled !== undefined) {
            delete config.brightness_enabled;
        }

        // Force port to be an absolute integer
        config.port = Math.abs(parseInt(port, 10));
        config.brightness = brightness;

        // Generate the raw TOML string
        let tomlString = tomlify.toToml(config, {space: 2});

        // FIX: Strip out the ".0" that the TOML library erroneously adds to the port
        tomlString = tomlString.replace(/port\s*=\s*([0-9]+)\.0/g, 'port = $1');

        // Write the cleaned string to the file
        fs.writeFileSync(configPath, tomlString);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- NEW API ENDPOINT: Test Physical LED ---
app.post('/api/test-led', (req, res) => {
    const { ledIndex } = req.body;

    if (ledIndex === undefined) {
        return res.status(400).json({ error: "Missing ledIndex in request body" });
    }

    try {
        // Read the current port dynamically from the TOML
        const configPath = path.join(projectPath, 'colorhoster.toml');
        let currentPort = 6742; // Default fallback

        if (fs.existsSync(configPath)) {
            const config = toml.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.port) {
                currentPort = parseInt(config.port, 10);
            }
        }

        // Initialize and fire the tester
        // Change 'tcp' to 'udp' here if ColorHoster strictly expects UDP packets
        const ledTester = new ColorHosterLEDTester('127.0.0.1', currentPort, 'tcp');
        ledTester.flashLedWhite(ledIndex);

        res.json({ success: true, message: `Flashed LED ${ledIndex} on port ${currentPort}` });
    } catch (e) {
        console.error("Error triggering LED:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});
// -------------------------------------------

app.get('/api/layouts', (req, res) => {
    const layoutDir = projectPath;

    if (!fs.existsSync(layoutDir)) {
        console.warn(`[Warning] Layouts folder not found at: ${layoutDir}`);
        return res.json([]);
    }

    fs.readdir(layoutDir, (err, files) => {
        if (err) {
            console.error("Error reading layouts directory:", err);
            return res.status(500).json({ error: "Cannot read layouts" });
        }

        const jsonFiles = files.filter(file => file.endsWith('.json'));
        console.log(`[Success] Found ${jsonFiles.length} layout files at ${layoutDir}`);
        res.json(jsonFiles);
    });
});

app.get('/api/layout/:filename', (req, res) => {
    const filePath = path.join(projectPath, req.params.filename);
    res.sendFile(filePath);
});

// Log Tailing
const IS_WIN = process.platform === 'win32';
const LOG_PATH = IS_WIN ? 'C:\\Windows\\Temp\\colorhoster.log' : '/tmp/colorhoster.log';

const tail = new Tail(LOG_PATH, { follow: true, logger: console });
tail.on("line", (data) => io.emit('log_update', data));

io.on('connection', (socket) => {
    if (fs.existsSync(LOG_PATH)) {
        fs.readFile(LOG_PATH, 'utf-8', (err, data) => {
            if (!err) socket.emit('log_snapshot', data);
        });
    }
});

http.listen(3000, () => console.log('ColorHoster Dashboard running on http://localhost:3000'));

function gracefulShutdown(signal) {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);

    // 1. Stop the file watcher
    try {
        tail.unwatch();
        console.log('Log tailing stopped.');
    } catch (err) {
        console.error('Error stopping tail:', err.message);
    }

    // 2. Close Socket.io
    io.close(() => {
        console.log('Socket.io connections closed.');
    });

    // 3. Close the HTTP server to free port 3000
    http.close(() => {
        console.log('HTTP server closed. Port 3000 freed.');

        // Exit cleanly
        process.exit(0);
    });

    // 4. Fallback: Force shutdown if it takes longer than 5 seconds
    setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down.');
        process.exit(1);
    }, 5000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
