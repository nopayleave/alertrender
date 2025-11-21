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
let starredSymbols = {} // Store starred symbols (synced from frontend)
let previousTrends = {} // Store previous trend for each symbol to detect changes

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
  if (d7Val > 80 && (alert.d1SwitchedToUp || d1Dir === 'up')) return 'Very Long'
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
      'Very Long': 0x4CAF50,
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
      } else if (d7Value !== null && d7Value < 20) {
        // D7 < 20: Heavy Sell
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Heavy Sell.`
      } else if (d7Value !== null && d7Value > 80) {
        // D7 > 80: Heavy Buy
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Heavy Buy.`
      } else if (newTrend.includes('🚀')) {
        // BULL Cross - Small Buy
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Small Buy.`
      } else if (newTrend.includes('🔻')) {
        // BEAR Cross - Small sell
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Small sell.`
      } else if (newTrend === 'Very Long') {
        // Very Long - Big Buy
        payload.content = `Ticker ${symbolSpelled}. Ticker ${symbolSpelled}. Big Buy.`
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
  // - Main script (again.pine): contains price and signals (handles Price and Signal columns)
  const isDayChangeAlert = alert.changeFromPrevDay !== undefined && !alert.price
  const isVwapCrossingAlert = alert.vwapCrossing === true || alert.vwapCrossing === 'true'
  const isQuadStochAlert = alert.quadStochSignal !== undefined
  const isQuadStochD4Alert = alert.d4Signal !== undefined
  const isOctoStochAlert = alert.d8Signal !== undefined
  const isMacdCrossingAlert = alert.macdCrossingSignal !== undefined
  
  // Log alert type detection for debugging
  console.log('📊 Alert type detected:', {
    isDayChangeAlert,
    isVwapCrossingAlert,
    isQuadStochAlert,
    isQuadStochD4Alert,
    isOctoStochAlert,
    isMacdCrossingAlert,
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
  } else if (isOctoStochAlert && !alert.price) {
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
    
    // Store Octo Stochastic data
    octoStochData[alert.symbol] = {
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
      d8Direction: alert.d8Direction,
      d8Signal: alert.d8Signal,
      d1d2Cross: alert.d1d2Cross,
      d1CrossD7: d1CrossD7,
      timeframe1_4: alert.timeframe1_4,
      timeframe5_8: alert.timeframe5_8,
      d1SwitchedToUp: d1SwitchedToUp,
      d1SwitchedToDown: d1SwitchedToDown,
      d7SwitchedToUp: d7SwitchedToUp,
      d7SwitchedToDown: d7SwitchedToDown,
      calculatedTrend: alert.calculatedTrend || null, // From Pine Script
      ttsMessage: alert.ttsMessage || null, // From Pine Script
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
      alerts[existingIndex].calculatedTrend = alert.calculatedTrend || null // From Pine Script
      alerts[existingIndex].ttsMessage = alert.ttsMessage || null // From Pine Script
      alerts[existingIndex].receivedAt = Date.now()
      console.log(`✅ Updated existing alert for ${alert.symbol} with Octo Stoch data`)
    } else {
      // Create new alert entry if it doesn't exist
      const newAlert = {
        symbol: alert.symbol,
        timeframe: alert.timeframe || null,
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
               isMacdCrossingAlert ? 'macd_crossing' : 'main_script',
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
        
        <!-- Search bar - sticky on top for desktop, bottom for mobile -->
        <div class="fixed md:sticky top-auto md:top-0 bottom-0 md:bottom-auto left-0 right-0 z-50 bg-background border-t md:border-t-0 md:border-b border-border py-4">
          <div class="container mx-auto" style="max-width:1360px;padding-bottom:1rem;">
            <div class="relative">
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
          </div>
        </div>

        <div class="bg-card rounded-lg shadow-sm">
          <div>
            <div class="overflow-x-auto">
              <table class="w-full table-auto">
                <thead>
                  <tr class="border-b border-border">
                    <th class="text-left py-3 pl-4 pr-1 font-bold text-muted-foreground w-12">
                      ⭐
                    </th>
                    <th class="text-left py-3 pl-1 pr-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors w-auto whitespace-nowrap" onclick="sortTable('symbol')">
                      Ticker <span id="sort-symbol" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('price')">
                      Price <span id="sort-price" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('trend')" title="Quad Stochastic Trend Analysis">
                      Trend <span id="sort-trend" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('qsArrow')" title="D1/D2/D3/D4 Direction Arrows">
                      QS Arrow <span id="sort-qsArrow" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('qstoch')" title="Octo Stochastic D7 Trend & Crossings">
                      QS D7 <span id="sort-qstoch" class="ml-1 text-xs">⇅</span>
                    </th>
                     <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('macdCrossing')" title="MACD Line & Signal Line Crossings">
                       MACD Cr <span id="sort-macdCrossing" class="ml-1 text-xs">⇅</span>
                     </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('d4value')" title="Octo Stochastic D7 Value">
                      D7 Value <span id="sort-d4value" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('volume')">
                      <span title="Volume since 9:30 AM">Vol</span> <span id="sort-volume" class="ml-1 text-xs">⇅</span>
                    </th>
                  </tr>
                </thead>
                <tbody id="alertTable">
                  <tr>
                    <td colspan="11" class="text-center text-muted-foreground py-12 relative">Loading alerts...</td>
                  </tr>
                </tbody>
              </table>
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

        // Starred alerts - stored in localStorage
        let starredAlerts = JSON.parse(localStorage.getItem('starredAlerts')) || {};

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
            const indicators = ['symbol', 'price', 'trend', 'quadStoch', 'qsArrow', 'qstoch', 'macdCrossing', 'd4value', 'priceChange', 'volume'];
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
        });

        function getSortValue(alert, field) {
          switch(field) {
            case 'symbol':
              return alert.symbol || '';
            case 'price':
              return parseFloat(alert.price) || 0;
            case 'vwap':
              return parseFloat(alert.vwap) || 0;
            case 'trend':
              // Sort by trend priority (NEW D1 & D7 BASED)
              const trendOrder = {
                'Dead Long': 15,  // Highest priority
                '🚀 BULL Cross': 12,
                'Very Long': 10,
                'Try Long': 8,
                'Switch Long': 7,
                'Neutral': 5,
                'Switch Short': 4,
                'Try Short': 3,
                'Very Short': 1,
                '🔻 BEAR Cross': 0,
                'Dead Short': -1  // Lowest priority (most bearish)
              };
              
              // Use calculatedTrend from Pine Script if available
              let trend_sort = alert.calculatedTrend || 'Neutral';
              
              // If not available, calculate locally
              if (!alert.calculatedTrend) {
                const d1Dir_sort = alert.d1Direction || 'flat';
                const d7Val_sort = parseFloat(alert.octoStochD7) || 0;
                const d1CrossD7_sort = alert.d1CrossD7;
                
                // HIGHEST PRIORITY: D1 crossover/crossunder D7
                if (d1CrossD7_sort === 'bull') {
                  trend_sort = '🚀 BULL Cross';
                }
                else if (d1CrossD7_sort === 'bear') {
                  trend_sort = '🔻 BEAR Cross';
                }
                // Very Long: D7 > 80 AND D1 switched to up OR D1 uptrend
                else if (d7Val_sort > 80 && (alert.d1SwitchedToUp || d1Dir_sort === 'up')) {
                  trend_sort = 'Very Long';
                }
                // Switch Short: D7 > 80 AND D1 switched to down
                else if (d7Val_sort > 80 && alert.d1SwitchedToDown) {
                  trend_sort = 'Switch Short';
                }
                // Very Short: D7 < 20 AND D1 switched to down OR D1 downtrend
                else if (d7Val_sort < 20 && (alert.d1SwitchedToDown || d1Dir_sort === 'down')) {
                  trend_sort = 'Very Short';
                }
                // Switch Long: D7 < 20 AND D1 switched to up
                else if (d7Val_sort < 20 && alert.d1SwitchedToUp) {
                  trend_sort = 'Switch Long';
                }
                // Try Long: D7 > 40 AND D1 going up
                else if (d7Val_sort > 40 && d1Dir_sort === 'up') {
                  trend_sort = 'Try Long';
                }
                // Try Short: D7 < 40 AND D1 going down
                else if (d7Val_sort < 40 && d1Dir_sort === 'down') {
                  trend_sort = 'Try Short';
                }
              }
              
              return trendOrder[trend_sort] || 5;
            case 'quadStoch':
              // Sort by D4 value numerically
              return parseFloat(alert.quadStochD4) || 0;
            case 'qsArrow':
              // Sort by number of up arrows (bullish first)
              const d1Dir = alert.d1Direction || 'flat';
              const d2Dir = alert.d2Direction || 'flat';
              const d3Dir = alert.d3Direction || 'flat';
              const d4Dir = alert.d4Direction || 'flat';
              const upCount = [d1Dir, d2Dir, d3Dir, d4Dir].filter(d => d === 'up').length;
              return upCount;
            case 'qstoch':
              // Sort by D4 signal strength (higher = more bullish)
              const d4sig = alert.quadStochD4Signal;
              if (d4sig === 'D4_Uptrend') return 10;
              if (d4sig === 'D4_Cross_Up_80') return 9;
              if (d4sig === 'D4_Cross_Up_50') return 8;
              if (d4sig === 'D4_Cross_Up_20') return 7;
              if (d4sig === 'D4_Cross_Down_20') return 3;
              if (d4sig === 'D4_Cross_Down_50') return 2;
              if (d4sig === 'D4_Cross_Down_80') return 1;
              if (d4sig === 'D4_Downtrend') return 0;
              return 5; // Default to neutral
            case 'macdCrossing':
              // Sort by MACD crossing signal strength (bullish to bearish)
              const macdSig = alert.macdCrossingSignal;
              if (macdSig === 'COver >50') return 10; // Strongest bullish
              if (macdSig === 'COver >0') return 9; // Bullish
              if (macdSig === 'MACD >0') return 8; // MACD above zero
              if (macdSig === 'Signal >0') return 7; // Signal above zero
              if (macdSig === 'COver <0') return 6; // Weak bullish
              if (macdSig === 'CUnder >0') return 5; // Weak bearish
              if (macdSig === 'CUnder <0') return 4; // Bearish
              if (macdSig === 'MACD <0') return 3; // MACD below zero
              if (macdSig === 'Signal <0') return 2; // Signal below zero
              if (macdSig === 'CUnder <-50') return 1; // Strongest bearish
              if (macdSig === 'M > S') return 0.5; // Neutral bullish
               if (macdSig === 'M < S') return 0.3; // Neutral bearish
               if (macdSig === 'M = S') return 0.4; // Neutral
               return 0; // Default
            case 'd4value':
              return alert.octoStochD7 !== undefined
                ? parseFloat(alert.octoStochD7) || 0
                : alert.d7 !== undefined
                  ? parseFloat(alert.d7) || 0
                  : 0;
            case 'priceChange':
              // Calculate price change percentage for sorting
              // Priority 1: Use changeFromPrevDay from Day script if available
              if (alert.changeFromPrevDay !== undefined) {
                return parseFloat(alert.changeFromPrevDay) || 0;
              }
              // Priority 2: Calculate from price and previousClose
              else if (alert.price && alert.previousClose && alert.previousClose !== 0) {
                const close = parseFloat(alert.price);
                const prevDayClose = parseFloat(alert.previousClose);
                const changeFromPrevDay = (close - prevDayClose) / prevDayClose * 100;
                return changeFromPrevDay;
              } 
              // Priority 3: Fallback to legacy priceChange field
              else if (alert.priceChange) {
                return parseFloat(alert.priceChange) || 0;
              }
              return 0;
            case 'volume':
              return parseInt(alert.volume) || 0;
            default:
              return '';
          }
        }

        function filterAlerts() {
          searchTerm = document.getElementById('searchInput').value.toLowerCase();
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
            alertTable.innerHTML = '<tr><td colspan="11" class="text-center text-muted-foreground py-12 relative">No alerts available</td></tr>';
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
            alertTable.innerHTML = '<tr><td colspan="11" class="text-center text-muted-foreground py-12 relative">No tickers match your search</td></tr>';
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
            
            // Find the previous alert for the same symbol (next in the array since newest is first)
            const previousAlert = filteredData.slice(index + 1).find(a => a.symbol === alert.symbol);
            
            if (previousAlert && !isNaN(currentPrice)) {
              const previousPrice = parseFloat(previousAlert.price);
              if (!isNaN(previousPrice)) {
                if (currentPrice > previousPrice) {
                  priceClass = 'text-green-400'; // Green if price went up
                } else if (currentPrice < previousPrice) {
                  priceClass = 'text-red-400'; // Red if price went down
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
              if (d7Value < 20) return 'Heavy Sell';
              if (d7Value > 80) return 'Heavy Buy';
              if (trend.includes('🚀')) return 'Small Buy';
              if (trend.includes('🔻')) return 'Small sell';
              if (trend === 'Very Long') return 'Big Buy';
              if (trend === 'Switch Short') return 'Medium Short';
              if (trend === 'Very Short') return 'Big Short';
              if (trend === 'Switch Long') return 'Medium Buy';
              if (trend === 'Try Long') return 'Medium Buy';
              if (trend === 'Try Short') return 'Medium Sell';
              return 'Neutral';
            };
            
            // Use calculatedTrend from Pine Script if available
            if (alert.calculatedTrend) {
              // Use ttsMessage from Pine Script if available, otherwise map from trend
              trendDisplay = alert.ttsMessage || getTTSMessage(alert.calculatedTrend, d7Val);
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
              } else if (calculatedTrend === 'Very Long') {
                trendClass = 'text-green-600 font-extrabold animate-pulse';
                trendCellClass = 'bg-green-900/50';
                trendTitle = 'D7 > 80, D1 going up - Very strong long signal';
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
              // Very Long: D7 > 80 AND D1 switched to up OR D1 uptrend
              else if (d7Val > 80 && (alert.d1SwitchedToUp || d1Dir === 'up')) {
                calculatedTrend = 'Very Long';
                trendClass = 'text-green-600 font-extrabold animate-pulse';
                trendCellClass = 'bg-green-900/50';
                trendTitle = 'D7 > 80, D1 going up - Very strong long signal';
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
              trendDisplay = getTTSMessage(calculatedTrend, d7Val);
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
            
            // MACD Crossing Signal Display
            let macdCrossingDisplay = '-';
            let macdCrossingClass = 'text-muted-foreground';
            let macdCrossingTitle = 'No recent MACD crossing signal';
            let macdCrossingCellClass = '';
            
            const macdCrossingSignal = alert.macdCrossingSignal;
            
            // Check if MACD crossing signal is recent (within last 5 minutes)
            const macdCrossingAge = alert.macdCrossingTimestamp ? (Date.now() - alert.macdCrossingTimestamp) / 60000 : 999;
            const isRecentCrossing = macdCrossingAge <= 5;
            
            // Bullish Crossing Signals (Green)
            if (macdCrossingSignal === 'COver >50') {
              macdCrossingDisplay = 'COver >50';
              macdCrossingClass = 'text-green-400 font-bold';
              macdCrossingTitle = 'MACD crosses above Signal AND MACD > 50 (Strong Bullish)';
              if (isRecentCrossing) macdCrossingCellClass = 'bg-green-900/30';
            } else if (macdCrossingSignal === 'COver >0') {
              macdCrossingDisplay = 'COver >0';
              macdCrossingClass = 'text-green-400 font-bold';
              macdCrossingTitle = 'MACD crosses above Signal AND MACD > 0 (Bullish)';
              if (isRecentCrossing) macdCrossingCellClass = 'bg-green-900/30';
            } else if (macdCrossingSignal === 'COver <0') {
              macdCrossingDisplay = 'COver <0';
              macdCrossingClass = 'text-yellow-400 font-semibold';
              macdCrossingTitle = 'MACD crosses above Signal BUT MACD < 0 (Weak Bullish)';
            }
            // Bearish Crossing Signals (Red)
            else if (macdCrossingSignal === 'CUnder <-50') {
              macdCrossingDisplay = 'CUnder <-50';
              macdCrossingClass = 'text-red-400 font-bold';
              macdCrossingTitle = 'MACD crosses below Signal AND MACD < -50 (Strong Bearish)';
            } else if (macdCrossingSignal === 'CUnder <0') {
              macdCrossingDisplay = 'CUnder <0';
              macdCrossingClass = 'text-red-400 font-bold';
              macdCrossingTitle = 'MACD crosses below Signal AND MACD < 0 (Bearish)';
              if (isRecentCrossing) macdCrossingCellClass = 'bg-red-900/30';
            } else if (macdCrossingSignal === 'CUnder >0') {
              macdCrossingDisplay = 'CUnder >0';
              macdCrossingClass = 'text-orange-400 font-semibold';
              macdCrossingTitle = 'MACD crosses below Signal BUT MACD > 0 (Weak Bearish)';
            }
            // Zero Line Crossings (Yellow/Orange)
            else if (macdCrossingSignal === 'MACD >0') {
              macdCrossingDisplay = 'MACD >0';
              macdCrossingClass = 'text-yellow-400 font-semibold';
              macdCrossingTitle = 'MACD line crosses above zero';
            } else if (macdCrossingSignal === 'MACD <0') {
              macdCrossingDisplay = 'MACD <0';
              macdCrossingClass = 'text-orange-400 font-semibold';
              macdCrossingTitle = 'MACD line crosses below zero';
            } else if (macdCrossingSignal === 'Signal >0') {
              macdCrossingDisplay = 'Signal >0';
              macdCrossingClass = 'text-yellow-400 font-semibold';
              macdCrossingTitle = 'Signal line crosses above zero';
            } else if (macdCrossingSignal === 'Signal <0') {
              macdCrossingDisplay = 'Signal <0';
              macdCrossingClass = 'text-orange-400 font-semibold';
              macdCrossingTitle = 'Signal line crosses below zero';
            }
            // Position States - Check MACD trend direction by comparing with previous alert
            else if (macdCrossingSignal === 'M > S') {
              const macdValue = parseFloat(alert.macd) || 0;
              const signalValue = parseFloat(alert.macdSignal) || 0;
              
              // Find previous alert for same symbol to detect MACD trend
              const prevAlert = filteredData.slice(index + 1).find(a => a.symbol === alert.symbol && a.macd !== undefined);
              let macdTrending = 'flat';
              
              if (prevAlert && prevAlert.macd !== undefined) {
                const prevMacdValue = parseFloat(prevAlert.macd) || 0;
                if (macdValue > prevMacdValue) {
                  macdTrending = 'up';
                } else if (macdValue < prevMacdValue) {
                  macdTrending = 'down';
                }
              }
              
              // Show M and S values for debugging
              const valueDisplay = \`M:\${macdValue.toFixed(2)} S:\${signalValue.toFixed(2)}\`;
              
              // Determine display based on MACD trend direction
              if (macdTrending === 'down') {
                macdCrossingDisplay = \`Down \${valueDisplay}\`;
                macdCrossingClass = 'text-orange-400 font-semibold';
                macdCrossingTitle = \`M > S but MACD trending down - M:\${macdValue.toFixed(2)} S:\${signalValue.toFixed(2)}\`;
              } else if (macdValue > 0) {
                macdCrossingDisplay = \`Drop in Uptrend \${valueDisplay}\`;
                macdCrossingClass = 'text-orange-400 font-semibold';
                macdCrossingTitle = \`M > S (>\${macdValue.toFixed(2)}) - Drop in uptrend\`;
              } else {
                macdCrossingDisplay = \`Up in Uptrend \${valueDisplay}\`;
                macdCrossingClass = 'text-green-400 font-semibold';
                macdCrossingTitle = \`M > S (<\${macdValue.toFixed(2)}) - Up in uptrend\`;
              }
            } else if (macdCrossingSignal === 'M < S') {
              const macdValue = parseFloat(alert.macd) || 0;
              const signalValue = parseFloat(alert.macdSignal) || 0;
              
              // Find previous alert for same symbol to detect MACD trend
              const prevAlert = filteredData.slice(index + 1).find(a => a.symbol === alert.symbol && a.macd !== undefined);
              let macdTrending = 'flat';
              
              if (prevAlert && prevAlert.macd !== undefined) {
                const prevMacdValue = parseFloat(prevAlert.macd) || 0;
                if (macdValue > prevMacdValue) {
                  macdTrending = 'up';
                } else if (macdValue < prevMacdValue) {
                  macdTrending = 'down';
                }
              }
              
              // Show M and S values for debugging
              const valueDisplay = \`M:\${macdValue.toFixed(2)} S:\${signalValue.toFixed(2)}\`;
              
              // Determine display based on MACD trend direction
              if (macdTrending === 'up') {
                macdCrossingDisplay = \`Up \${valueDisplay}\`;
                macdCrossingClass = 'text-lime-400 font-semibold';
                macdCrossingTitle = \`M < S but MACD trending up - M:\${macdValue.toFixed(2)} S:\${signalValue.toFixed(2)}\`;
              } else if (macdValue > 0) {
                macdCrossingDisplay = \`Drop in Downtrend \${valueDisplay}\`;
                macdCrossingClass = 'text-red-400 font-semibold';
                macdCrossingTitle = \`M < S (>\${macdValue.toFixed(2)}) - Drop in downtrend\`;
              } else {
                macdCrossingDisplay = \`Up in Downtrend \${valueDisplay}\`;
                macdCrossingClass = 'text-lime-400 font-semibold';
                macdCrossingTitle = \`M < S (<\${macdValue.toFixed(2)}) - Up in downtrend\`;
              }
            } else if (macdCrossingSignal === 'M = S') {
              const macdValue = parseFloat(alert.macd) || 0;
              const signalValue = parseFloat(alert.macdSignal) || 0;
              macdCrossingDisplay = \`M = S M:\${macdValue.toFixed(2)} S:\${signalValue.toFixed(2)}\`;
              macdCrossingClass = 'text-gray-400 font-semibold';
              macdCrossingTitle = 'MACD line equals Signal line (Neutral)';
            }
            
            // QS D7 Value gradient color (0-100 scale)
            let d4ValueClass = 'text-foreground';
            const d7Value = alert.octoStochD7 !== undefined
              ? parseFloat(alert.octoStochD7)
              : alert.d7 !== undefined
                ? parseFloat(alert.d7)
                : NaN;
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
            
            return \`
              <tr class="border-b border-border hover:bg-muted/50 transition-colors \${starred ? 'bg-muted/20' : ''}">
                <td class="py-3 pl-4 pr-1 text-center">
                  <button 
                    onclick="toggleStar('\${alert.symbol}')" 
                    class="text-xl \${starClass} transition-colors cursor-pointer hover:scale-110 transform"
                    title="\${starred ? 'Remove from favorites' : 'Add to favorites'}"
                  >
                    \${starIcon}
                  </button>
                </td>
                <td class="py-3 pl-1 pr-4 font-medium text-foreground w-auto whitespace-nowrap">\${alert.symbol || 'N/A'}</td>
                <td class="py-3 px-4 font-mono font-medium \${priceClass}">
                  $\${alert.price ? parseFloat(alert.price).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : 'N/A'}
                  <span class="text-sm ml-2 \${priceChangeClass}">\${priceChangeDisplay !== 'N/A' ? '(' + (parseFloat(priceChangeDisplay) >= 0 ? '+' : '') + priceChangeDisplay + '%)' : ''}</span>
                </td>
                <td class="py-3 px-4 font-bold \${trendClass} \${trendCellClass}" title="\${trendTitle}">\${trendDisplay}</td>
                <td class="py-3 px-4 text-lg \${qsArrowCellClass}" title="\${qsArrowTitle}">\${qsArrowDisplay}</td>
                <td class="py-3 px-4 font-bold \${qstochClass} \${qsD4CellClass}" title="\${qstochTitle}">\${qstochDisplay}</td>
                <td class="py-3 px-4 font-bold \${macdCrossingClass} \${macdCrossingCellClass}" title="\${macdCrossingTitle}">\${macdCrossingDisplay}</td>
                <td class="py-3 px-4 font-mono \${d4ValueClass}" title="Octo Stochastic D7 Value (0-100)">\${!isNaN(d7Value) ? d7Value.toFixed(2) : 'N/A'}</td>
                <td class="py-3 px-4 text-muted-foreground" title="Volume since 9:30 AM: \${alert.volume ? parseInt(alert.volume).toLocaleString() : 'N/A'}">\${formatVolume(alert.volume)}</td>
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
            document.getElementById('alertTable').innerHTML = '<tr><td colspan="11" class="text-center text-red-400 py-12 relative">Error loading alerts</td></tr>';
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
      </script>
    </body>
    </html>
  `)
})

app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})