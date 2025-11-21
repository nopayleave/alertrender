# Trend Calculation Logic

## Overview
The trend is calculated based on **D1** (fastest stochastic) and **D7** (slowest stochastic) values and their directions. The logic prioritizes Pine Script's `calculatedTrend` if available, otherwise falls back to local calculation.

---

## Priority Order (Highest to Lowest)

### **1. Dead Long / Dead Short** (EXTREME SIGNALS)
**Highest Priority - Extreme Conditions**

#### Dead Long
- **Condition**: `D7 > 90` AND `D7 direction = up` AND `D3 direction = up`
- **Display**: "Dead Long"
- **TTS Message**: "Dead Long"
- **Color**: Bright lime green with pulsing animation
- **Meaning**: Extreme overbought condition with both D7 and D3 rising

#### Dead Short
- **Condition**: `D7 < 10` AND `D7 direction = down` AND `D3 direction = down`
- **Display**: "Dead Short"
- **TTS Message**: "Dead Short"
- **Color**: Bright red with pulsing animation
- **Meaning**: Extreme oversold condition with both D7 and D3 falling

---

### **2. D1 x D7 Cross** (CROSSOVER SIGNALS)
**High Priority - Strong Momentum Signals**

#### 🚀 BULL Cross
- **Condition**: `D1 crosses OVER D7` AND `both D1 and D7 going UP`
- **Display**: "🚀 BULL Cross"
- **TTS Message**: "Small Buy"
- **Color**: Green with pulsing animation
- **Meaning**: Strong bullish momentum - fast stochastic crossing above slow stochastic

#### 🔻 BEAR Cross
- **Condition**: `D1 crosses UNDER D7` AND `both D1 and D7 going DOWN`
- **Display**: "🔻 BEAR Cross"
- **TTS Message**: "Small sell"
- **Color**: Red with pulsing animation
- **Meaning**: Strong bearish momentum - fast stochastic crossing below slow stochastic

---

### **3. D7 Extremes with D1 Confirmation** (VERY STRONG SIGNALS)
**High Priority - Extreme Levels with Direction Confirmation**

#### Very Long
- **Condition**: `D7 > 80` AND (`D1 switched to up` OR `D1 direction = up`)
- **Display**: "Very Long"
- **TTS Message**: "Heavy Buy" (if D7 > 80) or "Big Buy" (if D7 between 20-80)
- **Color**: Green with pulsing animation
- **Meaning**: Very strong long signal - D7 in extreme overbought zone with D1 confirming upward momentum

#### Very Short
- **Condition**: `D7 < 20` AND (`D1 switched to down` OR `D1 direction = down`)
- **Display**: "Very Short"
- **TTS Message**: "Heavy Sell" (if D7 < 20) or "Big Short" (if D7 between 20-80)
- **Color**: Red with pulsing animation
- **Meaning**: Very strong short signal - D7 in extreme oversold zone with D1 confirming downward momentum

---

### **4. D7 Extremes with D1 Switch** (REVERSAL SIGNALS)
**Medium-High Priority - Extreme Levels with Direction Change**

#### Switch Short
- **Condition**: `D7 > 80` AND `D1 switched to down`
- **Display**: "Switch Short"
- **TTS Message**: "Medium Short"
- **Color**: Orange with pulsing animation
- **Meaning**: D7 overbought but D1 is reversing down - potential short opportunity

#### Switch Long
- **Condition**: `D7 < 20` AND `D1 switched to up`
- **Display**: "Switch Long"
- **TTS Message**: "Medium Buy"
- **Color**: Lime green with pulsing animation
- **Meaning**: D7 oversold but D1 is reversing up - potential long opportunity

---

### **5. D7 Mid-Range with D1 Direction** (MODERATE SIGNALS)
**Medium Priority - Moderate Levels with Direction**

#### Try Long
- **Condition**: `D7 > 40` AND `D1 direction = up`
- **Display**: "Try Long"
- **TTS Message**: "Medium Buy"
- **Color**: Green (no animation)
- **Meaning**: Moderate bullish signal - D7 above midpoint with D1 rising

#### Try Short
- **Condition**: `D7 < 40` AND `D1 direction = down`
- **Display**: "Try Short"
- **TTS Message**: "Medium Sell"
- **Color**: Red (no animation)
- **Meaning**: Moderate bearish signal - D7 below midpoint with D1 falling

---

### **6. Neutral**
**Lowest Priority - No Clear Signal**

- **Condition**: None of the above conditions are met
- **Display**: "Neutral"
- **TTS Message**: "Neutral"
- **Color**: Gray
- **Meaning**: No clear trend signal

---

## TTS Message Priority (for Discord Audio)

The TTS message follows this priority order:

1. **Dead Long** → "Dead Long"
2. **Dead Short** → "Dead Short"
3. **D7 < 20** → "Heavy Sell" (overrides other trends)
4. **D7 > 80** → "Heavy Buy" (overrides other trends)
5. **🚀 BULL Cross** → "Small Buy"
6. **🔻 BEAR Cross** → "Small sell"
7. **Very Long** → "Big Buy"
8. **Switch Short** → "Medium Short"
9. **Very Short** → "Big Short"
10. **Switch Long** → "Medium Buy"
11. **Try Long** → "Medium Buy"
12. **Try Short** → "Medium Sell"
13. **Neutral** → "Neutral"

---

## Implementation Details

### Pine Script (Primary Source)
The trend is calculated in `TVcode/Quad Stochastic` (Pine Script) and sent via webhook as:
- `calculatedTrend`: The trend name (e.g., "Dead Long", "Very Long", "🚀 BULL Cross")
- `ttsMessage`: The TTS message for Discord audio

### Backend Fallback
If `calculatedTrend` is not available from Pine Script, the backend calculates it locally using the same logic.

### Frontend Display
The frontend displays the `ttsMessage` in the Trend column, but uses `calculatedTrend` for styling (colors, animations).

---

## Key Variables

- **D1**: Fastest stochastic (shortest timeframe)
- **D3**: Third stochastic
- **D7**: Slowest stochastic (longest timeframe)
- **D1 direction**: Direction of D1 (up/down/flat)
- **D3 direction**: Direction of D3 (up/down/flat)
- **D7 direction**: Direction of D7 (up/down/flat)
- **D1 switched to up**: D1 changed from down/flat to up
- **D1 switched to down**: D1 changed from up/flat to down
- **D1 crosses D7**: D1 value crosses above/below D7 value

---

## Visual Indicators

| Trend | Color | Animation | Background |
|-------|-------|-----------|------------|
| Dead Long | Bright Lime Green | Pulse | Dark Green |
| Dead Short | Bright Red | Pulse | Dark Red |
| 🚀 BULL Cross | Green | Pulse | Dark Green |
| 🔻 BEAR Cross | Red | Pulse | Dark Red |
| Very Long | Green | Pulse | Dark Green |
| Very Short | Red | Pulse | Dark Red |
| Switch Short | Orange | Pulse | Dark Orange |
| Switch Long | Lime Green | Pulse | Dark Lime |
| Try Long | Green | None | None |
| Try Short | Red | None | None |
| Neutral | Gray | None | None |

