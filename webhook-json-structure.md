# Webhook JSON Structure from Pine Script

## Complete JSON Fields

Based on the Pine Script code in `alertcode`, here are **ALL** the fields that will be included in the webhook JSON:

### Bullish Signal JSON:
```json
{
  "symbol": "TICKER",           // syminfo.ticker
  "signal": "Bullish",          // Fixed value
  "condition": "HA > 0",        // Fixed condition
  "price": 123.45,              // close price
  "timeframe": "3",             // timeframe.period
  "priceChange": 1.25,          // ((close - close[1]) / close[1]) * 100
  "volume": 1000000,            // volume
  "haValue": 125.7,             // o.b.c (Heikin-Ashi close)
  "stoch": "↑>0>D",            // Generated stochastic status string
  "stochK": 72.3,              // s.k (Primary Stochastic %K)
  "stochD": 68.1,              // s.d (Primary Stochastic %D)
  "stochRefD": 65.4,           // sRef.d (Reference Stochastic %D)
  "macdSignal": 98.5,          // o.s (MACD Signal line)
  "haVsMacdStatus": "H>50>S>50", // ✅ THIS FIELD IS INCLUDED!
  "lastCrossType": "Crossover", // "Crossover", "Crossunder", or stored value
  "lastPattern": "Higher Low",  // "Higher Low", "Lower High", "Standard", etc.
  "lastCrossValue": 17.17,     // K value at last cross
  "openCrossType": "Crossover", // Market open cross type
  "openStochK": 26.45,         // Stoch K at market open cross
  "openStochD": 23.88,         // Stoch D at market open cross
  "openStochRefD": 14.3,       // Stoch RefD at market open cross
  "isPremarket": false,        // Whether open cross was premarket
  "time": "1751252229654"      // Pine Script time value
}
```

### Bearish Signal JSON:
```json
{
  "symbol": "TICKER",
  "signal": "Bearish",          // Only difference from bullish
  "condition": "HA < 0",        // Only difference from bullish
  // ... all other fields identical
}
```

## Key Findings:

### ✅ **haVsMacdStatus IS INCLUDED!**
The Pine Script **DOES** calculate and include the `haVsMacdStatus` field:

```pinescript
// Calculate HA vs MACD comparison directly
haVsMacdComparison = haValue > o.s ? ">S" : haValue < o.s ? "<S" : "=S"

// Calculate HA zone indicator  
haZoneIndicator = math.abs(haValue) >= 500 ? (haValue >= 500 ? "H≥500" : "H≤-500") : 
                  math.abs(haValue) >= 50 ? (haValue >= 50 ? "H>50" : "H<-50") : "H±50"

// Calculate HA range indicator
haRangeIndicator = math.abs(haValue) >= 500 ? (haValue >= 500 ? ">500" : "<-500") :
                   math.abs(haValue) >= 50 ? (haValue >= 50 ? ">50" : "<-50") : "±50"

// Combine for complete status
haVsMacdStatus = haZoneIndicator + haVsMacdComparison + haRangeIndicator
```

### 🔍 **Why You Might Not See It:**
1. **Server restarts** - The deployed server may have restarted, clearing the in-memory alerts
2. **No recent webhooks** - The Pine Script may not have sent alerts recently
3. **Webhook URL mismatch** - The Pine Script might be pointing to a different URL

### 📊 **Expected haVsMacdStatus Values:**
- `H≥500>S>500` - Extreme bullish HA, above MACD signal, extreme range
- `H>50<S>50` - Mild bullish HA, below MACD signal, mild range  
- `H<-50<S<-50` - Mild bearish HA, below MACD signal, mild range
- `H≤-500<S<-500` - Extreme bearish HA, below MACD signal, extreme range
- `H±50=S±50` - Neutral HA, equal to MACD signal, neutral range

## Total Fields: 20
The webhook includes **20 comprehensive fields** covering price action, stochastics, MACD, Heikin-Ashi analysis, market timing, and pattern recognition. 