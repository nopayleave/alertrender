import express from 'express'
import cors from 'cors'

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// 方案一：object of arrays，每隻股票+timeframe一組歷史
let alerts = {} // { 'AAPL_30S': [ {}, {}, ... ], 'TSLA_30S': [ {}, ... ] }

// Helper（可以複用你舊 code）
function parseOrNull(value) {
  if (value === undefined || value === null || value === 'na' || value === 'NA' || value === 'NaN') return null
  const num = parseFloat(value)
  return isNaN(num) ? null : num
}

// API: TradingView webhook
app.post('/webhook', (req, res) => {
  const rawAlert = req.body
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
  // 只出最新一條
  const latestAlerts = Object.values(alerts)
    .map(arr => arr[arr.length - 1])
    .filter(Boolean)
  res.json(latestAlerts)
})

// API: 全部歷史 alerts（trace back 用）
app.get('/alerts/history', (req, res) => {
  // 返 object，前端可以 filter
  res.json(alerts)
})

// API: 指定symbol、timeframe歷史（可選）
app.get('/alerts/history/:symbol/:timeframe', (req, res) => {
  const key = `${req.params.symbol}_${req.params.timeframe}`
  if (!alerts[key]) return res.status(404).json({ error: 'No history found' })
  res.json(alerts[key])
})

// 其他：刪除單條、清空（同你舊code相同，可用唔用）
app.post('/delete-alert', (req, res) => {
  const { symbol, timeframe } = req.body
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' })
  const key = `${symbol}_${timeframe || '30S'}`
  const before = alerts[key]?.length || 0
  alerts[key] = []
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

// 頁面/前端HTML（你可以用返現有code不變，只要fetch /alerts或者 /alerts/history）
app.get('/', (req, res) => {
  res.send(`<html><body><h1>API Ready</h1><p>/alerts 最新 | /alerts/history 全部</p></body></html>`)
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
