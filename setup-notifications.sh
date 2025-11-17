#!/bin/bash

echo "🔔 Trading Dashboard - Notification Setup"
echo "=========================================="
echo ""

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file..."
    cat > .env << 'EOF'
# Email Notification Settings
EMAIL_ENABLED=false
EMAIL_FROM=alerts@tradingdashboard.com
EMAIL_TO=your-email@example.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# Discord Notification Settings
DISCORD_ENABLED=false
DISCORD_WEBHOOK_URL=

# Server Port
PORT=3000
EOF
    echo "✅ .env file created!"
else
    echo "ℹ️  .env file already exists"
fi

echo ""
echo "📧 Email Setup (Gmail):"
echo "1. Go to your Google Account: https://myaccount.google.com/"
echo "2. Security → 2-Step Verification (enable if not already)"
echo "3. Security → App passwords"
echo "4. Generate app password for 'Mail'"
echo "5. Copy the 16-character password"
echo ""
read -p "Enter your Gmail address (or press Enter to skip): " gmail_user
if [ ! -z "$gmail_user" ]; then
    read -p "Enter your Gmail app password: " gmail_pass
    read -p "Enter email to receive alerts: " email_to
    
    # Update .env file
    sed -i '' "s|EMAIL_ENABLED=false|EMAIL_ENABLED=true|g" .env
    sed -i '' "s|EMAIL_TO=your-email@example.com|EMAIL_TO=$email_to|g" .env
    sed -i '' "s|SMTP_USER=|SMTP_USER=$gmail_user|g" .env
    sed -i '' "s|SMTP_PASS=|SMTP_PASS=$gmail_pass|g" .env
    
    echo "✅ Email configuration saved!"
fi

echo ""
echo "💬 Discord Setup:"
echo "1. Open your Discord server"
echo "2. Server Settings → Integrations → Webhooks"
echo "3. Create Webhook → Copy Webhook URL"
echo ""
read -p "Enter Discord webhook URL (or press Enter to skip): " discord_url
if [ ! -z "$discord_url" ]; then
    sed -i '' "s|DISCORD_ENABLED=false|DISCORD_ENABLED=true|g" .env
    sed -i '' "s|DISCORD_WEBHOOK_URL=|DISCORD_WEBHOOK_URL=$discord_url|g" .env
    
    echo "✅ Discord configuration saved!"
fi

echo ""
echo "=========================================="
echo "✅ Setup Complete!"
echo ""
echo "Next steps:"
echo "1. Start the server: npm start"
echo "2. Open http://localhost:3000"
echo "3. Star symbols by clicking ⭐ icon"
echo "4. You'll receive notifications when trends change!"
echo ""
echo "To check configuration:"
echo "curl http://localhost:3000/notification-settings"
echo ""

