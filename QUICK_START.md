# Quick Start - Notification Setup

## Option 1: Interactive Setup (Easiest)

Run the setup script:

```bash
./setup-notifications.sh
```

Follow the prompts to configure email and/or Discord notifications.

---

## Option 2: Manual Setup

### Step 1: Create `.env` file

Create a file named `.env` in the project root:

```bash
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

### Step 2: Get Gmail App Password

1. Go to [Google Account](https://myaccount.google.com/)
2. Click **Security** → **2-Step Verification** (enable if not already)
3. Click **Security** → **App passwords**
4. Select **Mail** and your device
5. Click **Generate**
6. Copy the 16-character password
7. Paste it into `SMTP_PASS` in your `.env` file

### Step 3: Get Discord Webhook (Optional)

1. Open your Discord server
2. Go to **Server Settings** → **Integrations** → **Webhooks**
3. Click **New Webhook** or **Create Webhook**
4. Choose a channel for alerts
5. Click **Copy Webhook URL**
6. Paste it into `DISCORD_WEBHOOK_URL` in your `.env` file

---

## Option 3: Configure via Code (No .env file)

Edit `index.js` directly around line 12-31:

```javascript
const NOTIFICATION_CONFIG = {
  email: {
    enabled: true,  // Change to true
    from: 'alerts@tradingdashboard.com',
    to: 'your-email@example.com',  // Your email
    smtp: {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: 'your-gmail@gmail.com',  // Your Gmail
        pass: 'your-app-password'      // Your app password
      }
    }
  },
  discord: {
    enabled: true,  // Change to true
    webhookUrl: 'https://discord.com/api/webhooks/YOUR_URL'  // Your webhook
  }
}
```

---

## Testing Your Setup

### 1. Start the Server

```bash
npm start
```

### 2. Check Configuration

```bash
curl http://localhost:3000/notification-settings
```

You should see:
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
  "starredCount": 0
}
```

### 3. Star a Symbol

1. Open http://localhost:3000 in your browser
2. Click the ⭐ icon next to any symbol
3. The star should turn yellow

### 4. Wait for Trend Change

When the Octo Stochastic indicator sends data and the trend changes for your starred symbol, you'll receive notifications!

---

## Troubleshooting

### Email Not Working?

**Check Gmail Settings:**
- Using App Password (not regular password)?
- 2-Step Verification enabled?
- App Password is 16 characters without spaces?

**Check Server Logs:**
```bash
# Look for these messages:
📧 Email notification sent for AAPL: Try Long → Very Long
❌ Failed to send email for AAPL: ...
```

### Discord Not Working?

**Check Webhook:**
- Webhook URL is complete and correct?
- Webhook hasn't been deleted in Discord?
- Channel still exists?

**Test Webhook Manually:**
```bash
curl -X POST "YOUR_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"content": "Test message"}'
```

### No Notifications?

1. **Is the symbol starred?**
   - Check if ⭐ icon is yellow
   - Check server logs: `⭐ Starred symbols updated: [ 'AAPL' ]`

2. **Is Octo Stochastic sending data?**
   - Check `/debug` endpoint
   - Look for `octoStochData` in response

3. **Is trend actually changing?**
   - Trend must change (not stay the same)
   - Check server logs: `🔔 Trend change detected for starred symbol AAPL`

---

## Example Notification

### Email
```
Subject: ⭐ AAPL Trend Changed: Try Long → Very Long

⭐ Starred Alert: AAPL

Trend Change Detected:
Try Long → Very Long

Current Price: $175.43
Time: 11/17/2025, 2:30:15 PM
```

### Discord
A color-coded embed with:
- **Title:** ⭐ AAPL - Trend Changed
- **Description:** Try Long → Very Long
- **Color:** Green (bullish) or Red (bearish)
- **Fields:** Price: $175.43, Time: 2:30:15 PM

---

## Security Tips

✅ **DO:**
- Keep `.env` file private (it's in .gitignore)
- Use App Passwords for Gmail
- Use environment variables in production

❌ **DON'T:**
- Commit `.env` to git
- Share your SMTP password
- Share your Discord webhook URL
- Use your regular Gmail password

---

## Need Help?

Check the detailed guide: [NOTIFICATION_SETUP.md](./NOTIFICATION_SETUP.md)

Or check server logs for error messages:
```bash
npm start
# Watch for 📧, 💬, 🔔, ❌ emoji indicators
```

