# Webhook Testing Guide

## Quick Check Methods

### Method 1: Check Server Logs (Recommended)

1. **Restart your server** to see the new logging:
   ```bash
   node index.js
   ```

2. **Watch for incoming webhooks** - You'll see messages like:
   ```
   📨 Webhook received: {
     "symbol": "AAPL",
     "price": 175.50,
     ...
   }
   📊 Alert type detected: {
     isDayChangeAlert: false,
     isVwapCrossingAlert: false,
     isQuadStochAlert: false,
     isQuadStochD4Alert: false,
     symbol: "AAPL"
   }
   ```

### Method 2: Test Webhook Manually

Run the test script I created:
```bash
node test-webhook-manual.js
```

This will send test data to your webhook and show you if it's working.

### Method 3: Check Alert History Endpoint

Open in your browser:
```
http://localhost:3000/alerts/history
```

This shows ALL alerts received (including ones that don't show in the main dashboard).

### Method 4: Use curl Command

Test from command line:
```bash
# Test Main List script alert
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "TEST",
    "price": 100.50,
    "trend": "Bullish",
    "vwap": 100.00,
    "rsi": 65,
    "volume": 1000000
  }'

# Test Quad Stochastic D4 alert
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "TEST",
    "d4Signal": "D4_Uptrend"
  }'
```

### Method 5: Use Postman or Insomnia

**URL:** `http://localhost:3000/webhook`
**Method:** POST
**Headers:** `Content-Type: application/json`
**Body (JSON):**
```json
{
  "symbol": "TEST",
  "d4Signal": "D4_Cross_Up_50"
}
```

---

## TradingView Webhook Setup

### For List Script (Main Indicators)

Your List script should already be sending webhooks. Make sure:

1. **Alert is created** on your chart
2. **Webhook URL** is set: `http://your-server:3000/webhook`
3. **Alert message** should be the JSON from line 269 of your script

### For Quad Stochastic D4 Signals

You need to **UPDATE your Quad Stochastic script** to send the symbol:

**Current (Line 223-226):**
```pinescript
// === Trigger webhook alert ===
// Create alert message only when signal is non-empty
if signal != ""
    alert(signal, freq=alert.freq_once_per_bar_close)
```

**CHANGE TO:**
```pinescript
// === Trigger webhook alert ===
// Create JSON alert message with symbol
if signal != ""
    jsonMsg = '{' +
      '"symbol": "' + syminfo.ticker + '",' +
      '"d4Signal": "' + signal + '"}'
    alert(jsonMsg, freq=alert.freq_once_per_bar_close)
```

Then in TradingView:
1. Create an alert on the Quad Stochastic indicator
2. **Condition:** "Any alert() function call"
3. **Webhook URL:** `http://your-server:3000/webhook`
4. **Message:** `{{plot_0}}` or the alert message

---

## Expected Webhook Data Formats

### Main List Script
```json
{
  "symbol": "AAPL",
  "timeframe": "5",
  "price": 175.50,
  "trend": "Bullish",
  "vwap": 175.20,
  "vwapAbove": true,
  "vwapRemark": "UP2",
  "ema1": 174.80,
  "ema1Above": true,
  "ema2": 174.00,
  "ema2Above": true,
  "rsi": 62.5,
  "macd": 0.25,
  "macdSignal": 0.20,
  "volume": 1500000
}
```

### Quad Stochastic D4 Alert
```json
{
  "symbol": "AAPL",
  "d4Signal": "D4_Uptrend"
}
```

**Valid d4Signal values:**
- `D4_Uptrend`
- `D4_Downtrend`
- `D4_Cross_Up_20`
- `D4_Cross_Down_20`
- `D4_Cross_Up_50`
- `D4_Cross_Down_50`
- `D4_Cross_Up_80`
- `D4_Cross_Down_80`

---

## Troubleshooting

### Dashboard shows "-" in QStoch column

**Possible causes:**
1. ❌ No D4 webhook sent yet
2. ❌ D4 alert doesn't include `"symbol"` field
3. ❌ D4 signal expired (older than 30 minutes)
4. ❌ Main alert hasn't been sent for that symbol yet

**Solution:** Check server logs when alert fires

### Webhook returns error

**Check:**
- Is server running? (`node index.js`)
- Is port 3000 available?
- Is firewall blocking the connection?
- Is the JSON valid?

### No logs appearing

Make sure you:
1. Saved the updated `index.js`
2. Restarted the Node.js server
3. Are watching the terminal where the server is running

---

## Verify Everything is Working

1. ✅ Server is running (you see "Server listening on port 3000")
2. ✅ Run test script: `node test-webhook-manual.js`
3. ✅ Check dashboard: symbols appear with data
4. ✅ Check QStoch column shows: `↑ Uptrend`, `↓ Downtrend`, etc.
5. ✅ Server logs show webhook receives

If all checks pass, your webhook is working! 🎉

