# 📈 TradingView Webhook Live Alert Feed

A lightweight Node.js + Express server that receives TradingView webhook alerts and displays them in a beautiful, live-updating table using Tailwind CSS. Easily monitor your trading signals in real-time from any browser.

## 🚀 Features

✅ Accepts TradingView webhook alerts as JSON POST requests
✅ Stores the latest alerts in memory (FIFO, capped at 100)
✅ Provides a `/alerts` API endpoint to fetch alert data  
✅ Serves a Tailwind-powered dashboard at `/` that:
- Lists Ticker, Action (BUY/SELL), Price, Message, Timestamp
- Colors BUY (bullish) in green, SELL (bearish) in red
- Updates automatically every 2 seconds

✅ Deploys easily on Render or any Node.js platform

## 🌐 Live Demo

Your project is live here:
```
https://alertrender.onrender.com/
```

TradingView webhook URL:
```
https://alertrender.onrender.com/webhook
```

## 🔧 How it works

1. TradingView sends alerts (JSON payloads) via webhook POST to `/webhook`
2. The server captures and stores these alerts in memory
3. The frontend page auto-fetches `/alerts` and updates the table every 2 seconds
4. The dashboard shows a real-time feed of your latest signals

## 🛠 Quick start (local)

Clone the repository:
```bash
git clone https://github.com/yourname/tradingview-webhook-feed.git
cd tradingview-webhook-feed
npm install
npm start
```

By default it runs on `http://localhost:3000`.

## 🚀 Deploy on Render

Deploying on Render is super easy:

1. Push this code to GitHub
2. Go to https://render.com/, sign in with GitHub
3. Click "New + > Web Service"
4. Select your repository
5. Set:
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
6. Click "Create Web Service". Done! 🎉

Render gives you a public URL, like:
```
https://alertrender.onrender.com
```

## ⚙️ Set up TradingView

1. In TradingView, create an alert
2. Set your Webhook URL to:
   ```
https://alertrender.onrender.com/webhook
   ```
3. Your Pine Script alert should use `alert()` to send JSON

Example payload automatically sent:
```json
{
  "symbol": "BTCUSD",
  "signal": "Bullish",
  "condition": "Breakout confirmed",
  "price": 67100.00,
  "time": "1687957202000"
}
```
*(Or whatever your Pine Script defines)*

## ✨ Customization

To change the number of stored alerts, adjust this line in `index.js`:
```javascript
if (alerts.length > 100) alerts.pop()
```

To style the table more (fonts, icons, dark/light modes), simply update the Tailwind HTML in the `app.get('/')` route.

## 🚀 Example API usage

Get all current alerts (JSON):
```
GET https://alertrender.onrender.com/alerts
```

## ❤️ Credits

Built with:
- Express
- Tailwind CSS

## 📜 License

This project is licensed under the MIT License.