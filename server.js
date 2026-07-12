const express = require('express');
const fs = require('fs');
const path = require('path');
const toml = require('toml');
const tomlify = require('tomlify-j0.4');
const { Tail } = require('tail');
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

// Layout API
app.get('/api/layout', (req, res) => {
    try {
        const files = fs.readdirSync(projectPath);
        const jsonFile = files.find(f => f.endsWith('.json'));
        if (!jsonFile) throw new Error("No JSON found");
        const content = JSON.parse(fs.readFileSync(path.join(projectPath, jsonFile), 'utf-8'));
        res.json(content);
    } catch (e) {
        res.status(500).json({ error: "Layout not found" });
    }
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
