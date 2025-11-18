# Notification Rules & Conditions

## 📋 Overview
Discord notifications are sent when **starred symbols** experience **trend changes** based on D1 and D7 stochastic indicators.

---

## ⭐ Basic Requirements

### 1. **Symbol Must Be Starred**
- Only starred symbols (⭐) trigger notifications
- Star symbols by clicking the ⭐ icon in the dashboard
- Starred symbols are synced to backend automatically

### 2. **Octo Stochastic Data Required**
- Notifications only work with **Octo Stochastic** indicator (8-stoch)
- Must receive data with `d8Signal` field from TradingView
- Old "Quad Stochastic" (4-stoch) data does NOT trigger notifications

### 3. **Trend Must Change**
- Notifications are sent when trend **changes** (not on every update)
- First trend detection is recorded but doesn't trigger notification
- Subsequent trend changes trigger notifications

---

## 📊 Trend Calculation Rules

Trends are calculated based on **D1** (fast, 10-period) and **D7** (slow, 180-period) stochastics:

### **Priority Order (Highest to Lowest):**

1. **🚀 BULL Cross**
   - **Condition**: D1 crossed OVER D7 AND both going UP
   - **TTS**: "Bull Cross Alert. [SYMBOL]."

2. **🔻 BEAR Cross**
   - **Condition**: D1 crossed UNDER D7 AND both going DOWN
   - **TTS**: "Bear Cross Alert. [SYMBOL]."

3. **Very Long**
   - **Condition**: D7 > 80 AND (D1 switched to up OR D1 uptrend)
   - **TTS**: "Very Long Alert. [SYMBOL]."

4. **Switch Short**
   - **Condition**: D7 > 80 AND D1 switched to down
   - **TTS**: No special TTS (uses default)

5. **Very Short**
   - **Condition**: D7 < 20 AND (D1 switched to down OR D1 downtrend)
   - **TTS**: "Very Short Alert. [SYMBOL]."
   - **Special**: Red embed color + "Will fall hard" message

6. **Switch Long**
   - **Condition**: D7 < 20 AND D1 switched to up
   - **TTS**: No special TTS (uses default)

7. **Try Long**
   - **Condition**: D7 > 40 AND D1 going up
   - **TTS**: No special TTS (uses default)

8. **Try Short**
   - **Condition**: D7 < 40 AND D1 going down
   - **TTS**: No special TTS (uses default)

9. **Neutral**
   - **Condition**: Everything else
   - **TTS**: No notification

---

## 🔔 Notification Triggers

### **When Notifications Are Sent:**

✅ **Trend changes** for starred symbols trigger notifications:
- Old trend → New trend (e.g., "Neutral" → "Try Long")
- Any trend change is notified

### **TTS Audio Conditions:**

TTS audio is enabled for **important alerts only**:

1. **D7 < 20** (Oversold condition)
   - **Message**: "Ticker [O, N, D, S]. Ticker [O, N, D, S]. Will fall hard."
   - **Visual**: Red embed with "🔴 OVERSOLD CONDITION 🔴"
   - **Color**: Crimson red (0xDC143C)

2. **🚀 BULL Cross**
   - **Message**: "Bull Cross Alert. [SYMBOL]."

3. **🔻 BEAR Cross**
   - **Message**: "Bear Cross Alert. [SYMBOL]."

4. **Very Long**
   - **Message**: "Very Long Alert. [SYMBOL]."

5. **Very Short**
   - **Message**: "Very Short Alert. [SYMBOL]."

---

## 🎨 Visual Styling Rules

### **Discord Embed Colors:**

- **D7 < 20**: Crimson red (0xDC143C) - **ALWAYS RED regardless of trend**
- **🚀 BULL Cross**: Bright green (0x00FF00)
- **Very Long**: Green (0x4CAF50)
- **Try Long**: Light green (0x8BC34A)
- **Switch Long**: Yellow-green (0xCDDC39)
- **Neutral**: Gray (0x9E9E9E)
- **Switch Short**: Orange (0xFF9800)
- **Try Short**: Red-orange (0xFF5722)
- **Very Short**: Red (0xF44336)
- **🔻 BEAR Cross**: Bright red (0xFF0000)

### **Special Styling for D7 < 20:**

- **Title**: "🔴 ⚠️ [SYMBOL] - Trend Changed (D7 < 20)"
- **Description**: "🔴 **OVERSOLD CONDITION** 🔴"
- **D7 Field**: "🔴 D7 (OVERSOLD): [value] ⚠️"
- **Color**: Always red (overrides trend color)

---

## 📝 TTS Message Format

### **Symbol Spelling:**
- Ticker names are spelled letter-by-letter with commas
- Example: "ONDS" → "O, N, D, S"
- Commas create pauses for slower, clearer speech

### **D7 < 20 Message:**
```
"Ticker O, N, D, S. Ticker O, N, D, S. Will fall hard."
```
- Ticker repeated twice for emphasis
- Clear warning message

### **Other Important Alerts:**
```
"Bull Cross Alert. O, N, D, S."
"Bear Cross Alert. O, N, D, S."
"Very Long Alert. O, N, D, S."
"Very Short Alert. O, N, D, S."
```

---

## ⚙️ Configuration

### **Enable/Disable TTS:**
- Default: **Enabled**
- Set `DISCORD_TTS_ENABLED=false` in `.env` to disable
- Or update via API: `POST /notification-settings`

### **Discord Webhook:**
- Configured in `index.js` or via environment variable
- Current webhook: Set in code (line 29)

---

## 🔍 Detection Logic

### **D1 x D7 Cross Detection:**
- **Bull Cross**: Previous bar: D1 ≤ D7, Current bar: D1 > D7, AND both going UP
- **Bear Cross**: Previous bar: D1 ≥ D7, Current bar: D1 < D7, AND both going DOWN

### **Direction Switch Detection:**
- **D1 Switched**: Previous direction ≠ Current direction
- **D7 Switched**: Previous direction ≠ Current direction
- Stored in `previousDirections` object

### **Trend Change Detection:**
- Compares `currentTrend` vs `previousTrend`
- Only triggers if trend actually changed
- First detection records trend but doesn't notify

---

## 📊 Data Flow

1. **TradingView** sends Octo Stochastic data with `d8Signal` field
2. **Backend** receives data and calculates trend using `calculateTrend()`
3. **Check** if symbol is starred
4. **Compare** current trend vs previous trend
5. **If changed** → Send Discord notification (visual + TTS if applicable)
6. **Update** previous trend for next comparison

---

## 🚫 What Does NOT Trigger Notifications

❌ Symbols that are not starred
❌ First trend detection (no previous trend to compare)
❌ Trend stays the same (no change)
❌ Old Quad Stochastic data (4-stoch, uses `d4Signal`)
❌ Regular trend updates without change

---

## ✅ Summary Checklist

For a notification to be sent:
- [ ] Symbol is starred (⭐)
- [ ] Octo Stochastic data received (with `d8Signal`)
- [ ] Trend calculated successfully
- [ ] Trend changed from previous value
- [ ] Discord webhook configured and enabled

For TTS audio:
- [ ] All above conditions met
- [ ] TTS enabled in config
- [ ] Alert is important (D7 < 20, BULL/BEAR Cross, Very Long/Short)

---

## 📞 Test Endpoints

- **Test Discord**: `POST /test-discord`
  ```json
  {
    "symbol": "ONDS",
    "oldTrend": "Neutral",
    "newTrend": "Very Short",
    "price": "1.25",
    "d7Value": 18.5
  }
  ```

- **Check Settings**: `GET /notification-settings`
- **Check Starred**: See `starredCount` in settings response

