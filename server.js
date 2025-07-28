const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

const port = process.env.PORT || 4020;

app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'menu.html'));
});

app.get('/blueprint', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'blueprint.html'));
});

app.get('/vm', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'sandbox/vm.html'));
});

app.get('/map', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'map.html'));
});

app.get('/main', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/settings', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'settings/settings.html'));
});

app.get('/subscription', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'shop.html'));
});



app.use(express.static('public'));

let wasmModule = null;
const Module = require('./main.js');
let runSimulation = null;

async function loadWasm() {
    const wasmModule = await Module(); // zavoláš funkciu, nedávaj len require()

    runSimulation = wasmModule.cwrap('runSimulation', 'string', ['string']);
    console.log("✅ WASM loaded and bound.");
}
app.post('/simulate', (req, res) => {
    try {
        if (!runSimulation) {
            return res.status(500).json({ error: "WASM function not loaded" });
        }

        const name = req.body.name || 'Unknown';
        const result = runSimulation(name);
        res.json({ result });
    } catch (err) {
        console.error("❌ Simulácia zlyhala:", err);
        res.status(500).json({ error: "Simulation error: " + err.message });
    }
});

app.post('/save-blueprint', (req, res) => {
    try {
        const { name, blueprint } = req.body;
        if (!name || !blueprint) {
            return res.status(400).json({ error: "Missing name or blueprint" });
        }
        // Odstráň nebezpečné znaky z názvu (kvôli FS bezpečnosti)
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
        const filePath = path.join(__dirname, 'creator', `${safeName}.json`);
        fs.writeFileSync(filePath, JSON.stringify({ name, blueprint }, null, 2));
        res.json({ success: true, file: `/creator/${safeName}.json` });
    } catch (err) {
        console.error("❌ Saving blueprint failed:", err);
        res.status(500).json({ error: "Failed to save blueprint: " + err.message });
    }
});

app.get('/allCreatorFiles', (req, res) => {
    try {
        const dirPath = path.join(__dirname, 'creator');
        if (!fs.existsSync(dirPath)) {
            return res.status(404).json({ error: "Creator directory not found" });
        }
        const files = fs.readdirSync(dirPath)
            .filter(file => file.endsWith('.json'))
            .map(file => ({
                name: file.replace('.json', ''),
            }));
        res.json(files);
    } catch (err) {
        console.error("❌ Fetching creator files failed:", err);
        res.status(500).json({ error: "Failed to fetch creator files: " + err.message });
    }
});

app.get('/creator/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'creator', `${filename}.json`);

    if (!
    fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
    }
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        res.json(JSON.parse(data));
    } catch (err) {
        console.error("❌ Reading file failed:", err);
        res.status(500).json({ error: "Failed to read file: " + err.message });
    }
});

app.listen(port, async () => {
    await loadWasm();
    console.log(`🚀 Server running on http://localhost:${port}`);
});
