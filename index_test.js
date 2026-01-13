import express from 'express'
import cors from 'cors'
import nodemailer from 'nodemailer'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import yahooFinance from 'yahoo-finance2'
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
let orbDataStorage = {} // Store ORB data by symbol with timestamp: { symbol: { orbType, orbStatus, orbHigh, orbLow, orbMid, timestamp } }
let soloStochDataStorage = {} // Store Solo Stoch D2 data by symbol with timestamp
let dualStochDataStorage = {} // Store Dual Stoch D1/D2 data by symbol with timestamp
let dualStochHistory = {} // Store historical D1/D2 values for mini charts: { symbol: [{ d1, d2, timestamp }, ...] }
let bigTrendDay = {} // Store Big Trend Day status per symbol per trading day: { symbol: { date: 'YYYY-MM-DD', isBigTrendDay: true } }
let starredSymbols = {} // Store starred symbols (synced from frontend)
let previousTrends = {} // Store previous trend for each symbol to detect changes
let patternData = {} // Store latest HL/LH pattern per symbol
let sectorData = {} // Store sector information by symbol
let sectorCache = {} // Cache for Yahoo Finance sector data with timestamps
const SECTOR_CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours in milliseconds

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
        orbDataStorage,
        soloStochDataStorage,
        dualStochDataStorage,
        dualStochHistory,
        bigTrendDay,
        starredSymbols,
        previousTrends,
        patternData,
        sectorData,
        sectorCache
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
          case 'orbDataStorage': orbDataStorage = value; break
          case 'soloStochDataStorage': soloStochDataStorage = value; break
          case 'dualStochDataStorage': dualStochDataStorage = value; break
          case 'dualStochHistory': dualStochHistory = value; break
          case 'bigTrendDay': bigTrendDay = value; break
          case 'starredSymbols': starredSymbols = value; break
          case 'previousTrends': previousTrends = value; break
          case 'patternData': patternData = value; break
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

// Yahoo Finance sector data fetching
async function fetchSectorFromYahoo(symbol) {
  try {
    // Check cache first
    const cached = sectorCache[symbol]
    if (cached && (Date.now() - cached.timestamp) < SECTOR_CACHE_DURATION) {
      console.log(`📊 Using cached sector for ${symbol}: ${cached.sector}`)
      return cached.sector
    }
    
    console.log(`🔍 Fetching sector data for ${symbol} from Yahoo Finance...`)
    
    // Fetch quote summary from Yahoo Finance
    const quote = await yahooFinance.quoteSummary(symbol, {
      modules: ['summaryProfile', 'assetProfile']
    })
    
    let sector = null
    
    // Try to get sector from summaryProfile first
    if (quote.summaryProfile && quote.summaryProfile.sector) {
      sector = quote.summaryProfile.sector
    }
    // Fallback to assetProfile
    else if (quote.assetProfile && quote.assetProfile.sector) {
      sector = quote.assetProfile.sector
    }
    
    if (sector) {
      // Cache the result
      sectorCache[symbol] = {
        sector: sector,
        timestamp: Date.now()
      }
      
      // Also store in sectorData for immediate use
      sectorData[symbol] = sector
      
      console.log(`✅ Found sector for ${symbol}: ${sector}`)
      return sector
    } else {
      console.log(`⚠️ No sector found for ${symbol}`)
      return null
    }
    
  } catch (error) {
    console.error(`❌ Error fetching sector for ${symbol}:`, error.message)
    return null
  }
}

// Batch fetch sectors for multiple symbols
async function batchFetchSectors(symbols) {
  const promises = symbols.map(symbol => fetchSectorFromYahoo(symbol))
  const results = await Promise.allSettled(promises)
  
  results.forEach((result, index) => {
    const symbol = symbols[index]
    if (result.status === 'fulfilled' && result.value) {
      sectorData[symbol] = result.value
    }
  })
}

// Get sector for a symbol (with caching)
function getSectorForSymbol(symbol) {
  // Check if we already have it in sectorData
  if (sectorData[symbol]) {
    return sectorData[symbol]
  }
  
  // Check cache
  const cached = sectorCache[symbol]
  if (cached && (Date.now() - cached.timestamp) < SECTOR_CACHE_DURATION) {
    sectorData[symbol] = cached.sector
    return cached.sector
  }
  
  // If not cached or expired, fetch asynchronously (don't block)
  fetchSectorFromYahoo(symbol).then(sector => {
    if (sector) {
      // Broadcast update to frontend when sector is fetched
      broadcastUpdate('sector_updated', {
        symbol: symbol,
        sector: sector,
        timestamp: Date.now()
      })
    }
  }).catch(error => {
    console.error(`Error fetching sector for ${symbol}:`, error)
  })
  
  return null
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
  const isOrbAlert = alert.orbType !== undefined && alert.orbStatus !== undefined
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
    isCciAlert,
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
  } else if (isOrbAlert) {
    // ORB alert - store ORB data with timestamp
    const orbData = {
      orbType: alert.orbType, // "london" or "ny"
      orbStatus: alert.orbStatus, // "within_upper", "within_lower", "outside_above", "outside_below"
      priceDirection: alert.priceDirection || null, // "up", "down", or "flat"
      orbCrossover: alert.orbCrossover || null, // "cross_high", "cross_low", or "none"
      orbHigh: alert.orbHigh,
      orbLow: alert.orbLow,
      orbMid: alert.orbMid,
      sector: alert.sector || null, // sector information from webhook
      timestamp: Date.now()
    }
    
    // Store in a data storage object (similar to cciDataStorage pattern)
    if (!orbDataStorage) orbDataStorage = {}
    // Store both London and NY ORB data separately
    const storageKey = `${alert.symbol}_${alert.orbType}`
    orbDataStorage[storageKey] = orbData
    
    console.log(`✅ ORB data stored for ${alert.symbol} (${alert.orbType}): Status=${alert.orbStatus}, High=${alert.orbHigh}, Low=${alert.orbLow}, Mid=${alert.orbMid}`)
    
    // Update existing alert if it exists, or create new one if it doesn't
    const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
    if (existingIndex !== -1) {
      // Store both London and NY ORB data
      if (alert.orbType === 'london') {
        alerts[existingIndex].londonOrbStatus = orbData.orbStatus
        alerts[existingIndex].londonPriceDirection = orbData.priceDirection || null
        alerts[existingIndex].londonOrbCrossover = orbData.orbCrossover || null
        alerts[existingIndex].londonOrbHigh = orbData.orbHigh
        alerts[existingIndex].londonOrbLow = orbData.orbLow
        alerts[existingIndex].londonOrbMid = orbData.orbMid
      } else if (alert.orbType === 'ny') {
        alerts[existingIndex].nyOrbStatus = orbData.orbStatus
        alerts[existingIndex].nyPriceDirection = orbData.priceDirection || null
        alerts[existingIndex].nyOrbCrossover = orbData.orbCrossover || null
        alerts[existingIndex].nyOrbHigh = orbData.orbHigh
        alerts[existingIndex].nyOrbLow = orbData.orbLow
        alerts[existingIndex].nyOrbMid = orbData.orbMid
      }
      // Store sector information if available, or fetch from Yahoo Finance
      if (alert.sector) {
        alerts[existingIndex].sector = alert.sector
        sectorData[alert.symbol] = alert.sector
      } else {
        // Try to get sector from Yahoo Finance
        const existingSector = getSectorForSymbol(alert.symbol)
        if (existingSector) {
          alerts[existingIndex].sector = existingSector
        }
      }
      alerts[existingIndex].receivedAt = Date.now()
      console.log(`✅ Updated existing alert for ${alert.symbol} with ORB data (${alert.orbType})`)
    } else {
      // Create new alert entry if it doesn't exist
      const newAlert = {
        symbol: alert.symbol,
        timeframe: alert.timeframe || null,
        price: alert.price || null,
        receivedAt: Date.now()
      }
      // Add ORB data based on type
      if (alert.orbType === 'london') {
        newAlert.londonOrbStatus = orbData.orbStatus
        newAlert.londonPriceDirection = orbData.priceDirection || null
        newAlert.londonOrbCrossover = orbData.orbCrossover || null
        newAlert.londonOrbHigh = orbData.orbHigh
        newAlert.londonOrbLow = orbData.orbLow
        newAlert.londonOrbMid = orbData.orbMid
      } else if (alert.orbType === 'ny') {
        newAlert.nyOrbStatus = orbData.orbStatus
        newAlert.nyPriceDirection = orbData.priceDirection || null
        newAlert.nyOrbCrossover = orbData.orbCrossover || null
        newAlert.nyOrbHigh = orbData.orbHigh
        newAlert.nyOrbLow = orbData.orbLow
        newAlert.nyOrbMid = orbData.orbMid
      }
      // Store sector information if available, or fetch from Yahoo Finance
      if (alert.sector) {
        newAlert.sector = alert.sector
        sectorData[alert.symbol] = alert.sector
      } else {
        // Try to get sector from Yahoo Finance
        const existingSector = getSectorForSymbol(alert.symbol)
        if (existingSector) {
          newAlert.sector = existingSector
        }
      }
      alerts.unshift(newAlert)
      console.log(`✅ Created new alert entry for ${alert.symbol} with ORB data (${alert.orbType})`)
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
    
    // Merge ORB data from storage (both London and NY)
    const londonOrbInfo = orbDataStorage[`${alert.symbol}_london`]
    if (londonOrbInfo) {
      const ageInMinutes = (Date.now() - londonOrbInfo.timestamp) / 60000
      if (ageInMinutes <= 240) { // ORB data valid for 4 hours
        alertData.londonOrbStatus = londonOrbInfo.orbStatus
        alertData.londonPriceDirection = londonOrbInfo.priceDirection || null
        alertData.londonOrbCrossover = londonOrbInfo.orbCrossover || null
        alertData.londonOrbHigh = londonOrbInfo.orbHigh
        alertData.londonOrbLow = londonOrbInfo.orbLow
        alertData.londonOrbMid = londonOrbInfo.orbMid
        console.log(`✅ Merged London ORB data for ${alert.symbol}: Status=${londonOrbInfo.orbStatus}, High=${londonOrbInfo.orbHigh}, Low=${londonOrbInfo.orbLow} (age: ${ageInMinutes.toFixed(1)} min)`)
      } else {
        delete orbDataStorage[`${alert.symbol}_london`]
        console.log(`⏰ London ORB data expired for ${alert.symbol} (age: ${ageInMinutes.toFixed(1)} min)`)
      }
    }
    
    const nyOrbInfo = orbDataStorage[`${alert.symbol}_ny`]
    if (nyOrbInfo) {
      const ageInMinutes = (Date.now() - nyOrbInfo.timestamp) / 60000
      if (ageInMinutes <= 240) { // ORB data valid for 4 hours
        alertData.nyOrbStatus = nyOrbInfo.orbStatus
        alertData.nyPriceDirection = nyOrbInfo.priceDirection || null
        alertData.nyOrbCrossover = nyOrbInfo.orbCrossover || null
        alertData.nyOrbHigh = nyOrbInfo.orbHigh
        alertData.nyOrbLow = nyOrbInfo.orbLow
        alertData.nyOrbMid = nyOrbInfo.orbMid
        console.log(`✅ Merged NY ORB data for ${alert.symbol}: Status=${nyOrbInfo.orbStatus}, High=${nyOrbInfo.orbHigh}, Low=${nyOrbInfo.orbLow} (age: ${ageInMinutes.toFixed(1)} min)`)
      } else {
        delete orbDataStorage[`${alert.symbol}_ny`]
        console.log(`⏰ NY ORB data expired for ${alert.symbol} (age: ${ageInMinutes.toFixed(1)} min)`)
      }
    }
    
    // If no stored ORB data, check if this alert has ORB data
    if (alert.orbType !== undefined && alert.orbStatus !== undefined) {
      if (alert.orbType === 'london') {
        alertData.londonOrbStatus = alert.orbStatus
        alertData.londonPriceDirection = alert.priceDirection || null
        alertData.londonOrbHigh = alert.orbHigh
        alertData.londonOrbLow = alert.orbLow
        alertData.londonOrbMid = alert.orbMid
        console.log(`✅ Using London ORB data from alert for ${alert.symbol}: Status=${alert.orbStatus}`)
      } else if (alert.orbType === 'ny') {
        alertData.nyOrbStatus = alert.orbStatus
        alertData.nyPriceDirection = alert.priceDirection || null
        alertData.nyOrbHigh = alert.orbHigh
        alertData.nyOrbLow = alert.orbLow
        alertData.nyOrbMid = alert.orbMid
        console.log(`✅ Using NY ORB data from alert for ${alert.symbol}: Status=${alert.orbStatus}`)
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
    
    // Store sector information if available, or fetch from Yahoo Finance
    if (alert.sector) {
      alertData.sector = alert.sector
      sectorData[alert.symbol] = alert.sector
    } else {
      // Try to get sector from Yahoo Finance
      const existingSector = getSectorForSymbol(alert.symbol)
      if (existingSector) {
        alertData.sector = existingSector
      }
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
               isOrbAlert ? 'orb' :
               isSoloStochAlert ? 'solo_stoch' : 
               isDualStochAlert ? 'dual_stoch' : 'main_script',
    timestamp: Date.now()
  })
  
  res.json({ status: 'ok' })
})

// API to refresh sector data for all symbols
app.post('/refresh-sectors', async (req, res) => {
  try {
    console.log('🔄 Refreshing sector data for all symbols...')
    
    // Get all unique symbols from current alerts
    const symbols = [...new Set(alerts.map(alert => alert.symbol).filter(Boolean))]
    
    if (symbols.length === 0) {
      return res.json({ status: 'ok', message: 'No symbols to refresh', count: 0 })
    }
    
    console.log(`📊 Refreshing sectors for ${symbols.length} symbols: ${symbols.join(', ')}`)
    
    // Batch fetch sectors (limit to 10 at a time to avoid rate limiting)
    const batchSize = 10
    let refreshed = 0
    
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize)
      await batchFetchSectors(batch)
      refreshed += batch.length
      
      // Small delay between batches to be respectful to Yahoo Finance API
      if (i + batchSize < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    
    console.log(`✅ Sector refresh complete. Updated ${refreshed} symbols.`)
    
    // Broadcast update to frontend
    broadcastUpdate('sectors_refreshed', {
      count: refreshed,
      symbols: symbols,
      timestamp: Date.now()
    })
    
    res.json({ 
      status: 'ok', 
      message: `Refreshed sectors for ${refreshed} symbols`,
      count: refreshed,
      symbols: symbols
    })
    
  } catch (error) {
    console.error('❌ Error refreshing sectors:', error)
    res.status(500).json({ status: 'error', message: error.message })
  }
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
  cciDataStorage = {}
  orbDataStorage = {}
  soloStochDataStorage = {}
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

// Render default homepage (可改)
app.get('/', (req, res) => {
  res.send("<h1>Temporarily disabled</h1>");
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

// Periodic sector data refresh (every 6 hours)
setInterval(async () => {
  try {
    console.log('🕐 Periodic sector data refresh starting...')
    
    // Get symbols that need refresh (older than 12 hours or missing sector)
    const symbols = [...new Set(alerts.map(alert => alert.symbol).filter(Boolean))]
    const symbolsToRefresh = symbols.filter(symbol => {
      const cached = sectorCache[symbol]
      return !cached || (Date.now() - cached.timestamp) > (12 * 60 * 60 * 1000) // 12 hours
    })
    
    if (symbolsToRefresh.length > 0) {
      console.log(`📊 Refreshing sectors for ${symbolsToRefresh.length} symbols: ${symbolsToRefresh.join(', ')}`)
      await batchFetchSectors(symbolsToRefresh)
      console.log('✅ Periodic sector refresh complete')
    } else {
      console.log('✅ All sectors are up to date')
    }
  } catch (error) {
    console.error('❌ Error in periodic sector refresh:', error)
  }
}, 6 * 60 * 60 * 1000) // Every 6 hours

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