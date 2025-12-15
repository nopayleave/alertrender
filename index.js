import express from 'express'
import cors from 'cors'
import nodemailer from 'nodemailer'

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// Notification settings (configure via environment variables or update here)
const NOTIFICATION_CONFIG = {
  enabled: process.env.NOTIFICATIONS_ENABLED !== 'false', // Global toggle - default to true
  email: {
    enabled: process.env.EMAIL_ENABLED === 'true' || false,
    from: process.env.EMAIL_FROM || 'alerts@tradingdashboard.com',
    to: process.env.EMAIL_TO || 'your-email@example.com',
    smtp: {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
      }
    }
  },
  discord: {
    enabled: process.env.DISCORD_ENABLED !== 'false', // Default to true if webhook URL is set
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1440117112566710352/O-s1YsYR93f783PEjMhR9fmnan_agrmw8L3Me9F9SAl7rfdMWsxpFuIHHFkDyFrqE0Hq',
    ttsEnabled: process.env.DISCORD_TTS_ENABLED !== 'false' // Default to true - enable TTS for important alerts
  }
}

// Create email transporter
let emailTransporter = null
if (NOTIFICATION_CONFIG.email.enabled && NOTIFICATION_CONFIG.email.smtp.auth.user) {
  emailTransporter = nodemailer.createTransport(NOTIFICATION_CONFIG.email.smtp)
}

// 儲存 alert JSON
let alerts = [] // All alerts (not just latest per symbol)
let alertsHistory = [] // All historical alerts (backup storage)
let dayChangeData = {} // Store day change data by symbol
let dayVolumeData = {} // Store daily volume data by symbol
let vwapCrossingData = {} // Store VWAP crossing status by symbol with timestamp
let quadStochData = {} // Store Quad Stochastic crossing status by symbol with timestamp
let quadStochD4Data = {} // Store Quad Stochastic D4 trend and crossing data by symbol
let octoStochData = {} // Store Octo Stochastic (8 stoch) data by symbol
let previousQSValues = {} // Store previous QS values to detect changes
let previousDirections = {} // Store previous D1-D8 directions to detect switches
let previousPrices = {} // Store previous prices to detect price changes
let macdCrossingData = {} // Store MACD crossing signals by symbol with timestamp
let bjTsiDataStorage = {} // Store BJ TSI data by symbol with timestamp
let bjPremarketRange = {} // Store premarket high/low TSI values per symbol per day: { symbol: { date: 'YYYY-MM-DD', high: number, low: number } }
let soloStochDataStorage = {} // Store Solo Stoch D2 data by symbol with timestamp
let dualStochDataStorage = {} // Store Dual Stoch D1/D2 data by symbol with timestamp
let dualStochHistory = {} // Store historical D1/D2 values for mini charts: { symbol: [{ d1, d2, timestamp }, ...] }
let bigTrendDay = {} // Store Big Trend Day status per symbol per trading day: { symbol: { date: 'YYYY-MM-DD', isBigTrendDay: true } }
let starredSymbols = {} // Store starred symbols (synced from frontend)
let previousTrends = {} // Store previous trend for each symbol to detect changes
let patternData = {} // Store latest HL/LH pattern per symbol

// Helper function to check if current time is in premarket hours (4:00 AM - 9:30 AM Eastern Time)
function isInPremarketHours() {
  // Use Eastern Time (America/New_York) for US stock premarket
  const now = new Date();
  const easternTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = easternTime.getHours();
  const minute = easternTime.getMinutes();
  const currentTime = hour * 100 + minute;
  const premarketStart = 4 * 100 + 0; // 4:00 AM ET
  const premarketEnd = 9 * 100 + 30; // 9:30 AM ET
  return currentTime >= premarketStart && currentTime < premarketEnd;
}

// Helper function to get current date string (YYYY-MM-DD) in Eastern Time
function getCurrentDateString() {
  const now = new Date();
  // Use Eastern Time for date consistency with US stock market
  const easternDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const year = easternDate.getFullYear();
  const month = String(easternDate.getMonth() + 1).padStart(2, '0');
  const day = String(easternDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper function to track and calculate premarket range for BJ TSI
function updateBjPremarketRange(symbol, tsiValue) {
  if (!symbol || tsiValue === null || isNaN(tsiValue)) return;
  
  const today = getCurrentDateString();
  const symbolKey = symbol;
  
  // Initialize if doesn't exist or if it's a new day
  if (!bjPremarketRange[symbolKey] || bjPremarketRange[symbolKey].date !== today) {
    bjPremarketRange[symbolKey] = {
      date: today,
      high: tsiValue,
      low: tsiValue
    };
  } else {
    // Update high/low if we're still in premarket or if we haven't finalized yet
    if (isInPremarketHours() || !bjPremarketRange[symbolKey].finalized) {
      if (tsiValue > bjPremarketRange[symbolKey].high) {
        bjPremarketRange[symbolKey].high = tsiValue;
      }
      if (tsiValue < bjPremarketRange[symbolKey].low) {
        bjPremarketRange[symbolKey].low = tsiValue;
      }
    }
    
    // Mark as finalized when premarket ends
    if (!isInPremarketHours() && !bjPremarketRange[symbolKey].finalized) {
      bjPremarketRange[symbolKey].finalized = true;
      console.log(`📊 Premarket range finalized for ${symbol}: High=${bjPremarketRange[symbolKey].high.toFixed(3)}, Low=${bjPremarketRange[symbolKey].low.toFixed(3)}`);
    }
  }
}

// Helper function to get premarket range for a symbol
function getBjPremarketRange(symbol) {
  const symbolKey = symbol;
  if (!bjPremarketRange[symbolKey]) return { upper: null, lower: null };
  
  const today = getCurrentDateString();
  // Only return if it's for today
  if (bjPremarketRange[symbolKey].date !== today) return { upper: null, lower: null };
  
  return {
    upper: bjPremarketRange[symbolKey].high,
    lower: bjPremarketRange[symbolKey].low
  };
}

// Helper function to calculate trend based on alert data
function calculateTrend(alert) {
  // Use calculatedTrend from Pine Script if available (prioritize)
  if (alert.calculatedTrend && alert.calculatedTrend !== 'Neutral') {
    return alert.calculatedTrend
  }
  
  // Fallback to local calculation
  const d1Dir = alert.d1Direction || 'flat'
  const d3Dir = alert.d3Direction || 'flat'
  const d7Dir = alert.d7Direction || 'flat'
  const d7Val = parseFloat(alert.octoStochD7) || 0
  const d1CrossD7 = alert.d1CrossD7
  
  // HIGHEST PRIORITY: Dead Long/Short (D7 > 90/< 10 with D7 and D3 both going same direction)
  if (d7Val > 90 && d7Dir === 'up' && d3Dir === 'up') return 'Dead Long'
  if (d7Val < 10 && d7Dir === 'down' && d3Dir === 'down') return 'Dead Short'
  
  if (d1CrossD7 === 'bull') return '🚀 BULL Cross'
  if (d1CrossD7 === 'bear') return '🔻 BEAR Cross'
  if (d7Val > 80 && d3Dir === 'up') return 'Heavy Buy'
  if (d7Val > 80 && alert.d1SwitchedToDown) return 'Switch Short'
  if (d7Val < 20 && (alert.d1SwitchedToDown || d1Dir === 'down')) return 'Very Short'
  if (d7Val < 20 && alert.d1SwitchedToUp) return 'Switch Long'
  if (d7Val > 40 && d1Dir === 'up') return 'Try Long'
  if (d7Val < 40 && d1Dir === 'down') return 'Try Short'
  return 'Neutral'
}

// Send email notification
async function sendEmailNotification(symbol, oldTrend, newTrend, price) {
  if (!emailTransporter || !NOTIFICATION_CONFIG.email.enabled) return
  
  try {
    const mailOptions = {
      from: NOTIFICATION_CONFIG.email.from,
      to: NOTIFICATION_CONFIG.email.to,
      subject: `⭐ ${symbol} Trend Changed: ${oldTrend} → ${newTrend}`,
      html: `
        <h2>⭐ Starred Alert: ${symbol}</h2>
        <p><strong>Trend Change Detected:</strong></p>
        <p style="font-size: 18px;">
          <span style="color: #999;">${oldTrend}</span> 
          → 
          <span style="color: #4CAF50; font-weight: bold;">${newTrend}</span>
        </p>
        <p><strong>Current Price:</strong> $${price || 'N/A'}</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        <hr>
        <p style="color: #666; font-size: 12px;">This is an automated notification from your Trading Dashboard for starred symbols.</p>
      `
    }
    
    await emailTransporter.sendMail(mailOptions)
    console.log(`📧 Email notification sent for ${symbol}: ${oldTrend} → ${newTrend}`)
  } catch (error) {
    console.error(`❌ Failed to send email for ${symbol}:`, error.message)
  }
}

// Send Discord notification
async function sendDiscordNotification(symbol, oldTrend, newTrend, price, d7Value = null) {
  if (!NOTIFICATION_CONFIG.discord.enabled || !NOTIFICATION_CONFIG.discord.webhookUrl) return
  
  try {
    // Determine embed color based on new trend
    const trendColors = {
      'Dead Long': 0x00FF00,  // Bright green for extreme long
      '🚀 BULL Cross': 0x00FF00,
      'Heavy Buy': 0x4CAF50,
      'Try Long': 0x8BC34A,
      'Switch Long': 0xCDDC39,
      'Neutral': 0x9E9E9E,
      'Switch Short': 0xFF9800,
      'Try Short': 0xFF5722,
      'Very Short': 0xF44336,
      '🔻 BEAR Cross': 0xFF0000,
      'Dead Short': 0x8B0000  // Dark red for extreme short
    }
    
    // If D7 < 20, force red color regardless of trend (unless Dead Short which has its own color)
    let embedColor = trendColors[newTrend] || 0x9E9E9E
    const isD7Low = d7Value !== null && d7Value < 20
    if (isD7Low && newTrend !== 'Dead Short') {
      embedColor = 0xDC143C // Crimson red - darker, more prominent
    }
    
    // Build title with special formatting for extreme conditions
    let title = `⭐ ${symbol} - Trend Changed`
    if (newTrend === 'Dead Long') {
      title = `🟢 ⚡ ${symbol} - DEAD LONG (D7 > 90, D7↑ D3↑)`
    } else if (newTrend === 'Dead Short') {
      title = `🔴 ⚡ ${symbol} - DEAD SHORT (D7 < 10, D7↓ D3↓)`
    } else if (isD7Low) {
      title = `🔴 ⚠️ ${symbol} - Trend Changed (D7 < 20)`
    }
    
    // Build description with special formatting
    let description = `**${oldTrend}** → **${newTrend}**`
    if (newTrend === 'Dead Long') {
      description = `🟢 **EXTREME LONG CONDITION** 🟢\nD7 > 90, D7 and D3 both going UP\n**${oldTrend}** → **${newTrend}**`
    } else if (newTrend === 'Dead Short') {
      description = `🔴 **EXTREME SHORT CONDITION** 🔴\nD7 < 10, D7 and D3 both going DOWN\n**${oldTrend}** → **${newTrend}**`
    } else if (isD7Low) {
      description = `🔴 **OVERSOLD CONDITION** 🔴\n**${oldTrend}** → **${newTrend}**`
    }
    
    // Build fields array
    const fields = [
      {
        name: 'Price',
        value: `$${price || 'N/A'}`,
        inline: true
      },
      {
        name: 'Time',
        value: new Date().toLocaleTimeString(),
        inline: true
      }
    ]
    
    // Add D7 field for Dead Long/Short or D7 < 20
    if (newTrend === 'Dead Long' || newTrend === 'Dead Short' || isD7Low) {
      const d7Display = d7Value !== null ? d7Value.toFixed(2) : 'N/A'
      const d7Label = newTrend === 'Dead Long' ? '🟢 D7 (EXTREME LONG)' : 
                      newTrend === 'Dead Short' ? '🔴 D7 (EXTREME SHORT)' : 
                      '🔴 D7 (OVERSOLD)'
      fields.push({
        name: d7Label,
        value: `${d7Display}${newTrend === 'Dead Long' || newTrend === 'Dead Short' ? ' ⚡' : ' ⚠️'}`,
        inline: true
      })
    }
    
    const embed = {
      title: title,
      description: description,
      color: embedColor,
      fields: fields,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Trading Dashboard Alert'
      }
    }
    
    // Add D7 value to fields if available
    if (d7Value !== null) {
      const d7Field = {
        name: isD7Low ? '🔴 D7 (OVERSOLD)' : 'D7',
        value: isD7Low ? `**${d7Value.toFixed(2)}** ⚠️` : d7Value.toFixed(2),
        inline: true
      }
      embed.fields.push(d7Field)
    }
    
    // Build webhook payload with optional TTS
    const payload = {
      embeds: [embed]
    }
    
    // Add TTS (text-to-speech) audio notification
    // Enable TTS for all trend changes if TTS is enabled
    if (NOTIFICATION_CONFIG.discord.ttsEnabled && newTrend !== 'Neutral') {
      payload.tts = true
      // Add a content message that will be read out
      // Simple, clear format for TTS
      // Spell out ticker name letter by letter for clarity
      // Add commas and periods to create pauses and slow down speech
      const symbolSpelled = symbol.split('').join(', ') // "ONDS" becomes "O, N, D, S" - commas slow down TTS
      
      // TTS messages - Dead Long/Short have highest priority
      if (newTrend === 'Dead Long') {
        // Dead Long - D7 > 90, D7 and D3 both going up
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Dead Long.`
      } else if (newTrend === 'Dead Short') {
        // Dead Short - D7 < 10, D7 and D3 both going down
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Dead Short.`
      } else if (newTrend === 'Heavy Buy') {
        // Heavy Buy - D7 > 80 AND D3 going up
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Heavy Buy.`
      } else if (d7Value !== null && d7Value < 20) {
        // D7 < 20: Heavy Sell
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Heavy Sell.`
      } else if (newTrend.includes('🚀')) {
        // BULL Cross - Small Buy
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Small Buy.`
      } else if (newTrend.includes('🔻')) {
        // BEAR Cross - Small sell
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Small sell.`
      } else if (newTrend === 'Switch Short') {
        // Switch Short - Medium Short
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Medium Short.`
      } else if (newTrend === 'Very Short') {
        // Very Short - Big Short
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Big Short.`
      } else if (newTrend === 'Switch Long') {
        // Switch Long - Medium Buy
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Medium Buy.`
      } else if (newTrend === 'Try Long') {
        // Try Long - Medium Buy
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Medium Buy.`
      } else if (newTrend === 'Try Short') {
        // Try Short - Medium Sell
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Medium Sell.`
      } else {
        // Fallback for any other trend
        payload.content = `Trend Alert. ${symbolSpelled}. ${newTrend}.`
      }
    }
    
    const response = await fetch(NOTIFICATION_CONFIG.discord.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    
    if (response.ok) {
      console.log(`💬 Discord notification sent for ${symbol}: ${oldTrend} → ${newTrend}`)
    } else {
      console.error(`❌ Discord webhook failed for ${symbol}:`, response.statusText)
    }
  } catch (error) {
    console.error(`❌ Failed to send Discord notification for ${symbol}:`, error.message)
  }
}

// Check and send notifications for trend changes
function checkAndNotifyTrendChange(symbol, alertData) {
  // Check global notification toggle first
  if (!NOTIFICATION_CONFIG.enabled) {
    return // Notifications disabled globally
  }
  
  const currentTrend = calculateTrend(alertData)
  const previousTrend = previousTrends[symbol]
  const isStarred = starredSymbols[symbol]
  
  // Get D7 value
  const d7Value = alertData.octoStochD7 !== undefined ? parseFloat(alertData.octoStochD7) : 
                  alertData.d7 !== undefined ? parseFloat(alertData.d7) : null
  
  // Check for D7 extremes (D7 < 20 or > 80) - ALERT FOR ALL STOCKS (not just starred)
  const isD7Extreme = d7Value !== null && (d7Value < 20 || d7Value > 80)
  const wasD7Extreme = previousTrend === 'Very Short' || previousTrend === 'Very Long'
  
  // Send alert for D7 extremes (regardless of star status) - only on first detection
  if (isD7Extreme && !wasD7Extreme) {
    const extremeTrend = d7Value < 20 ? 'Very Short' : 'Very Long'
    const oldTrend = previousTrend || 'Neutral'
    console.log(`🚨 D7 Extreme Alert for ${symbol}: D7=${d7Value.toFixed(2)} (${extremeTrend})`)
    
    // Send notifications for D7 extremes (all stocks)
    sendEmailNotification(symbol, oldTrend, extremeTrend, alertData.price)
    sendDiscordNotification(symbol, oldTrend, extremeTrend, alertData.price, d7Value)
    
    // Update previous trend
    previousTrends[symbol] = extremeTrend
    return
  }
  
  // For starred symbols: check for regular trend changes
  if (isStarred) {
    console.log(`⭐ Checking trend for starred symbol ${symbol}: current=${currentTrend}, previous=${previousTrend || 'none'}`)
    
    // If trend changed and it's not the first time we're seeing this symbol
    if (previousTrend && previousTrend !== currentTrend) {
      console.log(`🔔 Trend change detected for starred symbol ${symbol}: ${previousTrend} → ${currentTrend}`)
      
      // Send notifications
      sendEmailNotification(symbol, previousTrend, currentTrend, alertData.price)
      sendDiscordNotification(symbol, previousTrend, currentTrend, alertData.price, d7Value)
    } else if (!previousTrend) {
      console.log(`📊 Initial trend recorded for starred symbol ${symbol}: ${currentTrend}`)
    }
    
    // Update previous trend for next comparison
    previousTrends[symbol] = currentTrend
  } else {
    // For non-starred symbols: only track trend (no notifications except D7 extremes above)
    if (!previousTrend) {
      previousTrends[symbol] = currentTrend
    } else if (previousTrend !== currentTrend) {
      previousTrends[symbol] = currentTrend
    }
  }
}

// Helper function to find and update alert by symbol (only for Day script merging)
function updateAlertData(symbol, newData) {
  // Find existing alert for this symbol (only look at recent alerts to merge Day script data)
  const existingIndex = alerts.findIndex(alert => alert.symbol === symbol)
  
  if (existingIndex !== -1) {
    // Merge with existing alert
    alerts[existingIndex] = {
      ...alerts[existingIndex],
      ...newData,
      receivedAt: Date.now()
    }
  } else {
    // Create new alert entry
    alerts.unshift({
      symbol: symbol,
      ...newData,
      receivedAt: Date.now()
    })
  }
  
  // Keep alerts within reasonable limit (increase to 5000 for more history)
  if (alerts.length > 5000) {
    alerts = alerts.slice(0, 5000)
  }
}

// Webhook for TradingView POST
app.post('/webhook', (req, res) => {
  const alert = req.body
  
  // Log incoming webhook for debugging
  console.log('📨 Webhook received:', JSON.stringify(alert, null, 2))
  
  // Debug BJ TSI premarket range values
  if (alert.bjTsi !== undefined) {
    console.log('🔍 BJ TSI Debug:', {
      symbol: alert.symbol,
      bjTsi: alert.bjTsi,
      bjPremarketTsiHigh: alert.bjPremarketTsiHigh,
      bjPremarketTsiLow: alert.bjPremarketTsiLow,
      bjPremarketRangeUpper: alert.bjPremarketRangeUpper, // Legacy support
      bjPremarketRangeLower: alert.bjPremarketRangeLower, // Legacy support
      highType: typeof alert.bjPremarketTsiHigh,
      lowType: typeof alert.bjPremarketTsiLow
    })
  }
  
  // Store in full history (all alerts)
  alertsHistory.unshift({
    ...alert,
    receivedAt: Date.now()
  })
  
  // Detect alert type:
  // - Day script: contains changeFromPrevDay and volume but missing price (handles Chg% and Vol columns)
  // - VWAP Crossing alert: contains vwapCrossing flag
  // - Quad Stochastic D1/D2 alert: contains quadStochSignal
  // - Quad Stochastic D4 alert: contains d4Signal field (old 4-stoch)
  // - Octo Stochastic alert: contains d8Signal field (new 8-stoch)
  // - MACD Crossing alert: contains macdCrossingSignal field
  // - BJ TSI alert: contains bjTsi field
  // - Main script (again.pine): contains price and signals (handles Price and Signal columns)
  const isDayChangeAlert = alert.changeFromPrevDay !== undefined && !alert.price
  const isVwapCrossingAlert = alert.vwapCrossing === true || alert.vwapCrossing === 'true'
  const isQuadStochAlert = alert.quadStochSignal !== undefined
  const isQuadStochD4Alert = alert.d4Signal !== undefined
  const isOctoStochAlert = alert.d8Signal !== undefined
  const isMacdCrossingAlert = alert.macdCrossingSignal !== undefined
  const isBjTsiAlert = alert.bjTsi !== undefined
  const isSoloStochAlert = alert.d2Signal === 'Solo'
  const isDualStochAlert = alert.d2Signal === 'Dual'
  
  // Log alert type detection for debugging
  console.log('📊 Alert type detected:', {
    isDayChangeAlert,
    isVwapCrossingAlert,
    isQuadStochAlert,
    isQuadStochD4Alert,
    isOctoStochAlert,
    isMacdCrossingAlert,
    isBjTsiAlert,
    isSoloStochAlert,
    isDualStochAlert,
    symbol: alert.symbol
  })
  
  if (isQuadStochD4Alert) {
    // Check if values changed compared to previous update
    const prevQS = previousQSValues[alert.symbol] || {}
    const prevDir = previousDirections[alert.symbol] || {}
    const d4Changed = prevQS.d4 !== alert.d4
    const directionChanged = 
      prevQS.d1Direction !== alert.d1Direction ||
      prevQS.d2Direction !== alert.d2Direction ||
      prevQS.d3Direction !== alert.d3Direction ||
      prevQS.d4Direction !== alert.d4Direction
    
    // Detect actual direction switches
    const d1Switched = prevDir.d1 && prevDir.d1 !== alert.d1Direction
    const d2Switched = prevDir.d2 && prevDir.d2 !== alert.d2Direction
    const d3Switched = prevDir.d3 && prevDir.d3 !== alert.d3Direction
    const d4Switched = prevDir.d4 && prevDir.d4 !== alert.d4Direction
    
    // Detect specific switch types
    const d2SwitchedToDown = d2Switched && alert.d2Direction === 'down'
    const d3SwitchedToUp = d3Switched && alert.d3Direction === 'up'
    const d3SwitchedToDown = d3Switched && alert.d3Direction === 'down'
    
    // Detect level crossings
    const d1CrossedUnder75 = prevQS.d1 > 75 && alert.d1 <= 75
    const d2CrossedUnder75 = prevQS.d2 > 75 && alert.d2 <= 75
    const d1CrossedAbove50 = prevQS.d1 < 50 && alert.d1 >= 50
    const d2CrossedAbove50 = prevQS.d2 < 50 && alert.d2 >= 50
    const d4CrossedAbove25 = prevQS.d4 < 25 && alert.d4 >= 25
    
    // Rank signals from bearish (-3) to bullish (+3) for comparison
    const signalRank = {
      'D4_Downtrend': -3,
      'D4_Cross_Down_80': -2,
      'D4_Cross_Down_50': -1,
      'D4_Cross_Down_20': 0,
      'D4_Cross_Up_20': 1,
      'D4_Cross_Up_50': 2,
      'D4_Cross_Up_80': 3,
      'D4_Uptrend': 3
    }
    
    const currentRank = signalRank[alert.d4Signal] || 0
    const previousRank = prevQS.d4Signal ? (signalRank[prevQS.d4Signal] || 0) : 0
    
    // Determine if more bullish or bearish
    let changeDirection = 'neutral'
    if (currentRank > previousRank) {
      changeDirection = 'bullish' // More bullish
    } else if (currentRank < previousRank) {
      changeDirection = 'bearish' // More bearish
    }
    
    // Count up vs down directions for arrow change type
    const prevUpCount = [prevQS.d1Direction, prevQS.d2Direction, prevQS.d3Direction, prevQS.d4Direction].filter(d => d === 'up').length
    const currUpCount = [alert.d1Direction, alert.d2Direction, alert.d3Direction, alert.d4Direction].filter(d => d === 'up').length
    
    let arrowChangeDirection = 'neutral'
    if (currUpCount > prevUpCount) {
      arrowChangeDirection = 'bullish'
    } else if (currUpCount < prevUpCount) {
      arrowChangeDirection = 'bearish'
    }
    
    // Quad Stochastic D4 alert - store trend and crossing data
    quadStochD4Data[alert.symbol] = {
      signal: alert.d4Signal,
      d1: alert.d1,
      d2: alert.d2,
      d3: alert.d3,
      d4: alert.d4,
      d1Direction: alert.d1Direction,
      d2Direction: alert.d2Direction,
      d3Direction: alert.d3Direction,
      d4Direction: alert.d4Direction,
      d4Changed: d4Changed,
      directionChanged: directionChanged,
      changeDirection: changeDirection,
      arrowChangeDirection: arrowChangeDirection,
      d2SwitchedToDown: d2SwitchedToDown,
      d3SwitchedToUp: d3SwitchedToUp,
      d3SwitchedToDown: d3SwitchedToDown,
      d1CrossedUnder75: d1CrossedUnder75,
      d2CrossedUnder75: d2CrossedUnder75,
      d1CrossedAbove50: d1CrossedAbove50,
      d2CrossedAbove50: d2CrossedAbove50,
      d4CrossedAbove25: d4CrossedAbove25,
      changeTimestamp: Date.now(),
      timestamp: Date.now()
    }
    
    // Store current values as previous for next comparison
    previousQSValues[alert.symbol] = {
      d1: alert.d1,
      d2: alert.d2,
      d3: alert.d3,
      d4: alert.d4,
      d4Signal: alert.d4Signal,
      d1Direction: alert.d1Direction,
      d2Direction: alert.d2Direction,
      d3Direction: alert.d3Direction,
      d4Direction: alert.d4Direction
    }
    
    // Store current directions as previous for next comparison
    previousDirections[alert.symbol] = {
      d1: alert.d1Direction,
      d2: alert.d2Direction,
      d3: alert.d3Direction,
      d4: alert.d4Direction
    }
    
    console.log(`✅ D4 signal stored for ${alert.symbol}: ${alert.d4Signal}, D4 value: ${alert.d4}, Changed: ${changeDirection}/${arrowChangeDirection}`)
    
    // Update existing alert if it exists, or create new one if it doesn't
    const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
    if (existingIndex !== -1) {
      alerts[existingIndex].quadStochD4Signal = alert.d4Signal
      alerts[existingIndex].quadStochD1 = alert.d1
      alerts[existingIndex].quadStochD2 = alert.d2
      alerts[existingIndex].quadStochD3 = alert.d3
      alerts[existingIndex].quadStochD4 = alert.d4
      alerts[existingIndex].d1Direction = alert.d1Direction
      alerts[existingIndex].d2Direction = alert.d2Direction
      alerts[existingIndex].d3Direction = alert.d3Direction
      alerts[existingIndex].d4Direction = alert.d4Direction
      alerts[existingIndex].qsD4Changed = d4Changed
      alerts[existingIndex].qsDirectionChanged = directionChanged
      alerts[existingIndex].qsChangeDirection = changeDirection
      alerts[existingIndex].qsArrowChangeDirection = arrowChangeDirection
      alerts[existingIndex].qsChangeTimestamp = Date.now()
      alerts[existingIndex].receivedAt = Date.now()
      console.log(`✅ Updated existing alert for ${alert.symbol} with D4 signal and values`)
    } else {
      // Create new alert entry if it doesn't exist
      const newAlert = {
        symbol: alert.symbol,
        timeframe: alert.timeframe || null,
        quadStochD4Signal: alert.d4Signal,
        quadStochD1: alert.d1,
        quadStochD2: alert.d2,
        quadStochD3: alert.d3,
        quadStochD4: alert.d4,
        d1Direction: alert.d1Direction,
        d2Direction: alert.d2Direction,
        d3Direction: alert.d3Direction,
        d4Direction: alert.d4Direction,
        qsD4Changed: d4Changed,
        qsDirectionChanged: directionChanged,
        qsChangeDirection: changeDirection,
        qsArrowChangeDirection: arrowChangeDirection,
        qsChangeTimestamp: Date.now(),
        d2SwitchedToDown: d2SwitchedToDown,
        d3SwitchedToUp: d3SwitchedToUp,
        d3SwitchedToDown: d3SwitchedToDown,
        d1CrossedUnder75: d1CrossedUnder75,
        d2CrossedUnder75: d2CrossedUnder75,
        d1CrossedAbove50: d1CrossedAbove50,
        d2CrossedAbove50: d2CrossedAbove50,
        d4CrossedAbove25: d4CrossedAbove25,
        receivedAt: Date.now()
      }
      alerts.unshift(newAlert)
      console.log(`✅ Created new alert entry for ${alert.symbol} with D4 signal and values`)
    }
  } else if (isOctoStochAlert) {
    // Octo Stochastic (8-stoch) alert - store all 8 stochastic data
    const prevOcto = previousQSValues[alert.symbol] || {}
    const prevDir = previousDirections[alert.symbol] || {}
    
    // Detect direction switches for D1 and D7
    const d1Switched = prevDir.d1 && prevDir.d1 !== alert.d1Direction
    const d7Switched = prevDir.d7 && prevDir.d7 !== alert.d7Direction
    
    // Detect specific switch types for trend analysis
    const d1SwitchedToUp = d1Switched && alert.d1Direction === 'up'
    const d1SwitchedToDown = d1Switched && alert.d1Direction === 'down'
    const d7SwitchedToUp = d7Switched && alert.d7Direction === 'up'
    const d7SwitchedToDown = d7Switched && alert.d7Direction === 'down'
    
    // Detect D1 crossover/crossunder D7
    const d1Val = parseFloat(alert.d1)
    const d7Val = parseFloat(alert.d7)
    const prevD1Val = parseFloat(prevOcto.d1)
    const prevD7Val = parseFloat(prevOcto.d7)
    
    let d1CrossD7 = null
    if (!isNaN(d1Val) && !isNaN(d7Val) && !isNaN(prevD1Val) && !isNaN(prevD7Val)) {
      // D1 crossover D7 (bullish) - both going up
      if (prevD1Val <= prevD7Val && d1Val > d7Val && alert.d1Direction === 'up' && alert.d7Direction === 'up') {
        d1CrossD7 = 'bull'
      }
      // D1 crossunder D7 (bearish) - both going down
      else if (prevD1Val >= prevD7Val && d1Val < d7Val && alert.d1Direction === 'down' && alert.d7Direction === 'down') {
        d1CrossD7 = 'bear'
      }
    }
    
    // Track Higher Low / Lower High pattern (prefer D3, fallback to D7)
    const normalizePatternValue = value => {
      if (value === undefined || value === null || value === '' || value === 'N/A') return null
      const num = parseFloat(value)
      return isNaN(num) ? value : num
    }

    const detectedPattern =
      alert.d3Pattern && alert.d3Pattern !== 'None'
        ? { type: alert.d3Pattern, value: normalizePatternValue(alert.d3PatternValue), source: 'D3' }
        : alert.d7Pattern && alert.d7Pattern !== 'None'
            ? { type: alert.d7Pattern, value: normalizePatternValue(alert.d7PatternValue), source: 'D7' }
            : null

    const existingPattern = patternData[alert.symbol]
    if (detectedPattern) {
      const samePattern = existingPattern && existingPattern.type === detectedPattern.type
      patternData[alert.symbol] = {
        type: detectedPattern.type,
        source: detectedPattern.source,
        lastValue: detectedPattern.value,
        startTime: samePattern && existingPattern.startTime ? existingPattern.startTime : Date.now(),
        lastUpdated: Date.now(),
        count: samePattern && existingPattern.count ? existingPattern.count + 1 : 1,
        trendBreak: false
      }
    } else if (existingPattern) {
      // Check for trend break: D3 went below HL or above LH
      const currentD3 = parseFloat(alert.d3)
      const patternValue = existingPattern.lastValue
      let trendBreak = existingPattern.trendBreak || false
      
      if (!isNaN(currentD3) && patternValue !== null && !isNaN(patternValue)) {
        if (existingPattern.type === 'Higher Low' && currentD3 < patternValue) {
          trendBreak = true
        } else if (existingPattern.type === 'Lower High' && currentD3 > patternValue) {
          trendBreak = true
        }
      }
      
      // No fresh pattern, keep previous info but refresh timestamp
      patternData[alert.symbol] = {
        ...existingPattern,
        lastUpdated: Date.now(),
        count: (existingPattern.count || 0) + 1,
        trendBreak: trendBreak
      }
    }
    
    // Get previous valid values for this symbol
    const prevOctoData = octoStochData[alert.symbol] || {}
    
    // Helper function to get valid value (use previous if current is invalid)
    const getValidValue = (current, previous, defaultValue = null) => {
      if (current !== undefined && current !== null && current !== '' && current !== 'N/A' && current !== 'na') {
        const num = parseFloat(current)
        if (!isNaN(num)) return current
      }
      return previous !== undefined && previous !== null && previous !== '' && previous !== 'N/A' ? previous : defaultValue
    }
    
    // Helper function to get valid string value
    const getValidString = (current, previous, defaultValue = '') => {
      if (current !== undefined && current !== null && current !== '' && current !== 'N/A') {
        return current
      }
      return previous !== undefined && previous !== null && previous !== '' && previous !== 'N/A' ? previous : defaultValue
    }
    
    // Store Octo Stochastic data with fallback to previous valid values
    octoStochData[alert.symbol] = {
      d1: getValidValue(alert.d1, prevOctoData.d1, '0'),
      d2: getValidValue(alert.d2, prevOctoData.d2, '0'),
      d3: getValidValue(alert.d3, prevOctoData.d3, '0'),
      d4: getValidValue(alert.d4, prevOctoData.d4, '0'),
      d5: getValidValue(alert.d5, prevOctoData.d5, '0'),
      d6: getValidValue(alert.d6, prevOctoData.d6, '0'),
      d7: getValidValue(alert.d7, prevOctoData.d7, '0'),
      d8: getValidValue(alert.d8, prevOctoData.d8, '0'),
      d1Direction: getValidString(alert.d1Direction, prevOctoData.d1Direction, 'flat'),
      d2Direction: getValidString(alert.d2Direction, prevOctoData.d2Direction, 'flat'),
      d3Direction: getValidString(alert.d3Direction, prevOctoData.d3Direction, 'flat'),
      d4Direction: getValidString(alert.d4Direction, prevOctoData.d4Direction, 'flat'),
      d5Direction: getValidString(alert.d5Direction, prevOctoData.d5Direction, 'flat'),
      d6Direction: getValidString(alert.d6Direction, prevOctoData.d6Direction, 'flat'),
      d7Direction: getValidString(alert.d7Direction, prevOctoData.d7Direction, 'flat'),
      d8Direction: getValidString(alert.d8Direction, prevOctoData.d8Direction, 'flat'),
      d8Signal: getValidString(alert.d8Signal, prevOctoData.d8Signal, 'Octo'),
      d1d2Cross: getValidString(alert.d1d2Cross, prevOctoData.d1d2Cross, 'none'),
      d1CrossD7: d1CrossD7 || prevOctoData.d1CrossD7 || null,
      timeframe1_4: getValidString(alert.timeframe1_4, prevOctoData.timeframe1_4, ''),
      timeframe5_8: getValidString(alert.timeframe5_8, prevOctoData.timeframe5_8, ''),
      d1SwitchedToUp: d1SwitchedToUp,
      d1SwitchedToDown: d1SwitchedToDown,
      d7SwitchedToUp: d7SwitchedToUp,
      d7SwitchedToDown: d7SwitchedToDown,
      patternType: patternData[alert.symbol]?.type || prevOctoData.patternType || '',
      patternValue: patternData[alert.symbol]?.lastValue ?? prevOctoData.patternValue ?? null,
      patternStartTime: patternData[alert.symbol]?.startTime || prevOctoData.patternStartTime || null,
      patternCount: patternData[alert.symbol]?.count || prevOctoData.patternCount || 0,
      patternTrendBreak: patternData[alert.symbol]?.trendBreak || alert.d3TrendBreak === 'true' || alert.d3TrendBreak === true || false,
      d3BelowLastHL: alert.d3BelowLastHL === 'true' || alert.d3BelowLastHL === true || false,
      d3AboveLastLH: alert.d3AboveLastLH === 'true' || alert.d3AboveLastLH === true || false,
      d3BelowLastD7HL: alert.d3BelowLastD7HL === 'true' || alert.d3BelowLastD7HL === true || false,
      d3AboveLastD7LH: alert.d3AboveLastD7LH === 'true' || alert.d3AboveLastD7LH === true || false,
      d3AbovePredictedLH: alert.d3AbovePredictedLH === 'true' || alert.d3AbovePredictedLH === true || false,
      d7AbovePredictedLH: alert.d7AbovePredictedLH === 'true' || alert.d7AbovePredictedLH === true || false,
      d3PredictedThirdLH: parseFloat(alert.d3PredictedThirdLH) || null,
      d7PredictedThirdLH: parseFloat(alert.d7PredictedThirdLH) || null,
      calculatedTrend: getValidString(alert.calculatedTrend, prevOctoData.calculatedTrend, 'Neutral'),
      ttsMessage: getValidString(alert.ttsMessage, prevOctoData.ttsMessage, ''),
      timestamp: Date.now()
    }
    
    // Store current values as previous for next comparison
    previousQSValues[alert.symbol] = {
      d1: alert.d1,
      d2: alert.d2,
      d3: alert.d3,
      d4: alert.d4,
      d5: alert.d5,
      d6: alert.d6,
      d7: alert.d7,
      d8: alert.d8,
      d1Direction: alert.d1Direction,
      d2Direction: alert.d2Direction,
      d3Direction: alert.d3Direction,
      d4Direction: alert.d4Direction,
      d5Direction: alert.d5Direction,
      d6Direction: alert.d6Direction,
      d7Direction: alert.d7Direction,
      d8Direction: alert.d8Direction
    }
    
    // Store current directions as previous for next comparison
    previousDirections[alert.symbol] = {
      d1: alert.d1Direction,
      d2: alert.d2Direction,
      d3: alert.d3Direction,
      d4: alert.d4Direction,
      d5: alert.d5Direction,
      d6: alert.d6Direction,
      d7: alert.d7Direction,
      d8: alert.d8Direction
    }
    
    console.log(`✅ Octo Stoch data stored for ${alert.symbol}: D1=${alert.d1}, D7=${alert.d7}, D1xD7=${d1CrossD7 || 'none'}, D8 Signal=${alert.d8Signal}`)
    
    // Check and notify trend change for starred symbols
    checkAndNotifyTrendChange(alert.symbol, octoStochData[alert.symbol])
    
    // Update existing alert if it exists, or create new one if it doesn't
    const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
    if (existingIndex !== -1) {
      // Update existing alert
      alerts[existingIndex].octoStochD1 = alert.d1
      alerts[existingIndex].octoStochD2 = alert.d2
      alerts[existingIndex].octoStochD3 = alert.d3
      alerts[existingIndex].octoStochD4 = alert.d4
      alerts[existingIndex].octoStochD5 = alert.d5
      alerts[existingIndex].octoStochD6 = alert.d6
      alerts[existingIndex].octoStochD7 = alert.d7
      alerts[existingIndex].octoStochD8 = alert.d8
      alerts[existingIndex].d1Direction = alert.d1Direction
      alerts[existingIndex].d2Direction = alert.d2Direction
      alerts[existingIndex].d3Direction = alert.d3Direction
      alerts[existingIndex].d4Direction = alert.d4Direction
      alerts[existingIndex].d5Direction = alert.d5Direction
      alerts[existingIndex].d6Direction = alert.d6Direction
      alerts[existingIndex].d7Direction = alert.d7Direction
      alerts[existingIndex].d8Direction = alert.d8Direction
      alerts[existingIndex].d8Signal = alert.d8Signal
      alerts[existingIndex].d1d2Cross = alert.d1d2Cross
      alerts[existingIndex].d1CrossD7 = d1CrossD7
      alerts[existingIndex].d1SwitchedToUp = d1SwitchedToUp
      alerts[existingIndex].d1SwitchedToDown = d1SwitchedToDown
      alerts[existingIndex].d7SwitchedToUp = d7SwitchedToUp
      alerts[existingIndex].d7SwitchedToDown = d7SwitchedToDown
      alerts[existingIndex].patternType = patternData[alert.symbol]?.type || alerts[existingIndex].patternType || null
      alerts[existingIndex].patternValue = patternData[alert.symbol]?.lastValue ?? alerts[existingIndex].patternValue ?? null
      alerts[existingIndex].patternStartTime = patternData[alert.symbol]?.startTime || alerts[existingIndex].patternStartTime || null
      alerts[existingIndex].patternCount = patternData[alert.symbol]?.count || alerts[existingIndex].patternCount || 0
      alerts[existingIndex].patternTrendBreak = patternData[alert.symbol]?.trendBreak || alert.d3TrendBreak === 'true' || alert.d3TrendBreak === true || false
      alerts[existingIndex].d3BelowLastHL = alert.d3BelowLastHL === 'true' || alert.d3BelowLastHL === true || false
      alerts[existingIndex].d3AboveLastLH = alert.d3AboveLastLH === 'true' || alert.d3AboveLastLH === true || false
      alerts[existingIndex].d3BelowLastD7HL = alert.d3BelowLastD7HL === 'true' || alert.d3BelowLastD7HL === true || false
      alerts[existingIndex].d3AboveLastD7LH = alert.d3AboveLastD7LH === 'true' || alert.d3AboveLastD7LH === true || false
      alerts[existingIndex].d3AbovePredictedLH = alert.d3AbovePredictedLH === 'true' || alert.d3AbovePredictedLH === true || false
      alerts[existingIndex].d7AbovePredictedLH = alert.d7AbovePredictedLH === 'true' || alert.d7AbovePredictedLH === true || false
      alerts[existingIndex].d3PredictedThirdLH = parseFloat(alert.d3PredictedThirdLH) || null
      alerts[existingIndex].d7PredictedThirdLH = parseFloat(alert.d7PredictedThirdLH) || null
      alerts[existingIndex].calculatedTrend = alert.calculatedTrend || null // From Pine Script
      alerts[existingIndex].ttsMessage = alert.ttsMessage || null // From Pine Script
      // Update basic info, daily comparison, and volume fields
      if (alert.price !== undefined) alerts[existingIndex].price = alert.price
      if (alert.timeframe !== undefined) alerts[existingIndex].timeframe = alert.timeframe
      if (alert.time !== undefined) alerts[existingIndex].time = alert.time
      if (alert.previousClose !== undefined) alerts[existingIndex].previousClose = alert.previousClose
      if (alert.changeFromPrevDay !== undefined) alerts[existingIndex].changeFromPrevDay = alert.changeFromPrevDay
      if (alert.volume !== undefined) alerts[existingIndex].volume = alert.volume
      if (alert.prevDayVolume !== undefined) alerts[existingIndex].prevDayVolume = alert.prevDayVolume
      alerts[existingIndex].receivedAt = Date.now()
      console.log(`✅ Updated existing alert for ${alert.symbol} with Octo Stoch data`)
    } else {
      // Create new alert entry if it doesn't exist
      const newAlert = {
        symbol: alert.symbol,
        timeframe: alert.timeframe || null,
        time: alert.time || null,
        price: alert.price || null,
        previousClose: alert.previousClose || null,
        changeFromPrevDay: alert.changeFromPrevDay || null,
        volume: alert.volume || null,
        prevDayVolume: alert.prevDayVolume || null,
        octoStochD1: alert.d1,
        octoStochD2: alert.d2,
        octoStochD3: alert.d3,
        octoStochD4: alert.d4,
        octoStochD5: alert.d5,
        octoStochD6: alert.d6,
        octoStochD7: alert.d7,
        octoStochD8: alert.d8,
        d1Direction: alert.d1Direction,
        d2Direction: alert.d2Direction,
        d3Direction: alert.d3Direction,
        d4Direction: alert.d4Direction,
        d5Direction: alert.d5Direction,
        d6Direction: alert.d6Direction,
        d7Direction: alert.d7Direction,
        d8Direction: alert.d8Direction,
        d8Signal: alert.d8Signal,
        d1d2Cross: alert.d1d2Cross,
        d1CrossD7: d1CrossD7,
        d1SwitchedToUp: d1SwitchedToUp,
        d1SwitchedToDown: d1SwitchedToDown,
        d7SwitchedToUp: d7SwitchedToUp,
        d7SwitchedToDown: d7SwitchedToDown,
        patternType: patternData[alert.symbol]?.type || null,
        patternValue: patternData[alert.symbol]?.lastValue ?? null,
        patternStartTime: patternData[alert.symbol]?.startTime || null,
        patternCount: patternData[alert.symbol]?.count || 0,
        patternTrendBreak: patternData[alert.symbol]?.trendBreak || alert.d3TrendBreak === 'true' || alert.d3TrendBreak === true || false,
        d3BelowLastHL: alert.d3BelowLastHL === 'true' || alert.d3BelowLastHL === true || false,
        d3AboveLastLH: alert.d3AboveLastLH === 'true' || alert.d3AboveLastLH === true || false,
        d3BelowLastD7HL: alert.d3BelowLastD7HL === 'true' || alert.d3BelowLastD7HL === true || false,
        d3AboveLastD7LH: alert.d3AboveLastD7LH === 'true' || alert.d3AboveLastD7LH === true || false,
        d3AbovePredictedLH: alert.d3AbovePredictedLH === 'true' || alert.d3AbovePredictedLH === true || false,
        d7AbovePredictedLH: alert.d7AbovePredictedLH === 'true' || alert.d7AbovePredictedLH === true || false,
        d3PredictedThirdLH: parseFloat(alert.d3PredictedThirdLH) || null,
        d7PredictedThirdLH: parseFloat(alert.d7PredictedThirdLH) || null,
        calculatedTrend: alert.calculatedTrend || null,
        ttsMessage: alert.ttsMessage || null,
        timeframe1_4: alert.timeframe1_4,
        timeframe5_8: alert.timeframe5_8,
        receivedAt: Date.now()
      }
      alerts.unshift(newAlert)
      console.log(`✅ Created new alert entry for ${alert.symbol} with Octo Stoch data`)
    }
  } else if (isMacdCrossingAlert && !alert.price) {
    // MACD Crossing alert - store crossing signal with timestamp
    macdCrossingData[alert.symbol] = {
      signal: alert.macdCrossingSignal,
      macd: alert.macd,
      macdSignal: alert.macdSignal,
      macdHistogram: alert.macdHistogram,
      timestamp: Date.now()
    }
    console.log(`✅ MACD crossing signal stored for ${alert.symbol}: ${alert.macdCrossingSignal}`)
    
    // Update existing alert if it exists, or create new one if it doesn't
    const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
    if (existingIndex !== -1) {
      alerts[existingIndex].macdCrossingSignal = alert.macdCrossingSignal
      alerts[existingIndex].macdCrossingTimestamp = alert.macdCrossingTimestamp
      if (alert.macd !== undefined) alerts[existingIndex].macd = alert.macd
      if (alert.macdSignal !== undefined) alerts[existingIndex].macdSignal = alert.macdSignal
      if (alert.macdHistogram !== undefined) alerts[existingIndex].macdHistogram = alert.macdHistogram
      alerts[existingIndex].receivedAt = Date.now()
      console.log(`✅ Updated existing alert for ${alert.symbol} with MACD crossing signal`)
    } else {
      // Create new alert entry if it doesn't exist
      const newAlert = {
        symbol: alert.symbol,
        timeframe: alert.timeframe || null,
        macdCrossingSignal: alert.macdCrossingSignal,
        macdCrossingTimestamp: alert.macdCrossingTimestamp || Date.now(),
        macd: alert.macd,
        macdSignal: alert.macdSignal,
        macdHistogram: alert.macdHistogram,
        receivedAt: Date.now()
      }
      alerts.unshift(newAlert)
      console.log(`✅ Created new alert entry for ${alert.symbol} with MACD crossing signal`)
    }
  } else if (isDayChangeAlert) {
    // Day script alert - store day change and volume data
    dayChangeData[alert.symbol] = alert.changeFromPrevDay
    if (alert.volume !== undefined) {
      dayVolumeData[alert.symbol] = alert.volume
    }
    
    // Update existing alert with day data
    const dayData = { changeFromPrevDay: alert.changeFromPrevDay }
    if (alert.volume !== undefined) {
      dayData.volume = alert.volume
    }
    updateAlertData(alert.symbol, dayData)
  } else if (isQuadStochAlert) {
    // Quad Stochastic D1/D2 alert - store crossing status with timestamp
    quadStochData[alert.symbol] = {
      signal: alert.quadStochSignal,
      d1: alert.d1,
      d2: alert.d2,
      d3: alert.d3,
      d4: alert.d4,
      k1: alert.k1,
      timestamp: Date.now()
    }
    console.log(`✅ Quad Stoch D1/D2 signal stored for ${alert.symbol}: ${alert.quadStochSignal}`)
    
    // Update existing alert if it exists, or create new one if it doesn't
    const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
    if (existingIndex !== -1) {
      alerts[existingIndex].quadStochSignal = alert.quadStochSignal
      alerts[existingIndex].quadStochD1 = alert.d1
      alerts[existingIndex].quadStochD2 = alert.d2
      alerts[existingIndex].quadStochD4 = alert.d4
      alerts[existingIndex].receivedAt = Date.now()
      console.log(`✅ Updated existing alert for ${alert.symbol} with Quad Stoch signal`)
    } else {
      // Create new alert entry if it doesn't exist
      const newAlert = {
        symbol: alert.symbol,
        timeframe: alert.timeframe || null,
        quadStochSignal: alert.quadStochSignal,
        quadStochD1: alert.d1,
        quadStochD2: alert.d2,
        quadStochD4: alert.d4,
        receivedAt: Date.now()
      }
      alerts.unshift(newAlert)
      console.log(`✅ Created new alert entry for ${alert.symbol} with Quad Stoch signal`)
    }
  } else if (isVwapCrossingAlert) {
    // VWAP Crossing alert - store crossing status with timestamp
    vwapCrossingData[alert.symbol] = {
      crossed: true,
      timestamp: Date.now()
    }
    console.log(`✅ VWAP crossing stored for ${alert.symbol}`)
    
    // Update existing alert if it exists, or create new one if it doesn't
    const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
    if (existingIndex !== -1) {
      alerts[existingIndex].vwapCrossing = true
      alerts[existingIndex].receivedAt = Date.now()
      console.log(`✅ Updated existing alert for ${alert.symbol} with VWAP crossing`)
    } else {
      // Create new alert entry if it doesn't exist
      const newAlert = {
        symbol: alert.symbol,
        timeframe: alert.timeframe || null,
        vwapCrossing: true,
        receivedAt: Date.now()
      }
      alerts.unshift(newAlert)
      console.log(`✅ Created new alert entry for ${alert.symbol} with VWAP crossing`)
    }
  } else if (isBjTsiAlert && !alert.price) {
    // BJ TSI alert - store BJ TSI data with timestamp
    const bjTsiValue = parseFloat(alert.bjTsi);
    
    // Track premarket range in backend (if TSI value is valid) - as backup
    if (!isNaN(bjTsiValue)) {
      updateBjPremarketRange(alert.symbol, bjTsiValue);
    }
    
    // Prioritize Pine script values if available, otherwise use backend calculated
    let pmUpper = null;
    let pmLower = null;
    
    // Check if Pine script sent premarket TSI high/low values (new field names)
    // Handle both string "null" and actual null values
    if (alert.bjPremarketTsiHigh !== null && 
        alert.bjPremarketTsiHigh !== undefined && 
        alert.bjPremarketTsiHigh !== '' && 
        alert.bjPremarketTsiHigh !== 'null' &&
        String(alert.bjPremarketTsiHigh).toLowerCase() !== 'null') {
      const highVal = parseFloat(alert.bjPremarketTsiHigh);
      if (!isNaN(highVal)) {
        pmUpper = highVal;
        console.log(`📊 Using Pine script PM High (premarketTsiHigh) for ${alert.symbol}: ${pmUpper.toFixed(3)}`);
      }
    }
    if (alert.bjPremarketTsiLow !== null && 
        alert.bjPremarketTsiLow !== undefined && 
        alert.bjPremarketTsiLow !== '' && 
        alert.bjPremarketTsiLow !== 'null' &&
        String(alert.bjPremarketTsiLow).toLowerCase() !== 'null') {
      const lowVal = parseFloat(alert.bjPremarketTsiLow);
      if (!isNaN(lowVal)) {
        pmLower = lowVal;
        console.log(`📊 Using Pine script PM Low (premarketTsiLow) for ${alert.symbol}: ${pmLower.toFixed(3)}`);
      }
    }
    
    // Legacy support: fallback to old field names if new ones not available
    if (pmUpper === null && alert.bjPremarketRangeUpper !== null && 
        alert.bjPremarketRangeUpper !== undefined && 
        alert.bjPremarketRangeUpper !== '' && 
        alert.bjPremarketRangeUpper !== 'null' &&
        String(alert.bjPremarketRangeUpper).toLowerCase() !== 'null') {
      const upperVal = parseFloat(alert.bjPremarketRangeUpper);
      if (!isNaN(upperVal)) {
        pmUpper = upperVal;
        console.log(`📊 Using Pine script PM Upper (legacy) for ${alert.symbol}: ${pmUpper.toFixed(3)}`);
      }
    }
    if (pmLower === null && alert.bjPremarketRangeLower !== null && 
        alert.bjPremarketRangeLower !== undefined && 
        alert.bjPremarketRangeLower !== '' && 
        alert.bjPremarketRangeLower !== 'null' &&
        String(alert.bjPremarketRangeLower).toLowerCase() !== 'null') {
      const lowerVal = parseFloat(alert.bjPremarketRangeLower);
      if (!isNaN(lowerVal)) {
        pmLower = lowerVal;
        console.log(`📊 Using Pine script PM Lower (legacy) for ${alert.symbol}: ${pmLower.toFixed(3)}`);
      }
    }
    
    // Fallback to backend calculated range if Pine script values not available
    if (pmUpper === null || pmLower === null) {
      const pmRange = getBjPremarketRange(alert.symbol);
      if (pmUpper === null) pmUpper = pmRange.upper;
      if (pmLower === null) pmLower = pmRange.lower;
    }
    
    bjTsiDataStorage[alert.symbol] = {
      bjTsi: alert.bjTsi,
      bjTsl: alert.bjTsl,
      bjTsiIsBull: alert.bjTsiIsBull === true || alert.bjTsiIsBull === 'true',
      bjTslIsBull: alert.bjTslIsBull === true || alert.bjTslIsBull === 'true',
      bjPremarketRangeUpper: pmUpper,
      bjPremarketRangeLower: pmLower,
      timestamp: Date.now()
    }
    console.log(`✅ BJ TSI data stored for ${alert.symbol}: TSI=${alert.bjTsi}, TSL=${alert.bjTsl}, PM Upper=${pmUpper !== null ? pmUpper.toFixed(3) : 'null'}, PM Lower=${pmLower !== null ? pmLower.toFixed(3) : 'null'}`)
    
    // Update existing alert if it exists, or create new one if it doesn't
    const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
    if (existingIndex !== -1) {
      alerts[existingIndex].bjTsi = bjTsiDataStorage[alert.symbol].bjTsi
      alerts[existingIndex].bjTsl = bjTsiDataStorage[alert.symbol].bjTsl
      alerts[existingIndex].bjTsiIsBull = bjTsiDataStorage[alert.symbol].bjTsiIsBull
      alerts[existingIndex].bjTslIsBull = bjTsiDataStorage[alert.symbol].bjTslIsBull
      alerts[existingIndex].bjPremarketRangeUpper = bjTsiDataStorage[alert.symbol].bjPremarketRangeUpper
      alerts[existingIndex].bjPremarketRangeLower = bjTsiDataStorage[alert.symbol].bjPremarketRangeLower
      alerts[existingIndex].receivedAt = Date.now()
      console.log(`✅ Updated existing alert for ${alert.symbol} with BJ TSI data`)
    } else {
      // Create new alert entry if it doesn't exist
      const newAlert = {
        symbol: alert.symbol,
        timeframe: alert.timeframe || null,
        bjTsi: bjTsiDataStorage[alert.symbol].bjTsi,
        bjTsl: bjTsiDataStorage[alert.symbol].bjTsl,
        bjTsiIsBull: bjTsiDataStorage[alert.symbol].bjTsiIsBull,
        bjTslIsBull: bjTsiDataStorage[alert.symbol].bjTslIsBull,
        bjPremarketRangeUpper: bjTsiDataStorage[alert.symbol].bjPremarketRangeUpper,
        bjPremarketRangeLower: bjTsiDataStorage[alert.symbol].bjPremarketRangeLower,
        receivedAt: Date.now()
      }
      alerts.unshift(newAlert)
      console.log(`✅ Created new alert entry for ${alert.symbol} with BJ TSI data`)
    }
  } else if (isSoloStochAlert) {
    // Solo Stoch alert - store D2 data with timestamp
    soloStochDataStorage[alert.symbol] = {
      d2: alert.d2,
      d2Direction: alert.d2Direction,
      d2Pattern: alert.d2Pattern || '',
      d2PatternValue: alert.d2PatternValue || null,
      previousClose: alert.previousClose || null,
      changeFromPrevDay: alert.changeFromPrevDay || null,
      volume: alert.volume || null,
      timestamp: Date.now()
    }
    console.log(`✅ Solo Stoch data stored for ${alert.symbol}: D2=${alert.d2}, Dir=${alert.d2Direction}, Chg%=${alert.changeFromPrevDay || 'N/A'}, Vol=${alert.volume || 'N/A'}`)
    
    // Update existing alert if it exists, or create new one if it doesn't
    const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
    if (existingIndex !== -1) {
      alerts[existingIndex].soloStochD2 = alert.d2
      alerts[existingIndex].soloStochD2Direction = alert.d2Direction
      alerts[existingIndex].soloStochD2Pattern = alert.d2Pattern || ''
      alerts[existingIndex].soloStochD2PatternValue = alert.d2PatternValue || null
      if (alert.price) alerts[existingIndex].price = alert.price
      if (alert.previousClose !== undefined) alerts[existingIndex].previousClose = alert.previousClose
      if (alert.changeFromPrevDay !== undefined) alerts[existingIndex].changeFromPrevDay = alert.changeFromPrevDay
      if (alert.volume !== undefined) alerts[existingIndex].volume = alert.volume
      alerts[existingIndex].receivedAt = Date.now()
      console.log(`✅ Updated existing alert for ${alert.symbol} with Solo Stoch data`)
    } else {
      // Create new alert entry if it doesn't exist
      const newAlert = {
        symbol: alert.symbol,
        timeframe: alert.timeframe || null,
        price: alert.price || null,
        previousClose: alert.previousClose || null,
        changeFromPrevDay: alert.changeFromPrevDay || null,
        volume: alert.volume || null,
        soloStochD2: alert.d2,
        soloStochD2Direction: alert.d2Direction,
        soloStochD2Pattern: alert.d2Pattern || '',
        soloStochD2PatternValue: alert.d2PatternValue || null,
        receivedAt: Date.now()
      }
      alerts.unshift(newAlert)
      console.log(`✅ Created new alert entry for ${alert.symbol} with Solo Stoch data`)
    }
  } else if (isDualStochAlert) {
    // Dual Stoch alert - store D1/D2 data with timestamp
    const timestamp = Date.now()
    dualStochDataStorage[alert.symbol] = {
      d1: alert.d1,
      d1Direction: alert.d1Direction,
      d1Pattern: alert.d1Pattern || '',
      d1PatternValue: alert.d1PatternValue || null,
      d2: alert.d2,
      d2Direction: alert.d2Direction || 'flat',
      highLevelTrend: alert.highLevelTrend || false,
      highLevelTrendType: alert.highLevelTrendType || 'None',
      highLevelTrendDiff: alert.highLevelTrendDiff || 0,
      previousClose: alert.previousClose || null,
      changeFromPrevDay: alert.changeFromPrevDay || null,
      volume: alert.volume || null,
      timestamp: timestamp
    }
    
    // Store historical data for mini chart (keep last 50 points)
    if (!dualStochHistory[alert.symbol]) {
      dualStochHistory[alert.symbol] = []
    }
    dualStochHistory[alert.symbol].push({
      d1: parseFloat(alert.d1) || 0,
      d2: parseFloat(alert.d2) || 0,
      timestamp: timestamp
    })
    // Keep only last 50 data points per symbol
    if (dualStochHistory[alert.symbol].length > 50) {
      dualStochHistory[alert.symbol] = dualStochHistory[alert.symbol].slice(-50)
    }
    
    // Check for Big Trend Day: D1 or D2 hits below 10 or above 90
    const today = getCurrentDateString()
    const d1Value = parseFloat(alert.d1) || 0
    const d2Value = parseFloat(alert.d2) || 0
    const isBigTrendDay = d1Value < 10 || d1Value > 90 || d2Value < 10 || d2Value > 90
    
    if (isBigTrendDay) {
      if (!bigTrendDay[alert.symbol]) {
        bigTrendDay[alert.symbol] = {}
      }
      // Mark this trading day as Big Trend Day
      if (!bigTrendDay[alert.symbol][today] || !bigTrendDay[alert.symbol][today].isBigTrendDay) {
        bigTrendDay[alert.symbol][today] = {
          isBigTrendDay: true,
          timestamp: timestamp,
          d1Value: d1Value,
          d2Value: d2Value
        }
        console.log(`📊 Big Trend Day detected for ${alert.symbol} on ${today}: D1=${d1Value.toFixed(2)}, D2=${d2Value.toFixed(2)}`)
      }
    }
    console.log(`✅ Dual Stoch data stored for ${alert.symbol}: D1=${alert.d1}, D2=${alert.d2}, HLT=${alert.highLevelTrendType || 'None'}, Chg%=${alert.changeFromPrevDay || 'N/A'}, Vol=${alert.volume || 'N/A'}`)
    
    // Update existing alert if it exists, or create new one if it doesn't
    const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
    if (existingIndex !== -1) {
      alerts[existingIndex].dualStochD1 = alert.d1
      alerts[existingIndex].dualStochD1Direction = alert.d1Direction
      alerts[existingIndex].dualStochD1Pattern = alert.d1Pattern || ''
      alerts[existingIndex].dualStochD1PatternValue = alert.d1PatternValue || null
      alerts[existingIndex].dualStochD2 = alert.d2
      alerts[existingIndex].dualStochD2Direction = alert.d2Direction || 'flat'
      alerts[existingIndex].dualStochHighLevelTrend = alert.highLevelTrend || false
      alerts[existingIndex].dualStochHighLevelTrendType = alert.highLevelTrendType || 'None'
      alerts[existingIndex].dualStochHighLevelTrendDiff = alert.highLevelTrendDiff || 0
      if (alert.price) alerts[existingIndex].price = alert.price
      if (alert.previousClose !== undefined) alerts[existingIndex].previousClose = alert.previousClose
      if (alert.changeFromPrevDay !== undefined) alerts[existingIndex].changeFromPrevDay = alert.changeFromPrevDay
      if (alert.volume !== undefined) alerts[existingIndex].volume = alert.volume
      alerts[existingIndex].receivedAt = Date.now()
      console.log(`✅ Updated existing alert for ${alert.symbol} with Dual Stoch data`)
    } else {
      // Create new alert entry if it doesn't exist
      const newAlert = {
        symbol: alert.symbol,
        timeframe: alert.timeframe || null,
        dualStochD1: alert.d1,
        dualStochD1Direction: alert.d1Direction,
        dualStochD1Pattern: alert.d1Pattern || '',
        dualStochD1PatternValue: alert.d1PatternValue || null,
        dualStochD2: alert.d2,
        dualStochD2Direction: alert.d2Direction || 'flat',
        dualStochHighLevelTrend: alert.highLevelTrend || false,
        dualStochHighLevelTrendType: alert.highLevelTrendType || 'None',
        dualStochHighLevelTrendDiff: alert.highLevelTrendDiff || 0,
        receivedAt: Date.now()
      }
      alerts.unshift(newAlert)
      console.log(`✅ Created new alert entry for ${alert.symbol} with Dual Stoch data`)
    }
  } else {
    // Main script alert (again.pine) - store ALL records, merge with any existing day data
    const alertData = { ...alert }
    
    // If this main script alert contains MACD crossing data, store it first
    if (alert.macdCrossingSignal) {
      macdCrossingData[alert.symbol] = {
        signal: alert.macdCrossingSignal,
        macd: alert.macd,
        macdSignal: alert.macdSignal,
        macdHistogram: alert.macdHistogram,
        timestamp: alert.macdCrossingTimestamp || Date.now()
      }
      console.log(`✅ Stored MACD crossing data for ${alert.symbol}: ${alert.macdCrossingSignal}`)
    }
    
    // Add day change data if available from Day script
    if (dayChangeData[alert.symbol] !== undefined) {
      alertData.changeFromPrevDay = dayChangeData[alert.symbol]
    }
    
    // Add volume data if available from Day script, but ONLY if main script didn't send volume
    // Main script's session_volume takes priority (it's the real-time cumulative daily volume)
    if (!alert.volume && dayVolumeData[alert.symbol] !== undefined) {
      alertData.volume = dayVolumeData[alert.symbol]
    }
    
    // Check and add VWAP crossing status if active (within last 5 minutes)
    const crossingInfo = vwapCrossingData[alert.symbol]
    if (crossingInfo && crossingInfo.crossed) {
      const ageInMinutes = (Date.now() - crossingInfo.timestamp) / 60000
      if (ageInMinutes <= 5) {
        // Crossing is recent (within 5 minutes), mark it
        alertData.vwapCrossing = true
      } else {
        // Crossing is old, expire it
        delete vwapCrossingData[alert.symbol]
        alertData.vwapCrossing = false
      }
    } else {
      alertData.vwapCrossing = false
    }
    
    // Check and add Quad Stochastic crossing status if active (within last 10 minutes)
    const quadStochInfo = quadStochData[alert.symbol]
    if (quadStochInfo && quadStochInfo.signal) {
      const ageInMinutes = (Date.now() - quadStochInfo.timestamp) / 60000
      if (ageInMinutes <= 10) {
        // Crossing is recent (within 10 minutes), mark it
        alertData.quadStochSignal = quadStochInfo.signal
        alertData.quadStochD1 = quadStochInfo.d1
        alertData.quadStochD2 = quadStochInfo.d2
        alertData.quadStochD4 = quadStochInfo.d4
      } else {
        // Crossing is old, expire it
        delete quadStochData[alert.symbol]
        alertData.quadStochSignal = null
      }
    } else {
      alertData.quadStochSignal = null
    }
    
    // Check and add Octo Stochastic data if active (within last 60 minutes) - PRIORITY
    const octoStochInfo = octoStochData[alert.symbol]
    if (octoStochInfo) {
      const ageInMinutes = (Date.now() - octoStochInfo.timestamp) / 60000
      if (ageInMinutes <= 60) {
        // Octo Stoch data is recent, use it (overrides Quad Stoch D4)
        alertData.octoStochD1 = octoStochInfo.d1
        alertData.octoStochD2 = octoStochInfo.d2
        alertData.octoStochD3 = octoStochInfo.d3
        alertData.octoStochD4 = octoStochInfo.d4
        alertData.octoStochD5 = octoStochInfo.d5
        alertData.octoStochD6 = octoStochInfo.d6
        alertData.octoStochD7 = octoStochInfo.d7
        alertData.octoStochD8 = octoStochInfo.d8
        alertData.d1Direction = octoStochInfo.d1Direction
        alertData.d2Direction = octoStochInfo.d2Direction
        alertData.d3Direction = octoStochInfo.d3Direction
        alertData.d4Direction = octoStochInfo.d4Direction
        alertData.d5Direction = octoStochInfo.d5Direction
        alertData.d6Direction = octoStochInfo.d6Direction
        alertData.d7Direction = octoStochInfo.d7Direction
        alertData.d8Direction = octoStochInfo.d8Direction
        alertData.d8Signal = octoStochInfo.d8Signal
        alertData.d1d2Cross = octoStochInfo.d1d2Cross
        alertData.d1CrossD7 = octoStochInfo.d1CrossD7
        alertData.d1SwitchedToUp = octoStochInfo.d1SwitchedToUp
        alertData.d1SwitchedToDown = octoStochInfo.d1SwitchedToDown
        alertData.d7SwitchedToUp = octoStochInfo.d7SwitchedToUp
        alertData.d7SwitchedToDown = octoStochInfo.d7SwitchedToDown
        alertData.patternType = octoStochInfo.patternType || null
        alertData.patternValue = octoStochInfo.patternValue ?? null
        alertData.patternStartTime = octoStochInfo.patternStartTime || null
        alertData.patternCount = octoStochInfo.patternCount || 0
        alertData.patternTrendBreak = octoStochInfo.patternTrendBreak || false
        alertData.d3BelowLastHL = octoStochInfo.d3BelowLastHL || false
        alertData.d3AboveLastLH = octoStochInfo.d3AboveLastLH || false
        alertData.d3BelowLastD7HL = octoStochInfo.d3BelowLastD7HL || false
        alertData.d3AboveLastD7LH = octoStochInfo.d3AboveLastD7LH || false
        alertData.d3AbovePredictedLH = octoStochInfo.d3AbovePredictedLH || false
        alertData.d7AbovePredictedLH = octoStochInfo.d7AbovePredictedLH || false
        alertData.d3PredictedThirdLH = octoStochInfo.d3PredictedThirdLH || null
        alertData.d7PredictedThirdLH = octoStochInfo.d7PredictedThirdLH || null
        alertData.calculatedTrend = octoStochInfo.calculatedTrend || null
        alertData.ttsMessage = octoStochInfo.ttsMessage || null
        alertData.timeframe1_4 = octoStochInfo.timeframe1_4
        alertData.timeframe5_8 = octoStochInfo.timeframe5_8
        console.log(`✅ Merged Octo Stoch data for ${alert.symbol}: D1=${octoStochInfo.d1}, D7=${octoStochInfo.d7}, D1xD7=${octoStochInfo.d1CrossD7 || 'none'} (age: ${ageInMinutes.toFixed(1)} min)`)
      } else {
        // Data is old, expire it
        delete octoStochData[alert.symbol]
        console.log(`⏰ Octo Stoch data expired for ${alert.symbol} (age: ${ageInMinutes.toFixed(1)} min)`)
      }
    }
    // FALLBACK: Check and add Quad Stochastic D4 trend status if active (within last 60 minutes) and no Octo data
    else {
      const quadStochD4Info = quadStochD4Data[alert.symbol]
      if (quadStochD4Info && quadStochD4Info.signal) {
        const ageInMinutes = (Date.now() - quadStochD4Info.timestamp) / 60000
        if (ageInMinutes <= 60) {
          // D4 signal is recent (within 30 minutes), mark it
          alertData.quadStochD4Signal = quadStochD4Info.signal
          alertData.quadStochD1 = quadStochD4Info.d1
          alertData.quadStochD2 = quadStochD4Info.d2
          alertData.quadStochD3 = quadStochD4Info.d3
          alertData.quadStochD4 = quadStochD4Info.d4
          alertData.d1Direction = quadStochD4Info.d1Direction
          alertData.d2Direction = quadStochD4Info.d2Direction
          alertData.d3Direction = quadStochD4Info.d3Direction
          alertData.d4Direction = quadStochD4Info.d4Direction
          alertData.qsD4Changed = quadStochD4Info.d4Changed
          alertData.qsDirectionChanged = quadStochD4Info.directionChanged
          alertData.qsChangeDirection = quadStochD4Info.changeDirection
          alertData.qsArrowChangeDirection = quadStochD4Info.arrowChangeDirection
          alertData.qsChangeTimestamp = quadStochD4Info.changeTimestamp
          alertData.d2SwitchedToDown = quadStochD4Info.d2SwitchedToDown
          alertData.d3SwitchedToUp = quadStochD4Info.d3SwitchedToUp
          alertData.d3SwitchedToDown = quadStochD4Info.d3SwitchedToDown
          alertData.d1CrossedUnder75 = quadStochD4Info.d1CrossedUnder75
          alertData.d2CrossedUnder75 = quadStochD4Info.d2CrossedUnder75
          alertData.d1CrossedAbove50 = quadStochD4Info.d1CrossedAbove50
          alertData.d2CrossedAbove50 = quadStochD4Info.d2CrossedAbove50
          alertData.d4CrossedAbove25 = quadStochD4Info.d4CrossedAbove25
          console.log(`✅ Merged D4 signal for ${alert.symbol}: ${quadStochD4Info.signal}, D4: ${quadStochD4Info.d4} (age: ${ageInMinutes.toFixed(1)} min)`)
        } else {
          // Signal is old, expire it
          delete quadStochD4Data[alert.symbol]
          alertData.quadStochD4Signal = null
          console.log(`⏰ D4 signal expired for ${alert.symbol} (age: ${ageInMinutes.toFixed(1)} min)`)
        }
      } else {
        alertData.quadStochD4Signal = null
      }
    }
    
    // Ensure pattern info is attached even if latest alert didn't include it
    const storedPattern = patternData[alert.symbol]
    if (storedPattern) {
      if (!alertData.patternType) {
        alertData.patternType = storedPattern.type
      }
      if (alertData.patternValue === undefined || alertData.patternValue === null) {
        alertData.patternValue = storedPattern.lastValue ?? null
      }
      if (!alertData.patternStartTime && storedPattern.startTime) {
        alertData.patternStartTime = storedPattern.startTime
      }
      if (!alertData.patternCount || alertData.patternCount === 0) {
        alertData.patternCount = storedPattern.count || 0
      }
      if (alertData.patternTrendBreak === undefined || alertData.patternTrendBreak === null) {
        alertData.patternTrendBreak = storedPattern.trendBreak || false
      }
    } else {
      // Default when no pattern data is available
      alertData.patternType = alertData.patternType || null
      alertData.patternValue = alertData.patternValue ?? null
      alertData.patternStartTime = alertData.patternStartTime || null
      alertData.patternCount = alertData.patternCount || 0
      alertData.patternTrendBreak = alertData.patternTrendBreak || false
    }
    
    // Check and add MACD crossing status if active (within last 15 minutes)
    const macdCrossingInfo = macdCrossingData[alert.symbol]
    if (macdCrossingInfo && macdCrossingInfo.signal) {
      const ageInMinutes = (Date.now() - macdCrossingInfo.timestamp) / 60000
      if (ageInMinutes <= 15) {
        // MACD crossing is recent (within 15 minutes), mark it
        alertData.macdCrossingSignal = macdCrossingInfo.signal
        alertData.macdCrossingTimestamp = macdCrossingInfo.timestamp
        if (macdCrossingInfo.macd !== undefined) alertData.macd = macdCrossingInfo.macd
        if (macdCrossingInfo.macdSignal !== undefined) alertData.macdSignal = macdCrossingInfo.macdSignal
        if (macdCrossingInfo.macdHistogram !== undefined) alertData.macdHistogram = macdCrossingInfo.macdHistogram
        console.log(`✅ Merged MACD crossing signal for ${alert.symbol}: ${macdCrossingInfo.signal} (age: ${ageInMinutes.toFixed(1)} min)`)
      } else {
        // Signal is old, expire it
        delete macdCrossingData[alert.symbol]
        alertData.macdCrossingSignal = null
        console.log(`⏰ MACD crossing signal expired for ${alert.symbol} (age: ${ageInMinutes.toFixed(1)} min)`)
      }
    } else {
      // If no stored MACD crossing data, check if this alert has MACD crossing data
      if (alert.macdCrossingSignal) {
        alertData.macdCrossingSignal = alert.macdCrossingSignal
        alertData.macdCrossingTimestamp = alert.macdCrossingTimestamp
        if (alert.macd !== undefined) alertData.macd = alert.macd
        if (alert.macdSignal !== undefined) alertData.macdSignal = alert.macdSignal
        if (alert.macdHistogram !== undefined) alertData.macdHistogram = alert.macdHistogram
        console.log(`✅ Using MACD crossing signal from alert for ${alert.symbol}: ${alert.macdCrossingSignal}`)
      } else {
        alertData.macdCrossingSignal = null
      }
    }
    
    // Check and add BJ TSI data if active (within last 60 minutes)
    const bjTsiInfo = bjTsiDataStorage[alert.symbol]
    if (bjTsiInfo) {
      const ageInMinutes = (Date.now() - bjTsiInfo.timestamp) / 60000
      if (ageInMinutes <= 60) {
        // BJ TSI data is recent (within 60 minutes), merge it
        // Use stored values (which already prioritize Pine script values)
        alertData.bjTsi = bjTsiInfo.bjTsi
        alertData.bjTsl = bjTsiInfo.bjTsl
        alertData.bjTsiIsBull = bjTsiInfo.bjTsiIsBull
        alertData.bjTslIsBull = bjTsiInfo.bjTslIsBull
        alertData.bjPremarketRangeUpper = bjTsiInfo.bjPremarketRangeUpper
        alertData.bjPremarketRangeLower = bjTsiInfo.bjPremarketRangeLower
        console.log(`✅ Merged BJ TSI data for ${alert.symbol}: TSI=${bjTsiInfo.bjTsi}, TSL=${bjTsiInfo.bjTsl}, PM Range=[${bjTsiInfo.bjPremarketRangeLower !== null ? bjTsiInfo.bjPremarketRangeLower.toFixed(3) : 'null'}, ${bjTsiInfo.bjPremarketRangeUpper !== null ? bjTsiInfo.bjPremarketRangeUpper.toFixed(3) : 'null'}] (age: ${ageInMinutes.toFixed(1)} min)`)
      } else {
        // Data is old, expire it
        delete bjTsiDataStorage[alert.symbol]
        console.log(`⏰ BJ TSI data expired for ${alert.symbol} (age: ${ageInMinutes.toFixed(1)} min)`)
      }
    } else {
      // If no stored BJ TSI data, check if this alert has BJ TSI data
      if (alert.bjTsi !== undefined) {
        const bjTsiValue = parseFloat(alert.bjTsi);
        
        // Track premarket range if TSI value is valid (as backup)
        if (!isNaN(bjTsiValue)) {
          updateBjPremarketRange(alert.symbol, bjTsiValue);
        }
        
        // Prioritize Pine script values if available (new field names: bjPremarketTsiHigh/Low)
        let pmUpper = null;
        let pmLower = null;
        
        // Check new field names first
        if (alert.bjPremarketTsiHigh !== null && 
            alert.bjPremarketTsiHigh !== undefined && 
            alert.bjPremarketTsiHigh !== '' && 
            alert.bjPremarketTsiHigh !== 'null' &&
            String(alert.bjPremarketTsiHigh).toLowerCase() !== 'null') {
          const highVal = parseFloat(alert.bjPremarketTsiHigh);
          if (!isNaN(highVal)) pmUpper = highVal;
        }
        if (alert.bjPremarketTsiLow !== null && 
            alert.bjPremarketTsiLow !== undefined && 
            alert.bjPremarketTsiLow !== '' && 
            alert.bjPremarketTsiLow !== 'null' &&
            String(alert.bjPremarketTsiLow).toLowerCase() !== 'null') {
          const lowVal = parseFloat(alert.bjPremarketTsiLow);
          if (!isNaN(lowVal)) pmLower = lowVal;
        }
        
        // Legacy support: fallback to old field names
        if (pmUpper === null && alert.bjPremarketRangeUpper !== null && 
            alert.bjPremarketRangeUpper !== undefined && 
            alert.bjPremarketRangeUpper !== '' && 
            alert.bjPremarketRangeUpper !== 'null') {
          const upperVal = parseFloat(alert.bjPremarketRangeUpper);
          if (!isNaN(upperVal)) pmUpper = upperVal;
        }
        if (pmLower === null && alert.bjPremarketRangeLower !== null && 
            alert.bjPremarketRangeLower !== undefined && 
            alert.bjPremarketRangeLower !== '' && 
            alert.bjPremarketRangeLower !== 'null') {
          const lowerVal = parseFloat(alert.bjPremarketRangeLower);
          if (!isNaN(lowerVal)) pmLower = lowerVal;
        }
        
        // Fallback to backend calculated range if Pine script values not available
        if (pmUpper === null || pmLower === null) {
          const pmRange = getBjPremarketRange(alert.symbol);
          if (pmUpper === null) pmUpper = pmRange.upper;
          if (pmLower === null) pmLower = pmRange.lower;
        }
        
        alertData.bjTsi = alert.bjTsi
        alertData.bjTsl = alert.bjTsl
        alertData.bjTsiIsBull = alert.bjTsiIsBull === true || alert.bjTsiIsBull === 'true'
        alertData.bjTslIsBull = alert.bjTslIsBull === true || alert.bjTslIsBull === 'true'
        alertData.bjPremarketRangeUpper = pmUpper
        alertData.bjPremarketRangeLower = pmLower
        console.log(`✅ Using BJ TSI data from alert for ${alert.symbol}: TSI=${alert.bjTsi}, PM Range=[${pmLower !== null ? pmLower.toFixed(3) : 'null'}, ${pmUpper !== null ? pmUpper.toFixed(3) : 'null'}]`)
      }
    }
    
    // Check and add Solo Stoch data if active (within last 60 minutes)
    const soloStochInfo = soloStochDataStorage[alert.symbol]
    if (soloStochInfo) {
      const ageInMinutes = (Date.now() - soloStochInfo.timestamp) / 60000
      if (ageInMinutes <= 60) {
        // Solo Stoch data is recent (within 60 minutes), merge it
        alertData.soloStochD2 = soloStochInfo.d2
        alertData.soloStochD2Direction = soloStochInfo.d2Direction
        alertData.soloStochD2Pattern = soloStochInfo.d2Pattern
        alertData.soloStochD2PatternValue = soloStochInfo.d2PatternValue
        // Also merge day data from Solo Stoch if not already set
        if (soloStochInfo.previousClose !== undefined && soloStochInfo.previousClose !== null && alertData.previousClose === undefined) {
          alertData.previousClose = soloStochInfo.previousClose
        }
        if (soloStochInfo.changeFromPrevDay !== undefined && soloStochInfo.changeFromPrevDay !== null && alertData.changeFromPrevDay === undefined) {
          alertData.changeFromPrevDay = soloStochInfo.changeFromPrevDay
        }
        if (soloStochInfo.volume !== undefined && soloStochInfo.volume !== null && alertData.volume === undefined) {
          alertData.volume = soloStochInfo.volume
        }
        console.log(`✅ Merged Solo Stoch data for ${alert.symbol}: D2=${soloStochInfo.d2}, Dir=${soloStochInfo.d2Direction}, Chg%=${soloStochInfo.changeFromPrevDay || 'N/A'} (age: ${ageInMinutes.toFixed(1)} min)`)
      } else {
        // Data is old, expire it
        delete soloStochDataStorage[alert.symbol]
        console.log(`⏰ Solo Stoch data expired for ${alert.symbol} (age: ${ageInMinutes.toFixed(1)} min)`)
      }
    }
    
    // Merge Dual Stoch data if available
    const dualStochInfo = dualStochDataStorage[alert.symbol]
    if (dualStochInfo) {
      const ageInMinutes = (Date.now() - dualStochInfo.timestamp) / 60000
      if (ageInMinutes <= 60) {
        // Dual Stoch data is recent (within 60 minutes), merge it
        alertData.dualStochD1 = dualStochInfo.d1
        alertData.dualStochD1Direction = dualStochInfo.d1Direction
        alertData.dualStochD1Pattern = dualStochInfo.d1Pattern
        alertData.dualStochD1PatternValue = dualStochInfo.d1PatternValue
        alertData.dualStochD2 = dualStochInfo.d2
        alertData.dualStochD2Direction = dualStochInfo.d2Direction
        alertData.dualStochHighLevelTrend = dualStochInfo.highLevelTrend
        alertData.dualStochHighLevelTrendType = dualStochInfo.highLevelTrendType
        alertData.dualStochHighLevelTrendDiff = dualStochInfo.highLevelTrendDiff
        // Add Big Trend Day status
        const today = getCurrentDateString()
        alertData.isBigTrendDay = (bigTrendDay[alert.symbol] && bigTrendDay[alert.symbol][today] && bigTrendDay[alert.symbol][today].isBigTrendDay) || false
        
        // Generate mini chart SVG on server side
        let miniChartSvg = ''
        const history = dualStochHistory[alert.symbol] || []
        if (history.length > 1 && dualStochInfo.d1 !== null && dualStochInfo.d2 !== null) {
          const chartWidth = 120
          const chartHeight = 40
          const padding = 2
          const plotWidth = chartWidth - padding * 2
          const plotHeight = chartHeight - padding * 2
          
          // Find min/max values for scaling
          let minVal = 100
          let maxVal = 0
          history.forEach(point => {
            minVal = Math.min(minVal, point.d1, point.d2)
            maxVal = Math.max(maxVal, point.d1, point.d2)
          })
          // Add some padding to the range
          const range = maxVal - minVal || 1
          minVal = Math.max(0, minVal - range * 0.1)
          maxVal = Math.min(100, maxVal + range * 0.1)
          const scale = (maxVal - minVal) || 1
          
          // Generate path for D1 (green) and D2 (blue)
          let d1Path = ''
          let d2Path = ''
          history.forEach((point, index) => {
            const x = padding + (index / (history.length - 1)) * plotWidth
            const y1 = padding + plotHeight - ((point.d1 - minVal) / scale) * plotHeight
            const y2 = padding + plotHeight - ((point.d2 - minVal) / scale) * plotHeight
            
            if (index === 0) {
              d1Path += 'M ' + x + ' ' + y1
              d2Path += 'M ' + x + ' ' + y2
            } else {
              d1Path += ' L ' + x + ' ' + y1
              d2Path += ' L ' + x + ' ' + y2
            }
          })
          
          // Add reference lines at 20, 50, 80
          const y20 = padding + plotHeight - ((20 - minVal) / scale) * plotHeight
          const y50 = padding + plotHeight - ((50 - minVal) / scale) * plotHeight
          const y80 = padding + plotHeight - ((80 - minVal) / scale) * plotHeight
          
          miniChartSvg = '<svg width="' + chartWidth + '" height="' + chartHeight + '" style="display: block;">' +
            '<!-- Reference lines -->' +
            '<line x1="' + padding + '" y1="' + y20 + '" x2="' + (chartWidth - padding) + '" y2="' + y20 + '" stroke="#666" stroke-width="0.5" opacity="0.3"/>' +
            '<line x1="' + padding + '" y1="' + y50 + '" x2="' + (chartWidth - padding) + '" y2="' + y50 + '" stroke="#666" stroke-width="0.5" opacity="0.2"/>' +
            '<line x1="' + padding + '" y1="' + y80 + '" x2="' + (chartWidth - padding) + '" y2="' + y80 + '" stroke="#666" stroke-width="0.5" opacity="0.3"/>' +
            '<!-- D2 line (blue) -->' +
            '<path d="' + d2Path + '" stroke="#0088ff" stroke-width="1.5" fill="none"/>' +
            '<!-- D1 line (green) -->' +
            '<path d="' + d1Path + '" stroke="#00ff00" stroke-width="1.5" fill="none"/>' +
            '</svg>'
        }
        alertData.dualStochMiniChart = miniChartSvg
        // Also merge day data from Dual Stoch if not already set
        if (dualStochInfo.previousClose !== undefined && dualStochInfo.previousClose !== null && alertData.previousClose === undefined) {
          alertData.previousClose = dualStochInfo.previousClose
        }
        if (dualStochInfo.changeFromPrevDay !== undefined && dualStochInfo.changeFromPrevDay !== null && alertData.changeFromPrevDay === undefined) {
          alertData.changeFromPrevDay = dualStochInfo.changeFromPrevDay
        }
        if (dualStochInfo.volume !== undefined && dualStochInfo.volume !== null && alertData.volume === undefined) {
          alertData.volume = dualStochInfo.volume
        }
        console.log(`✅ Merged Dual Stoch data for ${alert.symbol}: D1=${dualStochInfo.d1}, D2=${dualStochInfo.d2}, HLT=${dualStochInfo.highLevelTrendType} (age: ${ageInMinutes.toFixed(1)} min)`)
      } else {
        // Data is old, expire it
        delete dualStochDataStorage[alert.symbol]
        console.log(`⏰ Dual Stoch data expired for ${alert.symbol} (age: ${ageInMinutes.toFixed(1)} min)`)
      }
    }
    
    // Track previous price for color comparison
    const currentPrice = parseFloat(alert.price)
    const prevPrice = previousPrices[alert.symbol]
    if (prevPrice !== undefined && !isNaN(currentPrice)) {
      alertData.priceDirection = currentPrice > prevPrice ? 'up' : currentPrice < prevPrice ? 'down' : 'unchanged'
    }
    
    // Store current price as previous for next webhook
    if (!isNaN(currentPrice)) {
      previousPrices[alert.symbol] = currentPrice
    }
    
    // Add ALL alerts to the front (don't remove existing ones)
    alerts.unshift({
      ...alertData,
      receivedAt: Date.now()
    })
    
    // Keep alerts within reasonable limit (increase to 5000 for more history)
    if (alerts.length > 5000) {
      alerts = alerts.slice(0, 5000)
    }
  }
  
  // Keep only latest 10000 entries in history (prevent memory issues)
  alertsHistory = alertsHistory.slice(0, 10000)
  
  // Broadcast real-time update to connected clients
  broadcastUpdate('alert_received', {
    symbol: alert.symbol,
    alertType: isDayChangeAlert ? 'day_change' : 
               isVwapCrossingAlert ? 'vwap_crossing' :
               isQuadStochAlert ? 'quad_stoch' :
               isQuadStochD4Alert ? 'quad_stoch_d4' :
               isOctoStochAlert ? 'octo_stoch' :
               isMacdCrossingAlert ? 'macd_crossing' :
               isBjTsiAlert ? 'bj_tsi' :
               isSoloStochAlert ? 'solo_stoch' : 
               isDualStochAlert ? 'dual_stoch' : 'main_script',
    timestamp: Date.now()
  })
  
  res.json({ status: 'ok' })
})

// API for frontend - only latest alerts per symbol
app.get('/alerts', (req, res) => {
  // Get only the latest alert per symbol
  const latestAlerts = {}
  
  // Go through alerts and keep only the most recent for each symbol
  alerts.forEach(alert => {
    if (!alert.symbol) return
    
    if (!latestAlerts[alert.symbol] || 
        (alert.receivedAt > latestAlerts[alert.symbol].receivedAt)) {
      latestAlerts[alert.symbol] = alert
    }
  })
  
  // Convert to array and sort by receivedAt (newest first)
  const result = Object.values(latestAlerts).sort((a, b) => b.receivedAt - a.receivedAt)
  
  res.json(result)
})

// API for historical data - all alerts
app.get('/alerts/history', (req, res) => {
  res.json(alertsHistory)
})

// Debug endpoint - check what data is stored
app.get('/debug', (req, res) => {
  res.json({
    alertsCount: alerts.length,
    historyCount: alertsHistory.length,
    latestAlerts: alerts.slice(0, 5),
    quadStochD4Data: quadStochD4Data,
    octoStochData: octoStochData,
    quadStochData: quadStochData,
    vwapCrossingData: vwapCrossingData,
    macdCrossingData: macdCrossingData,
    dayChangeData: dayChangeData
  })
})

// New endpoint to reset/clear all alerts
app.post('/reset-alerts', (req, res) => {
  alerts = []
  alertsHistory = []
  dayChangeData = {}
  dayVolumeData = {}
  vwapCrossingData = {}
  quadStochData = {}
  quadStochD4Data = {}
  octoStochData = {}
  previousQSValues = {}
  previousDirections = {}
  previousPrices = {}
  macdCrossingData = {}
  bjPremarketRange = {}
  bjTsiDataStorage = {}
  soloStochDataStorage = {}
  dualStochDataStorage = {}
  bigTrendDay = {}
  patternData = {}
  res.json({ status: 'ok', message: 'All alerts cleared' })
})

// Endpoint to sync starred symbols from frontend
app.post('/starred-symbols', (req, res) => {
  try {
    const { starred } = req.body
    if (starred && typeof starred === 'object') {
      starredSymbols = starred
      console.log(`⭐ Starred symbols updated:`, Object.keys(starredSymbols).filter(k => starredSymbols[k]))
      res.json({ status: 'ok', message: 'Starred symbols updated', count: Object.keys(starredSymbols).filter(k => starredSymbols[k]).length })
    } else {
      res.status(400).json({ status: 'error', message: 'Invalid starred symbols data' })
    }
  } catch (error) {
    console.error('Error updating starred symbols:', error)
    res.status(500).json({ status: 'error', message: error.message })
  }
})

// Endpoint to get notification settings
app.get('/notification-settings', (req, res) => {
  res.json({
    enabled: NOTIFICATION_CONFIG.enabled, // Global notification toggle
    email: {
      enabled: NOTIFICATION_CONFIG.email.enabled,
      to: NOTIFICATION_CONFIG.email.to,
      configured: !!emailTransporter
    },
    discord: {
      enabled: NOTIFICATION_CONFIG.discord.enabled,
      configured: !!NOTIFICATION_CONFIG.discord.webhookUrl,
      ttsEnabled: NOTIFICATION_CONFIG.discord.ttsEnabled
    },
    starredCount: Object.keys(starredSymbols).filter(k => starredSymbols[k]).length
  })
})

// Endpoint to update notification settings (runtime)
app.post('/notification-settings', (req, res) => {
  try {
    const { enabled, email, discord } = req.body
    
    // Update global notification toggle
    if (enabled !== undefined) {
      NOTIFICATION_CONFIG.enabled = enabled
      console.log(`🔔 Global notifications ${enabled ? 'ENABLED' : 'DISABLED'}`)
    }
    
    if (email !== undefined) {
      if (email.enabled !== undefined) NOTIFICATION_CONFIG.email.enabled = email.enabled
      if (email.to) NOTIFICATION_CONFIG.email.to = email.to
      if (email.smtp) {
        Object.assign(NOTIFICATION_CONFIG.email.smtp, email.smtp)
        // Recreate transporter with new settings
        if (NOTIFICATION_CONFIG.email.enabled && NOTIFICATION_CONFIG.email.smtp.auth.user) {
          emailTransporter = nodemailer.createTransport(NOTIFICATION_CONFIG.email.smtp)
        }
      }
    }
    
    if (discord !== undefined) {
      if (discord.enabled !== undefined) NOTIFICATION_CONFIG.discord.enabled = discord.enabled
      if (discord.webhookUrl) NOTIFICATION_CONFIG.discord.webhookUrl = discord.webhookUrl
      if (discord.ttsEnabled !== undefined) NOTIFICATION_CONFIG.discord.ttsEnabled = discord.ttsEnabled
    }
    
    console.log('📬 Notification settings updated')
    res.json({ status: 'ok', message: 'Notification settings updated', enabled: NOTIFICATION_CONFIG.enabled })
  } catch (error) {
    console.error('Error updating notification settings:', error)
    res.status(500).json({ status: 'error', message: error.message })
  }
})

// Test endpoint to verify Discord notifications
app.post('/test-discord', async (req, res) => {
  try {
    const { symbol = 'TEST', oldTrend = 'Neutral', newTrend = 'Try Long', price = '100.00', d7Value = null } = req.body
    
    console.log(`🧪 Testing Discord notification for ${symbol}: ${oldTrend} → ${newTrend}, D7=${d7Value || 'N/A'}`)
    await sendDiscordNotification(symbol, oldTrend, newTrend, price, d7Value !== null ? parseFloat(d7Value) : null)
    
    res.json({ 
      status: 'ok', 
      message: 'Test notification sent to Discord',
      symbol,
      oldTrend,
      newTrend,
      d7Value
    })
  } catch (error) {
    console.error('Test notification error:', error)
    res.status(500).json({ status: 'error', message: error.message })
  }
})

// Server-Sent Events endpoint for real-time updates
let clients = []

app.get('/events', (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  })
  
  // Add client to list
  const clientId = Date.now()
  clients.push({ id: clientId, res })
  
  console.log(`📡 SSE client connected: ${clientId} (${clients.length} total clients)`)
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`)
  
  // Handle client disconnect
  req.on('close', () => {
    clients = clients.filter(client => client.id !== clientId)
    console.log(`📡 SSE client disconnected: ${clientId} (${clients.length} remaining)`)
  })
})

// Function to broadcast updates to all connected clients
function broadcastUpdate(updateType, data) {
  const message = JSON.stringify({ type: updateType, data, timestamp: Date.now() })
  
  clients.forEach(client => {
    try {
      client.res.write(`data: ${message}\n\n`)
    } catch (error) {
      console.log(`⚠️ Error sending SSE to client ${client.id}:`, error.message)
      // Remove disconnected client
      clients = clients.filter(c => c.id !== client.id)
    }
  })
  
  if (clients.length > 0) {
    console.log(`📡 Broadcasted ${updateType} update to ${clients.length} clients`)
  }
}

// Share Calculator Page
app.get('/calculator', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Share Calculator</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script>
        tailwind.config = {
          theme: {
            extend: {
              colors: {
                border: "hsl(217.2 32.6% 17.5%)",
                input: "hsl(217.2 32.6% 17.5%)",
                ring: "hsl(212.7 26.8% 83.9%)",
                background: "hsl(222.2 84% 4.9%)",
                foreground: "hsl(210 40% 98%)",
                primary: {
                  DEFAULT: "hsl(210 40% 98%)",
                  foreground: "hsl(222.2 47.4% 11.2%)",
                },
                secondary: {
                  DEFAULT: "hsl(217.2 32.6% 17.5%)",
                  foreground: "hsl(210 40% 98%)",
                },
                muted: {
                  DEFAULT: "hsl(217.2 32.6% 17.5%)",
                  foreground: "hsl(215 20.2% 65.1%)",
                },
                accent: {
                  DEFAULT: "hsl(217.2 32.6% 17.5%)",
                  foreground: "hsl(210 40% 98%)",
                },
                card: {
                  DEFAULT: "hsl(222.2 84% 4.9%)",
                  foreground: "hsl(210 40% 98%)",
                },
              }
            }
          }
        }
      </script>
    </head>
    <body class="bg-background min-h-screen py-8">
      <div class="container mx-auto max-w-4xl px-4">
        <!-- Navigation -->
        <div class="mb-6">
          <a href="/" class="text-blue-400 hover:text-blue-300 transition-colors">← Back to Dashboard</a>
        </div>

        <!-- Header -->
        <div class="mb-8">
          <h1 class="scroll-m-20 text-4xl font-extrabold tracking-tight text-foreground mb-2">Share Calculator</h1>
          <p class="text-muted-foreground">Calculate position sizing based on portfolio allocation</p>
        </div>

        <!-- Calculator Inputs (Sticky) -->
        <div id="stickyContainer" class="sticky top-0 z-20 bg-background pb-4">
          <div id="stickyCard" class="bg-card rounded-lg shadow-lg p-4 border border-border transition-all duration-300">
            <div class="flex flex-row gap-2">
              <!-- Portfolio Value with Currency Toggle -->
              <div class="flex-[0.5]">
                <label class="block text-xs font-medium text-muted-foreground mb-1">
                  Portfolio Value
                </label>
                <div class="flex gap-1">
                  <input 
                    type="number" 
                    id="portfolioValue" 
                    placeholder="180000"
                    class="flex-1 px-2 py-2 bg-secondary border border-border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-sm"
                    oninput="calculate()"
                    value="180000"
                  />
                  <select 
                    id="currency" 
                    class="px-2 py-2 bg-secondary border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm"
                    onchange="calculate()"
                  >
                    <option value="USD">USD</option>
                    <option value="HKD" selected>HKD</option>
                  </select>
                </div>
              </div>

              <!-- Share Price (Always USD) -->
              <div class="flex-[1.5]">
                <label class="block text-xs font-medium text-muted-foreground mb-1">
                  Share $US
                </label>
                <input 
                  type="number" 
                  id="sharePrice" 
                  placeholder="50"
                  step="0.01"
                  class="w-full px-2 py-2 bg-secondary border border-border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-sm"
                  oninput="calculate()"
                  value="50"
                />
              </div>
            </div>
            
            <!-- Quick Select Buttons -->
            <div class="mt-2 flex flex-wrap gap-1">
              <button onclick="setStockPrice(1)" class="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 border border-border rounded text-foreground transition-colors">$1</button>
              <button onclick="setStockPrice(5)" class="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 border border-border rounded text-foreground transition-colors">$5</button>
              <button onclick="setStockPrice(10)" class="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 border border-border rounded text-foreground transition-colors">$10</button>
              <button onclick="setStockPrice(15)" class="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 border border-border rounded text-foreground transition-colors">$15</button>
              <button onclick="setStockPrice(20)" class="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 border border-border rounded text-foreground transition-colors">$20</button>
              <button onclick="setStockPrice(50)" class="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 border border-border rounded text-foreground transition-colors">$50</button>
              <button onclick="setStockPrice(80)" class="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 border border-border rounded text-foreground transition-colors">$80</button>
              <button onclick="setStockPrice(100)" class="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 border border-border rounded text-foreground transition-colors">$100</button>
            </div>
          </div>
        </div>

        <!-- Allocation Results -->
        <div class="bg-card rounded-lg shadow-lg p-4 border border-border mb-4 mt-4">
          <div id="allocationList" class="space-y-2">
            <!-- Results will be populated here -->
          </div>
        </div>

        <!-- % Cheatsheet -->
        <div class="bg-card rounded-lg shadow-lg p-4 border border-border mb-4">
          <h3 class="text-lg font-semibold text-foreground mb-3">% Cheatsheet</h3>
          <p class="text-xs text-muted-foreground mb-3">Required shares to earn target profit from price moves</p>
          
          <!-- Custom Calculator -->
          <div class="bg-secondary/50 rounded-lg p-3 mb-4 border border-border">
            <div class="flex flex-wrap items-end gap-2">
              <div class="flex-1 min-w-[120px]">
                <label class="block text-xs font-medium text-muted-foreground mb-1">Target Profit <span id="customProfitCurrency">(USD)</span></label>
                <input 
                  type="number" 
                  id="customProfit" 
                  placeholder="1000"
                  class="w-full px-2 py-1.5 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  oninput="calculateCustom()"
                />
              </div>
              <div class="flex-1 min-w-[100px]">
                <label class="block text-xs font-medium text-muted-foreground mb-1">% Move</label>
                <input 
                  type="number" 
                  id="customPercent" 
                  placeholder="15"
                  step="0.1"
                  class="w-full px-2 py-1.5 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  oninput="calculateCustom()"
                />
              </div>
              <div class="flex-1 min-w-[120px]">
                <label class="block text-xs font-medium text-muted-foreground mb-1">Shares Needed</label>
                <div id="customResult" class="px-2 py-1.5 bg-blue-500/10 border border-blue-500/30 rounded text-blue-400 font-semibold text-sm text-center">
                  -
                </div>
              </div>
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-sm" id="cheatsheetTable">
              <thead>
                <tr class="border-b border-border">
                  <th class="sticky left-0 bg-card z-10 text-left py-2 px-2 text-muted-foreground">Target Profit <span id="profitCurrency" class="text-xs">(USD)</span></th>
                  <th class="text-center py-2 px-2 text-muted-foreground">1%</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">2%</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">5%</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">10%</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">15%</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">20%</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">30%</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">50%</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">75%</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">100%</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">150%</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">200%</th>
                </tr>
              </thead>
              <tbody id="cheatsheetBody">
                <!-- Will be populated by JavaScript -->
              </tbody>
            </table>
          </div>
        </div>

        <!-- Formula Reference -->
        <div class="mt-4 bg-card rounded-lg shadow p-3 border border-border">
          <div class="text-xs text-muted-foreground">
            💡 Shares are rounded to nice numbers (10, 50, 100, 500, 1000). Actual % may differ slightly.
            <br>
            📊 Cheatsheet formula: Required Shares = Target Profit (in USD) ÷ (Stock Price × Move %)
            <br>
            💱 Exchange rate: 7.8 HKD = 1 USD (HKD automatically converted for calculations)
          </div>
        </div>
      </div>

      <script>
        function roundToNice(num) {
          if (num === 0) return 0;
          
          // For very small numbers (< 10), round to nearest 10
          if (num < 10) {
            return Math.ceil(num / 10) * 10;
          }
          // For small numbers (10-99), round to nearest 10
          else if (num < 100) {
            return Math.round(num / 10) * 10;
          }
          // For medium-small numbers (100-499), round to nearest 50
          else if (num < 500) {
            return Math.round(num / 50) * 50;
          }
          // For medium numbers (500-999), round to nearest 100
          else if (num < 1000) {
            return Math.round(num / 100) * 100;
          }
          // For large numbers (1000-4999), round to nearest 500
          else if (num < 5000) {
            return Math.round(num / 500) * 500;
          }
          // For very large numbers (5000+), round to nearest 1000
          else {
            return Math.round(num / 1000) * 1000;
          }
        }

        function setStockPrice(price) {
          document.getElementById('sharePrice').value = price;
          calculate();
        }

        function calculate() {
          const portfolioValueInput = parseFloat(document.getElementById('portfolioValue').value) || 0;
          const currency = document.getElementById('currency').value;
          const sharePrice = parseFloat(document.getElementById('sharePrice').value) || 0;
          const allocationList = document.getElementById('allocationList');
          const cheatsheetBody = document.getElementById('cheatsheetBody');
          
          // Convert HKD to USD if needed (approximate rate: 7.8 HKD = 1 USD)
          const HKD_TO_USD = 7.8;
          const portfolioValue = currency === 'HKD' ? portfolioValueInput / HKD_TO_USD : portfolioValueInput;

          if (!portfolioValue || !sharePrice || portfolioValue <= 0 || sharePrice <= 0) {
            allocationList.innerHTML = '<div class="text-center text-muted-foreground py-8">Enter portfolio value and stock price</div>';
            cheatsheetBody.innerHTML = '<tr><td colspan="13" class="text-center text-muted-foreground py-4">Enter stock price to see cheatsheet</td></tr>';
            return;
          }

          // Allocation breakdown
          const allocations = [10, 20, 30, 40, 50];
          
          allocationList.innerHTML = allocations.map(percent => {
            const positionSize = portfolioValue * (percent / 100);
            const exactShares = positionSize / sharePrice;
            const numShares = roundToNice(exactShares);
            const actualCost = numShares * sharePrice;
            const actualPercent = portfolioValue > 0 ? (actualCost / portfolioValue) * 100 : 0;
            
            // Convert display cost to selected currency
            const displayCost = currency === 'HKD' ? actualCost * HKD_TO_USD : actualCost;
            const currencySymbol = currency === 'HKD' ? 'HK$' : '$';

            return \`
              <div class="flex items-center justify-between p-3 bg-secondary rounded border border-border hover:border-blue-500 transition-colors">
                <div class="flex items-baseline gap-2">
                  <span class="text-2xl font-bold text-blue-400">\${numShares.toLocaleString()}</span>
                  <span class="text-sm text-muted-foreground">shares</span>
                  <span class="text-lg font-semibold text-foreground">= \${percent}%</span>
                </div>
                <div class="text-right">
                  <div class="text-base font-semibold text-green-400">\${currencySymbol}\${displayCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                  <div class="text-xs text-muted-foreground">(\${actualPercent.toFixed(2)}%)</div>
                </div>
              </div>
            \`;
          }).join('');
          
          // % Cheatsheet - calculate required shares for different profit targets and % moves
          // Adjust profit targets based on currency
          const profitTargetsUSD = [100, 250, 500, 1000, 2500, 5000];
          const profitTargetsHKD = [1000, 2000, 4000, 8000, 20000, 40000];
          
          const profitTargets = currency === 'HKD' ? profitTargetsHKD : profitTargetsUSD;
          const currencySymbol = currency === 'HKD' ? 'HK$' : '$';
          
          // Update currency label in table header
          document.getElementById('profitCurrency').textContent = \`(\${currency})\`;
          document.getElementById('customProfitCurrency').textContent = \`(\${currency})\`;
          
          const percentMoves = [1, 2, 5, 10, 15, 20, 30, 50, 75, 100, 150, 200];
          
          cheatsheetBody.innerHTML = profitTargets.map(profit => {
            const cells = percentMoves.map(movePercent => {
              // Convert profit to USD if in HKD
              const profitUSD = currency === 'HKD' ? profit / HKD_TO_USD : profit;
              
              // Formula: Required Shares = Target Profit (USD) / (Stock Price × Move %)
              const profitPerShare = sharePrice * (movePercent / 100);
              const requiredShares = profitUSD / profitPerShare;
              const roundedShares = roundToNice(requiredShares);
              
              // Calculate cost and check if it exceeds 100% of capital
              const totalCost = roundedShares * sharePrice;
              const exceedsCapital = totalCost > portfolioValue;
              
              // Dim if exceeds capital
              const cellClass = exceedsCapital ? 'text-muted-foreground/50' : 'text-foreground font-semibold';
              const titleText = exceedsCapital ? \`Cost: $\${totalCost.toLocaleString()} (exceeds capital)\` : '';
              
              return \`<td class="text-center py-2 px-2 \${cellClass}" title="\${titleText}">\${roundedShares.toLocaleString()}</td>\`;
            }).join('');
            
            return \`
              <tr class="border-b border-border/50 hover:bg-secondary/30">
                <td class="sticky left-0 bg-card z-10 text-left py-2 px-2 text-green-400 font-semibold">\${currencySymbol}\${profit.toLocaleString()}</td>
                \${cells}
              </tr>
            \`;
          }).join('');
          
          // Update custom calculator too
          calculateCustom();
        }

        function calculateCustom() {
          const sharePrice = parseFloat(document.getElementById('sharePrice').value) || 0;
          const customProfit = parseFloat(document.getElementById('customProfit').value) || 0;
          const customPercent = parseFloat(document.getElementById('customPercent').value) || 0;
          const currency = document.getElementById('currency').value;
          const customResult = document.getElementById('customResult');
          
          if (!sharePrice || !customProfit || !customPercent || sharePrice <= 0 || customProfit <= 0 || customPercent <= 0) {
            customResult.textContent = '-';
            return;
          }
          
          // Convert HKD to USD if needed
          const HKD_TO_USD = 7.8;
          const profitUSD = currency === 'HKD' ? customProfit / HKD_TO_USD : customProfit;
          
          // Formula: Required Shares = Target Profit (USD) ÷ (Stock Price × Move %)
          const profitPerShare = sharePrice * (customPercent / 100);
          const requiredShares = profitUSD / profitPerShare;
          const roundedShares = roundToNice(requiredShares);
          
          customResult.textContent = roundedShares.toLocaleString();
        }

        // Detect when sticky is activated and remove border
        const stickyContainer = document.getElementById('stickyContainer');
        const stickyCard = document.getElementById('stickyCard');
        
        // Create a sentinel element before the sticky container
        const sentinel = document.createElement('div');
        sentinel.style.position = 'absolute';
        sentinel.style.top = '0';
        sentinel.style.height = '1px';
        stickyContainer.parentElement.insertBefore(sentinel, stickyContainer);
        
        const observer = new IntersectionObserver(
          ([entry]) => {
            if (!entry.isIntersecting) {
              // Sticky is active (scrolled past sentinel)
              stickyCard.classList.remove('border', 'border-border', 'rounded-lg');
              stickyCard.classList.add('border-b', 'border-border/50', 'rounded-none');
            } else {
              // Not sticky (at top of page)
              stickyCard.classList.remove('border-b', 'border-border/50', 'rounded-none');
              stickyCard.classList.add('border', 'border-border', 'rounded-lg');
            }
          },
          { threshold: [0], rootMargin: '-1px 0px 0px 0px' }
        );
        
        observer.observe(sentinel);

        // Calculate on page load
        calculate();
      </script>
    </body>
    </html>
  `)
})

// Render default homepage (可改)
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Alert Dashboard</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script>
        tailwind.config = {
          theme: {
            extend: {
              colors: {
                border: "hsl(217.2 32.6% 17.5%)",
                input: "hsl(217.2 32.6% 17.5%)",
                ring: "hsl(212.7 26.8% 83.9%)",
                background: "hsl(222.2 84% 4.9%)",
                foreground: "hsl(210 40% 98%)",
                primary: {
                  DEFAULT: "hsl(210 40% 98%)",
                  foreground: "hsl(222.2 47.4% 11.2%)",
                },
                secondary: {
                  DEFAULT: "hsl(217.2 32.6% 17.5%)",
                  foreground: "hsl(210 40% 98%)",
                },
                muted: {
                  DEFAULT: "hsl(217.2 32.6% 17.5%)",
                  foreground: "hsl(215 20.2% 65.1%)",
                },
                accent: {
                  DEFAULT: "hsl(217.2 32.6% 17.5%)",
                  foreground: "hsl(210 40% 98%)",
                },
                card: {
                  DEFAULT: "hsl(222.2 84% 4.9%)",
                  foreground: "hsl(210 40% 98%)",
                },
              }
            }
          }
        }
      </script>
      <style>
        @media (min-width: 1370px) {
          .container {
            max-width: 1360px;
          }
        }
        .mx-auto {
          margin: auto;
        }
        .p-4 {
          padding-bottom: 2rem;
        }
        .draggable-header {
          user-select: none;
          position: relative;
        }
        .draggable-header:hover {
          background-color: rgba(255, 255, 255, 0.05);
        }
        .draggable-header.dragging {
          opacity: 0.5;
          cursor: grabbing;
        }
        .draggable-header.drag-over {
          border-left: 2px solid #3b82f6;
        }
      </style>
    </head>
    <body class="bg-background min-h-screen pb-20 md:pb-0 md:pt-20">
      <div class="container mx-auto" style="max-width:1360px;">
        <div class="mb-8">
          <div class="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
            <div>
              <h1 class="scroll-m-20 text-4xl font-extrabold tracking-tight text-foreground mb-2">Trading Alert Dashboard</h1>
            </div>
            <div class="flex gap-3 items-center">
              <button id="notificationToggle" onclick="toggleNotifications()" class="inline-flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors shadow-lg">
                <span id="notificationIcon">🔔</span>
                <span id="notificationText">Notifications ON</span>
              </button>
              <a href="/calculator" class="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-lg">
                📊 Calculator
              </a>
            </div>
          </div>
        </div>
        
        <!-- Main content area: Filters on left, Table on right when width > 1280px -->
        <div class="flex flex-col xl:flex-row xl:gap-6 xl:items-start">
          <!-- Filters sidebar (left on xl, top on smaller screens) -->
          <div class="w-full xl:w-80 xl:flex-shrink-0 xl:sticky xl:top-4 xl:self-start">
            <!-- Search bar - sticky on top for desktop, bottom for mobile -->
            <div class="fixed md:sticky xl:static top-auto md:top-0 xl:top-auto bottom-0 md:bottom-auto xl:bottom-auto left-0 right-0 xl:left-auto xl:right-auto z-50 xl:z-auto bg-background border-t md:border-t-0 xl:border-t-0 md:border-b xl:border-b-0 border-border xl:border-r xl:pr-6 py-4 xl:py-0">
              <div class="container mx-auto xl:mx-0" style="max-width:1360px;padding-bottom:1rem;">
                <!-- Search input -->
                <div class="relative mb-3">
                  <input 
                    type="text" 
                    id="searchInput" 
                    placeholder="Search tickers..." 
                    class="w-full px-3 py-2 pr-10 bg-card border border-border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                    onkeyup="filterAlerts()"
                    oninput="toggleClearButton()"
                  />
                  <button 
                    id="clearButton" 
                    onclick="clearSearch()" 
                    class="absolute right-2 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors hidden"
                    aria-label="Clear search"
                  >
                    ✕
                  </button>
                </div>
                
                <!-- BJ TSI Filters -->
                <div class="flex flex-wrap gap-2 items-center text-xs mb-3">
                  <span class="text-muted-foreground font-medium">BJ Filters:</span>
              
              <!-- PM Range Filter -->
              <select 
                id="filterPmRange" 
                multiple
                size="1"
                class="px-2 py-1 bg-card border border-border rounded text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                onchange="filterAlerts()"
                title="Hold Ctrl/Cmd to select multiple"
              >
                <option value="Below">Below</option>
                <option value="Lower">Lower</option>
                <option value="Upper">Upper</option>
                <option value="Above">Above</option>
              </select>
              
              <!-- V Dir Filter -->
              <select 
                id="filterVDir" 
                multiple
                size="1"
                class="px-2 py-1 bg-card border border-border rounded text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                onchange="filterAlerts()"
                title="Hold Ctrl/Cmd to select multiple"
              >
                <option value="Up">Up</option>
                <option value="Down">Down</option>
              </select>
              
              <!-- S Dir Filter -->
              <select 
                id="filterSDir" 
                multiple
                size="1"
                class="px-2 py-1 bg-card border border-border rounded text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                onchange="filterAlerts()"
                title="Hold Ctrl/Cmd to select multiple"
              >
                <option value="Up">Up</option>
                <option value="Down">Down</option>
              </select>
              
              <!-- Area Filter -->
              <select 
                id="filterArea" 
                multiple
                size="1"
                class="px-2 py-1 bg-card border border-border rounded text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                onchange="filterAlerts()"
                title="Hold Ctrl/Cmd to select multiple"
              >
                <option value="strong_bullish">Strong Bullish</option>
                <option value="bullish">Bullish</option>
                <option value="light_bullish">Light Bullish</option>
                <option value="light_bearish">Light Bearish</option>
                <option value="bearish">Bearish</option>
                <option value="strong_bearish">Strong Bearish</option>
              </select>
              
                  <!-- Clear Filters Button -->
                  <button 
                    onclick="clearBjFilters()" 
                    class="px-2 py-1 bg-secondary hover:bg-secondary/80 border border-border rounded text-muted-foreground hover:text-foreground text-xs transition-colors"
                  >
                    Clear BJ Filters
                  </button>
                </div>
            
                <!-- Stoch Filters -->
                <div class="flex flex-wrap gap-2 items-center text-xs mb-3">
                  <span class="text-muted-foreground font-medium">Stoch Filters:</span>
                  
                  <!-- D1 Direction Filter -->
                  <select 
                    id="filterD1Direction" 
                    multiple
                    size="1"
                    class="px-2 py-1 bg-card border border-border rounded text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    onchange="filterAlerts()"
                    title="Hold Ctrl/Cmd to select multiple"
                  >
                    <option value="up">D1: Up</option>
                    <option value="down">D1: Down</option>
                    <option value="flat">D1: Flat</option>
                  </select>
                  
                  <!-- D1 Value Filter -->
                  <select 
                    id="filterD1Value" 
                    multiple
                    size="1"
                    class="px-2 py-1 bg-card border border-border rounded text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    onchange="filterAlerts()"
                    title="Hold Ctrl/Cmd to select multiple"
                  >
                    <option value="<10">&lt;10 (Extreme Oversold)</option>
                    <option value="10-20">10-20 (Oversold)</option>
                    <option value="20-50">20-50 (Lower Range)</option>
                    <option value="50-80">50-80 (Upper Range)</option>
                    <option value="80-90">80-90 (Overbought)</option>
                    <option value=">90">&gt;90 (Extreme Overbought)</option>
                  </select>
                  
                  <!-- D2 Direction Filter -->
                  <select 
                    id="filterD2Direction" 
                    multiple
                    size="1"
                    class="px-2 py-1 bg-card border border-border rounded text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    onchange="filterAlerts()"
                    title="Hold Ctrl/Cmd to select multiple"
                  >
                    <option value="up">D2: Up</option>
                    <option value="down">D2: Down</option>
                    <option value="flat">D2: Flat</option>
                  </select>
                  
                  <!-- D2 Value Filter -->
                  <select 
                    id="filterD2Value" 
                    multiple
                    size="1"
                    class="px-2 py-1 bg-card border border-border rounded text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    onchange="filterAlerts()"
                    title="Hold Ctrl/Cmd to select multiple"
                  >
                    <option value="<10">&lt;10 (Extreme Oversold)</option>
                    <option value="10-20">10-20 (Oversold)</option>
                    <option value="20-50">20-50 (Lower Range)</option>
                    <option value="50-80">50-80 (Upper Range)</option>
                    <option value="80-90">80-90 (Overbought)</option>
                    <option value=">90">&gt;90 (Extreme Overbought)</option>
                  </select>
                  
                  <!-- Trend Message Filter -->
                  <select 
                    id="filterTrendMessage" 
                    multiple
                    size="1"
                    class="px-2 py-1 bg-card border border-border rounded text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    onchange="filterAlerts()"
                    title="Hold Ctrl/Cmd to select multiple"
                  >
                    <option value="Do Not Long">Do Not Long</option>
                    <option value="Do Not Short">Do Not Short</option>
                    <option value="Try Long">Try Long</option>
                    <option value="Try Short">Try Short</option>
                    <option value="Big Trend Day">Big Trend Day</option>
                  </select>
                  
                  <!-- % Change Filter -->
                  <select 
                    id="filterPercentChange" 
                    multiple
                    size="1"
                    class="px-2 py-1 bg-card border border-border rounded text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    onchange="filterAlerts()"
                    title="Hold Ctrl/Cmd to select multiple"
                  >
                    <option value="<-5">&lt;-5% (Large Down)</option>
                    <option value="-5--2">-5% to -2% (Down)</option>
                    <option value="-2-0">-2% to 0% (Slight Down)</option>
                    <option value="0-2">0% to 2% (Slight Up)</option>
                    <option value="2-5">2% to 5% (Up)</option>
                    <option value=">5">&gt;5% (Large Up)</option>
                  </select>
                  
                  <!-- Clear Stoch Filters Button -->
                  <button 
                    onclick="clearStochFilters()" 
                    class="px-2 py-1 bg-secondary hover:bg-secondary/80 border border-border rounded text-muted-foreground hover:text-foreground text-xs transition-colors"
                  >
                    Clear Stoch Filters
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Table area (right on xl, below filters on smaller screens) -->
          <div class="w-full xl:flex-1 xl:min-w-0">
            <div class="bg-card rounded-lg shadow-sm">
              <div>
                <div class="overflow-x-auto">
                  <table class="w-full table-auto">
                    <thead id="tableHeader">
                      <tr class="border-b border-border">
                        <!-- Headers will be dynamically generated -->
                      </tr>
                    </thead>
                    <tbody id="alertTable">
                      <tr>
                        <td colspan="9" class="text-center text-muted-foreground py-12 relative">Loading alerts...</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="mt-6 text-center">
          <p class="text-sm text-muted-foreground" id="lastUpdate">Last updated: Never <span id="countdown"></span></p>
          <div class="mt-2 flex items-center justify-center gap-2">
            <div id="connectionStatus" class="flex items-center gap-1 text-xs">
              <div id="connectionIndicator" class="w-2 h-2 rounded-full bg-gray-500"></div>
              <span id="connectionText" class="text-muted-foreground">Connecting...</span>
            </div>
            <div id="realtimeIndicator" class="text-xs text-green-400 hidden">
              <span class="animate-pulse">🔄 Real-time updates active</span>
            </div>
          </div>
        </div>
      </div>

      <script>
        // Sorting state
        let currentSortField = 'symbol'; // Default to alphabetical sorting
        let currentSortDirection = 'asc';
        let alertsData = [];
        
        // Search state
        let searchTerm = '';
        
        // BJ TSI Filter state (arrays for multiple selections)
        let bjFilterPmRange = [];
        let bjFilterVDir = [];
        let bjFilterSDir = [];
        let bjFilterArea = [];
        
        // Stoch Filter state (arrays for multiple selections)
        let stochFilterD1Direction = [];
        let stochFilterD1Value = [];
        let stochFilterD2Direction = [];
        let stochFilterD2Value = [];
        let stochFilterTrendMessage = [];
        let stochFilterPercentChange = [];

        // Starred alerts - stored in localStorage
        let starredAlerts = JSON.parse(localStorage.getItem('starredAlerts')) || {};

        // Column order - stored in localStorage
        const defaultColumnOrder = ['star', 'symbol', 'price', 'd2', 'bj', 'volume'];
        let columnOrder = JSON.parse(localStorage.getItem('columnOrder')) || defaultColumnOrder;
        // Check if stored order has old columns - if so, reset to default
        const oldColumns = ['macdCrossing', 'vwap', 'ema1', 'ema2', 'macd', 'rsi', 'trend', 'pattern', 'qsArrow', 'd3value', 'd4value'];
        const hasOldColumns = columnOrder.some(colId => oldColumns.includes(colId));
        if (hasOldColumns) {
          console.log('🔄 Resetting column order due to old columns detected');
          columnOrder = defaultColumnOrder;
          localStorage.setItem('columnOrder', JSON.stringify(columnOrder));
        }
        // Ensure d2 column exists
        if (!columnOrder.includes('d2')) {
          const priceIndex = columnOrder.indexOf('price');
          if (priceIndex !== -1) {
            columnOrder.splice(priceIndex + 1, 0, 'd2');
          } else {
            columnOrder.push('d2');
          }
        }
        // Ensure bj column exists
        if (!columnOrder.includes('bj')) {
          const d2Index = columnOrder.indexOf('d2');
          if (d2Index !== -1) {
            columnOrder.splice(d2Index + 1, 0, 'bj');
          } else {
            columnOrder.push('bj');
          }
        }
        
        // Column definitions
        const columnDefs = {
          star: { id: 'star', title: '⭐', sortable: false, width: 'w-12' },
          symbol: { id: 'symbol', title: 'Ticker', sortable: true, sortField: 'symbol', width: 'w-auto' },
          price: { id: 'price', title: 'Price', sortable: true, sortField: 'price', width: '' },
          d2: { id: 'd2', title: 'Stoch', sortable: true, sortField: 'd2value', width: '', tooltip: 'Solo Stochastic D2 Value and Direction' },
          highLevelTrend: { id: 'highLevelTrend', title: 'HLT', sortable: true, sortField: 'highLevelTrend', width: '', tooltip: 'High Level Trend: Bull/Bear when D1 switches direction with large D1-D2 difference' },
          bj: { id: 'bj', title: 'BJ', sortable: true, sortField: 'bjValue', width: '', tooltip: 'BJ TSI: Value, PM Range, V Dir, S Dir, Area' },
          volume: { id: 'volume', title: 'Vol', sortable: true, sortField: 'volume', width: '', tooltip: 'Volume since 9:30 AM' }
        };

        // Countdown state
        let countdownSeconds = 120;
        let countdownInterval = null;

        function formatVolume(vol) {
          if (!vol || vol === 0) return 'N/A';
          if (vol >= 1000000) return (vol / 1000000).toFixed(1) + 'M';
          if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K';
          return vol.toString();
        }

        function sortTable(field) {
          if (currentSortField === field) {
            currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            currentSortField = field;
            currentSortDirection = 'asc';
          }
          
          updateSortIndicators();
          renderTable();
        }

        function updateSortIndicators() {
            // Reset all indicators
            const indicators = ['symbol', 'price', 'd2value', 'highLevelTrend', 'priceChange', 'volume', 'bjValue'];
          indicators.forEach(field => {
            const elem = document.getElementById('sort-' + field);
            if (elem) elem.textContent = '⇅';
          });
          
          // Set current sort indicator
          if (currentSortField) {
            const indicator = document.getElementById('sort-' + currentSortField);
            if (indicator) indicator.textContent = currentSortDirection === 'asc' ? '↑' : '↓';
          }
        }

        // Initialize sort indicators on page load
        document.addEventListener('DOMContentLoaded', function() {
          updateSortIndicators();
          renderTableHeaders();
          setupColumnDragAndDrop();
        });

        // Render table headers dynamically based on column order
        function renderTableHeaders() {
          const headerRow = document.querySelector('#tableHeader tr');
          if (!headerRow) return;
          
          headerRow.innerHTML = columnOrder.map(colId => {
            const col = columnDefs[colId];
            if (!col) return '';
            
            const sortableClass = col.sortable ? 'cursor-pointer hover:text-foreground transition-colors' : '';
            const sortField = col.sortField || col.id;
            const sortIndicator = col.sortable ? '<span id="sort-' + sortField + '" class="ml-1 text-xs">⇅</span>' : '';
            const tooltipAttr = col.tooltip ? 'title="' + col.tooltip + '"' : '';
            const paddingClass = colId === 'star' ? 'pl-4 pr-1' : colId === 'symbol' ? 'pl-1 pr-4' : 'px-4';
            const onclickAttr = col.sortable ? 'onclick="sortTable(\\'' + sortField + '\\')"' : '';
            const draggableAttr = colId !== 'star' ? 'true' : 'false';
            
            return '<th ' +
              'class="text-left py-3 ' + paddingClass + ' font-bold text-muted-foreground ' + col.width + ' ' + sortableClass + ' draggable-header" ' +
              'data-column-id="' + colId + '" ' +
              onclickAttr + ' ' +
              tooltipAttr + ' ' +
              'draggable="' + draggableAttr + '" ' +
              'ondragstart="handleHeaderDragStart(event)" ' +
              'ondragover="handleHeaderDragOver(event)" ' +
              'ondrop="handleHeaderDrop(event)" ' +
              'ondragend="handleHeaderDragEnd(event)"' +
              '>' +
              col.title + ' ' + sortIndicator +
              '</th>';
          }).join('');
          
          updateSortIndicators();
        }

        // Drag and drop handlers for column reordering
        let draggedColumnId = null;
        let draggedElement = null;

        function handleHeaderDragStart(e) {
          if (e.target.closest('.draggable-header')) {
            draggedElement = e.target.closest('.draggable-header');
            draggedColumnId = draggedElement.getAttribute('data-column-id');
            draggedElement.style.opacity = '0.5';
            draggedElement.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', draggedElement.innerHTML);
          }
        }

        function handleHeaderDragOver(e) {
          if (e.preventDefault) {
            e.preventDefault();
          }
          e.dataTransfer.dropEffect = 'move';
          
          const target = e.target.closest('.draggable-header');
          if (target && target !== draggedElement && draggedColumnId) {
            // Remove drag-over class from all headers
            document.querySelectorAll('.draggable-header').forEach(header => {
              header.classList.remove('drag-over');
            });
            // Add drag-over class to target
            target.classList.add('drag-over');
            
            const allHeaders = Array.from(document.querySelectorAll('.draggable-header'));
            const targetIndex = allHeaders.indexOf(target);
            const draggedIndex = allHeaders.indexOf(draggedElement);
            
            if (targetIndex < draggedIndex) {
              target.parentNode.insertBefore(draggedElement, target);
            } else {
              target.parentNode.insertBefore(draggedElement, target.nextSibling);
            }
          }
          return false;
        }

        function handleHeaderDrop(e) {
          if (e.stopPropagation) {
            e.stopPropagation();
          }
          
          if (draggedElement && draggedColumnId) {
            const allHeaders = Array.from(document.querySelectorAll('.draggable-header'));
            const newOrder = allHeaders.map(header => header.getAttribute('data-column-id'));
            
            // Update column order
            columnOrder = newOrder;
            localStorage.setItem('columnOrder', JSON.stringify(columnOrder));
            
            // Re-render table with new order
            renderTableHeaders();
            renderTable();
          }
          
          return false;
        }

        function handleHeaderDragEnd(e) {
          if (draggedElement) {
            draggedElement.style.opacity = '1';
            draggedElement.classList.remove('dragging');
          }
          // Remove drag-over class from all headers
          document.querySelectorAll('.draggable-header').forEach(header => {
            header.classList.remove('drag-over');
          });
          draggedElement = null;
          draggedColumnId = null;
        }

        function setupColumnDragAndDrop() {
          // Additional setup if needed
          // The drag handlers are already attached via inline event handlers
        }

        function getSortValue(alert, field) {
          switch(field) {
            case 'symbol':
              return alert.symbol || '';
            case 'price':
              return parseFloat(alert.price) || 0;
            case 'd2value':
              // Sort by D2 value from Dual Stoch, Solo Stoch, or generic d2
              return alert.dualStochD2 !== undefined
                ? parseFloat(alert.dualStochD2) || 0
                : alert.soloStochD2 !== undefined
                  ? parseFloat(alert.soloStochD2) || 0
                  : alert.d2 !== undefined
                    ? parseFloat(alert.d2) || 0
                    : 0;
            case 'highLevelTrend':
              // Sort by High Level Trend type (Bull > Bear > None)
              const hltType = alert.dualStochHighLevelTrendType || 'None'
              if (hltType === 'Bull') return 2
              if (hltType === 'Bear') return 1
              return 0
            case 'priceChange':
              // Calculate price change percentage for sorting
              if (alert.changeFromPrevDay !== undefined) {
                return parseFloat(alert.changeFromPrevDay) || 0;
              }
              else if (alert.price && alert.previousClose && alert.previousClose !== 0) {
                const close = parseFloat(alert.price);
                const prevDayClose = parseFloat(alert.previousClose);
                const changeFromPrevDay = (close - prevDayClose) / prevDayClose * 100;
                return changeFromPrevDay;
              } 
              else if (alert.priceChange) {
                return parseFloat(alert.priceChange) || 0;
              }
              return 0;
            case 'volume':
              return parseInt(alert.volume) || 0;
            case 'bjValue':
              return parseFloat(alert.bjTsi) || 0;
            default:
              return '';
          }
        }

        function filterAlerts() {
          searchTerm = document.getElementById('searchInput').value.toLowerCase();
          
          // BJ TSI Filters (get selected options as arrays)
          const pmRangeSelect = document.getElementById('filterPmRange');
          bjFilterPmRange = Array.from(pmRangeSelect?.selectedOptions || []).map(opt => opt.value);
          
          const vDirSelect = document.getElementById('filterVDir');
          bjFilterVDir = Array.from(vDirSelect?.selectedOptions || []).map(opt => opt.value);
          
          const sDirSelect = document.getElementById('filterSDir');
          bjFilterSDir = Array.from(sDirSelect?.selectedOptions || []).map(opt => opt.value);
          
          const areaSelect = document.getElementById('filterArea');
          bjFilterArea = Array.from(areaSelect?.selectedOptions || []).map(opt => opt.value);
          
          // Stoch Filters (get selected options as arrays)
          const d1DirectionSelect = document.getElementById('filterD1Direction');
          stochFilterD1Direction = Array.from(d1DirectionSelect?.selectedOptions || []).map(opt => opt.value);
          
          const d1ValueSelect = document.getElementById('filterD1Value');
          stochFilterD1Value = Array.from(d1ValueSelect?.selectedOptions || []).map(opt => opt.value);
          
          const d2DirectionSelect = document.getElementById('filterD2Direction');
          stochFilterD2Direction = Array.from(d2DirectionSelect?.selectedOptions || []).map(opt => opt.value);
          
          const d2ValueSelect = document.getElementById('filterD2Value');
          stochFilterD2Value = Array.from(d2ValueSelect?.selectedOptions || []).map(opt => opt.value);
          
          const trendMessageSelect = document.getElementById('filterTrendMessage');
          stochFilterTrendMessage = Array.from(trendMessageSelect?.selectedOptions || []).map(opt => opt.value);
          
          const percentChangeSelect = document.getElementById('filterPercentChange');
          stochFilterPercentChange = Array.from(percentChangeSelect?.selectedOptions || []).map(opt => opt.value);
          
          renderTable();
        }
        
        function clearBjFilters() {
          const pmRangeSelect = document.getElementById('filterPmRange');
          if (pmRangeSelect) Array.from(pmRangeSelect.options).forEach(opt => opt.selected = false);
          
          const vDirSelect = document.getElementById('filterVDir');
          if (vDirSelect) Array.from(vDirSelect.options).forEach(opt => opt.selected = false);
          
          const sDirSelect = document.getElementById('filterSDir');
          if (sDirSelect) Array.from(sDirSelect.options).forEach(opt => opt.selected = false);
          
          const areaSelect = document.getElementById('filterArea');
          if (areaSelect) Array.from(areaSelect.options).forEach(opt => opt.selected = false);
          
          bjFilterPmRange = [];
          bjFilterVDir = [];
          bjFilterSDir = [];
          bjFilterArea = [];
          renderTable();
        }
        
        function clearStochFilters() {
          const d1DirectionSelect = document.getElementById('filterD1Direction');
          if (d1DirectionSelect) Array.from(d1DirectionSelect.options).forEach(opt => opt.selected = false);
          
          const d1ValueSelect = document.getElementById('filterD1Value');
          if (d1ValueSelect) Array.from(d1ValueSelect.options).forEach(opt => opt.selected = false);
          
          const d2DirectionSelect = document.getElementById('filterD2Direction');
          if (d2DirectionSelect) Array.from(d2DirectionSelect.options).forEach(opt => opt.selected = false);
          
          const d2ValueSelect = document.getElementById('filterD2Value');
          if (d2ValueSelect) Array.from(d2ValueSelect.options).forEach(opt => opt.selected = false);
          
          const trendMessageSelect = document.getElementById('filterTrendMessage');
          if (trendMessageSelect) Array.from(trendMessageSelect.options).forEach(opt => opt.selected = false);
          
          const percentChangeSelect = document.getElementById('filterPercentChange');
          if (percentChangeSelect) Array.from(percentChangeSelect.options).forEach(opt => opt.selected = false);
          
          stochFilterD1Direction = [];
          stochFilterD1Value = [];
          stochFilterD2Direction = [];
          stochFilterD2Value = [];
          stochFilterTrendMessage = [];
          stochFilterPercentChange = [];
          renderTable();
        }

        function toggleClearButton() {
          const searchInput = document.getElementById('searchInput');
          const clearButton = document.getElementById('clearButton');
          
          if (searchInput.value.length > 0) {
            clearButton.classList.remove('hidden');
          } else {
            clearButton.classList.add('hidden');
          }
        }

        function clearSearch() {
          document.getElementById('searchInput').value = '';
          searchTerm = '';
          document.getElementById('clearButton').classList.add('hidden');
          renderTable();
        }

        function toggleStar(symbol) {
          starredAlerts[symbol] = !starredAlerts[symbol];
          localStorage.setItem('starredAlerts', JSON.stringify(starredAlerts));
          
          // Sync starred symbols to backend for notifications
          syncStarredSymbolsToBackend();
          
          renderTable();
        }
        
        // Sync starred symbols to backend
        async function syncStarredSymbolsToBackend() {
          try {
            await fetch('/starred-symbols', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ starred: starredAlerts })
            });
            console.log('⭐ Starred symbols synced to backend');
          } catch (error) {
            console.error('Failed to sync starred symbols:', error);
          }
        }
        
        // Initial sync on page load
        syncStarredSymbolsToBackend();
        
        // Load notification settings on page load
        loadNotificationSettings();

        function isStarred(symbol) {
          return starredAlerts[symbol] || false;
        }
        
        // Load notification settings and update UI
        async function loadNotificationSettings() {
          try {
            const response = await fetch('/notification-settings');
            const settings = await response.json();
            updateNotificationToggleUI(settings.enabled);
          } catch (error) {
            console.error('Failed to load notification settings:', error);
          }
        }
        
        // Update notification toggle UI
        function updateNotificationToggleUI(enabled) {
          const toggle = document.getElementById('notificationToggle');
          const icon = document.getElementById('notificationIcon');
          const text = document.getElementById('notificationText');
          
          if (enabled) {
            toggle.className = 'inline-flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors shadow-lg';
            icon.textContent = '🔔';
            text.textContent = 'Notifications ON';
          } else {
            toggle.className = 'inline-flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors shadow-lg';
            icon.textContent = '🔕';
            text.textContent = 'Notifications OFF';
          }
        }
        
        // Toggle notifications
        async function toggleNotifications() {
          try {
            const response = await fetch('/notification-settings');
            const settings = await response.json();
            const newState = !settings.enabled;
            
            const updateResponse = await fetch('/notification-settings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled: newState })
            });
            
            const result = await updateResponse.json();
            if (result.status === 'ok') {
              updateNotificationToggleUI(newState);
              console.log(\`🔔 Notifications \${newState ? 'ENABLED' : 'DISABLED'}\`);
            }
          } catch (error) {
            console.error('Failed to toggle notifications:', error);
            alert('Failed to toggle notifications. Please try again.');
          }
        }

        function updateCountdown() {
          const countdownElem = document.getElementById('countdown');
          if (countdownElem) {
            countdownElem.textContent = \`- \${countdownSeconds}s\`;
          }
        }

        function startCountdown() {
          countdownSeconds = 120;
          updateCountdown();
          
          if (countdownInterval) {
            clearInterval(countdownInterval);
          }
          
          countdownInterval = setInterval(() => {
            countdownSeconds--;
            if (countdownSeconds < 0) {
              countdownSeconds = 120;
            }
            updateCountdown();
          }, 1000);
        }

        function renderTable() {
          const alertTable = document.getElementById('alertTable');
          const lastUpdate = document.getElementById('lastUpdate');
          
          if (alertsData.length === 0) {
            alertTable.innerHTML = \`<tr><td colspan="\${columnOrder.length}" class="text-center text-muted-foreground py-12 relative">No alerts available</td></tr>\`;
            lastUpdate.innerHTML = 'Last updated: Never <span id="countdown"></span>';
            return;
          }

          // Filter data by search term
          let filteredData = alertsData;
          if (searchTerm) {
            filteredData = alertsData.filter(alert => 
              (alert.symbol || '').toLowerCase().includes(searchTerm)
            );
          }
          
          // Apply Stoch Filters
          if (stochFilterD1Direction.length > 0 || stochFilterD1Value.length > 0 || stochFilterD2Direction.length > 0 || stochFilterD2Value.length > 0 || stochFilterTrendMessage.length > 0 || stochFilterPercentChange.length > 0) {
            filteredData = filteredData.filter(alert => {
              // Get D1 and D2 values and directions
              const d1Value = alert.dualStochD1 !== null && alert.dualStochD1 !== undefined ? parseFloat(alert.dualStochD1) : null;
              const d2Value = alert.dualStochD2 !== null && alert.dualStochD2 !== undefined ? parseFloat(alert.dualStochD2) : null;
              const d1Direction = alert.dualStochD1Direction || 'flat';
              const d2Direction = alert.dualStochD2Direction || 'flat';
              
              // Get % change value
              const percentChange = alert.changeFromPrevDay !== null && alert.changeFromPrevDay !== undefined ? parseFloat(alert.changeFromPrevDay) : null;
              
              // Check D1 direction filter
              if (stochFilterD1Direction.length > 0 && !stochFilterD1Direction.includes(d1Direction)) return false;
              
              // Check D2 direction filter
              if (stochFilterD2Direction.length > 0 && !stochFilterD2Direction.includes(d2Direction)) return false;
              
              // Determine trend message from alert data
              let trendMessage = '';
              if (alert.isBigTrendDay) {
                trendMessage = 'Big Trend Day';
              } else if (d1Value !== null && d2Value !== null) {
                
                if (d1Direction === 'down' && d2Direction === 'down' && d1Value < 20 && d2Value < 20) {
                  trendMessage = 'Do Not Long';
                } else if (d1Direction === 'up' && d2Direction === 'up' && d1Value > 80 && d2Value > 80) {
                  trendMessage = 'Do Not Short';
                } else if (d1Direction === 'up' && d2Direction === 'up' && (d1Value > 20 || d2Value > 20)) {
                  trendMessage = 'Try Long';
                } else if (d1Direction === 'down' && d2Direction === 'down' && (d1Value < 80 || d2Value < 80)) {
                  trendMessage = 'Try Short';
                }
              }
              
              // Check D1 value filter (multiple selections)
              if (stochFilterD1Value.length > 0) {
                if (d1Value === null || isNaN(d1Value)) return false;
                const d1Val = d1Value;
                let matchesD1 = false;
                for (const filter of stochFilterD1Value) {
                  if (filter === '<10' && d1Val < 10) { matchesD1 = true; break; }
                  if (filter === '10-20' && d1Val >= 10 && d1Val < 20) { matchesD1 = true; break; }
                  if (filter === '20-50' && d1Val >= 20 && d1Val < 50) { matchesD1 = true; break; }
                  if (filter === '50-80' && d1Val >= 50 && d1Val < 80) { matchesD1 = true; break; }
                  if (filter === '80-90' && d1Val >= 80 && d1Val < 90) { matchesD1 = true; break; }
                  if (filter === '>90' && d1Val >= 90) { matchesD1 = true; break; }
                }
                if (!matchesD1) return false;
              }
              
              // Check D2 value filter (multiple selections)
              if (stochFilterD2Value.length > 0) {
                if (d2Value === null || isNaN(d2Value)) return false;
                const d2Val = d2Value;
                let matchesD2 = false;
                for (const filter of stochFilterD2Value) {
                  if (filter === '<10' && d2Val < 10) { matchesD2 = true; break; }
                  if (filter === '10-20' && d2Val >= 10 && d2Val < 20) { matchesD2 = true; break; }
                  if (filter === '20-50' && d2Val >= 20 && d2Val < 50) { matchesD2 = true; break; }
                  if (filter === '50-80' && d2Val >= 50 && d2Val < 80) { matchesD2 = true; break; }
                  if (filter === '80-90' && d2Val >= 80 && d2Val < 90) { matchesD2 = true; break; }
                  if (filter === '>90' && d2Val >= 90) { matchesD2 = true; break; }
                }
                if (!matchesD2) return false;
              }
              
              // Check trend message filter (multiple selections)
              if (stochFilterTrendMessage.length > 0 && !stochFilterTrendMessage.includes(trendMessage)) return false;
              
              // Check % change filter (multiple selections)
              if (stochFilterPercentChange.length > 0) {
                if (percentChange === null || isNaN(percentChange)) return false;
                const pctVal = percentChange;
                let matchesPct = false;
                for (const filter of stochFilterPercentChange) {
                  if (filter === '<-5' && pctVal < -5) { matchesPct = true; break; }
                  if (filter === '-5--2' && pctVal >= -5 && pctVal < -2) { matchesPct = true; break; }
                  if (filter === '-2-0' && pctVal >= -2 && pctVal < 0) { matchesPct = true; break; }
                  if (filter === '0-2' && pctVal >= 0 && pctVal < 2) { matchesPct = true; break; }
                  if (filter === '2-5' && pctVal >= 2 && pctVal < 5) { matchesPct = true; break; }
                  if (filter === '>5' && pctVal >= 5) { matchesPct = true; break; }
                }
                if (!matchesPct) return false;
              }
              
              return true;
            });
          }
          
          // Apply BJ TSI Filters (multiple selections)
          if (bjFilterPmRange.length > 0 || bjFilterVDir.length > 0 || bjFilterSDir.length > 0 || bjFilterArea.length > 0) {
            filteredData = filteredData.filter(alert => {
              // Calculate BJ TSI values for filtering
              const bjTsi = alert.bjTsi !== null && alert.bjTsi !== undefined && alert.bjTsi !== '' ? parseFloat(alert.bjTsi) : null;
              const bjTsiIsBull = alert.bjTsiIsBull === true || alert.bjTsiIsBull === 'true';
              const bjTslIsBull = alert.bjTslIsBull === true || alert.bjTslIsBull === 'true';
              
              // Get premarket range values
              let premarketRangeUpper = null;
              let premarketRangeLower = null;
              if (alert.bjPremarketRangeUpper !== null && alert.bjPremarketRangeUpper !== undefined && alert.bjPremarketRangeUpper !== '' && alert.bjPremarketRangeUpper !== 'null') {
                const upperVal = parseFloat(alert.bjPremarketRangeUpper);
                if (!isNaN(upperVal)) premarketRangeUpper = upperVal;
              }
              if (alert.bjPremarketRangeLower !== null && alert.bjPremarketRangeLower !== undefined && alert.bjPremarketRangeLower !== '' && alert.bjPremarketRangeLower !== 'null') {
                const lowerVal = parseFloat(alert.bjPremarketRangeLower);
                if (!isNaN(lowerVal)) premarketRangeLower = lowerVal;
              }
              
              // Calculate PM Range status
              let pmRangeStatus = '';
              if (bjTsi !== null && !isNaN(bjTsi) && premarketRangeUpper !== null && premarketRangeLower !== null) {
                const x = premarketRangeLower;
                const y = premarketRangeUpper;
                const rangeMid = (y + x) / 2;
                if (bjTsi < x) pmRangeStatus = 'Below';
                else if (bjTsi > y) pmRangeStatus = 'Above';
                else if (bjTsi < rangeMid) pmRangeStatus = 'Lower';
                else pmRangeStatus = 'Upper';
              }
              
              // Calculate V Dir and S Dir
              const vDir = bjTsiIsBull ? 'Up' : 'Down';
              const sDir = bjTslIsBull ? 'Up' : 'Down';
              
              // Calculate Area
              let areaValue = '';
              if (bjTsi !== null && !isNaN(bjTsi)) {
                if (bjTsi > 40) areaValue = 'strong_bullish';
                else if (bjTsi >= 15) areaValue = 'bullish';
                else if (bjTsi >= 0) areaValue = 'light_bullish';
                else if (bjTsi >= -15) areaValue = 'light_bearish';
                else if (bjTsi >= -40) areaValue = 'bearish';
                else areaValue = 'strong_bearish';
              }
              
              // Apply filters (check if value is in selected array)
              if (bjFilterPmRange.length > 0 && !bjFilterPmRange.includes(pmRangeStatus)) return false;
              if (bjFilterVDir.length > 0 && !bjFilterVDir.includes(vDir)) return false;
              if (bjFilterSDir.length > 0 && !bjFilterSDir.includes(sDir)) return false;
              if (bjFilterArea.length > 0 && !bjFilterArea.includes(areaValue)) return false;
              
              return true;
            });
          }

          // Sort filtered data - starred items always come first
          if (currentSortField) {
            filteredData.sort((a, b) => {
              // First, sort by starred status
              const aStarred = isStarred(a.symbol);
              const bStarred = isStarred(b.symbol);
              
              if (aStarred && !bStarred) return -1;
              if (!aStarred && bStarred) return 1;
              
              // Then sort by the selected field
              const aVal = getSortValue(a, currentSortField);
              const bVal = getSortValue(b, currentSortField);
              
              if (typeof aVal === 'string') {
                const result = aVal.localeCompare(bVal);
                return currentSortDirection === 'asc' ? result : -result;
              } else {
                const result = aVal - bVal;
                return currentSortDirection === 'asc' ? result : -result;
              }
            });
          }

          // Show "No results" message if search returns no results
          if (filteredData.length === 0 && searchTerm) {
            alertTable.innerHTML = \`<tr><td colspan="\${columnOrder.length}" class="text-center text-muted-foreground py-12 relative">No tickers match your search</td></tr>\`;
            lastUpdate.innerHTML = 'Last updated: ' + new Date(Math.max(...alertsData.map(alert => alert.receivedAt || 0))).toLocaleString() + ' <span id="countdown"></span>';
            updateCountdown();
            return;
          }

          // Update last update time with search info
          const mostRecent = Math.max(...alertsData.map(alert => alert.receivedAt || 0));
          const searchInfo = searchTerm ? \` • Showing \${filteredData.length} of \${alertsData.length}\` : '';
          lastUpdate.innerHTML = 'Last updated: ' + new Date(mostRecent).toLocaleString() + searchInfo + ' <span id="countdown"></span>';
          updateCountdown();

          alertTable.innerHTML = filteredData.map((alert, index) => {
            const starred = isStarred(alert.symbol);
            const starIcon = starred ? '⭐' : '☆';
            const starClass = starred ? 'text-yellow-400' : 'text-muted-foreground hover:text-yellow-400';
            
            // Price color based on comparison with previous alert for same symbol
            let priceClass = 'text-foreground'; // Default white/foreground color for price
            const currentPrice = parseFloat(alert.price);
            
            // Find the most recent previous alert for the same symbol
            // Look through all alertsData to find previous price for this symbol
            const currentReceivedAt = alert.receivedAt || 0;
            const previousAlerts = alertsData.filter(a => 
              a.symbol === alert.symbol && 
              a.price && 
              !isNaN(parseFloat(a.price)) &&
              (a.receivedAt || 0) < currentReceivedAt
            );
            
            // Get the most recent previous alert (highest receivedAt)
            const previousAlert = previousAlerts.length > 0
              ? previousAlerts.reduce((prev, curr) => 
                  (curr.receivedAt || 0) > (prev.receivedAt || 0) ? curr : prev
                )
              : null;
            
            if (previousAlert && !isNaN(currentPrice)) {
              const previousPrice = parseFloat(previousAlert.price);
              if (!isNaN(previousPrice)) {
                if (currentPrice > previousPrice) {
                  priceClass = 'text-green-400 font-semibold'; // Green if price went up
                } else if (currentPrice < previousPrice) {
                  priceClass = 'text-red-400 font-semibold'; // Red if price went down
                }
                // Otherwise stays white (no change)
              }
            }
            
            // Calculate price change percentage in frontend
            let priceChangeDisplay = 'N/A';
            let priceChangeClass = 'text-muted-foreground'; // Default for change %
            
            // Priority 1: Use changeFromPrevDay from List script if available
            if (alert.changeFromPrevDay !== undefined) {
              const changeFromPrevDay = parseFloat(alert.changeFromPrevDay);
              priceChangeDisplay = changeFromPrevDay.toFixed(2);
              // Change % color: green if >0%, red if <0%, gray if 0
              priceChangeClass = changeFromPrevDay > 0 ? 'text-green-400' : changeFromPrevDay < 0 ? 'text-red-400' : 'text-muted-foreground';
            }
            // Priority 2: Calculate from price and previousClose
            else if (alert.price && alert.previousClose && alert.previousClose !== 0) {
              const close = parseFloat(alert.price);
              const prevDayClose = parseFloat(alert.previousClose);
              const changeFromPrevDay = (close - prevDayClose) / prevDayClose * 100;
              priceChangeDisplay = changeFromPrevDay.toFixed(2);
              // Change % color: green if >0%, red if <0%, gray if 0
              priceChangeClass = changeFromPrevDay > 0 ? 'text-green-400' : changeFromPrevDay < 0 ? 'text-red-400' : 'text-muted-foreground';
            } 
            // Priority 3: Fallback to legacy priceChange field
            else if (alert.priceChange) {
              priceChangeDisplay = alert.priceChange;
              const change = parseFloat(alert.priceChange || 0);
              // Change % color: green if >0%, red if <0%, gray if 0
              priceChangeClass = change > 0 ? 'text-green-400' : change < 0 ? 'text-red-400' : 'text-muted-foreground';
            }
            
            // Calculate VWAP percentage difference
            let vwapDiffDisplay = '';
            let vwapDiffColor = '';
            if (alert.price && alert.vwap) {
              const price = parseFloat(alert.price);
              const vwap = parseFloat(alert.vwap);
              const vwapDiff = ((price - vwap) / vwap) * 100;
              const sign = vwapDiff >= 0 ? '+' : '';
              vwapDiffDisplay = \` (\${sign}\${vwapDiff.toFixed(2)}%)\`;
              vwapDiffColor = vwapDiff >= 0 ? 'text-green-400' : 'text-red-400';
            }
            
            // RSI color coding (overbought/oversold)
            const rsiValue = parseFloat(alert.rsi);
            const rsiClass = rsiValue >= 70 ? 'text-red-400 font-semibold' : 
                             rsiValue <= 30 ? 'text-green-400 font-semibold' : 
                             'text-muted-foreground';
            
            // VWAP color coding (price above/below)
            const vwapClass = alert.vwapAbove === 'true' || alert.vwapAbove === true ? 'text-green-400 font-semibold' : 
                              alert.vwapAbove === 'false' || alert.vwapAbove === false ? 'text-red-400 font-semibold' : 
                              'text-foreground';
            
            // VWAP Position color coding (band zone)
            const positionClass = alert.vwapRemark && alert.vwapRemark.startsWith('UP') ? 'text-green-400 font-bold' :
                                  alert.vwapRemark && alert.vwapRemark.startsWith('DN') ? 'text-red-400 font-bold' :
                                  'text-yellow-400 font-semibold';
            
            // Quad Stochastic Signal Display - showing D4 value
            let quadStochDisplay = '-';
            let quadStochClass = 'text-muted-foreground';
            let quadStochTitle = 'No D4 value available';
            
            const d4Val = alert.quadStochD4;
            
            if (d4Val !== undefined && d4Val !== null) {
              const d4Num = parseFloat(d4Val);
              quadStochDisplay = d4Num.toFixed(1);
              
              // Color coding based on D4 value
              if (d4Num >= 80) {
                quadStochClass = 'text-red-400 font-bold'; // Overbought
                quadStochTitle = \`D4: \${d4Num.toFixed(1)} (Overbought)\`;
              } else if (d4Num >= 50) {
                quadStochClass = 'text-green-400 font-semibold'; // Bullish
                quadStochTitle = \`D4: \${d4Num.toFixed(1)} (Bullish)\`;
              } else if (d4Num >= 20) {
                quadStochClass = 'text-yellow-400'; // Neutral
                quadStochTitle = \`D4: \${d4Num.toFixed(1)} (Neutral)\`;
              } else {
                quadStochClass = 'text-lime-400 font-semibold'; // Oversold
                quadStochTitle = \`D4: \${d4Num.toFixed(1)} (Oversold)\`;
              }
            }
            
            // QS Arrow Display - showing D1/D2/D3/D4 directions
            const d1Dir = alert.d1Direction || 'flat';
            const d2Dir = alert.d2Direction || 'flat';
            const d3Dir = alert.d3Direction || 'flat';
            const d4Dir = alert.d4Direction || 'flat';
            
            const getArrow = (dir) => {
              if (dir === 'up') return '↑';
              if (dir === 'down') return '↓';
              return '→';
            };
            
            const getArrowColor = (dir) => {
              if (dir === 'up') return 'text-green-400';
              if (dir === 'down') return 'text-red-400';
              return 'text-gray-400';
            };
            
            const qsArrowDisplay = \`
              <span class="\${getArrowColor(d1Dir)}">\${getArrow(d1Dir)}</span>
              <span class="\${getArrowColor(d2Dir)}">\${getArrow(d2Dir)}</span>
              <span class="\${getArrowColor(d3Dir)}">\${getArrow(d3Dir)}</span>
              <span class="\${getArrowColor(d4Dir)}">\${getArrow(d4Dir)}</span>
            \`;
            
            const qsArrowTitle = \`D1: \${d1Dir}, D2: \${d2Dir}, D3: \${d3Dir}, D4: \${d4Dir}\`;
            
            // === NEW TREND ANALYSIS - D1 & D7 BASED ===
            // Use calculatedTrend from Pine Script if available, otherwise calculate locally
            let trendDisplay = 'Neutral';
            let trendClass = 'text-gray-400';
            let trendCellClass = '';
            let trendTitle = 'Trend analysis based on D1 & D7';
            
            // Get D7 value for TTS message mapping
            const d7Val = parseFloat(alert.octoStochD7) || 0;
            
            // Function to map trend to TTS message
            const getTTSMessage = (trend, d7Value) => {
              if (trend === 'Dead Long') return 'Dead Long';
              if (trend === 'Dead Short') return 'Dead Short';
              if (trend === 'Heavy Buy') return 'Heavy Buy';
              if (d7Value < 20) return 'Heavy Sell';
              if (trend.includes('🚀')) return 'Small Buy';
              if (trend.includes('🔻')) return 'Small sell';
              if (trend === 'Switch Short') return 'Medium Short';
              if (trend === 'Very Short') return 'Big Short';
              if (trend === 'Switch Long') return 'Medium Buy';
              if (trend === 'Try Long') return 'Medium Buy';
              if (trend === 'Try Short') return 'Medium Sell';
              return 'Neutral';
            };
            
            // Get current D3 value for display
            const currentD3 = alert.octoStochD3 !== undefined ? parseFloat(alert.octoStochD3) : 
                             alert.d3 !== undefined ? parseFloat(alert.d3) : null;
            
            // Use calculatedTrend from Pine Script if available
            if (alert.calculatedTrend) {
              // Use ttsMessage from Pine Script if available, otherwise map from trend
              let baseTrendDisplay = alert.ttsMessage || getTTSMessage(alert.calculatedTrend, d7Val);
              
              // Add D3 value if there's a pattern
              const patternValue = alert.patternValue ?? alert.d3PatternValue ?? alert.d7PatternValue ?? null;
              if (patternValue !== null && !isNaN(patternValue) && currentD3 !== null && !isNaN(currentD3)) {
                trendDisplay = \`\${baseTrendDisplay} (D3: \${currentD3.toFixed(1)}→\${patternValue.toFixed(1)})\`;
              } else if (currentD3 !== null && !isNaN(currentD3)) {
                trendDisplay = \`\${baseTrendDisplay} (D3: \${currentD3.toFixed(1)})\`;
              } else {
                trendDisplay = baseTrendDisplay;
              }
              
              const calculatedTrend = alert.calculatedTrend;
              
              // Apply styling based on calculatedTrend (not trendDisplay which is TTS message)
              if (calculatedTrend === 'Dead Long') {
                trendClass = 'text-lime-300 font-extrabold animate-pulse';
                trendCellClass = 'bg-green-800/80';
                trendTitle = 'D7 > 90, D7 and D3 both going up - EXTREME LONG signal!';
              } else if (calculatedTrend === 'Dead Short') {
                trendClass = 'text-red-300 font-extrabold animate-pulse';
                trendCellClass = 'bg-red-800/80';
                trendTitle = 'D7 < 10, D7 and D3 both going down - EXTREME SHORT signal!';
              } else if (calculatedTrend.includes('🚀')) {
                trendClass = 'text-green-500 font-extrabold animate-pulse';
                trendCellClass = 'bg-green-900/70';
                trendTitle = 'D1 crossed OVER D7 (both going up) - Strong bullish signal!';
              } else if (calculatedTrend.includes('🔻')) {
                trendClass = 'text-red-500 font-extrabold animate-pulse';
                trendCellClass = 'bg-red-900/70';
                trendTitle = 'D1 crossed UNDER D7 (both going down) - Strong bearish signal!';
              } else if (calculatedTrend === 'Heavy Buy') {
                trendClass = 'text-green-600 font-extrabold animate-pulse';
                trendCellClass = 'bg-green-900/50';
                trendTitle = 'D7 > 80, D3 going up - Heavy Buy signal';
              } else if (calculatedTrend === 'Switch Short') {
                trendClass = 'text-orange-400 font-bold animate-pulse';
                trendCellClass = 'bg-orange-900/40';
                trendTitle = 'D7 > 80, D1 switched to down - Switch to short';
              } else if (calculatedTrend === 'Very Short') {
                trendClass = 'text-red-600 font-extrabold animate-pulse';
                trendCellClass = 'bg-red-900/50';
                trendTitle = 'D7 < 20, D1 going down - Very strong short signal';
              } else if (calculatedTrend === 'Switch Long') {
                trendClass = 'text-lime-400 font-bold animate-pulse';
                trendCellClass = 'bg-lime-900/40';
                trendTitle = 'D7 < 20, D1 switched to up - Switch to long';
              } else if (calculatedTrend === 'Try Long') {
                trendClass = 'text-green-400 font-semibold';
                trendTitle = 'D7 > 40, D1 going up - Try long position';
              } else if (calculatedTrend === 'Try Short') {
                trendClass = 'text-red-400 font-semibold';
                trendTitle = 'D7 < 40, D1 going down - Try short position';
              } else {
                trendClass = 'text-gray-400';
                trendTitle = \`Trend: \${calculatedTrend}\`;
              }
            } else {
              // Fallback: Calculate trend locally if not provided by Pine Script
              const d3Dir = alert.d3Direction || 'flat';
              const d7Dir = alert.d7Direction || 'flat';
              const d1CrossD7 = alert.d1CrossD7;
              let calculatedTrend = 'Neutral';
              
              // Priority order for trend determination based on D1 and D7
              // HIGHEST PRIORITY: Dead Long/Short (D7 > 90/< 10 with D7 and D3 both going same direction)
              if (d7Val > 90 && d7Dir === 'up' && d3Dir === 'up') {
                calculatedTrend = 'Dead Long';
                trendClass = 'text-lime-300 font-extrabold animate-pulse';
                trendCellClass = 'bg-green-800/80';
                trendTitle = 'D7 > 90, D7 and D3 both going up - EXTREME LONG signal!';
              }
              else if (d7Val < 10 && d7Dir === 'down' && d3Dir === 'down') {
                calculatedTrend = 'Dead Short';
                trendClass = 'text-red-300 font-extrabold animate-pulse';
                trendCellClass = 'bg-red-800/80';
                trendTitle = 'D7 < 10, D7 and D3 both going down - EXTREME SHORT signal!';
              }
              // HIGHEST PRIORITY: D1 crossover/crossunder D7
              else if (d1CrossD7 === 'bull') {
                calculatedTrend = '🚀 BULL Cross';
                trendClass = 'text-green-500 font-extrabold animate-pulse';
                trendCellClass = 'bg-green-900/70';
                trendTitle = 'D1 crossed OVER D7 (both going up) - Strong bullish signal!';
              }
              else if (d1CrossD7 === 'bear') {
                calculatedTrend = '🔻 BEAR Cross';
                trendClass = 'text-red-500 font-extrabold animate-pulse';
                trendCellClass = 'bg-red-900/70';
                trendTitle = 'D1 crossed UNDER D7 (both going down) - Strong bearish signal!';
              }
              // Heavy Buy: D7 > 80 AND D3 going up
              else if (d7Val > 80 && d3Dir === 'up') {
                calculatedTrend = 'Heavy Buy';
                trendClass = 'text-green-600 font-extrabold animate-pulse';
                trendCellClass = 'bg-green-900/50';
                trendTitle = 'D7 > 80, D3 going up - Heavy Buy signal';
              }
              // Switch Short: D7 > 80 AND D1 switched to down
              else if (d7Val > 80 && alert.d1SwitchedToDown) {
                calculatedTrend = 'Switch Short';
                trendClass = 'text-orange-400 font-bold animate-pulse';
                trendCellClass = 'bg-orange-900/40';
                trendTitle = 'D7 > 80, D1 switched to down - Switch to short';
              }
              // Very Short: D7 < 20 AND D1 switched to down OR D1 downtrend
              else if (d7Val < 20 && (alert.d1SwitchedToDown || d1Dir === 'down')) {
                calculatedTrend = 'Very Short';
                trendClass = 'text-red-600 font-extrabold animate-pulse';
                trendCellClass = 'bg-red-900/50';
                trendTitle = 'D7 < 20, D1 going down - Very strong short signal';
              }
              // Switch Long: D7 < 20 AND D1 switched to up
              else if (d7Val < 20 && alert.d1SwitchedToUp) {
                calculatedTrend = 'Switch Long';
                trendClass = 'text-lime-400 font-bold animate-pulse';
                trendCellClass = 'bg-lime-900/40';
                trendTitle = 'D7 < 20, D1 switched to up - Switch to long';
              }
              // Try Long: D7 > 40 AND D1 going up
              else if (d7Val > 40 && d1Dir === 'up') {
                calculatedTrend = 'Try Long';
                trendClass = 'text-green-400 font-semibold';
                trendTitle = 'D7 > 40, D1 going up - Try long position';
              }
              // Try Short: D7 < 40 AND D1 going down
              else if (d7Val < 40 && d1Dir === 'down') {
                calculatedTrend = 'Try Short';
                trendClass = 'text-red-400 font-semibold';
                trendTitle = 'D7 < 40, D1 going down - Try short position';
              }
              // Neutral zone
              else {
                calculatedTrend = 'Neutral';
                trendClass = 'text-gray-400';
                trendTitle = \`D7: \${d7Val.toFixed(1)}, D1: \${d1Dir} - No clear signal\`;
              }
              
              // Convert calculated trend to TTS message for display
              let baseTrendDisplay = getTTSMessage(calculatedTrend, d7Val);
              
              // Add D3 value if there's a pattern
              const patternValue = alert.patternValue ?? alert.d3PatternValue ?? alert.d7PatternValue ?? null;
              if (patternValue !== null && !isNaN(patternValue) && currentD3 !== null && !isNaN(currentD3)) {
                trendDisplay = \`\${baseTrendDisplay} (D3: \${currentD3.toFixed(1)}→\${patternValue.toFixed(1)})\`;
              } else if (currentD3 !== null && !isNaN(currentD3)) {
                trendDisplay = \`\${baseTrendDisplay} (D3: \${currentD3.toFixed(1)})\`;
              } else {
                trendDisplay = baseTrendDisplay;
              }
            }
            
            // Check if QS values changed recently (within last 2 minutes) and determine color
            const qsChangeAge = alert.qsChangeTimestamp ? (Date.now() - alert.qsChangeTimestamp) / 60000 : 999;
            const d4RecentlyChanged = alert.qsD4Changed && qsChangeAge <= 2;
            const directionRecentlyChanged = alert.qsDirectionChanged && qsChangeAge <= 2;
            
            // Color based on bullish/bearish change direction
            let qsD4CellClass = '';
            if (d4RecentlyChanged && alert.qsChangeDirection) {
              if (alert.qsChangeDirection === 'bullish') {
                qsD4CellClass = 'bg-green-900/50 animate-pulse';
              } else if (alert.qsChangeDirection === 'bearish') {
                qsD4CellClass = 'bg-red-900/50 animate-pulse';
              }
            }
            
            let qsArrowCellClass = '';
            if (directionRecentlyChanged && alert.qsArrowChangeDirection) {
              if (alert.qsArrowChangeDirection === 'bullish') {
                qsArrowCellClass = 'bg-green-900/50 animate-pulse';
              } else if (alert.qsArrowChangeDirection === 'bearish') {
                qsArrowCellClass = 'bg-red-900/50 animate-pulse';
              }
            }
            
            // QStoch D4 Signal Display
            let qstochDisplay = '-';
            let qstochClass = 'text-muted-foreground';
            let qstochTitle = 'No recent D4 signal';
            
            const d4Signal = alert.quadStochD4Signal;
            
            // Uptrend signals (Green)
            if (d4Signal === 'D4_Uptrend') {
              qstochDisplay = '↑ Up';
              qstochClass = 'text-green-400 font-bold';
              qstochTitle = 'D4 Uptrend (>50 or rising)';
            } else if (d4Signal === 'D4_Cross_Up_80') {
              qstochDisplay = '↑⚡ Exit OB';
              qstochClass = 'text-green-400 font-bold animate-pulse';
              qstochTitle = 'D4 Crossed Up 80 - Exiting Overbought Zone';
            } else if (d4Signal === 'D4_Cross_Up_50') {
              qstochDisplay = '↑⚡ Bull>50';
              qstochClass = 'text-green-400 font-bold animate-pulse';
              qstochTitle = 'D4 Crossed Up 50 - Entering Bullish Territory';
            } else if (d4Signal === 'D4_Cross_Up_20') {
              qstochDisplay = '↑⚡ Exit OS';
              qstochClass = 'text-lime-400 font-bold animate-pulse';
              qstochTitle = 'D4 Crossed Up 20 - Exiting Oversold Zone';
            }
            // Downtrend signals (Red)
            else if (d4Signal === 'D4_Downtrend') {
              qstochDisplay = '↓ Down';
              qstochClass = 'text-red-400 font-bold';
              qstochTitle = 'D4 Downtrend (<50 or falling)';
            } else if (d4Signal === 'D4_Cross_Down_20') {
              qstochDisplay = '↓⚡ In OS';
              qstochClass = 'text-red-400 font-bold animate-pulse';
              qstochTitle = 'D4 Crossed Down 20 - Entering Oversold Zone';
            } else if (d4Signal === 'D4_Cross_Down_50') {
              qstochDisplay = '↓⚡ Bear<50';
              qstochClass = 'text-red-400 font-bold animate-pulse';
              qstochTitle = 'D4 Crossed Down 50 - Entering Bearish Territory';
            } else if (d4Signal === 'D4_Cross_Down_80') {
              qstochDisplay = '↓⚡ In OB';
              qstochClass = 'text-orange-400 font-bold animate-pulse';
              qstochTitle = 'D4 Crossed Down 80 - Entering Overbought Zone';
            }
            
            // Pattern (Higher Low / Lower High) display
            const patternTypeRaw = alert.patternType || alert.d3Pattern || alert.d7Pattern || ''
            const isHigherLow = patternTypeRaw === 'Higher Low'
            const isLowerHigh = patternTypeRaw === 'Lower High'
            const patternCount = alert.patternCount || 0
            const patternStartTime = alert.patternStartTime || null
            const patternTrendBreak = alert.patternTrendBreak || false
            
            // Check specific break types
            const d3BelowLastHL = alert.d3BelowLastHL || false
            const d3AboveLastLH = alert.d3AboveLastLH || false
            const d3BelowLastD7HL = alert.d3BelowLastD7HL || false
            const d3AboveLastD7LH = alert.d3AboveLastD7LH || false
            const d3AbovePredictedLH = alert.d3AbovePredictedLH || false
            const d7AbovePredictedLH = alert.d7AbovePredictedLH || false
            
            // Determine break direction
            const isBreakUp = d3AboveLastLH || d3AboveLastD7LH || d3AbovePredictedLH || d7AbovePredictedLH
            const isBreakDown = d3BelowLastHL || d3BelowLastD7HL
            const isPredictedBreak = d3AbovePredictedLH || d7AbovePredictedLH
            
            let patternDurationDisplay = ''
            if (patternStartTime) {
              const durationMs = Date.now() - patternStartTime
              if (durationMs >= 60000) {
                const minutes = Math.floor(durationMs / 60000)
                patternDurationDisplay = \`\${minutes}m\`
              } else if (durationMs >= 1000) {
                const seconds = Math.max(1, Math.floor(durationMs / 1000))
                patternDurationDisplay = \`\${seconds}s\`
              }
            }
            const patternLabel = isHigherLow ? 'HL' : isLowerHigh ? 'LH' : '—'
            let patternClass = isHigherLow ? 'text-green-400 font-semibold' : isLowerHigh ? 'text-red-400 font-semibold' : 'text-muted-foreground'
            
            // Override class and display for trend breaks
            let patternDisplayStatic = patternTypeRaw
              ? \`\${patternLabel}\${patternCount ? ' ×' + patternCount : ''}\`
              : '—'
              
            if (isPredictedBreak) {
              patternClass = 'text-purple-400 font-bold animate-pulse'
              patternDisplayStatic = '🔮 Predicted ↑'
            } else if (isBreakUp) {
              patternClass = 'text-lime-400 font-bold animate-pulse'
              patternDisplayStatic = '⚠️ Break ↑'
            } else if (isBreakDown) {
              patternClass = 'text-red-400 font-bold animate-pulse'
              patternDisplayStatic = '⚠️ Break ↓'
            } else if (patternTrendBreak) {
              patternClass = 'text-yellow-400 font-bold animate-pulse'
              patternDisplayStatic = '⚠️ Break'
            }
            
            const patternValueDisplay =
              alert.patternValue ?? alert.d3PatternValue ?? alert.d7PatternValue ?? ''
            const patternTitleParts = []
            if (patternTypeRaw) patternTitleParts.push(\`Pattern: \${patternTypeRaw}\`)
            if (isPredictedBreak) {
              const predictedLevel = alert.d3PredictedThirdLH || alert.d7PredictedThirdLH
              patternTitleParts.push(\`🔮 PREDICTED BREAK - Above calculated 3rd LH (\${predictedLevel ? predictedLevel.toFixed(2) : 'N/A'})\`)
            } else if (isBreakUp) patternTitleParts.push('⚠️ BREAK UP - D3 above LH level')
            else if (isBreakDown) patternTitleParts.push('⚠️ BREAK DOWN - D3 below HL level')
            else if (patternTrendBreak) patternTitleParts.push('⚠️ TREND BREAK')
            if (patternCount) patternTitleParts.push(\`Count: \${patternCount}\`)
            if (patternDurationDisplay) patternTitleParts.push(\`Duration: \${patternDurationDisplay}\`)
            if (patternValueDisplay !== '' && patternValueDisplay !== null) patternTitleParts.push(\`Value: \${patternValueDisplay}\`)
            const patternTitle = patternTitleParts.join(' | ') || 'No HL/LH pattern detected'
            
            // QS D7 Value gradient color (0-100 scale)
            let d4ValueClass = 'text-foreground';
            let d7Value = NaN;
            if (alert.octoStochD7 !== undefined && alert.octoStochD7 !== null && alert.octoStochD7 !== '' && alert.octoStochD7 !== 'N/A') {
              d7Value = parseFloat(alert.octoStochD7);
            } else if (alert.d7 !== undefined && alert.d7 !== null && alert.d7 !== '' && alert.d7 !== 'N/A') {
              d7Value = parseFloat(alert.d7);
            }
            if (!isNaN(d7Value)) {
              // Gradient from red (0) → yellow (50) → green (100)
              if (d7Value >= 75) {
                d4ValueClass = 'text-green-400 font-bold'; // 75-100: Strong green
              } else if (d7Value >= 60) {
                d4ValueClass = 'text-green-500 font-semibold'; // 60-75: Green
              } else if (d7Value >= 50) {
                d4ValueClass = 'text-lime-400 font-semibold'; // 50-60: Lime
              } else if (d7Value >= 40) {
                d4ValueClass = 'text-yellow-400 font-semibold'; // 40-50: Yellow
              } else if (d7Value >= 25) {
                d4ValueClass = 'text-orange-400 font-semibold'; // 25-40: Orange
              } else {
                d4ValueClass = 'text-red-400 font-bold'; // 0-25: Red
              }
            }

            // QS D3 Value gradient color (0-100 scale)
            let d3ValueClass = 'text-foreground';
            let d3Value = NaN;
            if (alert.octoStochD3 !== undefined && alert.octoStochD3 !== null && alert.octoStochD3 !== '' && alert.octoStochD3 !== 'N/A') {
              d3Value = parseFloat(alert.octoStochD3);
            } else if (alert.d3 !== undefined && alert.d3 !== null && alert.d3 !== '' && alert.d3 !== 'N/A') {
              d3Value = parseFloat(alert.d3);
            }
            
            if (!isNaN(d3Value)) {
              // Gradient from red (0) → yellow (50) → green (100)
              if (d3Value >= 75) {
                d3ValueClass = 'text-green-400 font-bold'; // 75-100: Strong green
              } else if (d3Value >= 60) {
                d3ValueClass = 'text-green-500 font-semibold'; // 60-75: Green
              } else if (d3Value >= 50) {
                d3ValueClass = 'text-lime-400 font-semibold'; // 50-60: Lime
              } else if (d3Value >= 40) {
                d3ValueClass = 'text-yellow-400 font-semibold'; // 40-50: Yellow
              } else if (d3Value >= 25) {
                d3ValueClass = 'text-orange-400 font-semibold'; // 25-40: Orange
              } else {
                d3ValueClass = 'text-red-400 font-bold'; // 0-25: Red
              }
            }

            // Prepare arrows - use fallback values
            const d3DirForArrow = (alert.d3Direction && alert.d3Direction !== '' && alert.d3Direction !== 'N/A') ? alert.d3Direction : (d3Dir || 'flat');
            const d3Arrow = getArrow(d3DirForArrow);
            const d3ArrowColor = getArrowColor(d3DirForArrow);
            
            const d7DirForArrow = (alert.d7Direction && alert.d7Direction !== '' && alert.d7Direction !== 'N/A') ? alert.d7Direction : 'flat';
            const d7Arrow = getArrow(d7DirForArrow);
            const d7ArrowColor = getArrowColor(d7DirForArrow);
            
            // Solo Stoch D2 or Dual Stoch D1/D2 calculations
            // Check for Dual Stoch first, then Solo Stoch, then fallback to generic d2
            const dualStochD1 = alert.dualStochD1 !== null && alert.dualStochD1 !== undefined && alert.dualStochD1 !== '' ? parseFloat(alert.dualStochD1) : null;
            const dualStochD2 = alert.dualStochD2 !== null && alert.dualStochD2 !== undefined && alert.dualStochD2 !== '' ? parseFloat(alert.dualStochD2) : null;
            const soloD2 = alert.soloStochD2 !== null && alert.soloStochD2 !== undefined && alert.soloStochD2 !== '' ? parseFloat(alert.soloStochD2) : null;
            const genericD2 = alert.d2 !== null && alert.d2 !== undefined && alert.d2 !== '' ? parseFloat(alert.d2) : null;
            
            // Use Dual Stoch if available, otherwise Solo Stoch, otherwise generic d2
            const d2Value = dualStochD2 !== null ? dualStochD2 : (soloD2 !== null ? soloD2 : genericD2);
            const d2Direction = dualStochD2 !== null ? (alert.dualStochD1Direction || 'flat') : (alert.soloStochD2Direction || 'flat');
            const d2Pattern = dualStochD2 !== null ? (alert.dualStochD1Pattern || '') : (alert.soloStochD2Pattern || '');
            const d2PatternValue = dualStochD2 !== null ? (alert.dualStochD1PatternValue !== null && alert.dualStochD1PatternValue !== undefined ? parseFloat(alert.dualStochD1PatternValue) : null) : (alert.soloStochD2PatternValue !== null && alert.soloStochD2PatternValue !== undefined ? parseFloat(alert.soloStochD2PatternValue) : null);
            
            // Keep soloD2 variables for backward compatibility in display logic
            const soloD2Direction = d2Direction;
            const soloD2Pattern = d2Pattern;
            const soloD2PatternValue = d2PatternValue;
            
            // D1 color and direction for Dual Stoch
            let d1ValueClass = 'text-foreground';
            let d1DirClass = 'text-gray-400';
            let d1Arrow = '→';
            if (dualStochD1 !== null && !isNaN(dualStochD1)) {
              const d1Direction = alert.dualStochD1Direction || 'flat';
              d1DirClass = d1Direction === 'up' ? 'text-green-400' : d1Direction === 'down' ? 'text-blue-500' : 'text-gray-400';
              d1Arrow = d1Direction === 'up' ? '↑' : d1Direction === 'down' ? '↓' : '→';
              if (dualStochD1 > 80) {
                d1ValueClass = 'text-white font-bold';
              } else if (dualStochD1 < 20) {
                d1ValueClass = 'text-white font-bold';
              } else if (d1Direction === 'up') {
                d1ValueClass = 'text-green-400 font-semibold';
              } else if (d1Direction === 'down') {
                d1ValueClass = 'text-blue-500 font-semibold';
              }
            }
            
            // Calculate difference between D1 and D2 for Dual Stoch
            let d1D2Diff = null;
            let d1D2DiffClass = 'text-gray-400';
            if (dualStochD1 !== null && !isNaN(dualStochD1) && dualStochD2 !== null && !isNaN(dualStochD2)) {
              d1D2Diff = dualStochD1 - dualStochD2;
              // Color based on difference: positive (green), negative (red), zero (gray)
              if (d1D2Diff > 0) {
                d1D2DiffClass = 'text-green-400';
              } else if (d1D2Diff < 0) {
                d1D2DiffClass = 'text-red-400';
              } else {
                d1D2DiffClass = 'text-gray-400';
              }
            }
            
            // Generate mini chart SVG for D1/D2 (use pre-generated SVG from server)
            let miniChartSvg = alert.dualStochMiniChart || ''
            let d2CellHtml = ''
            
            // Trend messages based on D1 and D2 values and directions
            let trendMessage = '';
            let trendMessageClass = '';
            if (dualStochD1 !== null && !isNaN(dualStochD1) && dualStochD2 !== null && !isNaN(dualStochD2)) {
              const d1Direction = alert.dualStochD1Direction || 'flat';
              const d2Direction = alert.dualStochD2Direction || 'flat';
              
              // Both trending down and both below 20: "Do Not Long"
              if (d1Direction === 'down' && d2Direction === 'down' && dualStochD1 < 20 && dualStochD2 < 20) {
                trendMessage = 'Do Not Long';
                trendMessageClass = 'text-red-500 font-bold';
              }
              // Both trending up and both above 80: "Do Not Short"
              else if (d1Direction === 'up' && d2Direction === 'up' && dualStochD1 > 80 && dualStochD2 > 80) {
                trendMessage = 'Do Not Short';
                trendMessageClass = 'text-green-500 font-bold';
              }
              // Both trending up and either one above 20: "Try Long"
              else if (d1Direction === 'up' && d2Direction === 'up' && (dualStochD1 > 20 || dualStochD2 > 20)) {
                trendMessage = 'Try Long';
                trendMessageClass = 'text-green-400 font-semibold';
              }
              // Both trending down and either one below 80: "Try Short"
              else if (d1Direction === 'down' && d2Direction === 'down' && (dualStochD1 < 80 || dualStochD2 < 80)) {
                trendMessage = 'Try Short';
                trendMessageClass = 'text-red-400 font-semibold';
              }
            }
            
            // D2 color based on value (same as indicator: >80 white, <20 white, else green/blue)
            let d2ValueClass = 'text-foreground';
            let d2DirClass = d2Direction === 'up' ? 'text-green-400' : d2Direction === 'down' ? 'text-blue-500' : 'text-gray-400';
            let d2Arrow = d2Direction === 'up' ? '↑' : d2Direction === 'down' ? '↓' : '→';
            
            if (d2Value !== null && !isNaN(d2Value)) {
              if (d2Value > 80) {
                d2ValueClass = 'text-white font-bold'; // Overbought
              } else if (d2Value < 20) {
                d2ValueClass = 'text-white font-bold'; // Oversold
              } else if (d2Direction === 'up') {
                d2ValueClass = 'text-green-400 font-semibold';
              } else if (d2Direction === 'down') {
                d2ValueClass = 'text-blue-500 font-semibold';
              }
            }
            
            // D2 Pattern display
            let d2PatternDisplay = '';
            let d2PatternClass = 'text-muted-foreground';
            if (d2Pattern === 'Higher Low') {
              d2PatternDisplay = 'HL';
              d2PatternClass = 'text-cyan-400 font-semibold';
            } else if (d2Pattern === 'Lower High') {
              d2PatternDisplay = 'LH';
              d2PatternClass = 'text-orange-400 font-semibold';
            }
            
            // BJ TSI calculations
            const bjTsi = alert.bjTsi !== null && alert.bjTsi !== undefined && alert.bjTsi !== '' ? parseFloat(alert.bjTsi) : null;
            const bjTsl = alert.bjTsl !== null && alert.bjTsl !== undefined && alert.bjTsl !== '' ? parseFloat(alert.bjTsl) : null;
            const bjTsiIsBull = alert.bjTsiIsBull === true || alert.bjTsiIsBull === 'true';
            const bjTslIsBull = alert.bjTslIsBull === true || alert.bjTslIsBull === 'true';
            
            // Handle premarket range values - they might be null, "null" string, or actual numbers
            let premarketRangeUpper = null;
            let premarketRangeLower = null;
            if (alert.bjPremarketRangeUpper !== null && alert.bjPremarketRangeUpper !== undefined && alert.bjPremarketRangeUpper !== '' && alert.bjPremarketRangeUpper !== 'null') {
              const upperVal = parseFloat(alert.bjPremarketRangeUpper);
              if (!isNaN(upperVal)) premarketRangeUpper = upperVal;
            }
            if (alert.bjPremarketRangeLower !== null && alert.bjPremarketRangeLower !== undefined && alert.bjPremarketRangeLower !== '' && alert.bjPremarketRangeLower !== 'null') {
              const lowerVal = parseFloat(alert.bjPremarketRangeLower);
              if (!isNaN(lowerVal)) premarketRangeLower = lowerVal;
            }
            
            // Calculate PM Range status
            // Logic:
            // - Below: if current value (a) < lowest value (x) of premarket range
            // - Above: if current value (a) > highest value (y) of premarket range
            // - Lower: if current value (a) < 50% of premarket range = (y+x)/2
            // - Upper: if current value (a) > 50% of premarket range = (y+x)/2
            let pmRangeDisplay = '-';
            let pmRangeClass = 'text-muted-foreground';
            let pmRangeValues = ''; // Store the range values for display
            if (bjTsi !== null && !isNaN(bjTsi) && premarketRangeUpper !== null && !isNaN(premarketRangeUpper) && premarketRangeLower !== null && !isNaN(premarketRangeLower)) {
              const x = premarketRangeLower; // lowest value
              const y = premarketRangeUpper; // highest value
              const a = bjTsi; // current value
              const rangeMid = (y + x) / 2; // 50% of premarket range
              
              // Format range values for display
              pmRangeValues = ' (' + x.toFixed(2) + ' to ' + y.toFixed(2) + ')';
              
              if (a < x) {
                // Below: current value < lowest value
                pmRangeDisplay = 'Below';
                pmRangeClass = 'text-red-400 font-semibold';
              } else if (a > y) {
                // Above: current value > highest value
                pmRangeDisplay = 'Above';
                pmRangeClass = 'text-green-400 font-semibold';
              } else if (a < rangeMid) {
                // Lower: current value < 50% of range (below midpoint)
                pmRangeDisplay = 'Lower';
                pmRangeClass = 'text-yellow-400 font-semibold';
              } else {
                // Upper: current value >= 50% of range (above or equal to midpoint)
                pmRangeDisplay = 'Upper';
                pmRangeClass = 'text-lime-400 font-semibold';
              }
            }
            
            // Calculate Area with text labels
            let areaDisplay = '-';
            let areaClass = 'text-muted-foreground';
            let areaValue = ''; // For filtering
            if (!isNaN(bjTsi)) {
              if (bjTsi > 40) {
                areaDisplay = 'Strong Bullish';
                areaValue = 'strong_bullish';
                areaClass = 'text-green-400 font-bold';
              } else if (bjTsi >= 15) {
                areaDisplay = 'Bullish';
                areaValue = 'bullish';
                areaClass = 'text-green-500 font-semibold';
              } else if (bjTsi >= 0) {
                areaDisplay = 'Light Bullish';
                areaValue = 'light_bullish';
                areaClass = 'text-lime-400 font-semibold';
              } else if (bjTsi >= -15) {
                areaDisplay = 'Light Bearish';
                areaValue = 'light_bearish';
                areaClass = 'text-orange-400 font-semibold';
              } else if (bjTsi >= -40) {
                areaDisplay = 'Bearish';
                areaValue = 'bearish';
                areaClass = 'text-red-500 font-semibold';
              } else {
                areaDisplay = 'Strong Bearish';
                areaValue = 'strong_bearish';
                areaClass = 'text-red-400 font-bold';
              }
            }
            
            // V Dir and S Dir
            const vDirDisplay = bjTsiIsBull ? 'Up' : 'Down';
            const vDirClass = bjTsiIsBull ? 'text-green-400' : 'text-red-400';
            const sDirDisplay = bjTslIsBull ? 'Up' : 'Down';
            const sDirClass = bjTslIsBull ? 'text-green-400' : 'text-red-400';
            
            // ===== BJ TSI OVERVIEW LOGIC =====
            // Combines all signals into a single actionable overview
            let bjOverviewDisplay = '-';
            let bjOverviewClass = 'text-muted-foreground';
            
            if (bjTsi !== null && !isNaN(bjTsi)) {
              const vUp = bjTsiIsBull;
              const sUp = bjTslIsBull;
              const bothUp = vUp && sUp;
              const bothDown = !vUp && !sUp;
              const vUpSDown = vUp && !sUp;  // V turning up while S still down (early bullish)
              const vDownSUp = !vUp && sUp;  // V turning down while S still up (early bearish)
              
              // PM Range status checks
              const isBelow = pmRangeDisplay === 'Below';
              const isAbove = pmRangeDisplay === 'Above';
              const isLower = pmRangeDisplay === 'Lower';
              const isUpper = pmRangeDisplay === 'Upper';
              const inLowerHalf = isBelow || isLower;
              const inUpperHalf = isAbove || isUpper;
              const hasPmRange = pmRangeDisplay !== '-';
              
              // Area checks based on TSI value
              const isStrongBull = bjTsi > 40;
              const isBullish = bjTsi >= 15;
              const isStrongBear = bjTsi < -40;
              const isBearish = bjTsi <= -15;
              const isNeutralArea = bjTsi > -15 && bjTsi < 15;
              
              // Priority 1: Extreme breakout/breakdown
              if (isAbove && bothUp && isBullish) {
                bjOverviewDisplay = '🚀 Breakout';
                bjOverviewClass = 'text-green-400 font-bold';
              }
              else if (isBelow && bothDown && isBearish) {
                bjOverviewDisplay = '💥 Breakdown';
                bjOverviewClass = 'text-red-400 font-bold';
              }
              // Priority 2: Reveal signals (early reversal - KEY SIGNALS)
              else if (inLowerHalf && vUpSDown) {
                bjOverviewDisplay = '⚡ Reveal Long';
                bjOverviewClass = 'text-lime-400 font-bold animate-pulse';
              }
              else if (inUpperHalf && vDownSUp) {
                bjOverviewDisplay = '⚡ Reveal Short';
                bjOverviewClass = 'text-orange-400 font-bold animate-pulse';
              }
              // Priority 3: Strong momentum
              else if (bothUp && (isUpper || isAbove)) {
                bjOverviewDisplay = '📈 Go Up Heavy';
                bjOverviewClass = 'text-green-500 font-semibold';
              }
              else if (bothDown && (isLower || isBelow)) {
                bjOverviewDisplay = '📉 Go Down Heavy';
                bjOverviewClass = 'text-red-500 font-semibold';
              }
              // Priority 4: Strong area signals
              else if (isStrongBull && vUp) {
                bjOverviewDisplay = '🔥 Strong Bull';
                bjOverviewClass = 'text-green-400 font-semibold';
              }
              else if (isStrongBear && !vUp) {
                bjOverviewDisplay = '❄️ Strong Bear';
                bjOverviewClass = 'text-red-400 font-semibold';
              }
              // Priority 5: Building/Recovering (V up, S down - early reversal signs)
              else if (vUpSDown && isBearish) {
                bjOverviewDisplay = '💪 Recovering';
                bjOverviewClass = 'text-cyan-400 font-semibold';
              }
              else if (vUpSDown && isNeutralArea) {
                bjOverviewDisplay = '🌱 Building Long';
                bjOverviewClass = 'text-lime-500';
              }
              // Priority 6: Weakening/Fading (V down, S up - losing momentum)
              else if (vDownSUp && isBullish) {
                bjOverviewDisplay = '⚠️ Weakening';
                bjOverviewClass = 'text-yellow-400 font-semibold';
              }
              else if (vDownSUp && isNeutralArea) {
                bjOverviewDisplay = '🍂 Fading';
                bjOverviewClass = 'text-orange-400';
              }
              // Priority 7: Simple trend following
              else if (bothUp) {
                bjOverviewDisplay = '↗️ Trending Up';
                bjOverviewClass = 'text-green-400';
              }
              else if (bothDown) {
                bjOverviewDisplay = '↘️ Trending Down';
                bjOverviewClass = 'text-red-400';
              }
              // Default: Mixed/Consolidating
              else {
                bjOverviewDisplay = '↔️ Mixed';
                bjOverviewClass = 'text-gray-400';
              }
            }
            
            // Build d2 cell HTML string (to avoid template literal nesting issues)  
            if (!d2CellHtml) {
            let chartHtml = miniChartSvg || ''
            if (chartHtml) {
              chartHtml = '<div class="flex-shrink-0">' + chartHtml + '</div>'
            }
            let d1Html = ''
            if (dualStochD1 !== null) {
              d1Html = '<div class="flex flex-row items-center gap-1"><div class="font-mono text-lg ' + d1ValueClass + '">D1: ' + dualStochD1.toFixed(1) + '</div><div class="text-lg ' + d1DirClass + '">' + d1Arrow + '</div></div>'
            }
            let d2HtmlContent = '<div class="flex flex-row items-center gap-1">' +
              '<div class="font-mono text-lg ' + d2ValueClass + '">' + (dualStochD1 !== null ? 'D2: ' : '') + (d2Value !== null && !isNaN(d2Value) ? d2Value.toFixed(1) : '-') + '</div>' +
              '<div class="text-lg ' + d2DirClass + '">' + d2Arrow + '</div>' +
              (d2PatternDisplay ? '<div class="text-xs ' + d2PatternClass + '">' + d2PatternDisplay + '</div>' : '') +
              '</div>'
            let diffHtml = ''
            if (d1D2Diff !== null) {
              diffHtml = '<div class="text-xs ' + d1D2DiffClass + ' font-semibold">Diff: (' + (d1D2Diff >= 0 ? '+' : '') + d1D2Diff.toFixed(1) + ')</div>'
            }
            let trendHtml = ''
            if (trendMessage) {
              // Combine trend message with diff if available
              trendHtml = '<div class="flex items-center gap-1"><div class="text-xs ' + trendMessageClass + '">' + trendMessage + '</div>'
              if (diffHtml) {
                trendHtml += diffHtml
              }
              trendHtml += '</div>'
            } else if (diffHtml) {
              // If no trend message but diff exists, show diff alone
              trendHtml = diffHtml
            }
            // Add Big Trend Day indicator
            let bigTrendDayHtml = ''
            if (alert.isBigTrendDay) {
              bigTrendDayHtml = '<div class="text-xs text-yellow-400 font-bold animate-pulse">🔥 Big Trend Day</div>'
            }
            let d2TitleText = (dualStochD2 !== null ? 'Dual Stoch D1/D2' : 'Solo Stoch D2') + ': ' + 
              (dualStochD1 !== null ? 'D1=' + dualStochD1.toFixed(2) + ', ' : '') + 
              'D2=' + (d2Value !== null && !isNaN(d2Value) ? d2Value.toFixed(2) : 'N/A') + 
              ', Dir=' + d2Direction + 
              (d2PatternDisplay ? ', Pattern=' + d2Pattern : '') + 
              (d1D2Diff !== null ? ', Diff=' + d1D2Diff.toFixed(1) : '') + 
              (trendMessage ? ', ' + trendMessage : '')
            let d2TitleEscaped = d2TitleText.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
            // Build horizontal layout: Chart | D1: X↓ | D2: X↓ LH | Try Short | Diff: (X) | 🔥 Big Trend Day
            let parts = []
            if (chartHtml) parts.push(chartHtml)
            if (d1Html) {
              parts.push(d1Html)
            }
            if (d2HtmlContent) {
              parts.push(d2HtmlContent)
            }
            if (trendHtml) {
              parts.push(trendHtml)
            }
            if (bigTrendDayHtml) {
              parts.push(bigTrendDayHtml)
            }
            
            d2CellHtml = '<td class="py-3 px-4 text-left" title="' + d2TitleEscaped + (alert.isBigTrendDay ? ' - Big Trend Day' : '') + '">' +
              '<div class="flex flex-row items-center gap-2 flex-wrap">' +
              parts.join('<span class="text-muted-foreground mx-1">|</span>') +
              '</div></td>'
            }
            
            // Generate cell content for each column
            const cellContent = {
              star: \`
                <td class="py-3 pl-4 pr-1 text-center">
                  <button 
                    onclick="toggleStar('\${alert.symbol}')" 
                    class="text-xl \${starClass} transition-colors cursor-pointer hover:scale-110 transform"
                    title="\${starred ? 'Remove from favorites' : 'Add to favorites'}"
                  >
                    \${starIcon}
                  </button>
                </td>
              \`,
              symbol: \`<td class="py-3 pl-1 pr-4 font-medium text-foreground w-auto whitespace-nowrap">\${alert.symbol || 'N/A'}</td>\`,
              price: \`
                <td class="py-3 px-4 font-mono font-medium \${priceClass}">
                  $\${alert.price ? parseFloat(alert.price).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : 'N/A'}
                  <span class="text-sm ml-2 \${priceChangeClass}">\${priceChangeDisplay !== 'N/A' ? '(' + (parseFloat(priceChangeDisplay) >= 0 ? '+' : '') + priceChangeDisplay + '%)' : ''}</span>
                </td>
              \`,
              d2: d2CellHtml || '',
              highLevelTrend: \`
                <td class="py-3 px-4 text-left" title="High Level Trend: \${alert.dualStochHighLevelTrendType || 'None'}\${alert.dualStochHighLevelTrendDiff ? ', Diff=' + alert.dualStochHighLevelTrendDiff.toFixed(1) : ''}">
                  \${alert.dualStochHighLevelTrend && alert.dualStochHighLevelTrendType ? 
                    '<div class="text-sm font-semibold ' + (alert.dualStochHighLevelTrendType === 'Bull' ? 'text-green-400' : 'text-red-400') + '">' + alert.dualStochHighLevelTrendType + '</div>' : 
                    '<div class="text-sm text-gray-400">-</div>'}
                </td>
              \`,
              bj: \`
                <td class="py-3 px-4 text-xs text-foreground" title="BJ TSI: Value=\${!isNaN(bjTsi) ? bjTsi.toFixed(2) : 'N/A'}, PM Range=\${pmRangeDisplay}, V Dir=\${vDirDisplay}, S Dir=\${sDirDisplay}, Area=\${areaDisplay}">
                  <div class="space-y-1">
                    <div class="text-sm \${bjOverviewClass}">\${bjOverviewDisplay}</div>
                    <div class="font-mono text-foreground">Value: <span class="font-semibold text-foreground">\${!isNaN(bjTsi) ? bjTsi.toFixed(2) : '-'}</span></div>
                    <div class="text-foreground">PM Range: <span class="\${pmRangeClass}">\${pmRangeDisplay}\${pmRangeValues}</span></div>
                    <div class="text-foreground">V Dir: <span class="\${vDirClass}">\${vDirDisplay}</span> | S Dir: <span class="\${sDirClass}">\${sDirDisplay}</span></div>
                    <div class="text-foreground">Area: <span class="\${areaClass}">\${areaDisplay}</span></div>
                  </div>
                </td>
              \`,
              volume: \`<td class="py-3 px-4 text-muted-foreground" title="Volume since 9:30 AM: \${alert.volume ? parseInt(alert.volume).toLocaleString() : 'N/A'}">\${formatVolume(alert.volume)}</td>\`
            };
            
            // Render cells in column order
            const cells = columnOrder.map(colId => cellContent[colId] || '').join('');
            
            return \`
              <tr class="border-b border-border hover:bg-muted/50 transition-colors \${starred ? 'bg-muted/20' : ''}">
                \${cells}
              </tr>
            \`;
          }).join('');
        }

        async function fetchAlerts() {
          try {
            const response = await fetch('/alerts');
            const data = await response.json();
            
            alertsData = data;
            renderTable();
            startCountdown();
            
          } catch (error) {
            console.error('Error fetching alerts:', error);
            document.getElementById('alertTable').innerHTML = \`<tr><td colspan="\${columnOrder.length}" class="text-center text-red-400 py-12 relative">Error loading alerts</td></tr>\`;
          }
        }

        // Fetch alerts once on page load
        fetchAlerts();
        
        // Auto-refresh every 2 minutes (120 seconds) as fallback
        setInterval(fetchAlerts, 120000);
        
        // Real-time updates using Server-Sent Events (SSE)
        const eventSource = new EventSource('/events');
        const connectionIndicator = document.getElementById('connectionIndicator');
        const connectionText = document.getElementById('connectionText');
        const realtimeIndicator = document.getElementById('realtimeIndicator');
        
        eventSource.onopen = function(event) {
          console.log('📡 SSE connection opened');
          connectionIndicator.className = 'w-2 h-2 rounded-full bg-green-500';
          connectionText.textContent = 'Connected';
          connectionText.className = 'text-green-400';
          realtimeIndicator.classList.remove('hidden');
        };
        
        eventSource.onmessage = function(event) {
          console.log('📡 Received real-time update:', event.data);
          fetchAlerts(); // Refresh immediately when new data arrives
          
          // Show brief update indicator
          realtimeIndicator.innerHTML = '<span class="animate-pulse">🔄 Updated just now</span>';
          setTimeout(() => {
            realtimeIndicator.innerHTML = '<span class="animate-pulse">🔄 Real-time updates active</span>';
          }, 2000);
        };
        
        eventSource.onerror = function(event) {
          console.log('⚠️ SSE connection error, falling back to polling');
          connectionIndicator.className = 'w-2 h-2 rounded-full bg-red-500';
          connectionText.textContent = 'Disconnected';
          connectionText.className = 'text-red-400';
          realtimeIndicator.classList.add('hidden');
          // SSE failed, rely on interval polling
        };
        
        // Clean up SSE connection when page is unloaded
        window.addEventListener('beforeunload', function() {
          eventSource.close();
        });
        
        // Live pattern duration timer - updates every second
        function formatPatternDuration(startTime) {
          const durationMs = Date.now() - startTime
          if (durationMs >= 3600000) {
            const hours = Math.floor(durationMs / 3600000)
            const minutes = Math.floor((durationMs % 3600000) / 60000)
            return \`\${hours}h \${minutes}m\`
          } else if (durationMs >= 60000) {
            const minutes = Math.floor(durationMs / 60000)
            const seconds = Math.floor((durationMs % 60000) / 1000)
            return \`\${minutes}m \${seconds}s\`
          } else {
            const seconds = Math.max(1, Math.floor(durationMs / 1000))
            return \`\${seconds}s\`
          }
        }
        
        function updatePatternTimers() {
          const timers = document.querySelectorAll('.pattern-timer')
          timers.forEach(timer => {
            const startTime = parseInt(timer.dataset.start, 10)
            if (startTime && !isNaN(startTime)) {
              timer.textContent = formatPatternDuration(startTime)
            }
          })
        }
        
        // Update pattern timers every second
        setInterval(updatePatternTimers, 1000)
      </script>
    </body>
    </html>
  `)
})

app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})