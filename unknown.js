const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const nodemailer = require('nodemailer');

// Configure your mail transporter
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: 'gmail',  
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

// CSV file path
const csvFilePath = './contacts.csv';
if (!fs.existsSync(csvFilePath)) {
    fs.writeFileSync(csvFilePath, 'Name,Number\n', 'utf8');
}

// CSV writer
const csvWriter = createCsvWriter({
    path: csvFilePath,
    header: [
        { id: 'name', title: 'Name' },
        { id: 'number', title: 'Number' }
    ],
    append: true
});

// Cache of already saved contacts
let savedContacts = new Set();
const existing = fs.readFileSync(csvFilePath, 'utf8').split('\n');
existing.forEach(line => {
    const parts = line.split(',');
    if (parts[1] && parts[1] !== 'Number') savedContacts.add(parts[1]);
});

// Counter for batching
let newContactsCount = 0;

// Track runtime start time
const startTime = Math.floor(Date.now() / 1000);

// WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', qr => {
    console.log("📱 Scan this QR to login:");
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ WhatsApp is ready!');
});

client.on('message', async msg => {
    if (msg.timestamp < startTime) return;

    const contact = await msg.getContact();
    const number = contact.number;
    const profileName = contact.pushname || "Unknown";

    if (contact.name === number || contact.name === undefined) {
        if (savedContacts.has(number)) return;

        const name = `Customer ${profileName}`;

        try {
            // Save to CSV
            await csvWriter.writeRecords([{ name, number }]);
            savedContacts.add(number);

            // Append to VCF
            const vcfEntry = `BEGIN:VCARD
VERSION:3.0
FN:${name}
TEL;TYPE=CELL:${number}
END:VCARD
`;
            fs.appendFileSync('contacts.vcf', vcfEntry, 'utf8');
            console.log(`💾 Saved: ${name} (${number})`);

            // Increment counter
            newContactsCount++;

            // Send email if 7 new contacts reached
            if (newContactsCount >= 7) {
                await transporter.sendMail({
                    from: 'sameermd12q@gmail.com',
                    to: process.env.RECIPIENT_EMAIL,
                    subject: '📂 Updated contacts.vcf (7 new contacts added)',
                    text: `7 new contacts have been added.`,
                    attachments: [
                        {
                            filename: 'contacts.vcf',
                            path: './contacts.vcf'
                        }
                    ]
                });

                console.log("📧 Email sent with 7 new contacts!");
                
                // Clear the files
                fs.writeFileSync(csvFilePath, 'Name,Number\n', 'utf8');
                fs.writeFileSync('contacts.vcf', '', 'utf8');
                savedContacts.clear();
                
                console.log("🧹 Cleared contacts.csv and contacts.vcf");
                newContactsCount = 0; // reset counter
            }

        } catch (err) {
            console.error("❌ Error:", err);
        }
    }
});

client.initialize();
