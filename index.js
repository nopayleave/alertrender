import express from 'express'
import cors from 'cors'

const app = express()
const port = process.env.PORT || 3000

// Middleware for webhook JSON parsing
app.use(express.text({ type: 'text/plain' }))
app.use(express.json())
app.use(cors())

// 方案一：object of arrays，每隻股票+timeframe一組歷史
let alerts = {} // { 'AAPL_30S': [ {}, {}, ... ], 'TSLA_30S': [ {}, ... ] }

function isCurrentlyPremarket() {
  const now = new Date()
  const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }))
  const hour = etTime.getHours()
  const minute = etTime.getMinutes()
  const dayOfWeek = etTime.getDay()
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5
  if (!isWeekday) return false
  const afterPreStart = hour >= 4
  const beforeMarketOpen = hour < 9 || (hour === 9 && minute < 30)
  return afterPreStart && beforeMarketOpen
}

function isCurrentlyPast10AM() {
  const now = new Date()
  const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }))
  const hour = etTime.getHours()
  const dayOfWeek = etTime.getDay()
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5
  if (!isWeekday) return false
  return hour >= 10
}

// Helper（可以複用你舊 code）
function parseOrNull(value) {
  if (value === undefined || value === null || value === 'na' || value === 'NA' || value === 'NaN') return null
  const num = parseFloat(value)
  return isNaN(num) ? null : num
}

// Dummy data for dev
if (process.env.NODE_ENV !== 'production') {
  const currentlyPremarket = isCurrentlyPremarket()
  const currentlyPast10AM = isCurrentlyPast10AM()
  
  alerts['AAPL_30S'] = [
    {
      symbol: "AAPL", timeframe: "30S", time: Date.now().toString(),
      humanTime: "2024-07-04 09:30:00 ET",
      price: 189.45, priceChange: 1.24, volume: 45678901, 
      signal930: 12.50, signal932: 27.75, signal1000: 103.55,
      openSignal: 15.25, openTrendSignal: 75.80,
      s30sSignal: 125.45, s1mSignal: -75.20, s5mSignal: 275.60, sk2mDiff: 3.4,
      isPremarket: currentlyPremarket, isMarketHours: !currentlyPremarket, isPast10AM: currentlyPast10AM
    }
  ]
  
  alerts['TSLA_30S'] = [
    {
      symbol: "TSLA", timeframe: "30S", time: Date.now().toString(),
      humanTime: "2024-07-04 09:30:00 ET",
      price: 238.77, priceChange: -2.15, volume: 32145678,
      signal930: -15.20, signal932: -40.65, signal1000: -125.95,
      openSignal: -25.45, openTrendSignal: -85.30,
      s30sSignal: -125.80, s1mSignal: 45.60, s5mSignal: -275.90, sk2mDiff: -2.8,
      isPremarket: currentlyPremarket, isMarketHours: !currentlyPremarket, isPast10AM: currentlyPast10AM
    }
  ]
}

// --------- HTML (front-end) ---------
function getMainHTML() {
  // ...（原本 HTML 前端 code 不變，請直接 copy 返你自己貼嗰段 getMainHTML function）...
  // 你可以直接用返你上面一大段 getMainHTML
  // 如果要我補貼一次都得
  // 下面略過，專注 backend
  return `<!DOCTYPE html> ...完整HTML省略... </html>`
}

// --------- Express routes ---------
app.get('/', (req, res) => {
  res.send(getMainHTML())
})

// API: TradingView webhook - 支援 text/plain + JSON
app.post('/webhook', (req, res) => {
  let rawAlert = req.body
  // 如果 req.body 係 string（即 text/plain），就 JSON.parse
  if (typeof rawAlert === 'string') {
    try {
      rawAlert = JSON.parse(rawAlert)
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' })
    }
  }

  const symbol = rawAlert.symbol
  const timeframe = rawAlert.timeframe || '30S'
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' })

  const key = `${symbol}_${timeframe}`
  if (!alerts[key]) alerts[key] = []

  // parse signals
  const signal930 = parseOrNull(rawAlert.signal930)
  const signal932 = parseOrNull(rawAlert.signal932)
  const signal1000 = parseOrNull(rawAlert.signal1000)
  const openSignal = (signal932 !== null && signal930 !== null) ? signal932 - signal930 : null
  const openTrendSignal = (signal1000 !== null && signal932 !== null) ? signal1000 - signal932 : null

  const alert = {
    symbol,
    timeframe,
    time: rawAlert.time || Date.now().toString(),
    humanTime: rawAlert.humanTime || '',
    price: parseFloat(rawAlert.price) || 0,
    priceChange: parseFloat(rawAlert.priceChange) || 0,
    volume: rawAlert.volume || 0,
    signal930,
    signal932,
    signal1000,
    openSignal,
    openTrendSignal,
    s30sSignal: parseOrNull(rawAlert.s30sSignal),
    s1mSignal: parseOrNull(rawAlert.s1mSignal),
    s5mSignal: parseOrNull(rawAlert.s5mSignal),
    sk2mDiff: parseOrNull(rawAlert.sk2mDiff)
  }
  
  alerts[key].push(alert)

  // 限定每組最多保存3000條（按需調整）
  if (alerts[key].length > 3000) alerts[key].shift()
  res.sendStatus(200)
})

// API: 最新 alerts（每隻股票 timeframe 各1條，顯示用）
app.get('/alerts', (req, res) => {
  const premarket = isCurrentlyPremarket()
  const past10am = isCurrentlyPast10AM()
  
  // 只出最新一條
  const latestAlerts = Object.values(alerts)
    .map(arr => arr[arr.length - 1])
    .filter(Boolean)
    .filter(alert => alert.symbol && alert.symbol.trim() !== '')
    .map(alert => ({
      ...alert,
      isPremarket: premarket,
      isPast10AM: past10am
    }))
  
  res.json(latestAlerts)
})

// API: 全部歷史 alerts（trace back 用）
app.get('/alerts/history', (req, res) => {
  res.json(alerts)
})

// API: 指定symbol、timeframe歷史（可選）
app.get('/alerts/history/:symbol/:timeframe', (req, res) => {
  const key = `${req.params.symbol}_${req.params.timeframe}`
  if (!alerts[key]) return res.status(404).json({ error: 'No history found' })
  res.json(alerts[key])
})

// 其他：刪除單條、清空
app.post('/delete-alert', (req, res) => {
  const { symbol, timeframe } = req.body
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' })
  const key = `${symbol}_${timeframe || '30S'}`
  const before = alerts[key]?.length || 0
  if (alerts[key]) {
    alerts[key] = []
  }
  res.json({ message: `Deleted ${before} alerts for ${key}` })
})

app.delete('/alerts', (req, res) => {
  const count = Object.values(alerts).reduce((a, b) => a + b.length, 0)
  alerts = {}
  res.json({ message: `Cleared ${count} alerts`, count })
})

app.get('/clear-alerts', (req, res) => {
  const count = Object.values(alerts).reduce((a, b) => a + b.length, 0)
  alerts = {}
  res.json({ message: `Cleared ${count} alerts`, previousCount: count, currentCount: 0 })
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
