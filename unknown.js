const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const nodemailer = require('nodemailer');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Basic env validation (logs only)
if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD || !process.env.RECIPIENT_EMAIL) {
    console.warn('⚠️ Missing one or more email environment variables: GMAIL_USER, GMAIL_APP_PASSWORD, RECIPIENT_EMAIL');
}

const transporter = nodemailer.createTransport({
    service: 'gmail',  
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

// In-memory storage for contacts
const savedContacts = new Set();
const contactsBatch = [];
let newContactsCount = 0;
let isSendingEmail = false;

// Predeclare WhatsApp client to avoid TDZ in routes
let client;

// Simple web interface
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp Contact Saver</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                    line-height: 1.6; 
                    max-width: 800px; 
                    margin: 0 auto; 
                    padding: 20px;
                    color: #333;
                }
                h1 { color: #25D366; }
                .status { 
                    background: #f5f5f5; 
                    padding: 15px; 
                    border-radius: 5px; 
                    margin: 20px 0;
                }
                .stats { 
                    display: flex; 
                    gap: 20px; 
                    margin: 20px 0;
                }
                .stat-box {
                    background: white;
                    border: 1px solid #ddd;
                    border-radius: 5px;
                    padding: 10px 15px;
                    flex: 1;
                    text-align: center;
                }
                .stat-value {
                    font-size: 24px;
                    font-weight: bold;
                    color: #25D366;
                }
                .instructions {
                    background: #e8f5e9;
                    padding: 15px;
                    border-radius: 5px;
                    margin: 20px 0;
                }
            </style>
        </head>
        <body>
            <h1>WhatsApp Contact Saver</h1>
            
            <div class="status">
                <h2>Status: ${client && client.info ? 'Connected' : 'Disconnected'}</h2>
                ${!(client && client.info) ? '<p>Please check the server logs for the QR code to scan with WhatsApp Web</p>' : ''}
            </div>
            
            <div class="stats">
                <div class="stat-box">
                    <div class="stat-value">${contactsBatch.length}</div>
                    <div>Contacts in batch</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value">${savedContacts.size}</div>
                    <div>Total contacts</div>
                </div>
            </div>
            
            <div class="instructions">
                <h3>How it works:</h3>
                <ol>
                    <li>Scan the QR code shown in the server logs using WhatsApp Web</li>
                    <li>When you receive messages from new numbers, they'll be saved</li>
                    <li>Every 7 contacts, you'll receive an email with a VCF file</li>
                </ol>
            </div>
            
            <div>
                <button onclick="window.location.reload()">🔄 Refresh Status</button>
                ${contactsBatch.length > 0 ? 
                    `<button onclick="fetch('/send-batch')" style="background-color: #25D366; color: white;">
                        ✉️ Send Batch Now (${contactsBatch.length} contacts)
                    </button>` 
                    : ''
                }
            </div>
            
            <script>
                // Auto-refresh every 30 seconds
                setTimeout(() => window.location.reload(), 30000);
            </script>
        </body>
        </html>
    `);
});

// Health check endpoint for Render
app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true, connected: Boolean(client && client.info) });
});

// Who am I endpoint
app.get('/me', (_req, res) => {
    const info = client && client.info ? client.info : null;
    res.json({ ok: true, info });
});

// Manual init/reinit endpoint
app.post('/init', async (_req, res) => {
    try {
        await startClient(true);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
});

// Endpoint to manually trigger sending the current batch
app.get('/send-batch', async (req, res) => {
    if (contactsBatch.length === 0) {
        return res.send('No contacts in the current batch to send.');
    }
    
    try {
        await sendBatchEmail();
        res.send(`Successfully sent ${contactsBatch.length} contacts.`);
    } catch (err) {
        console.error('Error in send-batch:', err);
        res.status(500).send('Error sending batch: ' + err.message);
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Track runtime start time
const startTime = Math.floor(Date.now() / 1000);

// WhatsApp client
function resolveChromeExecutable() {
    // 1) If provided explicitly via env, use it
    if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    try {
        const p = puppeteer.executablePath();
        if (p && fs.existsSync(p)) return p;
    } catch (_) {}
    const bases = [
        path.join(process.env.PUPPETEER_CACHE_DIR || '/opt/render/.cache/puppeteer', 'chrome'),
        path.join('/root/.cache/puppeteer', 'chrome'),
        path.join('/home/render/.cache/puppeteer', 'chrome'),
        path.join(process.cwd(), '.cache', 'puppeteer', 'chrome')
    ];
    for (const base of bases) {
        try {
            const versions = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
            for (const ver of versions.sort().reverse()) {
                const candidate = path.join(base, ver, 'chrome-linux64', 'chrome');
                if (fs.existsSync(candidate)) return candidate;
            }
        } catch (_) {}
    }
    console.warn('⚠️ Could not resolve Chrome executable path; falling back to system default');
    return undefined;
}

async function startClient(force = false) {
    try {
        const chromeExecPath = resolveChromeExecutable();
        console.log('🧭 Chrome executable path:', chromeExecPath, 'exists:', chromeExecPath ? fs.existsSync(chromeExecPath) : 'n/a');

        if (!chromeExecPath) {
            if (!force) console.warn('⏳ Chrome path not resolved yet; retrying in 30s...');
            setTimeout(() => startClient(), 30000);
            return;
        }

        const authPath = process.env.WWEBJS_AUTH_PATH || '.wwebjs_auth';
        client = new Client({
            authStrategy: new LocalAuth({
                clientId: 'primary',
                dataPath: authPath
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-zygote',
                    '--single-process'
                ],
                executablePath: chromeExecPath
            }
        });

        client.on('qr', qr => {
            console.log('📱 Scan this QR to login:');
            qrcode.generate(qr, { small: true });
        });

        client.on('ready', () => {
            console.log('✅ WhatsApp is ready!');
            try {
                const me = client.info?.wid?._serialized || client.info?.wid?.user || 'unknown';
                console.log('👤 Logged in as:', me);
                const allowed = (process.env.ALLOWED_WA_USER || '').trim();
                if (allowed) {
                    const normalized = me.replace(/[^\d]/g, '');
                    const allowedNorm = allowed.replace(/[^\d]/g, '');
                    if (normalized !== allowedNorm) {
                        console.error('❌ Logged in account does not match ALLOWED_WA_USER. Expected:', allowed, 'Got:', me);
                    }
                }
            } catch (_) {}
        });

        client.on('disconnected', (reason) => {
            console.warn('⚠️ WhatsApp disconnected:', reason);
        });

        client.on('auth_failure', (msg) => {
            console.error('❌ Auth failure:', msg);
        });

        client.on('error', (err) => {
            console.error('❌ Client error:', err);
        });

        // Handle incoming messages
        client.on('message', async msg => {
            if (msg.timestamp < startTime) return;

            try {
                const contact = await msg.getContact();
                const number = contact.number;
                const profileName = contact.pushname || 'Unknown';

                if ((contact.name === number || !contact.name) && !savedContacts.has(number)) {
                    const name = `Customer ${profileName}`;
                    const contactEntry = { name, number };

                    savedContacts.add(number);
                    contactsBatch.push(contactEntry);
                    newContactsCount++;

                    console.log(`💾 New contact: ${name} (${number})`);
                    console.log(`📊 Batch size: ${contactsBatch.length}, Total contacts: ${savedContacts.size}`);

                    if (newContactsCount >= 7) {
                        await sendBatchEmail();
                    }
                }
            } catch (err) {
                console.error('❌ Error processing message:', err);
            }
        });

        await client.initialize();
    } catch (err) {
        console.error('❌ Failed to initialize WhatsApp client, retrying in 30s:', err?.message || err);
        setTimeout(() => startClient(), 30000);
    }
}

// kick off client initialization (with retries)
startClient();

async function sendBatchEmail() {
    if (contactsBatch.length === 0 || isSendingEmail) return;
    
    isSendingEmail = true;
    const batchToSend = [...contactsBatch];
    const countToSend = batchToSend.length;
    
    try {
        // Create VCF content from the current batch
        const vcfContent = batchToSend.map(contact => 
            `BEGIN:VCARD\nVERSION:3.0\nFN:${contact.name}\nTEL;TYPE=CELL:${contact.number}\nEND:VCARD`
        ).join('\n');

        await transporter.sendMail({
            from: process.env.GMAIL_USER,
            to: process.env.RECIPIENT_EMAIL,
            subject: `📱 New WhatsApp Contacts (${countToSend})`,
            text: `You have ${countToSend} new WhatsApp contacts.`,
            attachments: [{
                filename: `contacts_${Date.now()}.vcf`,
                content: vcfContent
            }]
        });

        console.log(`📧 Email sent with ${countToSend} contacts!`);
        
        // Clear the batch that was just sent
        contactsBatch.splice(0, countToSend);
        newContactsCount = 0;
    } catch (err) {
        console.error("❌ Error sending email:", err);
    } finally {
        isSendingEmail = false;
    }
}
