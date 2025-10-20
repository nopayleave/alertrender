# Quad Stochastic Dashboard Integration

## Overview
The dashboard now displays **Quad Stochastic D1/D2 crossing signals** in real-time when %D1 crosses %D2.

## Features

### Signal Types
- **↑ D1>D2** (Green, Pulsing) - D1 crossed **up** over D2 (Bullish signal)
- **↓ D1<D2** (Red, Pulsing) - D1 crossed **down** below D2 (Bearish signal)
- **-** (Gray) - No recent crossing detected

### Signal Duration
- Signals remain active for **10 minutes** after detection
- After 10 minutes, the signal expires and shows "-"

## TradingView Setup

### Step 1: Add the Quad Stochastic Indicator
1. Open TradingView
2. Add the **"Quad Stochastic"** indicator from `atoch副本` Pine Script
3. Configure your preferred settings:
   - Stoch1 (10, 3, 3) - Primary fast stochastic
   - Stoch2 (18, 1, 3) - Reference slower stochastic

### Step 2: Create Alert
1. Click on the **Alerts** panel (clock icon)
2. Click **Create Alert**
3. Configure:
   - **Condition**: Select "Quad Stoch" indicator
   - **Message**: Leave as default (webhook JSON is auto-generated)
   - **Webhook URL**: `https://alertrender.onrender.com/webhook`
   - **Name**: "Quad Stoch - {{ticker}}"

### Step 3: Alert Triggers
The alert will automatically fire when:
- **D1 crosses above D2** → Sends `D1_Cross_Up_D2` signal
- **D1 crosses below D2** → Sends `D1_Cross_Down_D2` signal

## Webhook Payload

The Pine Script sends this JSON structure:

```json
{
  "symbol": "AAPL",
  "quadStochSignal": "D1_Cross_Up_D2",
  "d1": 55.23,
  "d2": 52.18,
  "d3": 48.91,
  "d4": 45.67,
  "k1": 58.45,
  "time": "1729188000000"
}
```

## Dashboard Display

### New Column: "Quad Stoch"
Located between **Remark** and **RSI** columns.

**Features**:
- Sortable by clicking column header
- Color-coded (green for up, red for down)
- Animated pulse effect for active signals
- Tooltip shows D1 and D2 values on hover

## Testing

### Local Testing
```bash
# Start your local server
npm start

# In another terminal, send test data
node test-quad-stoch.js
```

### Live Server Testing
Edit `test-quad-stoch.js` and uncomment:
```javascript
const SERVER_URL = 'https://alertrender.onrender.com';
```

Then run:
```bash
node test-quad-stoch.js
```

## Integration with Other Alerts

The Quad Stochastic signals work alongside:
- **Main Script** (price, indicators, MACD)
- **Day Script** (daily change %, volume)
- **VWAP Crossing** (VWAP crossover alerts)

All alerts merge by symbol, so you'll see:
- Symbol's price and indicators
- Recent Quad Stoch crossing (if within 10 min)
- VWAP crossing status (if within 5 min)
- Daily change and volume data

## API Endpoints

### Get Current Alerts
```bash
GET /alerts
```
Returns latest alert per symbol with merged data.

### Get Alert History
```bash
GET /alerts/history
```
Returns all historical alerts including Quad Stoch crossings.

### Clear All Alerts
```bash
POST /reset-alerts
```
Clears all alerts including Quad Stoch data.

## Troubleshooting

### Signals not appearing?
1. Check TradingView alert is active
2. Verify webhook URL is correct
3. Check alert message contains JSON (not empty)
4. Test with `test-quad-stoch.js` to verify server works

### Signals disappearing too quickly?
- Signals expire after 10 minutes
- You can adjust in `index.js` line 139: `if (ageInMinutes <= 10)`
- Change 10 to desired minutes

### Multiple signals for same symbol?
- Dashboard shows only the **most recent** crossing
- Older crossings are automatically replaced
- Full history available at `/alerts/history`

## Color Coding Reference

| Signal | Color | Meaning |
|--------|-------|---------|
| ↑ D1>D2 | Green (pulsing) | Bullish - Fast stoch crossed above slow |
| ↓ D1<D2 | Red (pulsing) | Bearish - Fast stoch crossed below slow |
| - | Gray | No recent crossing detected |

## Performance Notes

- Signal checks happen on every main script alert
- No performance impact on main indicator calculations
- Stored in-memory (clears on server restart)
- Max 5000 alerts stored (auto-trims older data)

