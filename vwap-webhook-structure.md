# VWAP Webhook JSON Structure

## Complete JSON Fields from VWAP Script

The modified VWAP script (`code`) sends the following JSON payload on every bar close:

```json
{
  "symbol": "AAPL",
  "timeframe": "5",
  "time": "1696348800000",
  "price": 175.43,
  "trend": "Bullish",
  "vwap": 175.12,
  "vwapUpper1": 176.25,
  "vwapLower1": 173.99,
  "vwapUpper2": 177.38,
  "vwapLower2": 172.86,
  "vwapUpper3": 178.51,
  "vwapLower3": 171.73,
  "ema1": 175.67,
  "ema2": 174.89,
  "dayHigh": 176.89,
  "dayLow": 173.12,
  "macd": 0.5432,
  "macdSignal": 0.4821,
  "rsi": 62.34,
  "volume": 1250000
}
```

## Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `symbol` | string | Ticker symbol |
| `timeframe` | string | Chart timeframe (e.g., "1", "5", "15", "60", "D") |
| `time` | string | Timestamp in epoch milliseconds |
| `price` | number | Current close price |
| `trend` | string | Market trend: "Bullish", "Bearish", or "Neutral" |
| `vwap` | number | Volume Weighted Average Price |
| `vwapUpper1` | number | VWAP Upper Band #1 (1st standard deviation) |
| `vwapLower1` | number | VWAP Lower Band #1 |
| `vwapUpper2` | number | VWAP Upper Band #2 (2nd standard deviation) |
| `vwapLower2` | number | VWAP Lower Band #2 |
| `vwapUpper3` | number | VWAP Upper Band #3 (3rd standard deviation) |
| `vwapLower3` | number | VWAP Lower Band #3 |
| `ema1` | number | Fast EMA (default: 9 period) |
| `ema2` | number | Slow EMA (default: 21 period) |
| `dayHigh` | number | Daily high price |
| `dayLow` | number | Daily low price |
| `macd` | number | MACD line value |
| `macdSignal` | number | MACD Signal line value |
| `rsi` | number | Relative Strength Index (0-100) |
| `volume` | number | Current bar volume |

## Trend Logic

The trend is determined by:
- **Bullish**: Price > VWAP AND EMA1 > EMA2
- **Bearish**: Price < VWAP AND EMA1 < EMA2
- **Neutral**: All other cases

## Setup Instructions

1. **Add indicator to TradingView:**
   - Copy the modified `code` file content
   - Add as a new Pine Script indicator
   - Configure your preferred settings for EMAs, MACD, RSI

2. **Create Alert:**
   - Click "Create Alert" on the chart
   - Set condition to: "VWAP" (the indicator name)
   - Webhook URL: `https://alertrender.onrender.com/webhook`
   - Message: The script automatically sends JSON
   - Alert frequency: "Once Per Bar Close"

3. **View on Dashboard:**
   - Visit: `https://alertrender.onrender.com/`
   - Data will appear in real-time as alerts trigger

## Alert Frequency

- **Per Bar Close**: Sends one alert per bar on close (default)
- Configurable via the "Enable Webhook Alerts" setting in the script

## Total Fields: 20

The webhook includes comprehensive VWAP, trend, momentum, and volume data for each symbol.

