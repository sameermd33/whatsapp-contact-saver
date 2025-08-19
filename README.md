# WhatsApp Contact Saver

A Node.js application that saves new WhatsApp contacts to CSV and VCF files, and sends email notifications when new contacts are added.

## Features

- Saves new WhatsApp contacts to `contacts.csv`
- Generates VCF (vCard) file of contacts
- Sends email notifications with attached VCF when 7 new contacts are added
- Automatically clears storage after sending emails
- Uses QR code for easy WhatsApp Web authentication

## Prerequisites

- Node.js 14 or higher
- npm or yarn
- Gmail account with App Password (for sending emails)

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with your Gmail credentials:
   ```
   GMAIL_USER=your-email@gmail.com
   GMAIL_APP_PASSWORD=your-app-password
   RECIPIENT_EMAIL=recipient@example.com
   ```

## Usage

1. Start the application:
   ```bash
   npm start
   ```
2. Scan the QR code with your WhatsApp mobile app
3. The application will now monitor for new contacts

## Deployment

This application requires a server that can maintain a persistent connection. Recommended deployment options:

1. **VPS (Recommended)**
   - Set up a Linux VPS (Ubuntu 20.04+)
   - Install Node.js and npm
   - Use PM2 to keep the process running:
     ```bash
     npm install -g pm2
     pm2 start unknown.js --name "whatsapp-contact-saver"
     pm2 save
     pm2 startup
     ```

2. **Docker (Alternative)**
   - Build and run with Docker:
     ```bash
     docker build -t whatsapp-contact-saver .
     docker run -d --restart always --name whatsapp-bot -v $(pwd)/.wwebjs_auth:/app/.wwebjs_auth whatsapp-contact-saver
     ```

## Security Notes

- Never commit your `.env` file
- Use a dedicated Gmail account with App Password
- Keep your server secure with proper firewall rules

## License

ISC
# whatsapp-contact-saver
