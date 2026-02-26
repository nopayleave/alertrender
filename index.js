import express from 'express'
import cors from 'cors'
import nodemailer from 'nodemailer'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

// Data persistence configuration
const DATA_DIR = path.join(__dirname, 'data')
const DB_FILE = path.join(DATA_DIR, 'app-data.db')
const AUTO_SAVE_INTERVAL = 5 * 60 * 1000 // Auto-save every 5 minutes

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  console.log(`📁 Created data directory: ${DATA_DIR}`)
}

// Initialize SQLite database
let db = null
function initDatabase() {
  try {
    db = new Database(DB_FILE)
    db.pragma('journal_mode = WAL') // Write-Ahead Logging for better performance
    
    // Create tables
    db.exec(`
      -- Alerts table
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        data TEXT NOT NULL,
        receivedAt INTEGER NOT NULL
      );
      
      -- Alerts history table
      CREATE TABLE IF NOT EXISTS alerts_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        data TEXT NOT NULL,
        receivedAt INTEGER NOT NULL
      );
      
      -- Key-value storage for various data objects
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      
      -- Indexes for better query performance
      CREATE INDEX IF NOT EXISTS idx_alerts_symbol ON alerts(symbol);
      CREATE INDEX IF NOT EXISTS idx_alerts_receivedAt ON alerts(receivedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_alerts_history_symbol ON alerts_history(symbol);
      CREATE INDEX IF NOT EXISTS idx_alerts_history_receivedAt ON alerts_history(receivedAt DESC);
    `)
    
    console.log(`✅ Database initialized: ${DB_FILE}`)
    return true
  } catch (error) {
    console.error('❌ Error initializing database:', error)
    return false
  }
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
let cciDataStorage = {} // Store CCI crossover data by symbol with timestamp
let soloStochDataStorage = {} // Store Solo Stoch D2 data by symbol with timestamp
let stochOverviewDataStorage = {} // Store Stoch Overview (same stoch, higher TF) by symbol
let stochDetailDataStorage = {} // Store Stoch Detail (same stoch, lower TF) by symbol
let dualStochDataStorage = {} // Store Dual Stoch D1/D2 data by symbol with timestamp
let dualStochHistory = {} // Store historical D1/D2 values for mini charts: { symbol: [{ d1, d2, timestamp }, ...] }
let bigTrendDay = {} // Store Big Trend Day status per symbol per trading day: { symbol: { date: 'YYYY-MM-DD', isBigTrendDay: true } }
let starredSymbols = {} // Store starred symbols (synced from frontend)
let previousTrends = {} // Store previous trend for each symbol to detect changes
let patternData = {} // Store latest HL/LH pattern per symbol
let sectorData = {} // Store sector information by symbol (from webhook only)

// Data persistence functions using SQLite
function saveDataToDatabase() {
  if (!db) {
    console.error('❌ Database not initialized')
    return false
  }
  
  try {
    const transaction = db.transaction(() => {
      const now = Date.now()
      
      // Save alerts (keep only recent 5000)
      const alertsToSave = alerts.slice(0, 5000)
      db.prepare('DELETE FROM alerts').run()
      const insertAlert = db.prepare('INSERT INTO alerts (symbol, data, receivedAt) VALUES (?, ?, ?)')
      for (const alert of alertsToSave) {
        insertAlert.run(alert.symbol || '', JSON.stringify(alert), alert.receivedAt || now)
      }
      
      // Save alerts history (keep only recent 10000)
      const historyToSave = alertsHistory.slice(0, 10000)
      db.prepare('DELETE FROM alerts_history').run()
      const insertHistory = db.prepare('INSERT INTO alerts_history (symbol, data, receivedAt) VALUES (?, ?, ?)')
      for (const alert of historyToSave) {
        insertHistory.run(alert.symbol || '', JSON.stringify(alert), alert.receivedAt || now)
      }
      
      // Save all state objects as JSON
      const stateData = {
        dayChangeData,
        dayVolumeData,
        vwapCrossingData,
        quadStochData,
        quadStochD4Data,
        octoStochData,
        previousQSValues,
        previousDirections,
        previousPrices,
        macdCrossingData,
        cciDataStorage,
        soloStochDataStorage,
        stochOverviewDataStorage,
        stochDetailDataStorage,
        dualStochDataStorage,
        dualStochHistory,
        bigTrendDay,
        starredSymbols,
        previousTrends,
        patternData,
        sectorData
      }
      
      const upsertState = db.prepare('INSERT OR REPLACE INTO app_state (key, value, updatedAt) VALUES (?, ?, ?)')
      for (const [key, value] of Object.entries(stateData)) {
        upsertState.run(key, JSON.stringify(value), now)
      }
      
      // Save metadata
      upsertState.run('_metadata', JSON.stringify({ savedAt: new Date().toISOString() }), now)
    })
    
    transaction()
    
    console.log(`💾 Data saved to database (${alerts.length} alerts, ${alertsHistory.length} history entries)`)
    return true
  } catch (error) {
    console.error('❌ Error saving data to database:', error)
    return false
  }
}

function loadDataFromDatabase() {
  if (!db) {
    console.log('📂 Database not initialized, starting fresh')
    return false
  }
  
  try {
    // Load alerts (most recent 5000)
    const alertsRows = db.prepare('SELECT data FROM alerts ORDER BY receivedAt DESC LIMIT 5000').all()
    alerts = alertsRows.map(row => JSON.parse(row.data))
    
    // Load alerts history (most recent 10000)
    const historyRows = db.prepare('SELECT data FROM alerts_history ORDER BY receivedAt DESC LIMIT 10000').all()
    alertsHistory = historyRows.map(row => JSON.parse(row.data))
    
    // Load state objects
    const stateRows = db.prepare('SELECT key, value FROM app_state WHERE key != ?').all('_metadata')
    for (const row of stateRows) {
      try {
        const value = JSON.parse(row.value)
        switch (row.key) {
          case 'dayChangeData': dayChangeData = value; break
          case 'dayVolumeData': dayVolumeData = value; break
          case 'vwapCrossingData': vwapCrossingData = value; break
          case 'quadStochData': quadStochData = value; break
          case 'quadStochD4Data': quadStochD4Data = value; break
          case 'octoStochData': octoStochData = value; break
          case 'previousQSValues': previousQSValues = value; break
          case 'previousDirections': previousDirections = value; break
          case 'previousPrices': previousPrices = value; break
          case 'macdCrossingData': macdCrossingData = value; break
          case 'cciDataStorage': cciDataStorage = value; break
          case 'soloStochDataStorage': soloStochDataStorage = value; break
          case 'stochOverviewDataStorage': stochOverviewDataStorage = value; break
          case 'stochDetailDataStorage': stochDetailDataStorage = value; break
          case 'dualStochDataStorage': dualStochDataStorage = value; break
          case 'dualStochHistory': dualStochHistory = value; break
          case 'bigTrendDay': bigTrendDay = value; break
          case 'starredSymbols': starredSymbols = value; break
          case 'previousTrends': previousTrends = value; break
          case 'patternData': patternData = value; break
          case 'sectorData': sectorData = value; break
        }
      } catch (e) {
        console.warn(`⚠️  Failed to parse state key ${row.key}:`, e.message)
      }
    }
    
    // Get metadata
    const metadataRow = db.prepare('SELECT value FROM app_state WHERE key = ?').get('_metadata')
    const savedAt = metadataRow ? JSON.parse(metadataRow.value).savedAt : 'unknown'
    
    console.log(`✅ Data loaded from database (saved at: ${savedAt})`)
    console.log(`   - ${alerts.length} alerts restored`)
    console.log(`   - ${alertsHistory.length} historical alerts restored`)
    console.log(`   - ${Object.keys(starredSymbols).length} starred symbols restored`)
    return true
  } catch (error) {
    console.error('❌ Error loading data from database:', error)
    console.log('📂 Starting with empty data')
    return false
  }
}

// Helper function to get current date string in YYYY-MM-DD format
function getCurrentDateString() {
  const now = new Date()
  return now.toISOString().split('T')[0]
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

function parseStochValue(value) {
  if (value == null || value === '' || value === 'NaN') return null
  const num = parseFloat(value)
  return isNaN(num) ? null : num
}

// Webhook for TradingView POST
app.post('/webhook', (req, res) => {
  const alert = req.body
  
  // Log incoming webhook for debugging
  console.log('📨 Webhook received:', JSON.stringify(alert, null, 2))
  
  if (alert.symbol && alert.sector) {
    sectorData[alert.symbol] = alert.sector
    console.log(`📊 Received sector from webhook for ${alert.symbol}: ${alert.sector}`)
  }
  
  // Debug BJ TSI values
  if (alert.bjTsi !== undefined) {
    console.log('🔍 BJ TSI Debug:', {
      symbol: alert.symbol,
      bjTsi: alert.bjTsi,
      bjTsl: alert.bjTsl,
      bjTsiIsBull: alert.bjTsiIsBull,
      bjTslIsBull: alert.bjTslIsBull
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
  const isCciAlert = alert.cciCrossover !== undefined
  // Solo Stoch (stoch副本): d2Signal='Solo' or payload has k,d,kDirection,dDirection (K/D stoch)
  const isSoloStochAlert = alert.d2Signal === 'Solo' || (
    parseStochValue(alert.k) !== null && parseStochValue(alert.d) !== null &&
    alert.kDirection != null && alert.dDirection != null &&
    alert.d2Signal !== 'Dual'
  )
  const isDualStochAlert = alert.d2Signal === 'Dual'
  const isTriStochAlert = alert.d2Signal === 'Tri'
  
  // Log alert type detection for debugging
  console.log('📊 Alert type detected:', {
    isDayChangeAlert,
    isVwapCrossingAlert,
    isQuadStochAlert,
    isQuadStochD4Alert,
    isOctoStochAlert,
    isMacdCrossingAlert,
    isCciAlert,
    isSoloStochAlert,
    isDualStochAlert,
    isTriStochAlert,
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
  } else if (isCciAlert) {
    // CCI alert - store CCI crossover data with timestamp
    const cciData = {
      cciCrossover: alert.cciCrossover,
      cciDirection: alert.cciDirection,
      cciValue: alert.cciValue,
      cciMAValue: alert.cciMAValue,
      timestamp: Date.now()
    }
    
    // Store in a data storage object (similar to bjTsiDataStorage pattern)
    if (!cciDataStorage) cciDataStorage = {}
    cciDataStorage[alert.symbol] = cciData
    
    console.log(`✅ CCI data stored for ${alert.symbol}: Crossover=${alert.cciCrossover}, Direction=${alert.cciDirection}, CCI=${alert.cciValue}, MA=${alert.cciMAValue}`)
    
    // Update existing alert if it exists, or create new one if it doesn't
    const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
    if (existingIndex !== -1) {
      alerts[existingIndex].cciCrossover = cciData.cciCrossover
      alerts[existingIndex].cciDirection = cciData.cciDirection
      alerts[existingIndex].cciValue = cciData.cciValue
      alerts[existingIndex].cciMAValue = cciData.cciMAValue
      alerts[existingIndex].receivedAt = Date.now()
      console.log(`✅ Updated existing alert for ${alert.symbol} with CCI data`)
    } else {
      // Create new alert entry if it doesn't exist
      const newAlert = {
        symbol: alert.symbol,
        timeframe: alert.timeframe || null,
        price: alert.price || null,
        cciCrossover: cciData.cciCrossover,
        cciDirection: cciData.cciDirection,
        cciValue: cciData.cciValue,
        cciMAValue: cciData.cciMAValue,
        receivedAt: Date.now()
      }
      alerts.unshift(newAlert)
      console.log(`✅ Created new alert entry for ${alert.symbol} with CCI data`)
    }
  } else if (isTriStochAlert) {
    // Tri Stoch: single webhook carries k1/k2/k3 values + ov/dt mapped data
    const triStoch = {
      k1: alert.k1 || null,
      k2: alert.k2 || null,
      k3: alert.k3 || null,
      ovK: alert.ovK || null,
      ovD: alert.ovD || null,
      ovKDirection: alert.ovKDirection || null,
      ovDDirection: alert.ovDDirection || null,
      ovD2Pattern: alert.ovD2Pattern || '',
      ovD2PatternValue: alert.ovD2PatternValue || null,
      dtK: alert.dtK || null,
      dtD: alert.dtD || null,
      dtKDirection: alert.dtKDirection || null,
      dtDDirection: alert.dtDDirection || null,
      dtD2Pattern: alert.dtD2Pattern || '',
      dtD2PatternValue: alert.dtD2PatternValue || null,
      timestamp: Date.now()
    }
    stochOverviewDataStorage[alert.symbol] = {
      k: alert.ovK || null, d: alert.ovD || null, d2: alert.ovD || null,
      kDirection: alert.ovKDirection || null, dDirection: alert.ovDDirection || null, d2Direction: alert.ovDDirection || null,
      d2Pattern: alert.ovD2Pattern || '', d2PatternValue: alert.ovD2PatternValue || null,
      timestamp: Date.now()
    }
    stochDetailDataStorage[alert.symbol] = {
      k: alert.dtK || null, d: alert.dtD || null, d2: alert.dtD || null,
      kDirection: alert.dtKDirection || null, dDirection: alert.dtDDirection || null, d2Direction: alert.dtDDirection || null,
      d2Pattern: alert.dtD2Pattern || '', d2PatternValue: alert.dtD2PatternValue || null,
      timestamp: Date.now()
    }
    console.log(`✅ Tri Stoch stored for ${alert.symbol}: K1=${alert.k1}, K2=${alert.k2}, K3=${alert.k3}`)

    const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
    if (existingIndex !== -1) {
      alerts[existingIndex].triStoch = triStoch
      if (alert.price) alerts[existingIndex].price = alert.price
      if (alert.previousClose !== undefined) alerts[existingIndex].previousClose = alert.previousClose
      if (alert.changeFromPrevDay !== undefined) alerts[existingIndex].changeFromPrevDay = alert.changeFromPrevDay
      if (alert.volume !== undefined) alerts[existingIndex].volume = alert.volume
      alerts[existingIndex].receivedAt = Date.now()
    } else {
      alerts.unshift({
        symbol: alert.symbol,
        timeframe: alert.timeframe || null,
        price: alert.price || null,
        previousClose: alert.previousClose || null,
        changeFromPrevDay: alert.changeFromPrevDay || null,
        volume: alert.volume || null,
        triStoch,
        receivedAt: Date.now()
      })
      console.log(`✅ Created alert row for ${alert.symbol} (Tri Stoch)`)
    }
  } else if (isSoloStochAlert) {
    // Stoch Overview / Detail: same stoch alert, different timeframe (payload.stochType: 'overview' | 'detail')
    const stochType = alert.stochType === 'overview' || alert.stochType === 'detail' ? alert.stochType : null
    const d2Value = alert.d2 !== undefined ? alert.d2 : alert.d
    const d2Direction = alert.d2Direction !== undefined ? alert.d2Direction : alert.dDirection
    const stochPayload = {
      d2: d2Value,
      d2Direction: d2Direction,
      k: alert.k || null,
      kDirection: alert.kDirection || null,
      d: alert.d || null,
      dDirection: alert.dDirection || null,
      kCross: alert.kCross || 'none',
      d2Pattern: alert.d2Pattern || '',
      d2PatternValue: alert.d2PatternValue || null,
      previousClose: alert.previousClose || null,
      changeFromPrevDay: alert.changeFromPrevDay || null,
      volume: alert.volume || null,
      timestamp: Date.now()
    }

    if (stochType === 'overview') {
      stochOverviewDataStorage[alert.symbol] = stochPayload
      console.log(`✅ Stoch Overview stored for ${alert.symbol}: K=${alert.k || 'N/A'}, D=${d2Value}, Dir=${d2Direction}`)
      // Ensure symbol has an alert row so it appears in the list (Overview/Detail merged on GET /alerts)
      const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
      if (existingIndex !== -1) {
        alerts[existingIndex].receivedAt = Date.now()
      } else {
        alerts.unshift({
          symbol: alert.symbol,
          timeframe: alert.timeframe || null,
          price: alert.price || null,
          previousClose: alert.previousClose || null,
          changeFromPrevDay: alert.changeFromPrevDay || null,
          volume: alert.volume || null,
          receivedAt: Date.now()
        })
        console.log(`✅ Created alert row for ${alert.symbol} (Stoch Overview)`)
      }
    } else if (stochType === 'detail') {
      stochDetailDataStorage[alert.symbol] = stochPayload
      console.log(`✅ Stoch Detail stored for ${alert.symbol}: K=${alert.k || 'N/A'}, D=${d2Value}, Dir=${d2Direction}`)
      // Ensure symbol has an alert row so it appears in the list (Overview/Detail merged on GET /alerts)
      const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
      if (existingIndex !== -1) {
        alerts[existingIndex].receivedAt = Date.now()
      } else {
        alerts.unshift({
          symbol: alert.symbol,
          timeframe: alert.timeframe || null,
          price: alert.price || null,
          previousClose: alert.previousClose || null,
          changeFromPrevDay: alert.changeFromPrevDay || null,
          volume: alert.volume || null,
          receivedAt: Date.now()
        })
        console.log(`✅ Created alert row for ${alert.symbol} (Stoch Detail)`)
      }
    } else {
      // Legacy Solo Stoch (no stochType): store and update/create alert
      soloStochDataStorage[alert.symbol] = stochPayload
      console.log(`✅ Solo Stoch data stored for ${alert.symbol}: K=${alert.k || 'N/A'}, D=${d2Value}, Dir=${d2Direction}, Chg%=${alert.changeFromPrevDay || 'N/A'}, Vol=${alert.volume || 'N/A'}`)

      const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
      if (existingIndex !== -1) {
        alerts[existingIndex].soloStochD2 = d2Value
        alerts[existingIndex].soloStochD2Direction = d2Direction
        alerts[existingIndex].soloStochD2Pattern = alert.d2Pattern || ''
        alerts[existingIndex].soloStochD2PatternValue = alert.d2PatternValue || null
        if (alert.k !== undefined) alerts[existingIndex].k = alert.k
        if (alert.kDirection !== undefined) alerts[existingIndex].kDirection = alert.kDirection
        if (alert.d !== undefined) alerts[existingIndex].d = alert.d
        if (alert.dDirection !== undefined) alerts[existingIndex].dDirection = alert.dDirection
        if (alert.price) alerts[existingIndex].price = alert.price
        if (alert.previousClose !== undefined) alerts[existingIndex].previousClose = alert.previousClose
        if (alert.changeFromPrevDay !== undefined) alerts[existingIndex].changeFromPrevDay = alert.changeFromPrevDay
        if (alert.volume !== undefined) alerts[existingIndex].volume = alert.volume
        alerts[existingIndex].receivedAt = Date.now()
        console.log(`✅ Updated existing alert for ${alert.symbol} with Solo Stoch data`)
      } else {
        const newAlert = {
          symbol: alert.symbol,
          timeframe: alert.timeframe || null,
          price: alert.price || null,
          previousClose: alert.previousClose || null,
          changeFromPrevDay: alert.changeFromPrevDay || null,
          volume: alert.volume || null,
          soloStochD2: d2Value,
          soloStochD2Direction: d2Direction,
          soloStochD2Pattern: alert.d2Pattern || '',
          soloStochD2PatternValue: alert.d2PatternValue || null,
          k: alert.k || null,
          kDirection: alert.kDirection || null,
          d: alert.d || null,
          dDirection: alert.dDirection || null,
          receivedAt: Date.now()
        }
        alerts.unshift(newAlert)
        console.log(`✅ Created new alert entry for ${alert.symbol} with Solo Stoch data`)
      }
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
        price: alert.price || null,
        previousClose: alert.previousClose || null,
        changeFromPrevDay: alert.changeFromPrevDay || null,
        volume: alert.volume || null,
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
    
    // Check and add CCI data if active (within last 60 minutes)
    const cciInfo = cciDataStorage[alert.symbol]
    if (cciInfo) {
      const ageInMinutes = (Date.now() - cciInfo.timestamp) / 60000
      if (ageInMinutes <= 60) {
        // CCI data is recent (within 60 minutes), merge it
        alertData.cciCrossover = cciInfo.cciCrossover
        alertData.cciDirection = cciInfo.cciDirection
        alertData.cciValue = cciInfo.cciValue
        alertData.cciMAValue = cciInfo.cciMAValue
        console.log(`✅ Merged CCI data for ${alert.symbol}: Crossover=${cciInfo.cciCrossover}, Direction=${cciInfo.cciDirection}, CCI=${cciInfo.cciValue} (age: ${ageInMinutes.toFixed(1)} min)`)
      } else {
        // Data is old, expire it
        delete cciDataStorage[alert.symbol]
        console.log(`⏰ CCI data expired for ${alert.symbol} (age: ${ageInMinutes.toFixed(1)} min)`)
      }
    } else {
      // If no stored CCI data, check if this alert has CCI data
      if (alert.cciCrossover !== undefined) {
        alertData.cciCrossover = alert.cciCrossover
        alertData.cciDirection = alert.cciDirection
        alertData.cciValue = alert.cciValue
        alertData.cciMAValue = alert.cciMAValue
        console.log(`✅ Using CCI data from alert for ${alert.symbol}: Crossover=${alert.cciCrossover}`)
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
          const chartWidth = 80
          const chartHeight = 32
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
    
    if (alert.sector) {
      alertData.sector = alert.sector
      sectorData[alert.symbol] = alert.sector
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
               isCciAlert ? 'cci' :
               isTriStochAlert ? 'tri_stoch' :
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
  
  const STOCH_STORAGE_MAX_AGE_MINUTES = 60
  const now = Date.now()
  
  // Inject sector data and merge triStoch from storage
  result.forEach(alert => {
    if (!alert.sector && sectorData[alert.symbol]) {
      alert.sector = sectorData[alert.symbol]
    }
    // Reconstruct triStoch from stoch data storages if not already present
    if (!alert.triStoch) {
      const ovInfo = stochOverviewDataStorage[alert.symbol]
      const dtInfo = stochDetailDataStorage[alert.symbol]
      const ovRecent = ovInfo && (now - ovInfo.timestamp) / 60000 <= STOCH_STORAGE_MAX_AGE_MINUTES
      const dtRecent = dtInfo && (now - dtInfo.timestamp) / 60000 <= STOCH_STORAGE_MAX_AGE_MINUTES
      if (ovRecent || dtRecent) {
        alert.triStoch = {
          k1: ovRecent && ovInfo.k1 ? ovInfo.k1 : null,
          k2: dtRecent && dtInfo.k2 ? dtInfo.k2 : null,
          k3: ovRecent && ovInfo.k3 ? ovInfo.k3 : (dtRecent && dtInfo.k3 ? dtInfo.k3 : null),
          ovK: ovRecent ? ovInfo.k : null,
          ovD: ovRecent ? ovInfo.d : null,
          ovKDirection: ovRecent ? ovInfo.kDirection : null,
          ovDDirection: ovRecent ? (ovInfo.d2Direction || ovInfo.dDirection) : null,
          dtK: dtRecent ? dtInfo.k : null,
          dtD: dtRecent ? dtInfo.d : null,
          dtKDirection: dtRecent ? dtInfo.kDirection : null,
          dtDDirection: dtRecent ? (dtInfo.d2Direction || dtInfo.dDirection) : null,
          timestamp: Math.max(ovRecent ? ovInfo.timestamp : 0, dtRecent ? dtInfo.timestamp : 0)
        }
      }
    }
  })
  
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
  cciDataStorage = {}
  soloStochDataStorage = {}
  stochOverviewDataStorage = {}
  stochDetailDataStorage = {}
  dualStochDataStorage = {}
  bigTrendDay = {}
  patternData = {}
  saveDataToDatabase() // Save after clearing
  res.json({ status: 'ok', message: 'All alerts cleared and saved' })
})

// Endpoint to manually save data
app.post('/save-data', (req, res) => {
  const success = saveDataToDatabase()
  if (success) {
    res.json({ status: 'ok', message: 'Data saved successfully' })
  } else {
    res.status(500).json({ status: 'error', message: 'Failed to save data' })
  }
})

// Endpoint to export database file
app.get('/export/database', (req, res) => {
  try {
    if (!db || !fs.existsSync(DB_FILE)) {
      return res.status(404).json({ status: 'error', message: 'Database file not found' })
    }
    
    // Save current state before export
    saveDataToDatabase()
    
    const filename = `alertrender-backup-${new Date().toISOString().split('T')[0]}.db`
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    
    const fileStream = fs.createReadStream(DB_FILE)
    fileStream.pipe(res)
    
    console.log(`📥 Database export requested: ${filename}`)
  } catch (error) {
    console.error('❌ Error exporting database:', error)
    res.status(500).json({ status: 'error', message: 'Failed to export database' })
  }
})

// Endpoint to export all data as JSON
app.get('/export/json', (req, res) => {
  try {
    // Save current state before export
    saveDataToDatabase()
    
    const exportData = {
      alerts: alerts.slice(0, 5000),
      alertsHistory: alertsHistory.slice(0, 10000),
      dayChangeData,
      dayVolumeData,
      vwapCrossingData,
      quadStochData,
      quadStochD4Data,
      octoStochData,
      previousQSValues,
      previousDirections,
      previousPrices,
      macdCrossingData,
      bjTsiDataStorage,
      soloStochDataStorage,
      dualStochDataStorage,
      dualStochHistory,
      bigTrendDay,
      starredSymbols,
      previousTrends,
      patternData,
      exportedAt: new Date().toISOString(),
      stats: {
        alertsCount: alerts.length,
        alertsHistoryCount: alertsHistory.length,
        starredSymbolsCount: Object.keys(starredSymbols).filter(k => starredSymbols[k]).length
      }
    }
    
    const filename = `alertrender-backup-${new Date().toISOString().split('T')[0]}.json`
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    
    res.json(exportData)
    
    console.log(`📥 JSON export requested: ${filename} (${alerts.length} alerts, ${alertsHistory.length} history)`)
  } catch (error) {
    console.error('❌ Error exporting JSON:', error)
    res.status(500).json({ status: 'error', message: 'Failed to export data' })
  }
})

// Endpoint to get database statistics
app.get('/export/stats', (req, res) => {
  try {
    if (!db) {
      return res.json({ 
        status: 'ok', 
        database: 'not_initialized',
        stats: {
          alertsCount: alerts.length,
          alertsHistoryCount: alertsHistory.length,
          starredSymbolsCount: Object.keys(starredSymbols).filter(k => starredSymbols[k]).length
        }
      })
    }
    
    // Get database file size
    const dbSize = fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0
    
    // Get row counts from database
    const alertsCount = db.prepare('SELECT COUNT(*) as count FROM alerts').get().count
    const historyCount = db.prepare('SELECT COUNT(*) as count FROM alerts_history').get().count
    const stateKeysCount = db.prepare('SELECT COUNT(*) as count FROM app_state').get().count
    
    // Get unique symbols
    const uniqueSymbols = db.prepare('SELECT COUNT(DISTINCT symbol) as count FROM alerts').get().count
    
    res.json({
      status: 'ok',
      database: {
        file: DB_FILE,
        size: dbSize,
        sizeFormatted: `${(dbSize / 1024 / 1024).toFixed(2)} MB`,
        exists: fs.existsSync(DB_FILE)
      },
      stats: {
        alertsCount,
        alertsHistoryCount,
        stateKeysCount,
        uniqueSymbols,
        starredSymbolsCount: Object.keys(starredSymbols).filter(k => starredSymbols[k]).length,
        memoryAlertsCount: alerts.length,
        memoryHistoryCount: alertsHistory.length
      },
      lastSaved: db.prepare('SELECT updatedAt FROM app_state WHERE key = ?').get('_metadata')?.updatedAt || null
    })
  } catch (error) {
    console.error('❌ Error getting stats:', error)
    res.status(500).json({ status: 'error', message: 'Failed to get statistics' })
  }
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

// Avoid 404 when browser requests favicon
app.get('/favicon.ico', (req, res) => {
  res.status(204).end()
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
      <!-- noUiSlider for range sliders -->
      <link href="https://cdn.jsdelivr.net/npm/nouislider@15.7.1/dist/nouislider.min.css" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/nouislider@15.7.1/dist/nouislider.min.js"></script>
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
            max-width: 1700px;
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
        /* Column resize handle */
        .column-resize-handle {
          position: absolute;
          top: 0;
          right: 0;
          width: 6px;
          height: 100%;
          cursor: col-resize;
          background: transparent;
          z-index: 20;
          user-select: none;
          touch-action: none;
          margin-right: -3px;
        }
        .column-resize-handle:hover {
          background: rgba(59, 130, 246, 0.5);
        }
        .column-resize-handle.resizing {
          background: rgba(59, 130, 246, 0.9);
        }
        th {
          position: relative;
        }
        /* Prevent drag when clicking on resize handle */
        th .column-resize-handle {
          pointer-events: auto;
        }
        th.draggable-header:has(.column-resize-handle:hover) {
          cursor: col-resize;
        }
        /* Show resize indicator on header hover */
        th:hover .column-resize-handle {
          background: rgba(59, 130, 246, 0.2);
        }
        /* iOS-style filter chips */
        .filter-chip {
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
        .filter-chip.active {
          opacity: 1 !important;
          transform: scale(1.02);
        }
        /* Enhance existing colors for active state by increasing opacity/intensity */
        .filter-chip.active[class*="green"] {
          background: rgba(34, 197, 94, 0.35) !important;
          border-color: rgba(34, 197, 94, 0.7) !important;
          box-shadow: 0 2px 8px rgba(34, 197, 94, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }
        .filter-chip.active[class*="red"] {
          background: rgba(239, 68, 68, 0.35) !important;
          border-color: rgba(239, 68, 68, 0.7) !important;
          box-shadow: 0 2px 8px rgba(239, 68, 68, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }
        .filter-chip.active[class*="lime"] {
          background: rgba(132, 204, 22, 0.35) !important;
          border-color: rgba(132, 204, 22, 0.7) !important;
          box-shadow: 0 2px 8px rgba(132, 204, 22, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }
        .filter-chip.active[class*="orange"] {
          background: rgba(251, 146, 60, 0.35) !important;
          border-color: rgba(251, 146, 60, 0.7) !important;
          box-shadow: 0 2px 8px rgba(251, 146, 60, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }
        .filter-chip.active[class*="purple"] {
          background: rgba(168, 85, 247, 0.35) !important;
          border-color: rgba(168, 85, 247, 0.7) !important;
          box-shadow: 0 2px 8px rgba(168, 85, 247, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }
        .filter-chip.active[class*="gray"] {
          background: rgba(156, 163, 175, 0.35) !important;
          border-color: rgba(156, 163, 175, 0.7) !important;
          box-shadow: 0 2px 8px rgba(156, 163, 175, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }
        .filter-chip:active {
          transform: scale(0.95);
        }
        .filter-chip.active:active {
          transform: scale(0.92);
        }
        /* Dim inactive chips when one is active in the group */
        .filter-group.has-active .filter-chip:not(.active) {
          opacity: 0.4;
        }
        .filter-group.has-active .filter-chip:not(.active):hover {
          opacity: 0.7;
        }
        /* Dim inactive preset filter buttons when one is active */
        .preset-filter-group.has-active .preset-filter-chip:not(.active) {
          opacity: 0.4;
        }
        .preset-filter-group.has-active .preset-filter-chip:not(.active):hover {
          opacity: 0.7;
        }
        /* Filter group background */
        .filter-section {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 16px;
          padding: 16px;
        }
        /* Collapsible filter content */
        .filter-content {
          max-height: 1000px;
          overflow: hidden;
          transition: max-height 0.3s ease-out, opacity 0.2s ease-out;
          opacity: 1;
        }
        .filter-content.collapsed {
          max-height: 0;
          opacity: 0;
        }
        .filter-chevron {
          transition: transform 0.2s ease-out;
        }
        .filter-chevron.collapsed {
          transform: rotate(-90deg);
        }
        /* Hide scrollbar but allow scrolling */
        .hide-scrollbar {
          -ms-overflow-style: none;  /* IE and Edge */
          scrollbar-width: none;  /* Firefox */
        }
        .hide-scrollbar::-webkit-scrollbar {
          display: none;  /* Chrome, Safari and Opera */
        }
        /* Override xl:gap-6 to reduce space between filter and table */
        @media (min-width: 1280px) {
          .xl\:gap-6 {
            gap: 0.5rem;
          }
        }
        /* Remove border from last table row */
        tbody tr:last-child {
          border-bottom: none !important;
        }
        /* iOS-style search input focus */
        input:focus {
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        /* iOS-style range slider */
        .diff-slider {
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
        }
        .diff-slider::-webkit-slider-track {
          background: hsl(217.2 32.6% 17.5%);
          height: 4px;
          border-radius: 2px;
        }
        .diff-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: hsl(210 40% 98%);
          border: 2px solid rgb(59, 130, 246);
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          transition: all 0.2s;
        }
        .diff-slider::-webkit-slider-thumb:hover {
          transform: scale(1.1);
          box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
        }
        .diff-slider::-moz-range-track {
          background: hsl(217.2 32.6% 17.5%);
          height: 4px;
          border-radius: 2px;
        }
        .diff-slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: hsl(210 40% 98%);
          border: 2px solid rgb(59, 130, 246);
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          transition: all 0.2s;
        }
        .diff-slider::-moz-range-thumb:hover {
          transform: scale(1.1);
          box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
        }
        /* Material UI-inspired range slider styles */
        .range-track {
          pointer-events: none;
        }
        .range-indicator {
          pointer-events: none;
          transition: left 0.1s, width 0.1s;
        }
        .range-slider-handle::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: hsl(210 40% 98%);
          border: 2px solid rgb(59, 130, 246);
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3), 0 0 0 0 rgba(59, 130, 246, 0);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
        }
        .range-slider-handle::-webkit-slider-thumb:hover {
          transform: scale(1.15);
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.5), 0 0 0 4px rgba(59, 130, 246, 0.1);
        }
        .range-slider-handle::-webkit-slider-thumb:active {
          transform: scale(1.2);
          box-shadow: 0 6px 16px rgba(59, 130, 246, 0.6), 0 0 0 6px rgba(59, 130, 246, 0.15);
        }
        .range-slider-handle::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: hsl(210 40% 98%);
          border: 2px solid rgb(59, 130, 246);
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .range-slider-handle::-moz-range-thumb:hover {
          transform: scale(1.15);
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.5);
        }
        .range-slider-handle::-moz-range-thumb:active {
          transform: scale(1.2);
          box-shadow: 0 6px 16px rgba(59, 130, 246, 0.6);
        }
        .range-slider-handle::-webkit-slider-runnable-track {
          height: 2px;
          background: transparent;
        }
        .range-slider-handle::-moz-range-track {
          height: 2px;
          background: transparent;
        }
        .range-slider-handle:disabled::-webkit-slider-thumb {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }
        .range-slider-handle:disabled::-moz-range-thumb {
          opacity: 0.5;
          cursor: not-allowed;
        }
        /* noUiSlider custom dark theme */
        .noUi-target {
          background: hsl(217.2 32.6% 17.5%);
          border-radius: 4px;
          border: none;
          box-shadow: none;
        }
        .noUi-connect {
          background: rgb(59, 130, 246);
          border-radius: 4px;
        }
        .noUi-horizontal {
          height: 8px;
        }
        .noUi-horizontal .noUi-handle {
          width: 20px;
          height: 20px;
          right: -10px;
          top: -6px;
          border-radius: 50%;
          background: hsl(210 40% 98%);
          border: 2px solid rgb(59, 130, 246);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
          cursor: pointer;
        }
        .noUi-horizontal .noUi-handle::before,
        .noUi-horizontal .noUi-handle::after {
          display: none;
        }
        .noUi-handle:hover {
          transform: scale(1.1);
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.5), 0 0 0 4px rgba(59, 130, 246, 0.1);
        }
        .noUi-handle:active {
          transform: scale(1.15);
          box-shadow: 0 6px 16px rgba(59, 130, 246, 0.6), 0 0 0 6px rgba(59, 130, 246, 0.15);
        }
        .noUi-target[disabled] .noUi-connect {
          background: hsl(217.2 32.6% 25%);
        }
        .noUi-target[disabled] .noUi-handle {
          background: #9ca3af !important;
          border-color: #6b7280 !important;
          cursor: not-allowed;
          transform: none !important;
        }
        .noUi-target[disabled] .noUi-handle:hover,
        .noUi-target[disabled] .noUi-handle:active {
          transform: none !important;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3) !important;
        }
        .noUi-tooltip {
          display: none;
          background: hsl(222.2 84% 4.9%);
          border: 1px solid hsl(217.2 32.6% 17.5%);
          border-radius: 4px;
          color: hsl(210 40% 98%);
          font-size: 11px;
          padding: 2px 6px;
        }
        .noUi-active .noUi-tooltip {
          display: block;
        }
        /* Flash animation for direction changes */
        @keyframes flash {
          0% { background-color: rgba(59, 130, 246, 0.3); }
          50% { background-color: rgba(59, 130, 246, 0.6); }
          100% { background-color: transparent; }
        }
        .stoch-flash {
          animation: flash 0.8s ease-out;
        }
        /* Calculator slide-in panel */
        .calculator-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 1000;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.3s ease, visibility 0.3s ease;
        }
        .calculator-overlay.open {
          opacity: 1;
          visibility: visible;
        }
        .calculator-panel {
          position: fixed;
          top: 0;
          right: 0;
          width: 100%;
          max-width: 600px;
          height: 100vh;
          background: hsl(222.2 84% 4.9%);
          box-shadow: -4px 0 24px rgba(0, 0, 0, 0.5);
          z-index: 1001;
          transform: translateX(100%);
          transition: transform 0.3s ease;
          overflow-y: auto;
        }
        .calculator-panel.open {
          transform: translateX(0);
        }
        /* Exit Logic slide-in panel */
        .exit-logic-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 1000;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.3s ease, visibility 0.3s ease;
        }
        .exit-logic-overlay.open {
          opacity: 1;
          visibility: visible;
        }
        .exit-logic-panel {
          position: fixed;
          top: 0;
          right: 0;
          width: 100%;
          max-width: 700px;
          height: 100vh;
          background: hsl(222.2 84% 4.9%);
          box-shadow: -4px 0 24px rgba(0, 0, 0, 0.5);
          z-index: 1001;
          transform: translateX(100%);
          transition: transform 0.3s ease;
          overflow-y: auto;
        }
        .exit-logic-panel.open {
          transform: translateX(0);
        }
        .strategy-card {
          background: hsl(217.2 32.6% 17.5%);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
          transition: all 0.2s;
        }
        .strategy-card:hover {
          background: hsl(217.2 32.6% 20%);
          border-color: rgba(255, 255, 255, 0.2);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }
        .strategy-title {
          font-size: 1.25rem;
          font-weight: 600;
          color: hsl(210 40% 98%);
          margin-bottom: 0.75rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .strategy-description {
          color: hsl(215 20.2% 65.1%);
          font-size: 0.875rem;
          margin-bottom: 1rem;
        }
        .exit-rules {
          background: hsl(217.2 32.6% 12%);
          border-radius: 8px;
          padding: 1rem;
          border-left: 4px solid;
        }
        .exit-rules.long {
          border-left-color: #22c55e;
        }
        .exit-rules.short {
          border-left-color: #ef4444;
        }
        .exit-rules h4 {
          color: hsl(210 40% 98%);
          font-weight: 600;
          margin-bottom: 0.5rem;
          font-size: 0.875rem;
        }
        .exit-rules ol {
          list-style: decimal;
          margin-left: 1.25rem;
          color: hsl(215 20.2% 75%);
          font-size: 0.875rem;
        }
        .exit-rules li {
          margin-bottom: 0.25rem;
        }
        /* Exit Logic Tabs */
        .exit-logic-tabs {
          display: flex;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          margin-bottom: 2rem;
          gap: 0.5rem;
        }
        .exit-logic-tab {
          padding: 0.75rem 1.5rem;
          background: transparent;
          border: none;
          color: hsl(215 20.2% 65.1%);
          font-weight: 500;
          font-size: 0.875rem;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: all 0.2s;
          position: relative;
        }
        .exit-logic-tab:hover {
          color: hsl(210 40% 98%);
          background: rgba(255, 255, 255, 0.05);
        }
        .exit-logic-tab.active {
          color: hsl(210 40% 98%);
          border-bottom-color: #3b82f6;
          background: rgba(59, 130, 246, 0.1);
        }
        .exit-logic-tab-content {
          display: none;
        }
        .exit-logic-tab-content.active {
          display: block;
        }
        .exit-strategy-container {
          background: hsl(217.2 32.6% 17.5%);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
          transition: all 0.2s;
        }
        .exit-strategy-container:hover {
          background: hsl(217.2 32.6% 20%);
          border-color: rgba(255, 255, 255, 0.2);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }
        /* Hide scrollbar for cheatsheet table but allow scrolling */
        .cheatsheet-scroll-container {
          -ms-overflow-style: none;  /* IE and Edge */
          scrollbar-width: none;  /* Firefox */
          cursor: grab;
        }
        .cheatsheet-scroll-container::-webkit-scrollbar {
          display: none;  /* Chrome, Safari and Opera */
        }
        .cheatsheet-scroll-container:active {
          cursor: grabbing;
        }
        /* Export Modal */
        .export-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 2000;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.3s ease, visibility 0.3s ease;
        }
        .export-modal-overlay.open {
          opacity: 1;
          visibility: visible;
        }
        .export-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) scale(0.9);
          background: hsl(222.2 84% 4.9%);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          padding: 24px;
          z-index: 2001;
          min-width: 400px;
          max-width: 90vw;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.3s ease, visibility 0.3s ease, transform 0.3s ease;
        }
        .export-modal.open {
          opacity: 1;
          visibility: visible;
          transform: translate(-50%, -50%) scale(1);
        }
        /* Kanban board styles */
        .kanban-board {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
          align-items: start;
        }
        .kanban-column {
          background: hsl(217.2 32.6% 14.5%);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 12px;
          min-height: 160px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .kanban-column-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 12px;
          font-weight: 600;
          color: hsl(210 40% 98%);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .kanban-column-count {
          font-size: 11px;
          padding: 2px 6px;
          border-radius: 999px;
          background: rgba(59, 130, 246, 0.2);
          color: #60a5fa;
          border: 1px solid rgba(59, 130, 246, 0.4);
        }
        .kanban-card {
          background: hsl(217.2 32.6% 17.5%);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          padding: 10px 12px;
          transition: all 0.2s;
        }
        .kanban-card:hover {
          background: hsl(217.2 32.6% 20%);
          border-color: rgba(255, 255, 255, 0.2);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
        }
        .kanban-card.starred {
          border-color: rgba(251, 191, 36, 0.5);
          background: hsl(217.2 32.6% 20%);
        }
        .kanban-card-empty {
          text-align: center;
          font-size: 12px;
          color: hsl(215 20.2% 65.1%);
          padding: 12px 0 8px;
        }
        /* Toast notification styles */
        .toast-container {
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          gap: 10px;
          pointer-events: none;
        }
        .toast {
          pointer-events: auto;
          min-width: 300px;
          max-width: 400px;
          padding: 16px;
          background: hsl(222.2 84% 4.9%);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          gap: 12px;
          animation: slideInRight 0.3s ease-out;
          transition: opacity 0.3s ease-out, transform 0.3s ease-out;
        }
        .toast.hiding {
          animation: slideOutRight 0.3s ease-out;
          opacity: 0;
          transform: translateX(100%);
        }
        .toast.cross-high {
          border-left: 4px solid #22c55e;
        }
        .toast.cross-low {
          border-left: 4px solid #ef4444;
        }
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes slideOutRight {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(100%);
            opacity: 0;
          }
        }
        .toast-icon {
          font-size: 24px;
          flex-shrink: 0;
        }
        .toast-content {
          flex: 1;
        }
        .toast-title {
          font-weight: 600;
          font-size: 14px;
          color: hsl(210 40% 98%);
          margin-bottom: 4px;
        }
        .toast-message {
          font-size: 12px;
          color: hsl(215 20.2% 65.1%);
        }
        .toast-close {
          cursor: pointer;
          color: hsl(215 20.2% 65.1%);
          font-size: 18px;
          line-height: 1;
          padding: 4px;
          transition: color 0.2s;
        }
        .toast-close:hover {
          color: hsl(210 40% 98%);
        }
        /* ORB History Overlay */
        .orb-history-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 10000;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.3s ease, visibility 0.3s ease;
        }
        .orb-history-overlay.open {
          opacity: 1;
          visibility: visible;
        }
        .orb-history-panel {
          position: fixed;
          top: 0;
          right: 0;
          width: 100%;
          max-width: 600px;
          height: 100vh;
          background: hsl(222.2 84% 4.9%);
          border-left: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: -4px 0 24px rgba(0, 0, 0, 0.5);
          z-index: 10001;
          transform: translateX(100%);
          transition: transform 0.3s ease;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .orb-history-panel.open {
          transform: translateX(0);
        }
        .orb-history-header {
          padding: 20px 24px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .orb-history-header h3 {
          font-size: 18px;
          font-weight: 600;
          color: hsl(210 40% 98%);
        }
        .orb-history-close {
          cursor: pointer;
          color: hsl(215 20.2% 65.1%);
          font-size: 24px;
          line-height: 1;
          padding: 4px;
          transition: color 0.2s;
        }
        .orb-history-close:hover {
          color: hsl(210 40% 98%);
        }
        .orb-history-content {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }
        .orb-history-item {
          padding: 12px 16px;
          margin-bottom: 8px;
          background: hsl(217.2 32.6% 17.5%);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          border-left: 4px solid;
          transition: background 0.2s;
        }
        .orb-history-item:hover {
          background: hsl(217.2 32.6% 20%);
        }
        .orb-history-item.cross-high {
          border-left-color: #22c55e;
        }
        .orb-history-item.cross-low {
          border-left-color: #ef4444;
        }
        .orb-history-item-content {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .orb-history-symbol {
          font-weight: 600;
          font-size: 14px;
          color: hsl(210 40% 98%);
        }
        .orb-history-separator {
          color: hsl(215 20.2% 50%);
          font-size: 12px;
        }
        .orb-history-crossover {
          font-size: 13px;
          color: hsl(215 20.2% 65.1%);
        }
        .orb-history-time {
          font-size: 12px;
          color: hsl(215 20.2% 50%);
        }
        .orb-history-empty {
          text-align: center;
          padding: 48px 24px;
          color: hsl(215 20.2% 65.1%);
        }
        .orb-history-filters {
          padding: 16px 24px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          background: hsl(217.2 32.6% 15%);
        }
        .orb-history-filter-group {
          margin-bottom: 12px;
        }
        .orb-history-filter-group:last-child {
          margin-bottom: 0;
        }
        .orb-history-filter-label {
          display: block;
          font-size: 12px;
          font-weight: 500;
          color: hsl(215 20.2% 65.1%);
          margin-bottom: 8px;
        }
        .orb-history-filter-chips {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .orb-history-filter-chip {
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 500;
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 6px;
          background: hsl(217.2 32.6% 17.5%);
          color: hsl(215 20.2% 65.1%);
          cursor: pointer;
          transition: all 0.2s;
        }
        .orb-history-filter-chip:hover {
          background: hsl(217.2 32.6% 20%);
          border-color: rgba(255, 255, 255, 0.3);
        }
        .orb-history-filter-chip.active {
          background: rgba(59, 130, 246, 0.3);
          border-color: rgba(59, 130, 246, 0.6);
          color: #60a5fa;
        }
        /* Filter chip colors for different crossover types */
        .orb-filter-all {
          border-color: rgba(156, 163, 175, 0.3);
          color: hsl(215 20.2% 65.1%);
        }
        .orb-filter-all.active {
          background: rgba(156, 163, 175, 0.2);
          border-color: rgba(156, 163, 175, 0.5);
          color: #d1d5db;
        }
        .orb-filter-cross-high {
          border-color: rgba(34, 197, 94, 0.4);
          color: #4ade80;
        }
        .orb-filter-cross-high:hover {
          background: rgba(34, 197, 94, 0.1);
          border-color: rgba(34, 197, 94, 0.5);
        }
        .orb-filter-cross-high.active {
          background: rgba(34, 197, 94, 0.25);
          border-color: rgba(34, 197, 94, 0.6);
          color: #22c55e;
        }
        .orb-filter-cross-low {
          border-color: rgba(239, 68, 68, 0.4);
          color: #f87171;
        }
        .orb-filter-cross-low:hover {
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.5);
        }
        .orb-filter-cross-low.active {
          background: rgba(239, 68, 68, 0.25);
          border-color: rgba(239, 68, 68, 0.6);
          color: #ef4444;
        }
        .orb-filter-cross-bottom {
          border-color: rgba(74, 222, 128, 0.4);
          color: #4ade80;
        }
        .orb-filter-cross-bottom:hover {
          background: rgba(74, 222, 128, 0.1);
          border-color: rgba(74, 222, 128, 0.5);
        }
        .orb-filter-cross-bottom.active {
          background: rgba(74, 222, 128, 0.25);
          border-color: rgba(74, 222, 128, 0.6);
          color: #4ade80;
        }
        .orb-filter-cross-high-down {
          border-color: rgba(248, 113, 113, 0.4);
          color: #f87171;
        }
        .orb-filter-cross-high-down:hover {
          background: rgba(248, 113, 113, 0.1);
          border-color: rgba(248, 113, 113, 0.5);
        }
        .orb-filter-cross-high-down.active {
          background: rgba(248, 113, 113, 0.25);
          border-color: rgba(248, 113, 113, 0.6);
          color: #f87171;
        }
        .orb-filter-cross-mid-up {
          border-color: rgba(250, 204, 21, 0.4);
          color: #facc15;
        }
        .orb-filter-cross-mid-up:hover {
          background: rgba(250, 204, 21, 0.1);
          border-color: rgba(250, 204, 21, 0.5);
        }
        .orb-filter-cross-mid-up.active {
          background: rgba(250, 204, 21, 0.25);
          border-color: rgba(250, 204, 21, 0.6);
          color: #facc15;
        }
        .orb-filter-cross-mid-down {
          border-color: rgba(251, 146, 60, 0.4);
          color: #fb923c;
        }
        .orb-filter-cross-mid-down:hover {
          background: rgba(251, 146, 60, 0.1);
          border-color: rgba(251, 146, 60, 0.5);
        }
        .orb-filter-cross-mid-down.active {
          background: rgba(251, 146, 60, 0.25);
          border-color: rgba(251, 146, 60, 0.6);
          color: #fb923c;
        }
        .orb-history-search-input {
          width: 100%;
          padding: 8px 12px;
          font-size: 13px;
          background: hsl(217.2 32.6% 17.5%);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 6px;
          color: hsl(210 40% 98%);
          outline: none;
          transition: border-color 0.2s;
        }
        .orb-history-search-input:focus {
          border-color: rgba(59, 130, 246, 0.6);
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        .orb-history-search-input::placeholder {
          color: hsl(215 20.2% 50%);
        }
      </style>
    </head>
    <body class="bg-background min-h-screen pb-20 md:pb-0" style="padding-top: 40px;">
      <div class="container mx-auto" style="max-width:1700px;">
        <div class="mb-8">
          <div class="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
            <div class="flex-1">
              <div class="flex flex-col sm:flex-row sm:items-center sm:gap-4 gap-2">
                <h1 class="scroll-m-20 text-4xl font-extrabold tracking-tight text-foreground">Trading Alert Dashboard</h1>
                <div class="flex flex-col gap-1 text-sm">
                  <p class="text-muted-foreground" id="lastUpdate">Last updated: Never <span id="countdown"></span></p>
                  <div id="connectionStatus" class="flex items-center gap-2">
                    <div id="connectionIndicator" class="w-2 h-2 rounded-full bg-gray-500"></div>
                    <span id="connectionText" class="text-muted-foreground">Connecting...</span>
                  <div id="realtimeIndicator" class="text-green-400 hidden">
                    <span class="animate-pulse">🔄 Real-time updates active</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="flex gap-3 items-center">
              <button id="viewToggle" onclick="toggleView()" class="inline-flex items-center gap-2 px-4 py-3 bg-secondary hover:bg-secondary/80 text-foreground font-semibold rounded-lg transition-colors shadow-lg" title="Switch between table and masonry view">
                <span id="viewIcon">📋</span>
              </button>
              <button id="stochHistoryToggle" onclick="toggleStochHistory()" class="inline-flex items-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors shadow-lg" title="View Stochastic history">
                <span>📈</span>
                <span>Stoch His.</span>
              </button>
              <button id="notificationToggle" onclick="toggleNotifications()" class="inline-flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors shadow-lg">
                <span id="notificationIcon">🔔</span>
                <span id="notificationText">Unmute</span>
              </button>
              <button onclick="openCalculator()" class="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-lg">
                📊 Cal.
              </button>
              <button onclick="openExitLogic()" class="inline-flex items-center gap-2 px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-lg transition-colors shadow-lg">
                🚪 Exit Log
              </button>
            </div>
          </div>
        </div>
        
        <!-- Main content area: Filters on left, Table on right when width > 1280px -->
        <div class="flex flex-col xl:flex-row xl:gap-6 xl:items-start">
          <!-- Filters sidebar (left on xl, top on smaller screens) -->
          <div class="w-full xl:w-80 xl:flex-shrink-0 xl:sticky xl:top-4 xl:self-start">
            <!-- Search bar - sticky on top for desktop, bottom for mobile -->
            <div class="fixed md:sticky xl:static top-auto md:top-0 xl:top-auto bottom-0 md:bottom-auto xl:bottom-auto left-0 right-0 xl:left-auto xl:right-auto z-50 xl:z-auto bg-background/95 backdrop-blur-xl border-t md:border-t-0 xl:border-t-0 md:border-b xl:border-b-0 border-border/50 xl:pr-3 py-4 xl:py-0">
              <div class="container mx-auto xl:mx-0 px-4 xl:px-0" style="max-width:1700px;padding-bottom:1rem;">
                <!-- Search input - iOS style -->
                <div class="relative mb-4">
                  <input 
                    type="text" 
                    id="searchInput" 
                    placeholder="Search tickers..." 
                    class="w-full pl-3 pr-10 py-2.5 bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl text-foreground placeholder-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all shadow-sm"
                    onkeyup="filterAlerts()"
                    oninput="toggleClearButton()"
                  />
                  <button 
                    id="clearButton" 
                    onclick="clearSearch()" 
                    class="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-muted-foreground/20 hover:bg-muted-foreground/30 text-muted-foreground hover:text-foreground transition-all hidden"
                    aria-label="Clear search"
                  >
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                  </button>
                </div>
                
                <!-- Stoch Direction Filter -->
                <div class="mb-4 filter-section">
                  <div class="flex items-center justify-between mb-3">
                    <h3 class="text-sm font-semibold text-foreground/90 cursor-pointer select-none flex items-center gap-2 hover:text-foreground transition-colors" onclick="toggleFilterSection('stochDirFilters', this)">
                      <svg class="w-3 h-3 transition-transform duration-200 filter-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                      </svg>
                      Stoch
                    </h3>
                    <button onclick="event.stopPropagation(); clearStochDirFilters()" class="text-xs text-blue-500 hover:text-blue-400 font-medium transition-colors active:opacity-70">Clear</button>
                  </div>
                  <div id="stochDirFilters" class="filter-content">
                    <div class="mb-4">
                      <label class="block text-xs font-medium text-muted-foreground mb-1.5 px-1">K1 Direction</label>
                      <div class="filter-group flex flex-wrap gap-1.5">
                        <button onclick="toggleFilterChip('stoch_k1Dir', 'up', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-green-500/50 bg-green-500/20 hover:bg-green-500/30 active:scale-95 transition-all text-green-400" data-filter="stoch_k1Dir" data-value="up">▲ Up</button>
                        <button onclick="toggleFilterChip('stoch_k1Dir', 'down', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-red-500/50 bg-red-500/20 hover:bg-red-500/30 active:scale-95 transition-all text-red-400" data-filter="stoch_k1Dir" data-value="down">▼ Down</button>
                      </div>
                    </div>
                    <div class="mb-4">
                      <label class="block text-xs font-medium text-muted-foreground mb-1.5 px-1">K2 Direction</label>
                      <div class="filter-group flex flex-wrap gap-1.5">
                        <button onclick="toggleFilterChip('stoch_k2Dir', 'up', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-green-500/50 bg-green-500/20 hover:bg-green-500/30 active:scale-95 transition-all text-green-400" data-filter="stoch_k2Dir" data-value="up">▲ Up</button>
                        <button onclick="toggleFilterChip('stoch_k2Dir', 'down', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-red-500/50 bg-red-500/20 hover:bg-red-500/30 active:scale-95 transition-all text-red-400" data-filter="stoch_k2Dir" data-value="down">▼ Down</button>
                      </div>
                    </div>
                    <div class="mb-4">
                      <label class="block text-xs font-medium text-muted-foreground mb-1.5 px-1">K3 Direction</label>
                      <div class="filter-group flex flex-wrap gap-1.5">
                        <button onclick="toggleFilterChip('stoch_k3Dir', 'up', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-green-500/50 bg-green-500/20 hover:bg-green-500/30 active:scale-95 transition-all text-green-400" data-filter="stoch_k3Dir" data-value="up">▲ Up</button>
                        <button onclick="toggleFilterChip('stoch_k3Dir', 'down', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-red-500/50 bg-red-500/20 hover:bg-red-500/30 active:scale-95 transition-all text-red-400" data-filter="stoch_k3Dir" data-value="down">▼ Down</button>
                      </div>
                    </div>
                    <div class="mb-4">
                      <div class="flex items-center justify-between mb-2 px-1">
                        <label class="block text-xs font-medium text-muted-foreground">K1 Value <span class="text-foreground/60">|</span> <span id="stochK1ValueMinValue" class="text-blue-400 font-semibold">0</span> <span class="text-foreground/60">-</span> <span id="stochK1ValueMaxValue" class="text-blue-400 font-semibold">100</span></label>
                        <div class="flex items-center gap-3">
                          <label class="flex items-center gap-1.5 cursor-pointer" title="Exclude selected range"><input type="checkbox" id="stochK1ValueExcluded" class="rounded border-border bg-secondary text-blue-500 focus:ring-blue-500/50" onchange="toggleSliderFilter('stochK1Value')"><span class="text-xs text-muted-foreground">Excluded</span></label>
                          <label class="relative inline-flex items-center cursor-pointer"><input type="checkbox" id="stochK1ValueToggle" class="sr-only peer" onchange="toggleSliderFilter('stochK1Value')"><div class="w-11 h-6 bg-secondary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div></label>
                        </div>
                      </div>
                      <div class="px-2"><div class="mb-2"><div class="py-2"><div id="stochK1ValueSlider"></div></div></div></div>
                    </div>
                    <div class="mb-4">
                      <div class="flex items-center justify-between mb-2 px-1">
                        <label class="block text-xs font-medium text-muted-foreground">K2 Value <span class="text-foreground/60">|</span> <span id="stochK2ValueMinValue" class="text-blue-400 font-semibold">0</span> <span class="text-foreground/60">-</span> <span id="stochK2ValueMaxValue" class="text-blue-400 font-semibold">100</span></label>
                        <div class="flex items-center gap-3">
                          <label class="flex items-center gap-1.5 cursor-pointer" title="Exclude selected range"><input type="checkbox" id="stochK2ValueExcluded" class="rounded border-border bg-secondary text-blue-500 focus:ring-blue-500/50" onchange="toggleSliderFilter('stochK2Value')"><span class="text-xs text-muted-foreground">Excluded</span></label>
                          <label class="relative inline-flex items-center cursor-pointer"><input type="checkbox" id="stochK2ValueToggle" class="sr-only peer" onchange="toggleSliderFilter('stochK2Value')"><div class="w-11 h-6 bg-secondary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div></label>
                        </div>
                      </div>
                      <div class="px-2"><div class="mb-2"><div class="py-2"><div id="stochK2ValueSlider"></div></div></div></div>
                    </div>
                    <div class="mb-4">
                      <div class="flex items-center justify-between mb-2 px-1">
                        <label class="block text-xs font-medium text-muted-foreground">K3 Value <span class="text-foreground/60">|</span> <span id="stochK3ValueMinValue" class="text-blue-400 font-semibold">0</span> <span class="text-foreground/60">-</span> <span id="stochK3ValueMaxValue" class="text-blue-400 font-semibold">100</span></label>
                        <div class="flex items-center gap-3">
                          <label class="flex items-center gap-1.5 cursor-pointer" title="Exclude selected range"><input type="checkbox" id="stochK3ValueExcluded" class="rounded border-border bg-secondary text-blue-500 focus:ring-blue-500/50" onchange="toggleSliderFilter('stochK3Value')"><span class="text-xs text-muted-foreground">Excluded</span></label>
                          <label class="relative inline-flex items-center cursor-pointer"><input type="checkbox" id="stochK3ValueToggle" class="sr-only peer" onchange="toggleSliderFilter('stochK3Value')"><div class="w-11 h-6 bg-secondary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div></label>
                        </div>
                      </div>
                      <div class="px-2"><div class="mb-2"><div class="py-2"><div id="stochK3ValueSlider"></div></div></div></div>
                    </div>
                    <div class="mb-4">
                      <label class="block text-xs font-medium text-muted-foreground mb-1.5 px-1">Suggestion</label>
                      <div class="filter-group flex flex-wrap gap-1.5">
                        <button onclick="toggleFilterChip('stoch_suggestion', 'Strong Long', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-green-500/50 bg-green-500/20 hover:bg-green-500/30 active:scale-95 transition-all text-green-400" data-filter="stoch_suggestion" data-value="Strong Long">Strong Long</button>
                        <button onclick="toggleFilterChip('stoch_suggestion', 'Try Long', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-lime-500/50 bg-lime-500/20 hover:bg-lime-500/30 active:scale-95 transition-all text-lime-400" data-filter="stoch_suggestion" data-value="Try Long">Try Long</button>
                        <button onclick="toggleFilterChip('stoch_suggestion', 'Strong Short', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-red-500/50 bg-red-500/20 hover:bg-red-500/30 active:scale-95 transition-all text-red-400" data-filter="stoch_suggestion" data-value="Strong Short">Strong Short</button>
                        <button onclick="toggleFilterChip('stoch_suggestion', 'Try Short', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-orange-500/50 bg-orange-500/20 hover:bg-orange-500/30 active:scale-95 transition-all text-orange-400" data-filter="stoch_suggestion" data-value="Try Short">Try Short</button>
                        <button onclick="toggleFilterChip('stoch_suggestion', 'No Long', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-amber-500/50 bg-amber-500/20 hover:bg-amber-500/30 active:scale-95 transition-all text-amber-400" data-filter="stoch_suggestion" data-value="No Long">No Long</button>
                        <button onclick="toggleFilterChip('stoch_suggestion', 'No Short', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-amber-500/50 bg-amber-500/20 hover:bg-amber-500/30 active:scale-95 transition-all text-amber-400" data-filter="stoch_suggestion" data-value="No Short">No Short</button>
                      </div>
                    </div>
                    <div class="mb-4">
                      <label class="block text-xs font-medium text-muted-foreground mb-1.5 px-1">K order</label>
                      <div class="flex flex-wrap items-center gap-2 mb-2">
                        <label class="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" id="stochOrderApply" class="rounded border-border bg-secondary text-blue-500 focus:ring-blue-500/50" onchange="updateStochOrderFromDom(); filterAlerts();">
                          <span class="text-xs text-muted-foreground">Apply</span>
                        </label>
                      </div>
                      <div class="flex flex-wrap items-center gap-2">
                        <select id="stochOrderLeft" class="text-xs rounded border border-border bg-secondary text-foreground px-2 py-1.5 focus:ring-1 focus:ring-blue-500/50" onchange="updateStochOrderFromDom(); filterAlerts();">
                          <option value="K1">K1</option>
                          <option value="K2">K2</option>
                          <option value="K3" selected>K3</option>
                        </select>
                        <select id="stochOrderOp1" class="text-xs rounded border border-border bg-secondary text-foreground px-2 py-1.5 focus:ring-1 focus:ring-blue-500/50" onchange="updateStochOrderFromDom(); filterAlerts();">
                          <option value=">">&gt;</option>
                          <option value="<">&lt;</option>
                          <option value=">=">&gt;=</option>
                          <option value="<=">&lt;=</option>
                          <option value="=">=</option>
                          <option value="&">&amp;</option>
                        </select>
                        <select id="stochOrderMid" class="text-xs rounded border border-border bg-secondary text-foreground px-2 py-1.5 focus:ring-1 focus:ring-blue-500/50" onchange="updateStochOrderFromDom(); filterAlerts();">
                          <option value="K1">K1</option>
                          <option value="K2" selected>K2</option>
                          <option value="K3">K3</option>
                        </select>
                        <select id="stochOrderConnector" class="text-xs rounded border border-border bg-secondary text-foreground px-2 py-1.5 focus:ring-1 focus:ring-blue-500/50" onchange="updateStochOrderFromDom(); filterAlerts();">
                          <option value="&" selected>&amp;</option>
                          <option value="|">|</option>
                        </select>
                        <select id="stochOrderOp2" class="text-xs rounded border border-border bg-secondary text-foreground px-2 py-1.5 focus:ring-1 focus:ring-blue-500/50" onchange="updateStochOrderFromDom(); filterAlerts();">
                          <option value=">">&gt;</option>
                          <option value="<">&lt;</option>
                          <option value=">=">&gt;=</option>
                          <option value="<=">&lt;=</option>
                          <option value="=">=</option>
                          <option value="&">&amp;</option>
                        </select>
                        <select id="stochOrderRight" class="text-xs rounded border border-border bg-secondary text-foreground px-2 py-1.5 focus:ring-1 focus:ring-blue-500/50" onchange="updateStochOrderFromDom(); filterAlerts();">
                          <option value="K1" selected>K1</option>
                          <option value="K2">K2</option>
                          <option value="K3">K3</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
                  
                <!-- Other Filters - iOS chip style -->
                <div class="mb-4 filter-section">
                  <div class="flex items-center justify-between mb-3">
                    <h3 class="text-sm font-semibold text-foreground/90 cursor-pointer select-none flex items-center gap-2 hover:text-foreground transition-colors" onclick="toggleFilterSection('otherFilters', this)">
                      <svg class="w-3 h-3 transition-transform duration-200 filter-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                      </svg>
                      Other
                    </h3>
                    <button 
                      onclick="event.stopPropagation(); clearOtherFilters()" 
                      class="text-xs text-blue-500 hover:text-blue-400 font-medium transition-colors active:opacity-70"
                    >
                      Clear
                    </button>
                  </div>
                  
                  <div id="otherFilters" class="filter-content">
                  <!-- Price % -->
                    <div class="mb-4">
                    <label class="block text-xs font-medium text-muted-foreground mb-1.5 px-1">Price %</label>
                    <div class="filter-group flex flex-wrap gap-1.5">
                      <button onclick="toggleFilterChip('percentChange', '<-10', this)" class="filter-chip pl-2.5 pr-1.5 py-1.5 text-xs font-medium rounded-md border border-red-600/50 bg-red-600/20 hover:bg-red-600/30 active:scale-95 transition-all text-red-300" data-filter="percentChange" data-value="<-10" id="pricePercentLessThanMinus10">&lt;-10% <span id="pricePercentLessThanMinus10Count" class="ml-1 px-1 py-0.5 rounded text-xs font-bold bg-red-700/50 text-white">0</span></button>
                      <button onclick="toggleFilterChip('percentChange', '<-5', this)" class="filter-chip pl-2.5 pr-1.5 py-1.5 text-xs font-medium rounded-md border border-red-400/50 bg-red-500/20 hover:bg-red-500/30 active:scale-95 transition-all text-red-400" data-filter="percentChange" data-value="<-5" id="pricePercentLessThan5">&lt;-5% <span id="pricePercentLessThan5Count" class="ml-1 px-1 py-0.5 rounded text-xs font-bold bg-red-600/50 text-white">0</span></button>
                      <button onclick="toggleFilterChip('percentChange', '-5--2', this)" class="filter-chip pl-2.5 pr-1.5 py-1.5 text-xs font-medium rounded-md border border-red-500/50 bg-red-500/15 hover:bg-red-500/25 active:scale-95 transition-all text-red-500" data-filter="percentChange" data-value="-5--2" id="pricePercentMinus5ToMinus2">-5~-2% <span id="pricePercentMinus5ToMinus2Count" class="ml-1 px-1 py-0.5 rounded text-xs font-bold bg-red-600/50 text-white">0</span></button>
                      <button onclick="toggleFilterChip('percentChange', '-2-0', this)" class="filter-chip pl-2.5 pr-1.5 py-1.5 text-xs font-medium rounded-md border border-orange-500/50 bg-orange-500/15 hover:bg-orange-500/25 active:scale-95 transition-all text-orange-400" data-filter="percentChange" data-value="-2-0" id="pricePercentMinus2To0">-2~0% <span id="pricePercentMinus2To0Count" class="ml-1 px-1 py-0.5 rounded text-xs font-bold bg-orange-600/50 text-white">0</span></button>
                      <button onclick="toggleFilterChip('percentChange', '0-2', this)" class="filter-chip pl-2.5 pr-1.5 py-1.5 text-xs font-medium rounded-md border border-lime-500/50 bg-lime-500/15 hover:bg-lime-500/25 active:scale-95 transition-all text-lime-400" data-filter="percentChange" data-value="0-2" id="pricePercent0To2">0~2% <span id="pricePercent0To2Count" class="ml-1 px-1 py-0.5 rounded text-xs font-bold bg-lime-600/50 text-white">0</span></button>
                      <button onclick="toggleFilterChip('percentChange', '2-5', this)" class="filter-chip pl-2.5 pr-1.5 py-1.5 text-xs font-medium rounded-md border border-green-500/50 bg-green-500/15 hover:bg-green-500/25 active:scale-95 transition-all text-green-500" data-filter="percentChange" data-value="2-5" id="pricePercent2To5">2~5% <span id="pricePercent2To5Count" class="ml-1 px-1 py-0.5 rounded text-xs font-bold bg-green-600/50 text-white">0</span></button>
                      <button onclick="toggleFilterChip('percentChange', '>5', this)" class="filter-chip pl-2.5 pr-1.5 py-1.5 text-xs font-medium rounded-md border border-green-400/50 bg-green-500/20 hover:bg-green-500/30 active:scale-95 transition-all text-green-400" data-filter="percentChange" data-value=">5" id="pricePercentGreaterThan5">&gt;5% <span id="pricePercentGreaterThan5Count" class="ml-1 px-1 py-0.5 rounded text-xs font-bold bg-green-600/50 text-white">0</span></button>
                      <button onclick="toggleFilterChip('percentChange', '>10', this)" class="filter-chip pl-2.5 pr-1.5 py-1.5 text-xs font-medium rounded-md border border-green-300/50 bg-green-400/20 hover:bg-green-400/30 active:scale-95 transition-all text-green-300" data-filter="percentChange" data-value=">10" id="pricePercentGreaterThan10">&gt;10% <span id="pricePercentGreaterThan10Count" class="ml-1 px-1 py-0.5 rounded text-xs font-bold bg-green-500/50 text-white">0</span></button>
                    </div>
                  </div>
                    
                    <!-- Volume -->
                    <div class="mb-4">
                      <label class="block text-xs font-medium text-muted-foreground mb-1.5 px-1">Vol</label>
                      <div class="filter-group flex flex-wrap gap-1.5">
                        <button onclick="toggleFilterChip('volume', '<100K', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-gray-500/50 bg-gray-500/20 hover:bg-gray-500/30 active:scale-95 transition-all text-gray-400" data-filter="volume" data-value="<100K">&lt;100K</button>
                        <button onclick="toggleFilterChip('volume', '100K-500K', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-blue-500/50 bg-blue-500/20 hover:bg-blue-500/30 active:scale-95 transition-all text-blue-400" data-filter="volume" data-value="100K-500K">100K-500K</button>
                        <button onclick="toggleFilterChip('volume', '500K-1M', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-cyan-500/50 bg-cyan-500/20 hover:bg-cyan-500/30 active:scale-95 transition-all text-cyan-400" data-filter="volume" data-value="500K-1M">500K-1M</button>
                        <button onclick="toggleFilterChip('volume', '1M-5M', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-green-500/50 bg-green-500/20 hover:bg-green-500/30 active:scale-95 transition-all text-green-400" data-filter="volume" data-value="1M-5M">1M-5M</button>
                        <button onclick="toggleFilterChip('volume', '>5M', this)" class="filter-chip px-3 py-1.5 text-xs font-medium rounded-full border border-yellow-500/50 bg-yellow-500/20 hover:bg-yellow-500/30 active:scale-95 transition-all text-yellow-400" data-filter="volume" data-value=">5M">&gt;5M</button>
                    </div>
                  </div>
                  </div>
                </div>
                
                <!-- Export Settings Button -->
                <div class="mt-4">
                  <button onclick="openExportModal()" class="w-full px-4 py-2 text-sm font-medium rounded-lg border border-blue-500/50 bg-blue-500/20 hover:bg-blue-500/30 active:scale-95 transition-all text-blue-400 flex items-center justify-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                    </svg>
                    Export
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Table area (right on xl, below filters on smaller screens) -->
          <div class="w-full xl:flex-1 xl:min-w-0">
            <!-- Preset Filter Buttons -->
            <div class="mb-4 flex gap-2 flex-wrap preset-filter-group">
              <button id="presetDown" onclick="applyPresetFilter('down')" class="preset-filter-chip filter-chip pl-3 pr-1.5 py-1.5 text-sm font-medium rounded-lg border border-red-500/50 bg-red-500/20 hover:bg-red-500/30 active:scale-95 transition-all text-white">
                Down <span id="presetDownCount" class="ml-1 px-1.5 py-0.5 rounded text-xs font-bold bg-red-600/50 text-white">0</span>
              </button>
              <button id="presetUp" onclick="applyPresetFilter('up')" class="preset-filter-chip filter-chip pl-3 pr-1.5 py-1.5 text-sm font-medium rounded-lg border border-green-500/50 bg-green-500/20 hover:bg-green-500/30 active:scale-95 transition-all text-white">
                Up <span id="presetUpCount" class="ml-1 px-1.5 py-0.5 rounded text-xs font-bold bg-green-600/50 text-white">0</span>
              </button>
              <button id="presetExtBull" onclick="applyPresetFilter('extBull')" class="preset-filter-chip filter-chip pl-3 pr-1.5 py-1.5 text-sm font-medium rounded-lg border border-yellow-500/50 bg-yellow-500/20 hover:bg-yellow-500/30 active:scale-95 transition-all text-white">
                Ext. Bull <span id="presetExtBullCount" class="ml-1 px-1.5 py-0.5 rounded text-xs font-bold bg-yellow-600/50 text-white">0</span>
              </button>
              <button id="presetExtBear" onclick="applyPresetFilter('extBear')" class="preset-filter-chip filter-chip pl-3 pr-1.5 py-1.5 text-sm font-medium rounded-lg border border-pink-500/50 bg-pink-500/20 hover:bg-pink-500/30 active:scale-95 transition-all text-white">
                Ext. Bear <span id="presetExtBearCount" class="ml-1 px-1.5 py-0.5 rounded text-xs font-bold bg-pink-600/50 text-white">0</span>
              </button>
              <button id="presetClear" onclick="clearAllFilters()" class="preset-filter-chip filter-chip px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-500/50 bg-gray-500/20 hover:bg-gray-500/30 active:scale-95 transition-all text-gray-400">
                Clear All
              </button>
            </div>
            <!-- Table View -->
            <div id="tableView" class="bg-card/80 rounded-2xl shadow-sm overflow-hidden border border-border/30">
              <div>
                <div class="overflow-x-auto max-h-[calc(100vh-200px)] hide-scrollbar">
                  <table class="w-full table-auto border-collapse">
                    <thead id="tableHeader" class="sticky top-0 z-20" style="background-color: rgba(30, 35, 45, 0.95);">
                      <tr class="border-b border-border/50">
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
            
            <!-- Kanban View -->
            <div id="masonryView" class="hidden">
              <div id="masonryContainer" class="kanban-board">
                <!-- Kanban columns will be dynamically generated -->
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Toast Container -->
      <div id="toastContainer" class="toast-container"></div>

      <!-- Stoch History Overlay -->
      <div id="stochHistoryOverlay" class="orb-history-overlay" onclick="closeStochHistory()">
        <div class="orb-history-panel" onclick="event.stopPropagation()">
          <div class="orb-history-header">
            <h3>Stochastic History</h3>
            <button class="orb-history-close" onclick="closeStochHistory()">×</button>
          </div>
          <div class="orb-history-filters">
            <div class="orb-history-filter-group">
              <label class="orb-history-filter-label">Event Type:</label>
              <div class="orb-history-filter-chips">
                <button onclick="toggleStochHistoryFilter('eventType', 'all', this)" class="orb-history-filter-chip orb-filter-all active" data-filter="eventType" data-value="all">All</button>
                <button onclick="toggleStochHistoryFilter('eventType', 'direction_change', this)" class="orb-history-filter-chip orb-filter-cross-high" data-filter="eventType" data-value="direction_change">Direction Change</button>
                <button onclick="toggleStochHistoryFilter('eventType', 'preset_match', this)" class="orb-history-filter-chip orb-filter-cross-low" data-filter="eventType" data-value="preset_match">Preset Match</button>
                <button onclick="toggleStochHistoryFilter('eventType', 'trend_change', this)" class="orb-history-filter-chip orb-filter-cross-bottom" data-filter="eventType" data-value="trend_change">Trend Change</button>
              </div>
            </div>
          </div>
          <div class="orb-history-content" id="stochHistoryContent">
            <div class="orb-history-empty">No stochastic events recorded yet</div>
          </div>
        </div>
      </div>

      <!-- Export Modal -->
      <div id="exportModalOverlay" class="export-modal-overlay" onclick="closeExportModal()">
        <div class="export-modal" onclick="event.stopPropagation()">
          <h3 class="text-lg font-semibold text-foreground mb-4">Export Filter Settings</h3>
          <div class="mb-4">
            <label class="block text-sm font-medium text-muted-foreground mb-2">Preset Name</label>
            <input 
              type="text" 
              id="exportPresetName" 
              placeholder="Enter preset name..."
              class="w-full px-3 py-2 bg-card/80 border border-border/50 rounded-lg text-foreground placeholder-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
              onkeydown="if(event.key === 'Enter') exportFilterSettings()"
            />
          </div>
          <div class="flex gap-3 justify-end">
            <button 
              onclick="closeExportModal()" 
              class="px-4 py-2 text-sm font-medium rounded-lg border border-gray-500/50 bg-gray-500/20 hover:bg-gray-500/30 text-gray-400 transition-colors"
            >
              Cancel
            </button>
            <button 
              onclick="exportFilterSettings()" 
              class="px-4 py-2 text-sm font-medium rounded-lg border border-blue-500/50 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      <script>
        // View state (table or masonry)
        let currentView = localStorage.getItem('viewMode') || 'table'; // 'table' or 'masonry'
        
        // Kanban per-column D2 sort: { columnId: 'asc'|'desc'|null }
        let kanbanD2SortByColumn = {};
        
        // Sorting state
        let currentSortField = 'symbol'; // Default to alphabetical sorting
        let currentSortDirection = 'asc';
        let alertsData = [];
        
        // Search state
        let searchTerm = '';
        
        // Stoch K direction filter state
        let stochK1Dir = [];
        let stochK2Dir = [];
        let stochK3Dir = [];
        let stochK1Value = { min: 0, max: 100, active: false, excluded: false };
        let stochK2Value = { min: 0, max: 100, active: false, excluded: false };
        let stochK3Value = { min: 0, max: 100, active: false, excluded: false };
        let stochSuggestion = [];
        let stochOrderActive = false;
        let stochOrderLeft = 'K3';
        let stochOrderOp1 = '>';
        let stochOrderMid = 'K2';
        let stochOrderOp2 = '>';
        let stochOrderRight = 'K1';
        let stochOrderConnector = '&'; // '&' = AND, '|' = OR

        let stochFilterPercentChange = [];
        
        // Other Filter state
        let volumeFilter = []; // Volume filter (multiple selections: <100K, 100K-500K, etc.)
        
        // Sector data storage (frontend copy)
        let sectorData = {}; // Store sector information by symbol
        
        // Notification state
        let notificationsEnabled = true; // Track whether notifications/toasts are enabled
        
        // Active preset filter (for CCI-based presets)
        let activePreset = null;

        // Starred alerts - stored in localStorage
        let starredAlerts = JSON.parse(localStorage.getItem('starredAlerts')) || {};
        
        // Track previous stochastic directions for flash detection
        let previousStochDirections = {};
        
        // Track previous prices for price direction calculation (fallback)
        let previousPrices = {};
        
        // Track previous preset filter matches to detect new matches
        let previousPresetMatches = {}; // { symbol: ['down', 'up', 'trendDownBig'] }
        
        // Stochastic history
        let stochHistory = []; // Array of { symbol, eventType, eventData, price, timestamp }
        
        // Track previous stochastic states
        let previousStochStates = {}; // { symbol: { d1Direction, d2Direction, trendMessage, presetMatches } }
        
        // Stoch history filter state
        let stochHistoryFilters = {
          eventType: 'all' // 'all', 'direction_change', 'preset_match', 'trend_change'
        };

        // Column order - stored in localStorage
        const defaultColumnOrder = ['symbol', 'price', 'stoch', 'volume'];
        let columnOrder = JSON.parse(localStorage.getItem('columnOrder')) || defaultColumnOrder;
        // Remove legacy columns (star, orb) and any not in columnDefs
        columnOrder = columnOrder.filter(colId => colId !== 'star' && colId !== 'orb');
        
        // Column widths - stored in localStorage (in pixels)
        const defaultColumnWidths = {
          symbol: 80,
          price: 100,
          highLevelTrend: 64,
          stoch: 200,
          volume: 80
        };
        let columnWidths = JSON.parse(localStorage.getItem('columnWidths')) || defaultColumnWidths;
        
        // Helper function to get column width
        function getColumnWidth(colId) {
          return columnWidths[colId] || defaultColumnWidths[colId] || 100;
        }
        
        // Helper function to set column width
        function setColumnWidth(colId, width) {
          columnWidths[colId] = Math.max(30, Math.min(1000, width)); // Min 30px, max 1000px
          localStorage.setItem('columnWidths', JSON.stringify(columnWidths));
        }
        // Check if stored order has old columns - if so, reset to default
        const oldColumns = ['macdCrossing', 'vwap', 'ema1', 'ema2', 'macd', 'rsi', 'trend', 'pattern', 'qsArrow', 'd3value', 'd4value'];
        const hasOldColumns = columnOrder.some(colId => oldColumns.includes(colId));
        if (hasOldColumns) {
          console.log('🔄 Resetting column order due to old columns detected');
          columnOrder = defaultColumnOrder;
          localStorage.setItem('columnOrder', JSON.stringify(columnOrder));
        }
        columnOrder = columnOrder.filter(colId => colId !== 'd2' && colId !== 'stochOverview' && colId !== 'stochDetail');
        if (!columnOrder.includes('stoch')) {
          const priceIdx = columnOrder.indexOf('price');
          if (priceIdx !== -1) columnOrder.splice(priceIdx + 1, 0, 'stoch');
          else columnOrder.push('stoch');
        }
        
        // Column definitions
        const columnDefs = {
          symbol: { id: 'symbol', title: 'Ticker', sortable: true, sortField: 'symbol', width: 'w-[80px]' },
          price: { id: 'price', title: 'Price', sortable: true, sortField: 'price', width: 'w-[100px]' },
          stoch: { id: 'stoch', title: 'Stoch', sortable: false, width: 'w-[200px]', tooltip: 'Tri K direction: K1 | K2 | K3' },
          highLevelTrend: { id: 'highLevelTrend', title: 'HLT', sortable: true, sortField: 'highLevelTrend', width: 'w-16', tooltip: 'High Level Trend: Bull/Bear when D1 switches direction with large D1-D2 difference' },
          volume: { id: 'volume', title: 'Vol', sortable: true, sortField: 'volume', width: 'w-20', tooltip: 'Volume since 9:30 AM' }
        };

        // Countdown state
        let countdownSeconds = 120;
        let countdownInterval = null;

        function formatVolume(vol) {
          if (!vol || vol === 0) return 'N/A';
          if (vol >= 1000000) {
            const value = vol / 1000000;
            return (Math.ceil(value * 10) / 10).toFixed(1) + 'M';
          }
          if (vol >= 1000) {
            const value = vol / 1000;
            return (Math.ceil(value * 10) / 10).toFixed(1) + 'K';
          }
          return Math.ceil(vol * 10) / 10 + '';
        }

        // Format currency values with k notation for values over 1000
        function formatCurrency(value, showCents = true) {
          if (!value || isNaN(value)) return 'N/A';
          
          const num = parseFloat(value);
          const absNum = Math.abs(num);
          
          if (absNum >= 1000000) {
            const formatted = (num / 1000000).toFixed(2);
            return '$' + formatted + 'M';
          } else if (absNum >= 1000) {
            const formatted = (num / 1000).toFixed(2);
            return '$' + formatted + 'k';
          } else {
            if (showCents) {
              return '$' + num.toFixed(2);
            } else {
              return '$' + num.toFixed(0);
            }
          }
        }
        
        // Format regular numbers with k notation for values over 1000
        function formatNumber(value, decimals = 2) {
          if (!value || isNaN(value)) return 'N/A';
          
          const num = parseFloat(value);
          const absNum = Math.abs(num);
          
          if (absNum >= 1000000) {
            const formatted = (num / 1000000).toFixed(decimals);
            return formatted + 'M';
          } else if (absNum >= 1000) {
            const formatted = (num / 1000).toFixed(decimals);
            return formatted + 'k';
          } else {
            return num.toFixed(decimals);
          }
        }

        function parseStochValue(value) {
          if (value === null || value === undefined || value === '') return null;
          const num = parseFloat(value);
          return isNaN(num) ? null : num;
        }

        function getStochValues(alert) {
          const kValueRaw = parseStochValue(alert.k);
          const dValueRaw = parseStochValue(alert.d);
          const fallbackK = parseStochValue(alert.dualStochD1) || parseStochValue(alert.d1);
          const fallbackD = parseStochValue(alert.dualStochD2) || parseStochValue(alert.d2);
          const soloD = parseStochValue(alert.soloStochD2);
          const genericD = parseStochValue(alert.d2);
          const kValue = kValueRaw !== null ? kValueRaw : fallbackK;
          const dValue = dValueRaw !== null ? dValueRaw : (fallbackD !== null ? fallbackD : (soloD !== null ? soloD : genericD));
          const kDirection = alert.kDirection || alert.dualStochD1Direction || alert.d1Direction || 'flat';
          const dDirection = alert.dDirection || alert.dualStochD2Direction || alert.soloStochD2Direction || alert.d2Direction || 'flat';
          return { kValue, dValue, kDirection, dDirection };
        }

        function hasStochDirFilters() {
          return stochK1Dir.length > 0 || stochK2Dir.length > 0 || stochK3Dir.length > 0 ||
            stochK1Value.active || stochK2Value.active || stochK3Value.active || stochSuggestion.length > 0 || stochOrderActive;
        }

        function updateStochOrderFromDom() {
          const applyEl = document.getElementById('stochOrderApply');
          const leftEl = document.getElementById('stochOrderLeft');
          const op1El = document.getElementById('stochOrderOp1');
          const midEl = document.getElementById('stochOrderMid');
          const op2El = document.getElementById('stochOrderOp2');
          const rightEl = document.getElementById('stochOrderRight');
          const connEl = document.getElementById('stochOrderConnector');
          stochOrderActive = applyEl ? applyEl.checked : false;
          stochOrderLeft = leftEl ? leftEl.value : 'K3';
          stochOrderOp1 = op1El ? op1El.value : '>';
          stochOrderMid = midEl ? midEl.value : 'K2';
          stochOrderConnector = connEl ? connEl.value : '&';
          stochOrderOp2 = op2El ? op2El.value : '>';
          stochOrderRight = rightEl ? rightEl.value : 'K1';
        }

        function stochOrderCompare(a, op, b) {
          if (op === '=' || op === '&') return Math.abs(a - b) < 1e-6;
          if (op === '>') return a > b;
          if (op === '<') return a < b;
          if (op === '>=') return a >= b;
          if (op === '<=') return a <= b;
          return false;
        }

        function passesStochDirFilter(alert) {
          const t = alert.triStoch;
          if (stochOrderActive) {
            const k1 = t && t.ovK != null && !isNaN(parseFloat(t.ovK)) ? parseFloat(t.ovK) : null;
            const k2 = t && t.dtK != null && !isNaN(parseFloat(t.dtK)) ? parseFloat(t.dtK) : null;
            const k3 = t && t.k3 != null && !isNaN(parseFloat(t.k3)) ? parseFloat(t.k3) : null;
            const vals = { K1: k1, K2: k2, K3: k3 };
            const leftVal = vals[stochOrderLeft];
            const midVal = vals[stochOrderMid];
            const rightVal = vals[stochOrderRight];
            if (leftVal == null || midVal == null || rightVal == null) return false;
            const first = stochOrderCompare(leftVal, stochOrderOp1, midVal);
            const second = stochOrderCompare(midVal, stochOrderOp2, rightVal);
            if (stochOrderConnector === '|') {
              if (!first && !second) return false;
            } else {
              if (!first || !second) return false;
            }
          }
          if (stochSuggestion.length > 0) {
            const sug = getTriStochSuggestion(t);
            if (!sug || !stochSuggestion.includes(sug.text)) return false;
          }
          if (stochK1Dir.length > 0) {
            const dir = t && t.ovKDirection ? t.ovKDirection : 'flat';
            if (!stochK1Dir.includes(dir)) return false;
          }
          if (stochK2Dir.length > 0) {
            const dir = t && t.dtKDirection ? t.dtKDirection : 'flat';
            if (!stochK2Dir.includes(dir)) return false;
          }
          if (stochK3Dir.length > 0) {
            if (!t || !t.k3) return false;
          }
          if (stochK1Value.active) {
            const v = t && t.ovK != null && !isNaN(parseFloat(t.ovK)) ? parseFloat(t.ovK) : null;
            if (v === null) return false;
            const inside = v >= stochK1Value.min && v <= stochK1Value.max;
            if (stochK1Value.excluded ? inside : !inside) return false;
          }
          if (stochK2Value.active) {
            const v = t && t.dtK != null && !isNaN(parseFloat(t.dtK)) ? parseFloat(t.dtK) : null;
            if (v === null) return false;
            const inside = v >= stochK2Value.min && v <= stochK2Value.max;
            if (stochK2Value.excluded ? inside : !inside) return false;
          }
          if (stochK3Value.active) {
            const v = t && t.k3 != null && !isNaN(parseFloat(t.k3)) ? parseFloat(t.k3) : null;
            if (v === null) return false;
            const inside = v >= stochK3Value.min && v <= stochK3Value.max;
            if (stochK3Value.excluded ? inside : !inside) return false;
          }
          return true;
        }

        function clearStochDirFilters() {
          document.querySelectorAll('[data-filter^="stoch_k"], [data-filter="stoch_suggestion"]').forEach(c => c.classList.remove('active'));
          stochK1Dir = []; stochK2Dir = []; stochK3Dir = []; stochSuggestion = [];
          stochOrderActive = false;
          stochOrderLeft = 'K3'; stochOrderOp1 = '>'; stochOrderMid = 'K2'; stochOrderConnector = '&'; stochOrderOp2 = '>'; stochOrderRight = 'K1';
          const applyEl = document.getElementById('stochOrderApply');
          if (applyEl) applyEl.checked = false;
          const leftEl = document.getElementById('stochOrderLeft');
          if (leftEl) leftEl.value = 'K3';
          const op1El = document.getElementById('stochOrderOp1');
          if (op1El) op1El.value = '>';
          const midEl = document.getElementById('stochOrderMid');
          if (midEl) midEl.value = 'K2';
          const connEl = document.getElementById('stochOrderConnector');
          if (connEl) connEl.value = '&';
          const op2El = document.getElementById('stochOrderOp2');
          if (op2El) op2El.value = '>';
          const rightEl = document.getElementById('stochOrderRight');
          if (rightEl) rightEl.value = 'K1';
          stochK1Value.min = 0; stochK1Value.max = 100; stochK1Value.active = false; stochK1Value.excluded = false;
          stochK2Value.min = 0; stochK2Value.max = 100; stochK2Value.active = false; stochK2Value.excluded = false;
          stochK3Value.min = 0; stochK3Value.max = 100; stochK3Value.active = false; stochK3Value.excluded = false;
          ['stochK1Value', 'stochK2Value', 'stochK3Value'].forEach(key => {
            const t = document.getElementById(key + 'Toggle');
            const e = document.getElementById(key + 'Excluded');
            if (t) t.checked = false;
            if (e) e.checked = false;
            if (sliders[key] && sliders[key].noUiSlider) sliders[key].noUiSlider.set([0, 100]);
          });
          renderTable();
        }

        // High win-rate long/short suggestion from Tri K (K1=ov, K2=dt, K3=value)
        function getTriStochSuggestion(t) {
          if (!t) return null;
          const k1 = t.ovK != null && !isNaN(parseFloat(t.ovK)) ? parseFloat(t.ovK) : null;
          const k2 = t.dtK != null && !isNaN(parseFloat(t.dtK)) ? parseFloat(t.dtK) : null;
          const k3 = t.k3 != null && !isNaN(parseFloat(t.k3)) ? parseFloat(t.k3) : null;
          const d1 = (t.ovKDirection || '').toLowerCase();
          const d2 = (t.dtKDirection || '').toLowerCase();
          const up = (d) => d === 'up';
          const down = (d) => d === 'down';
          const allUp = up(d1) && up(d2) && k3 !== null && k3 < 30;
          const allDown = down(d1) && down(d2) && k3 !== null && k3 > 70;
          if (k3 !== null && k3 < 10 && down(d1) && down(d2)) return { text: 'Strong Short', type: 'short' };   // Oversold, both down = trend down
          if (k3 !== null && k3 > 90 && up(d1) && up(d2)) return { text: 'Strong Long', type: 'long' };         // Overbought, both up = trend up
          if (k3 !== null && k3 < 10 && (up(d1) || up(d2))) return { text: 'Try Long', type: 'long' };        // Oversold + one turning up
          if (k3 !== null && k3 > 90 && (down(d1) || down(d2))) return { text: 'Try Short', type: 'short' }; // Overbought + one turning down
          if (allUp || (k3 !== null && k3 < 20 && up(d1) && up(d2))) return { text: 'Strong Long', type: 'long' };
          if (allDown || (k3 !== null && k3 > 80 && down(d1) && down(d2))) return { text: 'Strong Short', type: 'short' };
          if (up(d1) && up(d2)) return { text: 'Try Long', type: 'long' };
          if (down(d1) && down(d2)) return { text: 'Try Short', type: 'short' };
          if (k3 !== null && k3 < 20 && (up(d1) || up(d2))) return { text: 'Try Long', type: 'long' };
          if (k3 !== null && k3 > 80 && (down(d1) || down(d2))) return { text: 'Try Short', type: 'short' };
          if (k3 !== null && k3 > 80 && up(d1) && up(d2)) return { text: 'No Short', type: 'neutral' };        // Overbought but bullish
          if (k3 !== null && k3 < 20 && down(d1) && down(d2)) return { text: 'No Long', type: 'neutral' };     // Oversold but bearish
          return null;
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
            const indicators = ['symbol', 'price', 'highLevelTrend', 'priceChange', 'volume'];
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

        // noUiSlider instances storage
        const sliders = {};
        
        function createValueSlider(sliderKey, elId, minLabelId, maxLabelId, updateFn) {
          const el = document.getElementById(elId);
          if (el && !sliders[sliderKey]) {
            noUiSlider.create(el, { start: [0, 100], connect: true, range: { 'min': 0, 'max': 100 }, step: 1, tooltips: [{ to: v => Math.round(v) }, { to: v => Math.round(v) }] });
            sliders[sliderKey] = el;
            const conn = el.querySelector('.noUi-connect');
            if (conn) conn.style.background = 'linear-gradient(to right, #ef4444 0%, #ef4444 40%, #eab308 40%, #eab308 60%, #22c55e 60%, #22c55e 100%)';
            el.noUiSlider.on('update', function(values) {
              const mn = Math.round(values[0]), mx = Math.round(values[1]);
              const mnEl = document.getElementById(minLabelId), mxEl = document.getElementById(maxLabelId);
              if (mnEl) { mnEl.textContent = mn; mnEl.className = 'font-semibold ' + (mn < 40 ? 'text-red-400' : mn > 60 ? 'text-green-400' : 'text-yellow-400'); }
              if (mxEl) { mxEl.textContent = mx; mxEl.className = 'font-semibold ' + (mx < 40 ? 'text-red-400' : mx > 60 ? 'text-green-400' : 'text-yellow-400'); }
              const c = el.querySelector('.noUi-connect');
              if (c) {
                const gc = v => v < 40 ? '#ef4444' : v > 60 ? '#22c55e' : '#eab308';
                const mc = gc(mn), xc = gc(mx);
                c.style.background = mc === xc ? mc : ((mn < 40 && mx > 60) ? 'linear-gradient(to right, ' + mc + ' 0%, #eab308 50%, ' + xc + ' 100%)' : 'linear-gradient(to right, ' + mc + ' 0%, ' + xc + ' 100%)');
              }
            });
            el.noUiSlider.on('change', updateFn);
          }
        }

        function createDiffSlider(sliderKey, elId, minLabelId, maxLabelId, updateFn) {
          const el = document.getElementById(elId);
          if (el && !sliders[sliderKey]) {
            noUiSlider.create(el, { start: [0, 75], connect: true, range: { 'min': 0, 'max': 75 }, step: 1, tooltips: [{ to: v => Math.round(v) }, { to: v => Math.round(v) }] });
            sliders[sliderKey] = el;
            const conn = el.querySelector('.noUi-connect');
            if (conn) conn.style.background = 'linear-gradient(to right, #60a5fa 0%, #60a5fa 20%, #eab308 20%, #eab308 50%, #fb923c 50%, #fb923c 100%)';
            el.noUiSlider.on('update', function(values) {
              const mn = Math.round(values[0]), mx = Math.round(values[1]);
              const mnEl = document.getElementById(minLabelId), mxEl = document.getElementById(maxLabelId);
              if (mnEl) { mnEl.textContent = mn; mnEl.className = 'font-semibold ' + (mn < 10 ? 'text-blue-400' : mn < 25 ? 'text-yellow-400' : 'text-orange-400'); }
              if (mxEl) { mxEl.textContent = mx; mxEl.className = 'font-semibold ' + (mx < 10 ? 'text-blue-400' : mx < 25 ? 'text-yellow-400' : 'text-orange-400'); }
              const c = el.querySelector('.noUi-connect');
              if (c) {
                const gc = v => v < 10 ? '#60a5fa' : v < 25 ? '#eab308' : '#fb923c';
                const mc = gc(mn), xc = gc(mx);
                c.style.background = mc === xc ? mc : 'linear-gradient(to right, ' + mc + ' 0%, ' + xc + ' 100%)';
              }
            });
            el.noUiSlider.on('change', updateFn);
          }
        }

        function initializeSliders() {
          createValueSlider('stochK1Value', 'stochK1ValueSlider', 'stochK1ValueMinValue', 'stochK1ValueMaxValue', function() { updateGenericValueFilter('stochK1Value', stochK1Value); });
          createValueSlider('stochK2Value', 'stochK2ValueSlider', 'stochK2ValueMinValue', 'stochK2ValueMaxValue', function() { updateGenericValueFilter('stochK2Value', stochK2Value); });
          createValueSlider('stochK3Value', 'stochK3ValueSlider', 'stochK3ValueMinValue', 'stochK3ValueMaxValue', function() { updateGenericValueFilter('stochK3Value', stochK3Value); });
        }

        // Initialize sort indicators on page load
        document.addEventListener('DOMContentLoaded', function() {
          updateSortIndicators();
          renderTableHeaders();
          setupColumnDragAndDrop();
          initializeSliders();
          initializeView(); // Initialize view mode
        });
        
        // Initialize view mode
        function initializeView() {
          const tableView = document.getElementById('tableView');
          const masonryView = document.getElementById('masonryView');
          const viewIcon = document.getElementById('viewIcon');
          
          if (currentView === 'masonry') {
            tableView.classList.add('hidden');
            masonryView.classList.remove('hidden');
            viewIcon.textContent = '📋';
          } else {
            tableView.classList.remove('hidden');
            masonryView.classList.add('hidden');
            viewIcon.textContent = '🧱';
          }
        }
        
        // Toggle between table and masonry view
        function toggleView() {
          currentView = currentView === 'table' ? 'masonry' : 'table';
          localStorage.setItem('viewMode', currentView);
          
          const tableView = document.getElementById('tableView');
          const masonryView = document.getElementById('masonryView');
          const viewIcon = document.getElementById('viewIcon');
          
          if (currentView === 'masonry') {
            tableView.classList.add('hidden');
            masonryView.classList.remove('hidden');
            viewIcon.textContent = '📋';
            renderMasonry();
          } else {
            tableView.classList.remove('hidden');
            masonryView.classList.add('hidden');
            viewIcon.textContent = '🧱';
            renderTable();
          }
        }
        
        // Render masonry layout
        function sortKanbanByD2(columnId) {
          const cur = kanbanD2SortByColumn[columnId];
          kanbanD2SortByColumn[columnId] = cur === null || cur === undefined ? 'asc' : cur === 'asc' ? 'desc' : null;
          renderMasonry();
        }
        
        function renderMasonry() {
          const masonryContainer = document.getElementById('masonryContainer');
          const lastUpdate = document.getElementById('lastUpdate');
          
          if (alertsData.length === 0) {
            masonryContainer.innerHTML = '<div class="text-center text-muted-foreground py-12 col-span-full">No alerts available</div>';
            lastUpdate.innerHTML = 'Last updated: Never <span id="countdown"></span>';
            return;
          }
          
          // Filter data (same logic as renderTable)
          let filteredData = alertsData;
          if (searchTerm) {
            filteredData = alertsData.filter(alert => 
              (alert.symbol || '').toLowerCase().includes(searchTerm)
            );
          }
          
          // Apply Stoch K direction filters
          if (hasStochDirFilters()) {
            filteredData = filteredData.filter(alert => {
              return passesStochDirFilter(alert);
            });
          }
          
          // Apply Other Filters (Price %, Volume) - same as renderTable
          if (stochFilterPercentChange.length > 0 || volumeFilter.length > 0) {
            filteredData = filteredData.filter(alert => {
              // Price % filter (changeFromPrevDay)
              if (stochFilterPercentChange.length > 0) {
                const percentChange = alert.changeFromPrevDay !== null && alert.changeFromPrevDay !== undefined ? parseFloat(alert.changeFromPrevDay) : null;
                if (percentChange === null || isNaN(percentChange)) return false;
                const pctVal = percentChange;
                let matchesPct = false;
                for (const filter of stochFilterPercentChange) {
                  if (filter === '<-10' && pctVal < -10) { matchesPct = true; break; }
                  if (filter === '<-5' && pctVal >= -10 && pctVal < -5) { matchesPct = true; break; }
                  if (filter === '-5--2' && pctVal >= -5 && pctVal < -2) { matchesPct = true; break; }
                  if (filter === '-2-0' && pctVal >= -2 && pctVal < 0) { matchesPct = true; break; }
                  if (filter === '0-2' && pctVal >= 0 && pctVal < 2) { matchesPct = true; break; }
                  if (filter === '2-5' && pctVal >= 2 && pctVal < 5) { matchesPct = true; break; }
                  if (filter === '>5' && pctVal >= 5 && pctVal < 10) { matchesPct = true; break; }
                  if (filter === '>10' && pctVal >= 10) { matchesPct = true; break; }
                }
                if (!matchesPct) return false;
              }
              
              // Volume filter
              if (volumeFilter.length > 0) {
                const volume = alert.volume ? parseInt(alert.volume) : 0;
                let matchesVol = false;
                for (const filter of volumeFilter) {
                  if (filter === '<100K' && volume < 100000) { matchesVol = true; break; }
                  if (filter === '100K-500K' && volume >= 100000 && volume < 500000) { matchesVol = true; break; }
                  if (filter === '500K-1M' && volume >= 500000 && volume < 1000000) { matchesVol = true; break; }
                  if (filter === '1M-5M' && volume >= 1000000 && volume < 5000000) { matchesVol = true; break; }
                  if (filter === '>5M' && volume >= 5000000) { matchesVol = true; break; }
                }
                if (!matchesVol) return false;
              }
              
              return true;
            });
          }
          
          // Sort filtered data - starred items always come first
          if (currentSortField) {
            filteredData.sort((a, b) => {
              const aStarred = isStarred(a.symbol);
              const bStarred = isStarred(b.symbol);
              
              if (aStarred && !bStarred) return -1;
              if (!aStarred && bStarred) return 1;
              
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
          
          if (filteredData.length === 0) {
            masonryContainer.innerHTML = '<div class="text-center text-muted-foreground py-12 col-span-full">No results found</div>';
            return;
          }
          
          const kanbanColumns = [
            { id: 'all', title: 'All', bgColor: 'bg-card' }
          ];

          const columnBuckets = { all: [] };
          filteredData.forEach(alert => {
            columnBuckets.all.push(alert);
          });

          // Sort each column: starred first, then crossings, then by D2 (if sort active) or alphabetical
          Object.keys(columnBuckets).forEach(columnId => {
            const d2Dir = kanbanD2SortByColumn[columnId];
            columnBuckets[columnId].sort((a, b) => {
              const aStarred = isStarred(a.symbol);
              const bStarred = isStarred(b.symbol);
              
              // Starred symbols always come first
              if (aStarred && !bStarred) return -1;
              if (!aStarred && bStarred) return 1;
              
              // Check for stochastic crossings
              const aCross = a.kCross && a.kCross !== 'none';
              const bCross = b.kCross && b.kCross !== 'none';
              
              // Crossings come next (after starred)
              if (aCross && !bCross) return -1;
              if (!aCross && bCross) return 1;
              
              // Then by D2 value if sort active, else alphabetical
              if (d2Dir === 'asc' || d2Dir === 'desc') {
                const aD2 = getStochValues(a).dValue;
                const bD2 = getStochValues(b).dValue;
                const aVal = aD2 != null && !isNaN(aD2) ? aD2 : -1;
                const bVal = bD2 != null && !isNaN(bD2) ? bD2 : -1;
                const cmp = aVal - bVal;
                return d2Dir === 'asc' ? cmp : -cmp;
              }
              return (a.symbol || '').localeCompare(b.symbol || '');
            });
          });

          const getStochValueClass = (value) => {
            if (value === null || isNaN(value)) return 'text-muted-foreground';
            if (value < 40) return 'text-red-400';
            if (value > 60) return 'text-green-400';
            return 'text-white';
          };

          masonryContainer.innerHTML = kanbanColumns.map(column => {
            const cards = columnBuckets[column.id] || [];
            const cardsHtml = cards.length === 0
              ? '<div class="kanban-card-empty">No tickers</div>'
              : cards.map(alert => {
                  const symbol = alert.symbol || 'N/A';
                  const { kValue, dValue, kDirection, dDirection } = getStochValues(alert);
                  const kDisplay = kValue !== null && !isNaN(kValue) ? kValue.toFixed(1) : 'N/A';
                  const dDisplay = dValue !== null && !isNaN(dValue) ? dValue.toFixed(1) : 'N/A';
                  const kClass = getStochValueClass(kValue);
                  const dClass = getStochValueClass(dValue);
                  const d1Arrow = kDirection === 'up' ? '↑' : kDirection === 'down' ? '↓' : '→';
                  const d2Arrow = dDirection === 'up' ? '↑' : dDirection === 'down' ? '↓' : '→';
                  const starred = isStarred(symbol);
                  const cardClass = starred ? 'kanban-card starred' : 'kanban-card';
                  
                  // Change percentage (from previous day's close)
                  const changePercent = alert.changeFromPrevDay;
                  const changeDisplay = changePercent !== null && changePercent !== undefined && !isNaN(changePercent)
                    ? (changePercent >= 0 ? '+' : '') + changePercent.toFixed(2) + '%'
                    : '';
                  const changeClass = changePercent >= 0 ? 'text-green-400' : 'text-red-400';
                  
                  // Crossing tag (K crossing D)
                  const kCross = alert.kCross || 'none';
                  const crossTag = kCross === 'cross_over' ? 'C↑' : kCross === 'cross_under' ? 'C↓' : '';
                  const crossClass = kCross === 'cross_over' ? 'text-green-400' : kCross === 'cross_under' ? 'text-red-400' : '';
                  
                  // HL/LH pattern (Higher Low / Lower High)
                  const d2Pattern = alert.soloStochD2Pattern || alert.dualStochD1Pattern || alert.d2Pattern || '';
                  const d2PatternTag = d2Pattern === 'Higher Low' ? 'HL' : d2Pattern === 'Lower High' ? 'LH' : '';
                  const d2PatternClass = d2Pattern === 'Higher Low' ? 'text-cyan-400' : d2Pattern === 'Lower High' ? 'text-orange-400' : '';
                  
                  // D1 crossing 90/10 levels - use bg color instead of tag
                  let levelCrossBg = '';
                  if (kValue !== null && !isNaN(kValue)) {
                    if (kValue >= 90 && kDirection === 'up') {
                      levelCrossBg = 'bg-yellow-500/20';
                    } else if (kValue > 85 && kValue < 90 && kDirection === 'down') {
                      levelCrossBg = 'bg-orange-500/20';
                    } else if (kValue <= 10 && kDirection === 'down') {
                      levelCrossBg = 'bg-purple-500/20';
                    } else if (kValue > 10 && kValue <= 15 && kDirection === 'up') {
                      levelCrossBg = 'bg-cyan-500/20';
                    }
                  }
            
            return \`
              <div class="\${cardClass} \${levelCrossBg}" onclick="toggleStar('\${symbol}')">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-semibold text-foreground whitespace-nowrap">\${starred ? '⭐ ' : ''}\${symbol}\${changeDisplay ? \` <span class="\${changeClass}">\${changeDisplay}</span>\` : ''}</span>
                  <div class="text-xs whitespace-nowrap flex items-center gap-1">
                    \${crossTag ? \`<span class="\${crossClass} font-bold">\${crossTag}</span><span class="text-muted-foreground">|</span>\` : ''}
                    \${d2PatternTag ? \`<span class="\${d2PatternClass} font-bold">\${d2PatternTag}</span><span class="text-muted-foreground">|</span>\` : ''}
                    <span class="text-muted-foreground">D1</span>
                    <span class="\${kClass} font-semibold ml-1">\${kDisplay}\${d1Arrow}</span>
                    <span class="text-muted-foreground mx-1">|</span>
                    <span class="text-muted-foreground">D2</span>
                    <span class="\${dClass} font-semibold ml-1">\${dDisplay}\${d2Arrow}</span>
                  </div>
                </div>
              </div>
                  \`;
                }).join('');

            return \`
              <div class="kanban-column \${column.bgColor || ''}">
                <div class="kanban-column-header">
                  <span class="flex items-center gap-1.5">
                    \${column.title}
                    <button type="button" onclick="event.stopPropagation(); sortKanbanByD2('\${column.id}')" class="p-0.5 rounded hover:bg-white/10 transition-colors" title="Sort by D2 value">
                      <span class="text-xs text-muted-foreground">\${kanbanD2SortByColumn[column.id] === 'asc' ? '↑' : kanbanD2SortByColumn[column.id] === 'desc' ? '↓' : '⇅'}</span>
                    </button>
                  </span>
                  <span class="kanban-column-count">\${cards.length}</span>
                  </div>
                \${cardsHtml}
              </div>
            \`;
          }).join('');
          
          // Update last update time
          const now = new Date();
          lastUpdate.innerHTML = \`Last updated: \${now.toLocaleTimeString()} <span id="countdown"></span>\`;
        }

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
            const paddingClass = colId === 'symbol' ? 'pl-4 pr-4' : 'px-4';
            const onclickAttr = col.sortable ? 'onclick="sortTable(\\'' + sortField + '\\')"' : '';
            const draggableAttr = 'true';
            
            // Get dynamic width
            const width = getColumnWidth(colId);
            const widthStyle = 'width: ' + width + 'px; min-width: ' + width + 'px; max-width: ' + width + 'px;';
            
            // Add ticker count badge for symbol column
            const tickerCountBadge = colId === 'symbol' ? '<span id="tickerCount" class="ml-2 px-2 py-0.5 text-xs font-semibold bg-blue-500/20 text-blue-400 rounded-md border border-blue-500/30">0</span>' : '';
            
            return '<th ' +
              'class="text-left py-3 ' + paddingClass + ' font-bold text-muted-foreground ' + sortableClass + ' draggable-header" ' +
              'style="' + widthStyle + '" ' +
              'data-column-id="' + colId + '" ' +
              onclickAttr + ' ' +
              tooltipAttr + ' ' +
              'draggable="' + draggableAttr + '" ' +
              'ondragstart="handleHeaderDragStart(event)" ' +
              'ondragover="handleHeaderDragOver(event)" ' +
              'ondrop="handleHeaderDrop(event)" ' +
              'ondragend="handleHeaderDragEnd(event)"' +
              '>' +
              col.title + tickerCountBadge + ' ' + sortIndicator +
              '</th>';
          }).join('');
          
          updateSortIndicators();
          
          // Attach resize handlers after headers are rendered
          attachResizeHandlers();
        }
        
        // Attach resize handlers to all column headers
        function attachResizeHandlers() {
          const headers = document.querySelectorAll('th[data-column-id]');
          headers.forEach(header => {
            const columnId = header.getAttribute('data-column-id');
            
            // Remove existing resize handle if any
            const existingHandle = header.querySelector('.column-resize-handle');
            if (existingHandle) {
              existingHandle.remove();
            }
            
            // Create and attach resize handle
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'column-resize-handle';
            resizeHandle.title = 'Drag to resize column';
            resizeHandle.addEventListener('mousedown', (e) => {
              handleColumnResizeStart(e, columnId);
            });
            header.appendChild(resizeHandle);
          });
        }

        // Drag and drop handlers for column reordering
        let draggedColumnId = null;
        let draggedElement = null;

        function handleHeaderDragStart(e) {
          // Don't start drag if clicking on resize handle
          if (e.target.closest('.column-resize-handle')) {
            e.preventDefault();
            return false;
          }
          
          // Don't start drag if currently resizing
          if (resizeState.isResizing) {
            e.preventDefault();
            return false;
          }
          
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

        // Column resize handlers
        let resizeState = {
          isResizing: false,
          columnId: null,
          startX: 0,
          startWidth: 0,
          header: null
        };

        function handleColumnResizeStart(e, columnId) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          // Prevent drag from starting
          if (e.target.closest('.column-resize-handle')) {
            const header = e.target.closest('th');
            if (!header) return;
            
            // Disable dragging on this header
            header.setAttribute('draggable', 'false');
            
            resizeState.isResizing = true;
            resizeState.columnId = columnId;
            resizeState.startX = e.clientX;
            resizeState.startWidth = getColumnWidth(columnId);
            resizeState.header = header;
            
            // Add resizing class
            const handle = e.target.closest('.column-resize-handle');
            if (handle) {
              handle.classList.add('resizing');
            }
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            
            // Add global mouse move and mouse up listeners
            document.addEventListener('mousemove', handleColumnResize, { passive: false });
            document.addEventListener('mouseup', handleColumnResizeEnd, { once: true });
          }
        }

        function handleColumnResize(e) {
          if (!resizeState.isResizing) return;
          
          e.preventDefault();
          e.stopPropagation();
          
          const diff = e.clientX - resizeState.startX;
          const newWidth = Math.max(30, Math.min(1000, resizeState.startWidth + diff));
          
          // Update width in real-time
          if (resizeState.header) {
            resizeState.header.style.width = newWidth + 'px';
            resizeState.header.style.minWidth = newWidth + 'px';
            resizeState.header.style.maxWidth = newWidth + 'px';
          }
          
          // Update all cells in this column
          const columnIndex = columnOrder.indexOf(resizeState.columnId);
          if (columnIndex !== -1) {
            const rows = document.querySelectorAll('#alertTable tr');
            rows.forEach(row => {
              const cell = row.children[columnIndex];
              if (cell) {
                cell.style.width = newWidth + 'px';
                cell.style.minWidth = newWidth + 'px';
                cell.style.maxWidth = newWidth + 'px';
              }
            });
          }
        }

        function handleColumnResizeEnd(e) {
          if (!resizeState.isResizing) return;
          
          e.preventDefault();
          e.stopPropagation();
          
          const diff = e.clientX - resizeState.startX;
          const newWidth = Math.max(30, Math.min(1000, resizeState.startWidth + diff));
          
          // Save the new width
          setColumnWidth(resizeState.columnId, newWidth);
          
          // Update all headers and cells
          const columnIndex = columnOrder.indexOf(resizeState.columnId);
          if (columnIndex !== -1) {
            // Update all headers
            const headers = document.querySelectorAll('th[data-column-id="' + resizeState.columnId + '"]');
            headers.forEach(header => {
              header.style.width = newWidth + 'px';
              header.style.minWidth = newWidth + 'px';
              header.style.maxWidth = newWidth + 'px';
                header.setAttribute('draggable', 'true');
            });
            
            // Update all cells
            const rows = document.querySelectorAll('#alertTable tr');
            rows.forEach(row => {
              const cell = row.children[columnIndex];
              if (cell) {
                cell.style.width = newWidth + 'px';
                cell.style.minWidth = newWidth + 'px';
                cell.style.maxWidth = newWidth + 'px';
              }
            });
          }
          
          // Clean up
          const resizeHandle = document.querySelector('.column-resize-handle.resizing');
          if (resizeHandle) {
            resizeHandle.classList.remove('resizing');
          }
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          
          // Remove event listeners
          document.removeEventListener('mousemove', handleColumnResize);
          document.removeEventListener('mouseup', handleColumnResizeEnd);
          
          // Reset state
          resizeState.isResizing = false;
          resizeState.columnId = null;
          resizeState.startX = 0;
          resizeState.startWidth = 0;
          resizeState.header = null;
        }

        function getSortValue(alert, field) {
          switch(field) {
            case 'symbol':
              return alert.symbol || '';
            case 'price':
              // Sort by price change percentage instead of price value
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
            default:
              return '';
          }
        }

        // Toggle filter section collapse/expand
        function toggleFilterSection(sectionId, headerElement) {
          const content = document.getElementById(sectionId);
          const chevron = headerElement.querySelector('.filter-chevron');
          
          if (content && chevron) {
            content.classList.toggle('collapsed');
            chevron.classList.toggle('collapsed');
          }
        }

        // Chip-based filter toggle function
        function toggleFilterChip(filterType, value, element) {
          // Toggle active state for filters
          element.classList.toggle('active');
          
          // Update parent container's has-active class
          const parentGroup = element.closest('.filter-group');
          if (parentGroup) {
            const hasAnyActive = parentGroup.querySelector('.filter-chip.active') !== null;
            parentGroup.classList.toggle('has-active', hasAnyActive);
          }
          
          // Update filter arrays based on active chips
          updateFilterArrays();
          
          // Apply filters
          filterAlerts();
        }
        
        function toggleSliderFilter(sliderType) {
          const map = { stochK1Value: stochK1Value, stochK2Value: stochK2Value, stochK3Value: stochK3Value };
          if (map[sliderType]) updateGenericValueFilter(sliderType, map[sliderType]);
        }

        function updateGenericValueFilter(key, stateObj) {
          const toggle = document.getElementById(key + 'Toggle');
          const excludedEl = document.getElementById(key + 'Excluded');
          const slider = sliders[key];
          if (slider && slider.noUiSlider) {
            const values = slider.noUiSlider.get();
            const minVal = Math.round(parseFloat(values[0]));
            const maxVal = Math.round(parseFloat(values[1]));
            stateObj.min = minVal;
            stateObj.max = maxVal;
            stateObj.excluded = excludedEl ? excludedEl.checked : false;
            stateObj.active = toggle && toggle.checked && (minVal > 0 || maxVal < 100);
            filterAlerts();
          }
        }

        function updateGenericDiffFilter(key, stateObj) {
          const toggle = document.getElementById(key + 'Toggle');
          const slider = sliders[key];
          if (slider && slider.noUiSlider) {
            const values = slider.noUiSlider.get();
            const minVal = Math.round(parseFloat(values[0]));
            const maxVal = Math.round(parseFloat(values[1]));
            stateObj.min = minVal;
            stateObj.max = maxVal;
            stateObj.active = toggle && toggle.checked && (minVal > 0 || maxVal < 75);
            filterAlerts();
          }
        }

        function updateFilterArrays() {
          stochK1Dir = Array.from(document.querySelectorAll('[data-filter="stoch_k1Dir"].active')).map(c => c.dataset.value);
          stochK2Dir = Array.from(document.querySelectorAll('[data-filter="stoch_k2Dir"].active')).map(c => c.dataset.value);
          stochK3Dir = Array.from(document.querySelectorAll('[data-filter="stoch_k3Dir"].active')).map(c => c.dataset.value);
          stochSuggestion = Array.from(document.querySelectorAll('[data-filter="stoch_suggestion"].active')).map(c => c.dataset.value);
          updateStochOrderFromDom();
          stochFilterPercentChange = Array.from(document.querySelectorAll('[data-filter="percentChange"].active')).map(c => c.dataset.value);
          volumeFilter = Array.from(document.querySelectorAll('[data-filter="volume"].active')).map(c => c.dataset.value);
        }
        
        function filterAlerts() {
          searchTerm = document.getElementById('searchInput').value.toLowerCase();
          
          // Update filter arrays from chip states
          updateFilterArrays();
          
          renderTable();
        }
        
        function clearStochFilters() {
          clearStochDirFilters();
        }
        
        // Clear Other filters
        function clearOtherFilters() {
          // Remove active class from all Other filter chips
          document.querySelectorAll('[data-filter="percentChange"], [data-filter="volume"]').forEach(chip => {
            chip.classList.remove('active');
            const parentGroup = chip.closest('.filter-group');
            if (parentGroup) parentGroup.classList.remove('has-active');
          });
          
          stochFilterPercentChange = [];
          volumeFilter = [];
          renderTable();
        }
        
        function clearAllFilters() {
          clearStochFilters();
          clearOtherFilters();
          // Clear search
          const searchInput = document.getElementById('searchInput');
          if (searchInput) {
            searchInput.value = '';
            searchTerm = '';
            toggleClearButton();
          }
          // Clear preset filter active states
          const presetGroup = document.querySelector('.preset-filter-group');
          if (presetGroup) presetGroup.classList.remove('has-active');
          document.querySelectorAll('.preset-filter-chip').forEach(btn => {
            btn.classList.remove('active');
          });
          activePreset = null;
        }
        
        function applyPresetFilter(preset) {
          const presetGroup = document.querySelector('.preset-filter-group');
          const presetButton = document.getElementById('preset' + preset.charAt(0).toUpperCase() + preset.slice(1));
          
          // Check if button is already active - if so, deactivate it
          if (presetButton && presetButton.classList.contains('active')) {
            clearAllFilters();
            return;
          }
          
          // Clear all filters first
          clearAllFilters();
          
          // Set active state for preset button
          if (presetButton && presetGroup) {
            presetButton.classList.add('active');
            presetGroup.classList.add('has-active');
          }
          
          // Track active preset for CCI-based filtering
          activePreset = preset;
          
          function activateChip(filterName, value) {
            const chip = document.querySelector('[data-filter="' + filterName + '"][data-value="' + value + '"]');
            if (chip) { chip.classList.add('active'); const pg = chip.closest('.filter-group'); if (pg) pg.classList.add('has-active'); }
          }

          if (preset === 'down') {
            activateChip('stoch_k1Dir', 'down');
            activateChip('stoch_k2Dir', 'down');
          } else if (preset === 'up') {
            activateChip('stoch_k1Dir', 'up');
            activateChip('stoch_k2Dir', 'up');
          } else if (preset === 'extBull') {
            activateChip('stoch_k1Dir', 'up');
          } else if (preset === 'extBear') {
            activateChip('stoch_k1Dir', 'down');
          }
          
          // Update filter arrays from chip states
          updateFilterArrays();
          
          // Apply filters - ensure renderTable is called
            filterAlerts();
          
          // Force a re-render to ensure filters are applied
          renderTable();
        }

        // Export filter settings
        function openExportModal() {
          const overlay = document.getElementById('exportModalOverlay');
          const modal = overlay.querySelector('.export-modal');
          const input = document.getElementById('exportPresetName');
          
          overlay.classList.add('open');
          modal.classList.add('open');
          input.value = '';
          input.focus();
        }
        
        function closeExportModal() {
          const overlay = document.getElementById('exportModalOverlay');
          const modal = overlay.querySelector('.export-modal');
          
          overlay.classList.remove('open');
          modal.classList.remove('open');
        }
        
        function exportFilterSettings() {
          const presetName = document.getElementById('exportPresetName').value.trim();
          
          if (!presetName) {
            alert('Please enter a preset name');
            return;
          }
          
          // Collect all current filter settings
          updateFilterArrays();
          
          const settings = {
            name: presetName,
            filters: {
              stoch: {
                k1Dir: stochK1Dir,
                k2Dir: stochK2Dir,
                k3Dir: stochK3Dir
              },
              percentChange: stochFilterPercentChange,
              search: searchTerm || null
            }
          };
          
          // Format for AI to create preset button
          const exportText = \`Preset Name: \${presetName}

Filter Settings:
\${JSON.stringify(settings, null, 2)}

Use this to create a new preset filter button that applies these exact filter settings.\`;
          
          // Copy to clipboard
          navigator.clipboard.writeText(exportText).then(() => {
            alert('Filter settings copied to clipboard!');
            closeExportModal();
          }).catch(err => {
            console.error('Failed to copy:', err);
            alert('Failed to copy to clipboard. Please try again.');
          });
        }

        // Count how many alerts match each preset filter
        // dataToCount: the data to count from (should be filteredData from renderTable)
        function updatePresetFilterCounts(dataToCount) {
          // Use filtered data if provided, otherwise use all alertsData
          const data = dataToCount || alertsData;
          
          if (data.length === 0) {
            const downCountEl = document.getElementById('presetDownCount');
            const upCountEl = document.getElementById('presetUpCount');
            const extBullCountEl = document.getElementById('presetExtBullCount');
            const extBearCountEl = document.getElementById('presetExtBearCount');
            if (downCountEl) downCountEl.textContent = '0';
            if (upCountEl) upCountEl.textContent = '0';
            if (extBullCountEl) extBullCountEl.textContent = '0';
            if (extBearCountEl) extBearCountEl.textContent = '0';
            return;
          }

          // Count preset matches
          let downCount = 0;
          let upCount = 0;
          let extBullCount = 0;
          let extBearCount = 0;

          data.forEach(alert => {
            const t = alert.triStoch;
            const k1Dir = t && t.ovKDirection ? t.ovKDirection : 'flat';
            const k2Dir = t && t.dtKDirection ? t.dtKDirection : 'flat';
            const k1Val = t && t.ovK != null ? parseFloat(t.ovK) : null;
            
            let matchesDown = k1Dir === 'down' && k2Dir === 'down';
            let matchesUp = k1Dir === 'up' && k2Dir === 'up';
            let matchesExtBull = k1Dir === 'up' && k1Val !== null && !isNaN(k1Val) && k1Val >= 80 && k1Val <= 100;
            let matchesExtBear = k1Dir === 'down' && k1Val !== null && !isNaN(k1Val) && k1Val >= 0 && k1Val <= 30;
            
            if (matchesDown) downCount++;
            if (matchesUp) upCount++;
            if (matchesExtBull) extBullCount++;
            if (matchesExtBear) extBearCount++;
          });

          // Update the count displays
          const downCountEl = document.getElementById('presetDownCount');
          const upCountEl = document.getElementById('presetUpCount');
          const extBullCountEl = document.getElementById('presetExtBullCount');
          const extBearCountEl = document.getElementById('presetExtBearCount');
          if (downCountEl) downCountEl.textContent = downCount;
          if (upCountEl) upCountEl.textContent = upCount;
          if (extBullCountEl) extBullCountEl.textContent = extBullCount;
          if (extBearCountEl) extBearCountEl.textContent = extBearCount;
        }

        // Count how many alerts match each Price % range
        // dataToCount: the data to count from (should be filteredData from renderTable)
        function updatePricePercentCounts(dataToCount) {
          // Use filtered data if provided, otherwise use all alertsData
          const data = dataToCount || alertsData;
          
          if (data.length === 0) {
            const lessThanMinus10CountEl = document.getElementById('pricePercentLessThanMinus10Count');
            const lessThan5CountEl = document.getElementById('pricePercentLessThan5Count');
            const minus5ToMinus2CountEl = document.getElementById('pricePercentMinus5ToMinus2Count');
            const minus2To0CountEl = document.getElementById('pricePercentMinus2To0Count');
            const zeroTo2CountEl = document.getElementById('pricePercent0To2Count');
            const twoTo5CountEl = document.getElementById('pricePercent2To5Count');
            const greaterThan5CountEl = document.getElementById('pricePercentGreaterThan5Count');
            const greaterThan10CountEl = document.getElementById('pricePercentGreaterThan10Count');
            if (lessThanMinus10CountEl) lessThanMinus10CountEl.textContent = '0';
            if (lessThan5CountEl) lessThan5CountEl.textContent = '0';
            if (minus5ToMinus2CountEl) minus5ToMinus2CountEl.textContent = '0';
            if (minus2To0CountEl) minus2To0CountEl.textContent = '0';
            if (zeroTo2CountEl) zeroTo2CountEl.textContent = '0';
            if (twoTo5CountEl) twoTo5CountEl.textContent = '0';
            if (greaterThan5CountEl) greaterThan5CountEl.textContent = '0';
            if (greaterThan10CountEl) greaterThan10CountEl.textContent = '0';
            return;
          }

          // Count matches for each range
          let lessThanMinus10Count = 0;
          let lessThan5Count = 0;
          let minus5ToMinus2Count = 0;
          let minus2To0Count = 0;
          let zeroTo2Count = 0;
          let twoTo5Count = 0;
          let greaterThan5Count = 0;
          let greaterThan10Count = 0;

          data.forEach(alert => {
            const percentChange = alert.changeFromPrevDay !== null && alert.changeFromPrevDay !== undefined ? parseFloat(alert.changeFromPrevDay) : null;
            
            if (percentChange === null || isNaN(percentChange)) {
              return; // Skip alerts without valid price change data
            }
            
            const pctVal = percentChange;
            
            if (pctVal < -10) {
              lessThanMinus10Count++;
            } else if (pctVal >= -10 && pctVal < -5) {
              lessThan5Count++;
            } else if (pctVal >= -5 && pctVal < -2) {
              minus5ToMinus2Count++;
            } else if (pctVal >= -2 && pctVal < 0) {
              minus2To0Count++;
            } else if (pctVal >= 0 && pctVal < 2) {
              zeroTo2Count++;
            } else if (pctVal >= 2 && pctVal < 5) {
              twoTo5Count++;
            } else if (pctVal >= 5 && pctVal < 10) {
              greaterThan5Count++;
            } else if (pctVal >= 10) {
              greaterThan10Count++;
            }
          });

          // Update the count displays
          const lessThanMinus10CountEl = document.getElementById('pricePercentLessThanMinus10Count');
          const lessThan5CountEl = document.getElementById('pricePercentLessThan5Count');
          const minus5ToMinus2CountEl = document.getElementById('pricePercentMinus5ToMinus2Count');
          const minus2To0CountEl = document.getElementById('pricePercentMinus2To0Count');
          const zeroTo2CountEl = document.getElementById('pricePercent0To2Count');
          const twoTo5CountEl = document.getElementById('pricePercent2To5Count');
          const greaterThan5CountEl = document.getElementById('pricePercentGreaterThan5Count');
          const greaterThan10CountEl = document.getElementById('pricePercentGreaterThan10Count');
          if (lessThanMinus10CountEl) lessThanMinus10CountEl.textContent = lessThanMinus10Count;
          if (lessThan5CountEl) lessThan5CountEl.textContent = lessThan5Count;
          if (minus5ToMinus2CountEl) minus5ToMinus2CountEl.textContent = minus5ToMinus2Count;
          if (minus2To0CountEl) minus2To0CountEl.textContent = minus2To0Count;
          if (zeroTo2CountEl) zeroTo2CountEl.textContent = zeroTo2Count;
          if (twoTo5CountEl) twoTo5CountEl.textContent = twoTo5Count;
          if (greaterThan5CountEl) greaterThan5CountEl.textContent = greaterThan5Count;
          if (greaterThan10CountEl) greaterThan10CountEl.textContent = greaterThan10Count;
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
            notificationsEnabled = settings.enabled; // Update client-side state
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
            text.textContent = 'Unmute';
          } else {
            toggle.className = 'inline-flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors shadow-lg';
            icon.textContent = '🔕';
            text.textContent = 'Mute';
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
              notificationsEnabled = newState; // Update client-side state
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
          // If in masonry view, render masonry instead
          if (currentView === 'masonry') {
            renderMasonry();
            return;
          }
          
          const alertTable = document.getElementById('alertTable');
          const lastUpdate = document.getElementById('lastUpdate');
          
          if (alertsData.length === 0) {
            alertTable.innerHTML = \`<tr><td colspan="\${columnOrder.length}" class="text-center text-muted-foreground py-12 relative">No alerts available</td></tr>\`;
            lastUpdate.innerHTML = 'Last updated: Never <span id="countdown"></span>';
            // Update ticker count badge
            const tickerCountEl = document.getElementById('tickerCount');
            if (tickerCountEl) tickerCountEl.textContent = '0';
            return;
          }

          // Filter data by search term
          let filteredData = alertsData;
          if (searchTerm) {
            filteredData = alertsData.filter(alert => 
              (alert.symbol || '').toLowerCase().includes(searchTerm)
            );
          }
          
          // Create dataForPresetCounts: filtered by search only (NOT by Stoch filters)
          let dataForPresetCounts = [...filteredData];
          
          // Apply Other Filters (Price %, Volume)
          if (stochFilterPercentChange.length > 0 || volumeFilter.length > 0) {
            filteredData = filteredData.filter(alert => {
              // Price % filter (changeFromPrevDay)
              if (stochFilterPercentChange.length > 0) {
                const percentChange = alert.changeFromPrevDay !== null && alert.changeFromPrevDay !== undefined ? parseFloat(alert.changeFromPrevDay) : null;
                if (percentChange === null || isNaN(percentChange)) return false;
                const pctVal = percentChange;
                let matchesPct = false;
                for (const filter of stochFilterPercentChange) {
                  if (filter === '<-10' && pctVal < -10) { matchesPct = true; break; }
                  if (filter === '<-5' && pctVal >= -10 && pctVal < -5) { matchesPct = true; break; }
                  if (filter === '-5--2' && pctVal >= -5 && pctVal < -2) { matchesPct = true; break; }
                  if (filter === '-2-0' && pctVal >= -2 && pctVal < 0) { matchesPct = true; break; }
                  if (filter === '0-2' && pctVal >= 0 && pctVal < 2) { matchesPct = true; break; }
                  if (filter === '2-5' && pctVal >= 2 && pctVal < 5) { matchesPct = true; break; }
                  if (filter === '>5' && pctVal >= 5 && pctVal < 10) { matchesPct = true; break; }
                  if (filter === '>10' && pctVal >= 10) { matchesPct = true; break; }
                }
                if (!matchesPct) return false;
              }
              
              // Volume filter
              if (volumeFilter.length > 0) {
                const volume = alert.volume ? parseInt(alert.volume) : 0;
                let matchesVol = false;
                for (const filter of volumeFilter) {
                  if (filter === '<100K' && volume < 100000) { matchesVol = true; break; }
                  if (filter === '100K-500K' && volume >= 100000 && volume < 500000) { matchesVol = true; break; }
                  if (filter === '500K-1M' && volume >= 500000 && volume < 1000000) { matchesVol = true; break; }
                  if (filter === '1M-5M' && volume >= 1000000 && volume < 5000000) { matchesVol = true; break; }
                  if (filter === '>5M' && volume >= 5000000) { matchesVol = true; break; }
                }
                if (!matchesVol) return false;
              }
              
              return true;
            });
          }
          
          // Apply Stoch K direction filters
          if (hasStochDirFilters()) {
            filteredData = filteredData.filter(alert => passesStochDirFilter(alert));
          }
          // Note: dataForPresetCounts is already set correctly above (after search and ORB filters, before Stoch filters)
          // Do NOT overwrite it here, as filteredData now has Stoch filters applied

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
            // Update ticker count badge
            const tickerCountEl = document.getElementById('tickerCount');
            if (tickerCountEl) tickerCountEl.textContent = '0';
            return;
          }

          // Update ticker count badge
          const tickerCountEl = document.getElementById('tickerCount');
          if (tickerCountEl) tickerCountEl.textContent = filteredData.length;
          
          // Update preset filter counts based on data BEFORE preset filters are applied
          // This ensures counts reflect how many items in the current filtered list match each preset
          updatePresetFilterCounts(dataForPresetCounts);
          
          // Update Price % filter counts based on data BEFORE preset filters are applied
          updatePricePercentCounts(dataForPresetCounts);

          // Update last update time with search info
          const mostRecent = Math.max(...alertsData.map(alert => alert.receivedAt || 0));
          const searchInfo = searchTerm ? \` • Showing \${filteredData.length} of \${alertsData.length}\` : '';
          lastUpdate.innerHTML = 'Last updated: ' + new Date(mostRecent).toLocaleString() + searchInfo + ' <span id="countdown"></span>';
          updateCountdown();

          alertTable.innerHTML = filteredData.map((alert, index) => {
            // Helper function to get width style for a column
            const getCellWidthStyle = (colId) => {
              const width = getColumnWidth(colId);
              return 'width: ' + width + 'px; min-width: ' + width + 'px; max-width: ' + width + 'px;';
            };
            
            const starred = isStarred(alert.symbol);
            // Stationary pin (pushpin) SVG icons - filled when pinned, outline when not
            const starIcon = starred 
              ? '<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M16 12V4h1a2 2 0 0 0 0-4H7a2 2 0 0 0 0 4h1v8c0 1.1-.9 2-2 2H4a2 2 0 0 0 0 4h16a2 2 0 0 0 0-4h-2c-1.1 0-2-.9-2-2z"/></svg>'
              : '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2V5z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v6M9 18h6"/></svg>';
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
            if (alert.changeFromPrevDay !== undefined && alert.changeFromPrevDay !== null) {
              const changeFromPrevDay = parseFloat(alert.changeFromPrevDay);
              if (!isNaN(changeFromPrevDay)) {
              priceChangeDisplay = changeFromPrevDay.toFixed(2);
              // Change % color: green if >0%, red if <0%, gray if 0
              priceChangeClass = changeFromPrevDay > 0 ? 'text-green-400' : changeFromPrevDay < 0 ? 'text-red-400' : 'text-muted-foreground';
              }
            }
            // Priority 2: Calculate from price and previousClose
            else if (alert.price && alert.previousClose && alert.previousClose !== 0) {
              const close = parseFloat(alert.price);
              const prevDayClose = parseFloat(alert.previousClose);
              if (!isNaN(close) && !isNaN(prevDayClose) && prevDayClose !== 0) {
              const changeFromPrevDay = (close - prevDayClose) / prevDayClose * 100;
              priceChangeDisplay = changeFromPrevDay.toFixed(2);
              // Change % color: green if >0%, red if <0%, gray if 0
              priceChangeClass = changeFromPrevDay > 0 ? 'text-green-400' : changeFromPrevDay < 0 ? 'text-red-400' : 'text-muted-foreground';
              }
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
              if (!isNaN(price) && !isNaN(vwap) && vwap !== 0) {
              const vwapDiff = ((price - vwap) / vwap) * 100;
              const sign = vwapDiff >= 0 ? '+' : '';
              vwapDiffDisplay = \` (\${sign}\${vwapDiff.toFixed(2)}%)\`;
              vwapDiffColor = vwapDiff >= 0 ? 'text-green-400' : 'text-red-400';
              }
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
              if (!isNaN(d4Num)) {
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
            // Sources: legacy K/D, then Dual Stoch d1/d2 (dualStochD1/D2 or alert.d1/d2), then Solo, then generic d2
            const dualStochD1Raw = parseStochValue(alert.k) ?? parseStochValue(alert.dualStochD1) ?? parseStochValue(alert.d1);
            const dualStochD1 = (dualStochD1Raw !== null && !isNaN(dualStochD1Raw)) ? dualStochD1Raw : null;
            const dualStochD2Raw = parseStochValue(alert.d) ?? parseStochValue(alert.dualStochD2) ?? parseStochValue(alert.d2);
            const dualStochD2 = (dualStochD2Raw !== null && !isNaN(dualStochD2Raw)) ? dualStochD2Raw : null;
            const soloD2Raw = alert.soloStochD2 !== null && alert.soloStochD2 !== undefined && alert.soloStochD2 !== '' ? parseFloat(alert.soloStochD2) : null;
            const soloD2 = (soloD2Raw !== null && !isNaN(soloD2Raw)) ? soloD2Raw : null;
            const genericD2Raw = alert.d2 !== null && alert.d2 !== undefined && alert.d2 !== '' ? parseFloat(alert.d2) : null;
            const genericD2 = (genericD2Raw !== null && !isNaN(genericD2Raw)) ? genericD2Raw : null;
            
            // Use Dual Stoch if available, otherwise Solo Stoch, otherwise generic d2
            const d2Value = dualStochD2 !== null ? dualStochD2 : (soloD2 !== null ? soloD2 : genericD2);
            const d2Direction = dualStochD2 !== null ? (alert.dDirection || alert.dualStochD2Direction || alert.d2Direction || 'flat') : (alert.soloStochD2Direction || alert.d2Direction || 'flat');
            const d2Pattern = dualStochD2 !== null ? (alert.dualStochD1Pattern || '') : (alert.soloStochD2Pattern || alert.d2Pattern || '');
            const d2PatternValue = dualStochD2 !== null ? (alert.dualStochD1PatternValue != null ? parseFloat(alert.dualStochD1PatternValue) : null) : (parseStochValue(alert.soloStochD2PatternValue) ?? parseStochValue(alert.d2PatternValue));
            
            // Keep soloD2 variables for backward compatibility in display logic
            const soloD2Direction = d2Direction;
            const soloD2Pattern = d2Pattern;
            const soloD2PatternValue = d2PatternValue;
            
            // D1 color and direction for Dual Stoch
            let d1ValueClass = 'text-foreground';
            let d1DirClass = 'text-gray-400';
            let d1Arrow = '→';
            let d1Direction = 'flat';
            if (dualStochD1 !== null && !isNaN(dualStochD1)) {
              d1Direction = alert.kDirection || alert.dualStochD1Direction || alert.d1Direction || 'flat';
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
            
            // Trend messages based on K/D values and directions
            let trendMessage = '';
            let trendMessageClass = '';
            const { kValue, dValue, kDirection, dDirection } = getStochValues(alert);
            if (kValue !== null && dValue !== null) {
              if (kValue < 15 && dValue < 15) {
                trendMessage = 'No Long';
                trendMessageClass = 'text-red-500 font-bold';
              } else if (kValue > 80) {
                trendMessage = 'No Short';
                trendMessageClass = 'text-green-500 font-bold';
              } else if (kDirection === 'up' && kValue > 20) {
                trendMessage = 'Try Long';
                trendMessageClass = 'text-green-400 font-semibold';
              } else if (kDirection === 'down' && kValue < 80) {
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
            
            // ORB calculations
            const nyOrbHigh = alert.nyOrbHigh !== null && alert.nyOrbHigh !== undefined ? parseFloat(alert.nyOrbHigh) : null;
            const nyOrbLow = alert.nyOrbLow !== null && alert.nyOrbLow !== undefined ? parseFloat(alert.nyOrbLow) : null;
            const nyOrbMid = alert.nyOrbMid !== null && alert.nyOrbMid !== undefined ? parseFloat(alert.nyOrbMid) : null;
            const nyOrbStatus = alert.nyOrbStatus || null;
            
            const londonOrbHigh = alert.londonOrbHigh !== null && alert.londonOrbHigh !== undefined ? parseFloat(alert.londonOrbHigh) : null;
            const londonOrbLow = alert.londonOrbLow !== null && alert.londonOrbLow !== undefined ? parseFloat(alert.londonOrbLow) : null;
            const londonOrbMid = alert.londonOrbMid !== null && alert.londonOrbMid !== undefined ? parseFloat(alert.londonOrbMid) : null;
            const londonOrbStatus = alert.londonOrbStatus || null;
            
            // Get price direction from alert data (prefer NY, fallback to London)
            const nyPriceDirection = alert.nyPriceDirection || null;
            const londonPriceDirection = alert.londonPriceDirection || null;
            let priceDirection = nyPriceDirection || londonPriceDirection;
            
            // Fallback: Calculate price direction from price movement if not available
            if (!priceDirection) {
              const currentPrice = alert.price ? parseFloat(alert.price) : null;
              const prevPrice = previousPrices[alert.symbol];
              if (currentPrice !== null && !isNaN(currentPrice) && prevPrice !== undefined && !isNaN(prevPrice)) {
                priceDirection = currentPrice > prevPrice ? 'up' : currentPrice < prevPrice ? 'down' : 'flat';
              }
            }
            
            // Get ORB crossover from alert data (prefer NY, fallback to London)
            const nyOrbCrossover = alert.nyOrbCrossover || null;
            const londonOrbCrossover = alert.londonOrbCrossover || null;
            const orbCrossover = nyOrbCrossover || londonOrbCrossover;
            
            // Build d2 cell HTML string (to avoid template literal nesting issues)  
            if (!d2CellHtml) {
            let chartHtml = miniChartSvg || ''
            if (chartHtml) {
              chartHtml = '<div class="flex-shrink-0">' + chartHtml + '</div>'
            }
            let d1Html = ''
            const hasKD = parseStochValue(alert.k) !== null || parseStochValue(alert.d) !== null
            const d1Label = hasKD ? 'K' : 'D1'
            const d2Label = hasKD ? 'D' : 'D2'
            if (dualStochD1 !== null && !isNaN(dualStochD1)) {
              d1Html = '<div class="flex flex-row items-center gap-1"><div class="font-mono text-lg ' + d1ValueClass + '">' + d1Label + ': ' + dualStochD1.toFixed(1) + '</div><div class="text-lg ' + d1DirClass + '">' + d1Arrow + '</div></div>'
            }
            let diffHtml = ''
            if (d1D2Diff !== null && !isNaN(d1D2Diff)) {
              diffHtml = '<div class="inline-block px-2 py-0.5 rounded bg-gray-700 text-white font-semibold">' + Math.abs(d1D2Diff).toFixed(1) + '</div>'
            }
            // Combine D2 value with diff box (no separator between them)
            let d2HtmlContent = '<div class="flex flex-row items-center gap-1">' +
              '<div class="font-mono text-lg ' + d2ValueClass + '">' + (dualStochD1 !== null ? d2Label + ': ' : '') + (d2Value !== null && !isNaN(d2Value) ? d2Value.toFixed(1) : '-') + '</div>' +
              '<div class="text-lg ' + d2DirClass + '">' + d2Arrow + '</div>' +
              (d2PatternDisplay ? '<div class="text-xs ' + d2PatternClass + '">' + d2PatternDisplay + '</div>' : '') +
              (diffHtml ? '<div class="flex items-center ml-1">' + diffHtml + '</div>' : '') +
              '</div>'
            let trendHtml = ''
            if (trendMessage) {
              trendHtml = '<div class="text-xs ' + trendMessageClass + '">' + trendMessage + '</div>'
            }
            let d2TitleText = (dualStochD2 !== null ? (hasKD ? 'Stoch K.D' : 'Dual Stoch D1.D2') : 'Solo Stoch D2') + ': ' + 
              (dualStochD1 !== null && !isNaN(dualStochD1) ? d1Label + '=' + dualStochD1.toFixed(2) + '.' : '') + 
              d2Label + '=' + (d2Value !== null && !isNaN(d2Value) ? d2Value.toFixed(2) : 'N/A') + 
              ', Dir=' + d2Direction + 
              (d2PatternDisplay ? ', Pattern=' + d2Pattern : '') + 
              (d1D2Diff !== null && !isNaN(d1D2Diff) ? ', Diff=' + d1D2Diff.toFixed(1) : '') + 
              (trendMessage ? ', ' + trendMessage : '')
            let d2TitleEscaped = d2TitleText.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
            
            // Check if direction changed for flash animation
            const symbolKey = alert.symbol;
            const prevDirections = previousStochDirections[symbolKey] || { d1: null, d2: null };
            const currentD1Dir = dualStochD1 !== null ? d1Direction : null;
            const currentD2Dir = d2Direction;
            const d1Changed = prevDirections.d1 !== null && prevDirections.d1 !== currentD1Dir && currentD1Dir !== null;
            const d2Changed = prevDirections.d2 !== null && prevDirections.d2 !== currentD2Dir && currentD2Dir !== null;
            const shouldFlash = d1Changed || d2Changed;
            
            // Update previous directions
            previousStochDirections[symbolKey] = {
              d1: currentD1Dir,
              d2: currentD2Dir
            };
            
            // Build horizontal layout: Chart | D1: X↓ | D2: X↓ LH [diff box] | Trend
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
            
            const flashClass = shouldFlash ? ' stoch-flash' : '';
            d2CellHtml = '<td class="py-3 px-4 text-left' + flashClass + '" style="' + getCellWidthStyle('d2') + '" title="' + d2TitleEscaped + '">' +
              '<div class="flex flex-row items-center gap-2 flex-wrap">' +
              parts.join('<span class="text-muted-foreground mx-1">|</span>') +
              '</div></td>'
            }
            
            // Generate cell content for each column
            const cellContent = {
              symbol: \`<td class="py-3 pl-4 pr-4 font-medium text-foreground w-auto whitespace-nowrap" style="\${getCellWidthStyle('symbol')}">
                <div class="flex items-center gap-2">
                  <button 
                    onclick="event.stopPropagation(); toggleStar('\${alert.symbol}')" 
                    class="\${starClass} transition-colors cursor-pointer hover:scale-110 transform flex-shrink-0"
                    title="\${starred ? 'Remove from favorites' : 'Add to favorites'}"
                  >
                    \${starIcon}
                  </button>
                  <span>\${alert.symbol || 'N/A'}</span>
                </div>
              </td>\`,
              price: \`
                <td class="py-3 px-4 font-mono font-medium \${priceClass}" style="\${getCellWidthStyle('price')}">
                  \${alert.price ? formatCurrency(alert.price) : 'N/A'}
                  <span class="text-sm ml-2 \${priceChangeClass}">\${priceChangeDisplay !== 'N/A' ? '(' + (parseFloat(priceChangeDisplay) >= 0 ? '+' : '') + priceChangeDisplay + '%)' : ''}</span>
                </td>
              \`,
              highLevelTrend: \`
                <td class="py-3 px-4 text-left" style="\${getCellWidthStyle('highLevelTrend')}" title="High Level Trend: \${alert.dualStochHighLevelTrendType || 'None'}\${alert.dualStochHighLevelTrendDiff !== null && alert.dualStochHighLevelTrendDiff !== undefined && !isNaN(alert.dualStochHighLevelTrendDiff) ? ', Diff=' + alert.dualStochHighLevelTrendDiff.toFixed(1) : ''}">
                  \${alert.dualStochHighLevelTrend && alert.dualStochHighLevelTrendType ? 
                    '<div class="text-sm font-semibold ' + (alert.dualStochHighLevelTrendType === 'Bull' ? 'text-green-400' : 'text-red-400') + '">' + alert.dualStochHighLevelTrendType + '</div>' : 
                    '<div class="text-sm text-gray-400">-</div>'}
                </td>
              \`,
              volume: \`<td class="py-3 px-4 text-muted-foreground" style="\${getCellWidthStyle('volume')}" title="Volume since 9:30 AM: \${alert.volume ? parseInt(alert.volume).toLocaleString() : 'N/A'}">\${formatVolume(alert.volume)}</td>\`,
              stoch: (() => {
                const t = alert.triStoch;
                if (!t) return '<td class="py-3 px-4 text-muted-foreground text-xs" style="' + getCellWidthStyle('stoch') + '">-</td>';
                function kCell(label, kVal, kDir) {
                  const v = kVal != null && !isNaN(parseFloat(kVal)) ? parseFloat(kVal) : null;
                  const dir = kDir || 'flat';
                  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–';
                  const valStr = v !== null ? v.toFixed(1) : '–';
                  const clr = v !== null ? (v > 80 ? 'text-white' : v < 20 ? 'text-red-400' : dir === 'up' ? 'text-green-400' : dir === 'down' ? 'text-blue-400' : 'text-muted-foreground') : 'text-muted-foreground';
                  return '<span class="font-semibold ' + clr + '" title="' + label + ': ' + valStr + ' ' + dir + '"><span class="font-mono">' + label + ' ' + valStr + '</span> ' + arrow + '</span>';
                }
                const parts = [kCell('K1', t.ovK, t.ovKDirection), kCell('K2', t.dtK, t.dtKDirection), kCell('K3', t.k3, null)];
                const suggestion = getTriStochSuggestion(t);
                let suggestionHtml = '';
                if (suggestion) {
                  const sugClr = suggestion.type === 'long' ? 'text-green-400 font-semibold' : suggestion.type === 'short' ? 'text-red-400 font-semibold' : 'text-amber-400';
                  suggestionHtml = '<span class="text-xs ' + sugClr + ' ml-2">' + suggestion.text + '</span>';
                }
                return '<td class="py-3 px-4 text-left" style="' + getCellWidthStyle('stoch') + '"><div class="flex flex-row items-center gap-3 flex-wrap">' + parts.join('<span class="text-muted-foreground">|</span>') + suggestionHtml + '</div></td>';
              })()
            };
            
            // Render cells in column order
            const cells = columnOrder.map(colId => cellContent[colId] || '').join('');
            
            const stockPrice = alert.price ? parseFloat(alert.price) : null;
            const priceAttr = stockPrice && !isNaN(stockPrice) ? \`oncontextmenu="event.preventDefault(); openCalculatorWithPrice(\${stockPrice});"\` : '';
            return \`
              <tr class="border-b border-border hover:bg-muted/50 transition-colors \${starred ? 'bg-muted/20' : ''}" style="background-color: rgba(255, 255, 255, 0.02);" \${priceAttr} title="Right-click to open calculator with this stock price">
                \${cells}
              </tr>
            \`;
          }).join('');
        }

        // Check if alert matches any preset filter
        function checkPresetMatches(alert) {
          if (!alert || !alert.symbol) return [];
          
          const t = alert.triStoch;
          const k1Dir = t && t.ovKDirection ? t.ovKDirection : 'flat';
          const k2Dir = t && t.dtKDirection ? t.dtKDirection : 'flat';
          const k1Val = t && t.ovK != null ? parseFloat(t.ovK) : null;
          
          const matches = [];
          
          if (k1Dir === 'down' && k2Dir === 'down') matches.push('down');
          if (k1Dir === 'up' && k2Dir === 'up') matches.push('up');
          if (k1Dir === 'up' && k1Val !== null && !isNaN(k1Val) && k1Val >= 80 && k1Val <= 100) matches.push('extBull');
          if (k1Dir === 'down' && k1Val !== null && !isNaN(k1Val) && k1Val >= 0 && k1Val <= 30) matches.push('extBear');
          
          return matches;
        }
        
        // Show toast notification for preset filter match
        function showPresetMatchToast(symbol, presetName, price) {
          const toastContainer = document.getElementById('toastContainer');
          if (!toastContainer) return;
          
          // Get preset display name and styling
          let title = '';
          let toastClass = '';
          let icon = '';
          
          switch(presetName) {
            case 'down':
              title = 'Down Signal';
              toastClass = 'cross-low';
              icon = '🔻';
              break;
            case 'up':
              title = 'Up Signal';
              toastClass = 'cross-high';
              icon = '🚀';
              break;
            case 'extBull':
              title = 'Ext. Bull Signal';
              toastClass = 'cross-high';
              icon = '📈';
              break;
            case 'extBear':
              title = 'Ext. Bear Signal';
              toastClass = 'cross-low';
              icon = '📉';
              break;
            default:
              title = 'Preset Match';
              toastClass = 'cross-high';
              icon = '📊';
          }
          
          const message = \`\${symbol} matches \${title}\${price ? ' at ' + formatCurrency(price) : ''}\`;
          
          const toast = document.createElement('div');
          toast.className = \`toast \${toastClass}\`;
          toast.innerHTML = \`
            <div class="toast-icon">\${icon}</div>
            <div class="toast-content">
              <div class="toast-title">\${title}</div>
              <div class="toast-message">\${message}</div>
            </div>
            <button class="toast-close" onclick="this.parentElement.remove()">×</button>
          \`;
          
          toastContainer.appendChild(toast);
          
          // Auto-remove after 5 seconds
          setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => {
              if (toast.parentElement) {
                toast.remove();
              }
            }, 300);
          }, 5000);
        }
        
        // Toggle Stoch history overlay
        function toggleStochHistory() {
          const overlay = document.getElementById('stochHistoryOverlay');
          const panel = overlay.querySelector('.orb-history-panel');
          
          if (overlay.classList.contains('open')) {
            closeStochHistory();
          } else {
            overlay.classList.add('open');
            panel.classList.add('open');
            renderStochHistory();
          }
        }
        
        // Close Stoch history overlay
        function closeStochHistory() {
          const overlay = document.getElementById('stochHistoryOverlay');
          const panel = overlay.querySelector('.orb-history-panel');
          overlay.classList.remove('open');
          panel.classList.remove('open');
        }
        
        // Toggle Stoch history filter chip
        function toggleStochHistoryFilter(filterType, value, element) {
          // Update active state
          const chips = element.parentElement.querySelectorAll('.orb-history-filter-chip');
          chips.forEach(chip => chip.classList.remove('active'));
          element.classList.add('active');
          
          // Update filter state
          stochHistoryFilters[filterType] = value;
          
          // Apply filters
          applyStochHistoryFilters();
        }
        
        // Apply Stoch history filters
        function applyStochHistoryFilters() {
          // Render with filters
          renderStochHistory();
        }
        
        // Render Stoch history list
        function renderStochHistory() {
          const content = document.getElementById('stochHistoryContent');
          if (!content) return;
          
          if (stochHistory.length === 0) {
            content.innerHTML = '<div class="orb-history-empty">No stochastic events recorded yet</div>';
            return;
          }
          
          // Apply filters
          let filteredHistory = stochHistory.filter(item => {
            // Event type filter
            if (stochHistoryFilters.eventType !== 'all' && item.eventType !== stochHistoryFilters.eventType) {
              return false;
            }
            
            return true;
          });
          
          if (filteredHistory.length === 0) {
            content.innerHTML = '<div class="orb-history-empty">No events match the current filters</div>';
            return;
          }
          
          content.innerHTML = filteredHistory.map(item => {
            const time = new Date(item.timestamp);
            const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            const dateStr = time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            
            let eventText = '';
            let itemClass = 'cross-high';
            
            // Get D1/D2 values for display
            const d1Value = item.eventData.d1Value !== null && item.eventData.d1Value !== undefined ? parseFloat(item.eventData.d1Value).toFixed(1) : 'N/A';
            const d2Value = item.eventData.d2Value !== null && item.eventData.d2Value !== undefined ? parseFloat(item.eventData.d2Value).toFixed(1) : 'N/A';
            const d1D2Display = \`D1:\${d1Value} D2:\${d2Value}\`;
            
            switch(item.eventType) {
              case 'direction_change':
                eventText = item.eventData.description || 'Direction Changed';
                itemClass = item.eventData.isBullish ? 'cross-high' : 'cross-low';
                break;
              case 'preset_match':
                eventText = item.eventData.presetName || 'Preset Match';
                itemClass = item.eventData.isBullish ? 'cross-high' : 'cross-low';
                break;
              case 'trend_change':
                eventText = item.eventData.trendMessage || 'Trend Changed';
                itemClass = item.eventData.isBullish ? 'cross-high' : 'cross-low';
                break;
              default:
                eventText = 'Stochastic Event';
                itemClass = 'cross-high';
            }
            
            return \`
              <div class="orb-history-item \${itemClass}">
                <div class="orb-history-item-content">
                  <span class="orb-history-symbol">\${item.symbol}</span>
                  <span class="orb-history-separator">|</span>
                  <span class="orb-history-crossover">\${eventText}</span>
                  <span class="orb-history-separator">|</span>
                  <span class="orb-history-crossover">\${d1D2Display}</span>
                  <span class="orb-history-separator">|</span>
                  <span class="orb-history-time">\${dateStr} at \${timeStr}</span>
                </div>
              </div>
            \`;
          }).join('');
        }
        
        // Check for stochastic events and add to history
        function checkStochEvents(alert) {
          if (!alert || !alert.symbol) return;
          
          const symbol = alert.symbol;
          const { kValue, dValue, kDirection, dDirection } = getStochValues(alert);
          const d1Value = kValue;
          const d2Value = dValue;
          const d1Direction = kDirection;
          const d2Direction = dDirection;
          
          // Initialize previous state for this symbol if not exists
          if (!previousStochStates[symbol]) {
            previousStochStates[symbol] = {
              d1Direction: d1Direction,
              d2Direction: d2Direction,
              trendMessage: '',
              presetMatches: []
            };
            return; // Don't record initial state
          }
          
          const prevState = previousStochStates[symbol];
          
          // Check for direction changes
          if (d1Direction !== prevState.d1Direction || d2Direction !== prevState.d2Direction) {
            const isBullish = (d1Direction === 'up' && d2Direction === 'up') || (d1Direction === 'up' && prevState.d1Direction !== 'up');
            stochHistory.unshift({
              symbol: symbol,
              eventType: 'direction_change',
              eventData: {
                description: \`D1: \${prevState.d1Direction} → \${d1Direction}, D2: \${prevState.d2Direction} → \${d2Direction}\`,
                d1Direction: d1Direction,
                d2Direction: d2Direction,
                prevD1Direction: prevState.d1Direction,
                prevD2Direction: prevState.d2Direction,
                d1Value: d1Value,
                d2Value: d2Value,
                isBullish: isBullish
              },
              price: alert.price,
              timestamp: Date.now()
            });
          }
          
          // Check for preset matches (already handled in checkPresetMatches, but we can add to history here)
          const currentPresetMatches = checkPresetMatches(alert);
          const newPresetMatches = currentPresetMatches.filter(p => !prevState.presetMatches.includes(p));
          
          newPresetMatches.forEach(preset => {
            const isBullish = preset === 'up';
            stochHistory.unshift({
              symbol: symbol,
              eventType: 'preset_match',
              eventData: {
                presetName: preset === 'down' ? 'Down' : preset === 'up' ? 'Up' : 'Trend Down Big',
                preset: preset,
                d1Value: d1Value,
                d2Value: d2Value,
                isBullish: isBullish
              },
              price: alert.price,
              timestamp: Date.now()
            });
          });
          
          // Update previous state
          previousStochStates[symbol] = {
            d1Direction: d1Direction,
            d2Direction: d2Direction,
            trendMessage: prevState.trendMessage,
            presetMatches: currentPresetMatches
          };
          
          // Keep only last 100 entries
          if (stochHistory.length > 100) {
            stochHistory = stochHistory.slice(0, 100);
          }
          
          // Update history display if open
          if (document.getElementById('stochHistoryOverlay').classList.contains('open')) {
            renderStochHistory();
          }
        }
        
        async function fetchAlerts() {
          try {
            const response = await fetch('/alerts');
            const data = await response.json();
            
            // Check for preset matches in the fetched data
            if (Array.isArray(data)) {
              data.forEach(alert => {
                // Check preset filter matches
                const currentMatches = checkPresetMatches(alert);
                const symbol = alert.symbol;
                
                // Initialize previous matches for this symbol if not exists
                if (!previousPresetMatches[symbol]) {
                  previousPresetMatches[symbol] = [];
                }
                
                const prevMatches = previousPresetMatches[symbol];
                
                // Check for new matches (presets that weren't matched before)
                currentMatches.forEach(preset => {
                  if (!prevMatches.includes(preset)) {
                    // New match detected - show toast (skip 'up' and 'down' presets)
                    if (preset !== 'up' && preset !== 'down') {
                      showPresetMatchToast(symbol, preset, alert.price);
                    }
                  }
                });
                
                // Update previous matches
                previousPresetMatches[symbol] = currentMatches;
                
                // Check for stochastic events
                checkStochEvents(alert);
              });
            }
            
            alertsData = data;
            
            // Extract sector data from alerts for frontend use
            if (Array.isArray(data)) {
              data.forEach(alert => {
                if (alert.sector && alert.symbol) {
                  sectorData[alert.symbol] = alert.sector;
                }
              });
            }
            
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
          realtimeIndicator.innerHTML = '<span class="animate-pulse">🔄 Real-time updates active</span>';
        };
        
        eventSource.onmessage = function(event) {
          console.log('📡 Received real-time update:', event.data);
          
          // Parse the event data to check for ORB crossovers and preset matches
          try {
            const update = JSON.parse(event.data);
            
            // Handle sector updates
            if (update.type === 'sector_updated') {
                const { symbol, sector } = update.data;
                if (symbol && sector) {
                    sectorData[symbol] = sector;
                }
                // Don't treat as alert for other logic
                return;
            }
            
            if (update.type === 'sectors_refreshed') {
                fetchAlerts();
                return;
            }

            if (update.type === 'alert' && update.data) {
              // Check preset filter matches
              const currentMatches = checkPresetMatches(update.data);
              const symbol = update.data.symbol;
              
              if (symbol) {
                // Initialize previous matches for this symbol if not exists
                if (!previousPresetMatches[symbol]) {
                  previousPresetMatches[symbol] = [];
                }
                
                const prevMatches = previousPresetMatches[symbol];
                
                // Check for new matches (presets that weren't matched before)
                currentMatches.forEach(preset => {
                  if (!prevMatches.includes(preset)) {
                    // New match detected - show toast (skip 'up' and 'down' presets)
                    if (preset !== 'up' && preset !== 'down') {
                      showPresetMatchToast(symbol, preset, update.data.price);
                    }
                  }
                });
                
                // Update previous matches
                previousPresetMatches[symbol] = currentMatches;
                
                // Check for stochastic events
                checkStochEvents(update.data);
              }
            }
          } catch (e) {
            // Not JSON or parse error, continue with normal flow
          }
          
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
        
        // Calculator slide-in panel functions
        function openCalculator(price = null) {
          document.getElementById('calculatorOverlay').classList.add('open');
          document.getElementById('calculatorPanel').classList.add('open');
          document.body.style.overflow = 'hidden';
          
          // Set stock price if provided
          if (price !== null && !isNaN(price)) {
            const sharePriceInput = document.getElementById('sharePrice');
            if (sharePriceInput) {
              sharePriceInput.value = price;
            }
          }
          
          // Initialize calculator on open
          setTimeout(() => {
            if (typeof calculate === 'function') {
              calculate();
            }
          }, 100);
        }
        
        function openCalculatorWithPrice(price) {
          openCalculator(price);
        }
        
        function closeCalculator() {
          document.getElementById('calculatorOverlay').classList.remove('open');
          document.getElementById('calculatorPanel').classList.remove('open');
          document.body.style.overflow = '';
        }
        
        // Exit Logic slide-in panel functions
        function openExitLogic() {
          document.getElementById('exitLogicOverlay').classList.add('open');
          document.getElementById('exitLogicPanel').classList.add('open');
          document.body.style.overflow = 'hidden';
        }
        
        function closeExitLogic() {
          document.getElementById('exitLogicOverlay').classList.remove('open');
          document.getElementById('exitLogicPanel').classList.remove('open');
          document.body.style.overflow = '';
        }
        
        // Switch between exit logic tabs
        function switchExitTab(tabName) {
          // Remove active class from all tabs and content
          document.querySelectorAll('.exit-logic-tab').forEach(tab => {
            tab.classList.remove('active');
          });
          document.querySelectorAll('.exit-logic-tab-content').forEach(content => {
            content.classList.remove('active');
          });
          
          // Add active class to clicked tab
          event.target.classList.add('active');
          
          // Show corresponding content
          const contentId = tabName + '-content';
          const content = document.getElementById(contentId);
          if (content) {
            content.classList.add('active');
          }
        }
        
        // Close calculator when clicking overlay
        document.addEventListener('DOMContentLoaded', function() {
          const overlay = document.getElementById('calculatorOverlay');
          if (overlay) {
            overlay.addEventListener('click', function(e) {
              if (e.target === overlay) {
                closeCalculator();
              }
            });
          }
          
          // Close exit logic when clicking overlay
          const exitLogicOverlay = document.getElementById('exitLogicOverlay');
          if (exitLogicOverlay) {
            exitLogicOverlay.addEventListener('click', function(e) {
              if (e.target === exitLogicOverlay) {
                closeExitLogic();
              }
            });
          }
          
          // Close calculator or exit logic with Escape key
          document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
              const calculatorPanel = document.getElementById('calculatorPanel');
              const exitLogicPanel = document.getElementById('exitLogicPanel');
              
              if (calculatorPanel && calculatorPanel.classList.contains('open')) {
                closeCalculator();
              } else if (exitLogicPanel && exitLogicPanel.classList.contains('open')) {
                closeExitLogic();
              }
            }
          });
          
          // Drag-to-scroll for cheatsheet table
          const cheatsheetContainer = document.getElementById('cheatsheetScrollContainer');
          if (cheatsheetContainer) {
            let isDown = false;
            let startX;
            let scrollLeft;
            
            cheatsheetContainer.addEventListener('mousedown', (e) => {
              isDown = true;
              cheatsheetContainer.style.cursor = 'grabbing';
              startX = e.pageX - cheatsheetContainer.offsetLeft;
              scrollLeft = cheatsheetContainer.scrollLeft;
            });
            
            cheatsheetContainer.addEventListener('mouseleave', () => {
              isDown = false;
              cheatsheetContainer.style.cursor = 'grab';
            });
            
            cheatsheetContainer.addEventListener('mouseup', () => {
              isDown = false;
              cheatsheetContainer.style.cursor = 'grab';
            });
            
            cheatsheetContainer.addEventListener('mousemove', (e) => {
              if (!isDown) return;
              e.preventDefault();
              const x = e.pageX - cheatsheetContainer.offsetLeft;
              const walk = (x - startX) * 2; // Scroll speed multiplier
              cheatsheetContainer.scrollLeft = scrollLeft - walk;
            });
            
            // Touch support for mobile
            let touchStartX = 0;
            let touchScrollLeft = 0;
            
            cheatsheetContainer.addEventListener('touchstart', (e) => {
              touchStartX = e.touches[0].pageX - cheatsheetContainer.offsetLeft;
              touchScrollLeft = cheatsheetContainer.scrollLeft;
            });
            
            cheatsheetContainer.addEventListener('touchmove', (e) => {
              e.preventDefault();
              const x = e.touches[0].pageX - cheatsheetContainer.offsetLeft;
              const walk = (x - touchStartX) * 2;
              cheatsheetContainer.scrollLeft = touchScrollLeft - walk;
            });
          }
        });
      </script>
      
      <!-- Calculator Slide-in Panel -->
      <div id="calculatorOverlay" class="calculator-overlay" onclick="closeCalculator()"></div>
      <div id="calculatorPanel" class="calculator-panel">
        <div class="p-6">
          <!-- Header with close button -->
          <div class="flex items-center justify-between mb-6">
            <div>
              <h1 class="scroll-m-20 text-4xl font-extrabold tracking-tight text-foreground mb-2">Share Calculator</h1>
              <p class="text-muted-foreground">Calculate position sizing based on portfolio allocation</p>
            </div>
            <button onclick="closeCalculator()" class="text-muted-foreground hover:text-foreground transition-colors p-2">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          <!-- Calculator Inputs -->
          <div class="bg-card rounded-lg shadow-lg p-4 border border-border mb-4">
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

          <!-- Allocation Results -->
          <div class="bg-card rounded-lg shadow-lg p-4 border border-border mb-4">
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

            <div class="overflow-x-auto cheatsheet-scroll-container" id="cheatsheetScrollContainer">
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
          <div class="mt-4 bg-card rounded-lg shadow p-3 border border-border mb-6">
            <div class="text-xs text-muted-foreground">
              💡 Shares are rounded to nice numbers (10, 50, 100, 500, 1000). Actual % may differ slightly.
              <br>
              📊 Cheatsheet formula: Required Shares = Target Profit (in USD) ÷ (Stock Price × Move %)
              <br>
              💱 Exchange rate: 7.8 HKD = 1 USD (HKD automatically converted for calculations)
            </div>
          </div>
        </div>
      </div>
      
      <!-- Exit Logic Slide-in Panel -->
      <div id="exitLogicOverlay" class="exit-logic-overlay" onclick="closeExitLogic()"></div>
      <div id="exitLogicPanel" class="exit-logic-panel">
        <div class="p-6">
          <!-- Header with close button -->
          <div class="flex items-center justify-between mb-6">
            <div>
              <h1 class="scroll-m-20 text-4xl font-extrabold tracking-tight text-foreground mb-2">Exit Logic Strategies</h1>
              <p class="text-muted-foreground">Trading exit strategies for different market conditions</p>
            </div>
            <button onclick="closeExitLogic()" class="text-muted-foreground hover:text-foreground transition-colors p-2">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          <!-- Tabs -->
          <div class="exit-logic-tabs">
            <button class="exit-logic-tab active" onclick="switchExitTab('counter-trend')">Counter Trend</button>
            <button class="exit-logic-tab" onclick="switchExitTab('pullback')">Pull Back</button>
            <button class="exit-logic-tab" onclick="switchExitTab('general')">General Tips</button>
          </div>

          <!-- Tab Content -->
          <div class="exit-logic-content">
            <!-- Counter Trend Tab -->
            <div id="counter-trend-content" class="exit-logic-tab-content active">
              <!-- Counter Trend Long -->
              <div class="exit-strategy-container">
                <div class="strategy-title">
                  <span class="text-green-400">📈</span>
                  Counter Trend Long
                </div>
                <div class="strategy-description">
                  Long position against the prevailing downtrend, betting on a reversal or bounce.
                </div>
                <div class="exit-rules long">
                  <h4>Exit when:</h4>
                  <ol>
                    <li>Drop below previous candle low</li>
                    <li>Stoch below 50 and down trend</li>
                    <li>Volume decreases significantly</li>
                  </ol>
                </div>
              </div>

              <!-- Counter Trend Short -->
              <div class="exit-strategy-container">
                <div class="strategy-title">
                  <span class="text-red-400">📉</span>
                  Counter Trend Short
                </div>
                <div class="strategy-description">
                  Short position against the prevailing uptrend, betting on a reversal or pullback.
                </div>
                <div class="exit-rules short">
                  <h4>Exit when:</h4>
                  <ol>
                    <li>Break above previous candle high</li>
                    <li>Stoch above 50 and up trend</li>
                    <li>Strong buying volume emerges</li>
                  </ol>
                </div>
              </div>
            </div>

            <!-- Pull Back Tab -->
            <div id="pullback-content" class="exit-logic-tab-content">
              <!-- Pull Back Long -->
              <div class="exit-strategy-container">
                <div class="strategy-title">
                  <span class="text-green-400">🔄</span>
                  Pull Back Long
                </div>
                <div class="strategy-description">
                  Long position during a temporary pullback in an overall uptrend.
                </div>
                <div class="exit-rules long">
                  <h4>Exit when:</h4>
                  <ol>
                    <li>Break below pullback support level</li>
                    <li>Stoch crosses below 30 with momentum</li>
                    <li>Trend changes from up to down</li>
                    <li>Volume spike on breakdown</li>
                  </ol>
                </div>
              </div>

              <!-- Pull Back Short -->
              <div class="exit-strategy-container">
                <div class="strategy-title">
                  <span class="text-red-400">🔄</span>
                  Pull Back Short
                </div>
                <div class="strategy-description">
                  Short position during a temporary pullback in an overall downtrend.
                </div>
                <div class="exit-rules short">
                  <h4>Exit when:</h4>
                  <ol>
                    <li>Break above pullback resistance level</li>
                    <li>Stoch crosses above 70 with momentum</li>
                    <li>Trend changes from down to up</li>
                    <li>Volume spike on breakout</li>
                  </ol>
                </div>
              </div>
            </div>

            <!-- General Tips Tab -->
            <div id="general-content" class="exit-logic-tab-content">
              <div class="exit-strategy-container">
                <div class="strategy-title">
                  <span class="text-blue-400">💡</span>
                  General Exit Tips
                </div>
                <div class="strategy-description">
                  Universal principles that apply across all strategies.
                </div>
                <div class="exit-rules" style="border-left-color: #3b82f6;">
                  <h4>Always consider:</h4>
                  <ol>
                    <li>Risk-reward ratio (minimum 1:2)</li>
                    <li>Time-based exits (avoid holding too long)</li>
                    <li>Market session changes (London/NY close)</li>
                    <li>News events and earnings</li>
                    <li>Overall market sentiment</li>
                  </ol>
                </div>
              </div>

              <div class="exit-strategy-container">
                <div class="strategy-title">
                  <span class="text-yellow-400">⚠️</span>
                  Risk Management
                </div>
                <div class="strategy-description">
                  Essential risk management principles for all trades.
                </div>
                <div class="exit-rules" style="border-left-color: #eab308;">
                  <h4>Risk rules:</h4>
                  <ol>
                    <li>Never risk more than 1-2% per trade</li>
                    <li>Set stop loss before entering position</li>
                    <li>Scale out profits at key levels</li>
                    <li>Avoid revenge trading after losses</li>
                    <li>Keep detailed trading journal</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <script>
        // Calculator functions (same as original calculator page)
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
      </script>
    </body>
    </html>
  `)
})

// Initialize database and load data on startup
console.log('🔄 Initializing database...')
if (initDatabase()) {
  console.log('🔄 Loading persisted data...')
  loadDataFromDatabase()
} else {
  console.log('⚠️  Database initialization failed, starting with empty data')
}

// Set up periodic auto-save
let autoSaveInterval = setInterval(() => {
  saveDataToDatabase()
}, AUTO_SAVE_INTERVAL)
console.log(`⏰ Auto-save enabled (every ${AUTO_SAVE_INTERVAL / 1000 / 60} minutes)`)

// Graceful shutdown handler
function gracefulShutdown(signal) {
  console.log(`\n${signal} received, saving data before shutdown...`)
  clearInterval(autoSaveInterval)
  saveDataToDatabase()
  if (db) {
    db.close()
    console.log('✅ Database closed')
  }
  console.log('✅ Data saved, shutting down gracefully')
  process.exit(0)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error)
  saveDataToDatabase()
  if (db) db.close()
  process.exit(1)
})

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled rejection at:', promise, 'reason:', reason)
  saveDataToDatabase()
})

app.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`)
  console.log(`💾 Database: ${DB_FILE}`)
})