const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

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

// Track runtime start time
const startTime = Math.floor(Date.now() / 1000);  // seconds

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
    // ✅ Only handle messages after script start
    if (msg.timestamp < startTime) return;

    const contact = await msg.getContact();
    const number = contact.number;
    const profileName = contact.pushname || "Unknown";

    // ✅ Only for unsaved numbers
    if (contact.name === number || contact.name === undefined) {
        if (savedContacts.has(number)) {
            console.log(`⏭️ Skipped duplicate: ${profileName} (${number})`);
            return;
        }

        const name = `Customer ${profileName}`;

        try {
            // Save to CSV
            await csvWriter.writeRecords([{ name, number }]);
            savedContacts.add(number);

            // Save to VCF (append mode)
            const vcfEntry = `BEGIN:VCARD
VERSION:3.0
FN:${name}
TEL;TYPE=CELL:${number}
END:VCARD
`;
            fs.appendFileSync('contacts.vcf', vcfEntry, 'utf8');

            console.log(`💾 Saved: ${name} (${number})`);
        } catch (err) {
            console.error("❌ Error writing files:", err);
        }
    } else {
        console.log(`ℹ️ Ignored saved contact: ${contact.name}`);
    }
});

client.initialize();
