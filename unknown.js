const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const nodemailer = require('nodemailer');
const puppeteer = require('puppeteer');
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
client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: puppeteer.executablePath()
    }
});

client.on('qr', qr => {
    console.log("📱 Scan this QR to login:");
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ WhatsApp is ready!');
});

client.on('disconnected', (reason) => {
    console.warn('⚠️ WhatsApp disconnected:', reason);
});

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

client.on('message', async msg => {
    if (msg.timestamp < startTime) return;

    try {
        const contact = await msg.getContact();
        const number = contact.number;
        const profileName = contact.pushname || "Unknown";

        if ((contact.name === number || !contact.name) && !savedContacts.has(number)) {
            const name = `Customer ${profileName}`;
            const contactEntry = { name, number };

            // Add to memory
            savedContacts.add(number);
            contactsBatch.push(contactEntry);
            newContactsCount++;
            
            console.log(`💾 New contact: ${name} (${number})`);
            console.log(`📊 Batch size: ${contactsBatch.length}, Total contacts: ${savedContacts.size}`);

            // Send email if we have 7 or more new contacts
            if (newContactsCount >= 7) {
                await sendBatchEmail();
            }
        }
    } catch (err) {
        console.error("❌ Error processing message:", err);
    }
});

client.initialize();
