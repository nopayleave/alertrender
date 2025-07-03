import express from 'express'
import cors from 'cors'

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

let alerts = []

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

// Dummy data for dev
if (process.env.NODE_ENV !== 'production') {
  const currentlyPremarket = isCurrentlyPremarket()
  const currentlyPast10AM = isCurrentlyPast10AM()
  alerts = [
    {
      symbol: "AAPL", timeframe: "30S", time: Date.now().toString(), price: 189.45,
      priceChange: 2.34, volume: 45678901, openSignal: 15.25, openTrendSignal: 75.80,
      s30sSignal: 125.45, s1mSignal: -75.20, s5mSignal: 275.60, sk2mDiff: 3.4,
      // These 3 field will be replaced dynamically in /alerts API!
      isPremarket: currentlyPremarket, isMarketHours: !currentlyPremarket, isPast10AM: currentlyPast10AM
    },
    {
      symbol: "TSLA", timeframe: "30S", time: Date.now().toString(), price: 238.77,
      priceChange: -1.89, volume: 32145678, openSignal: -25.45, openTrendSignal: -85.30,
      s30sSignal: -125.80, s1mSignal: 45.60, s5mSignal: -275.90, sk2mDiff: -2.8,
      isPremarket: currentlyPremarket, isMarketHours: !currentlyPremarket, isPast10AM: currentlyPast10AM
    }
  ]
}

// -------- Helper Functions (Format/Color) --------
function formatVolume(volume) {
  if (!volume || volume === 'N/A') return 'N/A'
  const num = parseFloat(volume)
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(0) + 'K'
  return Math.round(num).toString()
}
function formatOpenValue(value, isPremarket) {
  if (isPremarket) return 'Not Yet'
  if (value === undefined || value === null || value === '' || value === 'N/A') return 'N/A'
  const val = parseFloat(value)
  if (isNaN(val)) return 'N/A'
  return val > 0 ? 'Up' : 'Down'
}
function formatOpenTrendValue(value, isPast10AM) {
  if (!isPast10AM) return 'Not Yet'
  if (value === undefined || value === null || value === '' || value === 'N/A') return 'N/A'
  const val = parseFloat(value)
  if (isNaN(val)) return 'N/A'
  return val > 0 ? 'Up' : 'Down'
}
function formatTrend(sk2mDiff) {
  if (sk2mDiff === undefined || sk2mDiff === null || sk2mDiff === '' || sk2mDiff === 'N/A') return 'N/A'
  const val = parseFloat(sk2mDiff)
  if (isNaN(val)) return 'N/A'
  return val > 0 ? 'Up' : 'Down'
}
function getSignalBgColor(value) {
  if (value === undefined || value === null || value === '' || value === 'N/A') return 'bg-white text-black'
  const val = parseFloat(value)
  if (isNaN(val)) return 'bg-white text-black'
  if (val >= 250) return 'bg-green-600 text-white'
  if (val >= 50) return 'bg-green-300 text-black'
  if (val >= -50) return 'bg-white text-black'
  if (val >= -250) return 'bg-red-300 text-black'
  return 'bg-red-600 text-white'
}

// --------- HTML (front-end, unchanged) ---------
function getMainHTML() {
  // same as your version, keep unchanged for space, see next message for full HTML if you want
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <title>Trading Dashboard</title>
  <style>
    .table-container { max-width: 100%; overflow-x: auto; }
    table { min-width: 1200px; }
  </style>
</head>
<body class="bg-gray-900 text-gray-100">
<div class="container mx-auto p-6">
  <div class="text-center mb-6">
    <h1 class="text-3xl font-bold mb-2">Trading Dashboard</h1>
    <p id="lastUpdate" class="text-sm text-gray-400">Last updated: Never</p>
    <p id="marketStatus" class="text-xs text-gray-500 mt-1">Market Status: Loading...</p>
  </div>
  <div class="bg-gray-800 rounded-lg shadow-lg overflow-hidden">
    <div class="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4">
      <h2 class="text-xl font-semibold text-white">Live Trading Data</h2>
    </div>
    <div class="table-container">
      <table class="w-full">
        <thead class="bg-gray-700">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Ticker</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Price</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Chg%</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Vol</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Open</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Open Trend</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">S30s</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">S1m</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">S5m</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Trend</th>
            <th class="px-6 py-3 text-center text-xs font-medium text-gray-300 uppercase tracking-wider">Action</th>
          </tr>
        </thead>
        <tbody id="alertsTable" class="bg-gray-800 divide-y divide-gray-700"></tbody>
      </table>
      <div id="noAlerts" class="text-center py-12 text-gray-500 hidden">
        <span class="text-4xl mb-4 block">📊</span>
        <p class="text-lg">No trading data available</p>
      </div>
    </div>
  </div>
</div>
<script>
// ... your previous JS for fetching and displaying table ...
// 直接用返原本 fetchAlerts、formatOpenValue、formatOpenTrendValue...
// 佢會自動跟返你後端嘅 isPremarket/isPast10AM 判斷顯示「Not Yet」
</script>
</body>
</html>`
}

// --------- Express routes ---------
app.get('/', (req, res) => {
  res.send(getMainHTML())
})

// TradingView webhook 入資料
app.post('/webhook', (req, res) => {
  const rawAlert = req.body
  if (!rawAlert.symbol || rawAlert.symbol.trim() === '') return res.status(400).json({ error: 'Symbol is required' })
  const alert = {
    symbol: rawAlert.symbol,
    timeframe: rawAlert.timeframe || "30S",
    time: rawAlert.time || Date.now().toString(),
    price: parseFloat(rawAlert.price) || 0,
    priceChange: parseFloat(rawAlert.priceChange) || 0,
    volume: rawAlert.volume || 0,
    openSignal: parseFloat(rawAlert.openSignal) || 0,
    openTrendSignal: parseFloat(rawAlert.openTrendSignal) || 0,
    s30sSignal: parseFloat(rawAlert.s30sSignal) || 0,
    s1mSignal: parseFloat(rawAlert.s1mSignal) || 0,
    s5mSignal: parseFloat(rawAlert.s5mSignal) || 0,
    sk2mDiff: parseFloat(rawAlert.sk2mDiff) || 0
    // isPremarket, isPast10AM 等下喺 /alerts API 計
  }
  const existingIndex = alerts.findIndex(existing => existing.symbol === alert.symbol && existing.timeframe === alert.timeframe)
  if (existingIndex !== -1) {
    alerts[existingIndex] = { ...alert, time: Date.now().toString() }
  } else {
    alert.time = Date.now().toString()
    alerts.unshift(alert)
  }
  if (alerts.length > 100) alerts.pop()
  res.sendStatus(200)
})

// 核心：API 每次動態根據現時時間返 isPremarket/isPast10AM
app.get('/alerts', (req, res) => {
  const premarket = isCurrentlyPremarket()
  const past10am = isCurrentlyPast10AM()
  const validAlerts = alerts
    .filter(alert => alert.symbol && alert.symbol.trim() !== '')
    .map(alert => ({
      ...alert,
      isPremarket: premarket,
      isPast10AM: past10am
    }))
  res.json(validAlerts)
})

// delete, clear 等 route 你原本已寫好，唔洗改
app.post('/delete-alert', (req, res) => {
  const { symbol, timeframe } = req.body
  if (!symbol) return res.status(400).json({ error: 'Symbol is required' })
  const initialCount = alerts.length
  alerts = alerts.filter(alert => timeframe ? !(alert.symbol === symbol && alert.timeframe === timeframe) : alert.symbol !== symbol)
  const deletedCount = initialCount - alerts.length
  if (deletedCount > 0) res.json({ message: `Deleted ${deletedCount} alert(s) for ${symbol}`, deletedCount })
  else res.status(404).json({ error: 'Alert not found' })
})
app.delete('/alerts', (req, res) => {
  const clearedCount = alerts.length
  alerts.length = 0
  res.json({ message: `Cleared ${clearedCount} alerts`, count: clearedCount })
})
app.get('/clear-alerts', (req, res) => {
  const clearedCount = alerts.length
  alerts.length = 0
  res.json({ message: `Cleared ${clearedCount} alerts`, previousCount: clearedCount, currentCount: 0 })
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})

