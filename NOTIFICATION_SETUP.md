# Notification Setup Guide

This guide explains how to set up email and Discord notifications for starred symbols when their trend changes.

## Features

- 📧 **Email Notifications**: Get emails when starred symbols' trends change
- 💬 **Discord Notifications**: Get Discord messages with color-coded embeds
- ⭐ **Starred Symbols Only**: Notifications are sent only for symbols you've starred
- 🔔 **Trend Changes**: Notified when trend changes (e.g., "Try Long" → "Very Long")

## Setup Instructions

### 1. Install Dependencies

First, install the nodemailer package:

```bash
npm install nodemailer
```

### 2. Configure Environment Variables

Create a `.env` file in the project root with the following settings:

```env
# Email Notification Settings
EMAIL_ENABLED=true
EMAIL_FROM=alerts@tradingdashboard.com
EMAIL_TO=your-email@example.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=your-app-password

# Discord Notification Settings
DISCORD_ENABLED=true
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_URL

# Server Port
PORT=3000
```

### 3. Email Setup (Gmail Example)

For Gmail, you need to use an **App Password** (not your regular password):

1. Go to your Google Account settings
2. Enable 2-Factor Authentication
3. Go to Security → App passwords
4. Generate a new app password for "Mail"
5. Use this password in `SMTP_PASS`

**Settings for Gmail:**
- `SMTP_HOST`: smtp.gmail.com
- `SMTP_PORT`: 587
- `SMTP_USER`: your-gmail@gmail.com
- `SMTP_PASS`: your-16-character-app-password

### 4. Discord Setup

To get a Discord webhook URL:

1. Open your Discord server
2. Go to Server Settings → Integrations
3. Click "Create Webhook" or "View Webhooks"
4. Create a new webhook for your desired channel
5. Copy the Webhook URL
6. Paste it into `DISCORD_WEBHOOK_URL`

### 5. Alternative: Configure via API

You can also configure notifications at runtime using the API:

```bash
# Update email settings
curl -X POST http://localhost:3000/notification-settings \
  -H "Content-Type: application/json" \
  -d '{
    "email": {
      "enabled": true,
      "to": "your-email@example.com",
      "smtp": {
        "host": "smtp.gmail.com",
        "port": 587,
        "auth": {
          "user": "your-gmail@gmail.com",
          "pass": "your-app-password"
        }
      }
    }
  }'

# Update Discord settings
curl -X POST http://localhost:3000/notification-settings \
  -H "Content-Type: application/json" \
  -d '{
    "discord": {
      "enabled": true,
      "webhookUrl": "https://discord.com/api/webhooks/YOUR_WEBHOOK_URL"
    }
  }'
```

### 6. Check Configuration

Get current notification settings:

```bash
curl http://localhost:3000/notification-settings
```

Response:
```json
{
  "email": {
    "enabled": true,
    "to": "your-email@example.com",
    "configured": true
  },
  "discord": {
    "enabled": true,
    "configured": true
  },
  "starredCount": 5
}
```

## How It Works

1. **Star a Symbol**: Click the ⭐ icon next to any symbol in the dashboard
2. **Backend Sync**: The starred symbols are automatically synced to the backend
3. **Trend Monitoring**: When Octo Stochastic data is received, the backend calculates the trend
4. **Change Detection**: If the trend changes for a starred symbol, notifications are sent
5. **Receive Alerts**: You'll get an email and/or Discord message with:
   - Symbol name
   - Old trend → New trend
   - Current price
   - Timestamp

## Notification Example

### Email
```
⭐ Starred Alert: AAPL

Trend Change Detected:
Try Long → Very Long

Current Price: $175.43
Time: 11/17/2025, 2:30:15 PM
```

### Discord
A color-coded embed with:
- Title: "⭐ AAPL - Trend Changed"
- Description: "Try Long → Very Long"
- Color: Green (for bullish trends) or Red (for bearish trends)
- Fields: Price and Time

## Trend Types

The following trend changes will trigger notifications:

1. **🚀 BULL Cross** - D1 crossed over D7 (both going up)
2. **🔻 BEAR Cross** - D1 crossed under D7 (both going down)
3. **Very Long** - D7 > 80, D1 going up
4. **Very Short** - D7 < 20, D1 going down
5. **Switch Long** - D7 < 20, D1 switched to up
6. **Switch Short** - D7 > 80, D1 switched to down
7. **Try Long** - D7 > 40, D1 going up
8. **Try Short** - D7 < 40, D1 going down
9. **Neutral** - No clear signal

## Troubleshooting

### Email Not Sending

1. Check SMTP credentials are correct
2. For Gmail, ensure you're using an App Password, not your regular password
3. Check server logs for error messages
4. Verify `EMAIL_ENABLED=true`

### Discord Not Sending

1. Verify webhook URL is correct
2. Check the webhook hasn't been deleted in Discord
3. Ensure `DISCORD_ENABLED=true`
4. Check server logs for error messages

### No Notifications

1. Ensure the symbol is starred (⭐ icon should be yellow)
2. Check that Octo Stochastic data is being received (check `/debug` endpoint)
3. Verify trend is actually changing (not staying the same)
4. Check server console for notification logs

## Console Logs

When notifications are sent, you'll see logs like:

```
⭐ Starred symbols updated: [ 'AAPL', 'TSLA', 'NVDA' ]
🔔 Trend change detected for starred symbol AAPL: Try Long → Very Long
📧 Email notification sent for AAPL: Try Long → Very Long
💬 Discord notification sent for AAPL: Try Long → Very Long
```

## Security Notes

- Never commit your `.env` file to git
- Keep your SMTP password and Discord webhook URL secret
- Use environment variables in production
- Consider using a dedicated email account for alerts

## API Endpoints

- `POST /starred-symbols` - Sync starred symbols from frontend
- `GET /notification-settings` - Get current notification configuration
- `POST /notification-settings` - Update notification settings at runtime

