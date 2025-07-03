import express from 'express'
import cors from 'cors'

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

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
  
  // Initialize with some test data
  alerts['AAPL_30S'] = [
    {
      symbol: "AAPL", timeframe: "30S", time: Date.now().toString(), price: 189.45,
      priceChange: 1.24, volume: 45678901, 
      signal930: 12.50, signal932: 27.75, signal1000: 103.55,
      openSignal: 15.25, openTrendSignal: 75.80,
      s30sSignal: 125.45, s1mSignal: -75.20, s5mSignal: 275.60, sk2mDiff: 3.4,
      isPremarket: currentlyPremarket, isMarketHours: !currentlyPremarket, isPast10AM: currentlyPast10AM
    }
  ]
  
  alerts['TSLA_30S'] = [
    {
      symbol: "TSLA", timeframe: "30S", time: Date.now().toString(), price: 238.77,
      priceChange: -2.15, volume: 32145678,
      signal930: -15.20, signal932: -40.65, signal1000: -125.95,
      openSignal: -25.45, openTrendSignal: -85.30,
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

// --------- HTML (front-end) ---------
function getMainHTML() {
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
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600" onclick="sortTable('symbol')">
              Ticker <span id="symbol-sort" class="ml-1"></span>
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600" onclick="sortTable('price')">
              Price <span id="price-sort" class="ml-1"></span>
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600" onclick="sortTable('priceChange')">
              Chg% <span id="priceChange-sort" class="ml-1"></span>
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600" onclick="sortTable('volume')">
              Vol <span id="volume-sort" class="ml-1"></span>
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600" onclick="sortTable('openSignal')">
              Open <span id="openSignal-sort" class="ml-1"></span>
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600" onclick="sortTable('openTrendSignal')">
              Open Trend <span id="openTrendSignal-sort" class="ml-1"></span>
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600" onclick="sortTable('s30sSignal')">
              S30s <span id="s30sSignal-sort" class="ml-1"></span>
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600" onclick="sortTable('s1mSignal')">
              S1m <span id="s1mSignal-sort" class="ml-1"></span>
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600" onclick="sortTable('s5mSignal')">
              S5m <span id="s5mSignal-sort" class="ml-1"></span>
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-600" onclick="sortTable('sk2mDiff')">
              Trend <span id="sk2mDiff-sort" class="ml-1"></span>
            </th>
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
let previousData = []
let sortState = { column: 'symbol', direction: 'asc' }

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

function updateMarketStatus() {
  const now = new Date()
  const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }))
  const hour = etTime.getHours()
  const minute = etTime.getMinutes()
  const dayOfWeek = etTime.getDay()
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5
  
  let status = ''
  
  if (!isWeekday) {
    status = 'Market Closed (Weekend)'
  } else if (hour < 4) {
    status = 'Market Closed (Overnight)'
  } else if (hour < 9 || (hour === 9 && minute < 30)) {
    status = 'Premarket Hours (4:00 AM - 9:30 AM ET)'
  } else if (hour < 16) {
    status = 'Market Open (9:30 AM - 4:00 PM ET)'
  } else if (hour < 20) {
    status = 'After Hours (4:00 PM - 8:00 PM ET)'
  } else {
    status = 'Market Closed (Evening)'
  }
  
  const statusElement = document.getElementById('marketStatus')
  if (statusElement) {
    statusElement.textContent = \`Market Status: \${status} | ET: \${etTime.toLocaleTimeString()}\`
  }
}

function sortTable(column) {
  if (sortState.column === column) {
    sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc'
  } else {
    sortState.column = column
    sortState.direction = 'asc'
  }
  
  updateSortIndicators()
  fetchAlerts()
}

function updateSortIndicators() {
  const allSortSpans = document.querySelectorAll('[id$="-sort"]')
  allSortSpans.forEach(span => {
    span.textContent = ''
  })
  
  const sortSpan = document.getElementById(\`\${sortState.column}-sort\`)
  if (sortSpan) {
    sortSpan.textContent = sortState.direction === 'asc' ? '↑' : '↓'
  }
}

function applySorting(alerts) {
  const { column, direction } = sortState
  
  return alerts.sort((a, b) => {
    let aVal = a[column]
    let bVal = b[column]
    
    if (['price', 'priceChange', 'volume', 'openSignal', 'openTrendSignal', 
         's30sSignal', 's1mSignal', 's5mSignal', 'sk2mDiff'].includes(column)) {
      aVal = parseFloat(aVal) || 0
      bVal = parseFloat(bVal) || 0
    } else {
      aVal = (aVal || '').toString().toLowerCase()
      bVal = (bVal || '').toString().toLowerCase()
    }
    
    if (direction === 'asc') {
      return aVal > bVal ? 1 : aVal < bVal ? -1 : 0
    } else {
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0
    }
  })
}

async function deleteAlert(symbol, timeframe) {
  if (!confirm(\`Are you sure you want to delete the alert for \${symbol}?\`)) {
    return
  }
  
  try {
    const response = await fetch('/delete-alert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ symbol, timeframe })
    })
    
    if (response.ok) {
      fetchAlerts()
    } else {
      alert('Failed to delete alert')
    }
  } catch (error) {
    console.error('Error deleting alert:', error)
    alert('Error deleting alert')
  }
}

async function fetchAlerts() {
  try {
    const response = await fetch('/alerts')
    const data = await response.json()
  
    const sortedData = applySorting([...data])
    
    updateMarketStatus()
  
    const lastUpdate = document.getElementById('lastUpdate')
    if (data.length > 0) {
      const mostRecent = Math.max(...data.map(alert => parseInt(alert.time)))
      lastUpdate.textContent = 'Last updated: ' + new Date(mostRecent).toLocaleString()
    } else {
      lastUpdate.textContent = 'Last updated: Never'
    }
  
    const alertsTable = document.getElementById('alertsTable')
    const noAlerts = document.getElementById('noAlerts')
  
    if (sortedData.length === 0) {
      alertsTable.innerHTML = ''
      noAlerts.classList.remove('hidden')
    } else {
      noAlerts.classList.add('hidden')
      alertsTable.innerHTML = sortedData.map(alert => {
        const wasUpdated = previousData.length > 0 && 
            previousData.find(prev => prev.symbol === alert.symbol && prev.time !== alert.time)
        const updateHighlight = wasUpdated ? 'ring-2 ring-blue-400 ring-opacity-50' : ''
        
        return \`
          <tr class="hover:bg-gray-700 transition-colors duration-200 \${updateHighlight}">
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="flex items-center">
                <span class="text-sm font-medium text-white hover:text-blue-400 cursor-pointer"
                      onclick="window.open('https://www.tradingview.com/chart/?symbol=\${alert.symbol}', '_blank')"
                      title="Click to open TradingView">
                  \${alert.symbol}
                </span>
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">
              $\${parseFloat(alert.price || 0).toFixed(2)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm \${parseFloat(alert.priceChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'}">
              \${(alert.priceChange || 0)}%
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">
              \${formatVolume(alert.volume)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">
              \${formatOpenValue(alert.openSignal, alert.isPremarket)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white">
              \${formatOpenTrendValue(alert.openTrendSignal, alert.isPast10AM)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">
              <span class="px-2 py-1 rounded font-medium \${getSignalBgColor(alert.s30sSignal)}">
                \${parseFloat(alert.s30sSignal || 0).toFixed(1)}
              </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">
              <span class="px-2 py-1 rounded font-medium \${getSignalBgColor(alert.s1mSignal)}">
                \${parseFloat(alert.s1mSignal || 0).toFixed(1)}
              </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">
              <span class="px-2 py-1 rounded font-medium \${getSignalBgColor(alert.s5mSignal)}">
                \${parseFloat(alert.s5mSignal || 0).toFixed(1)}
              </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-white font-medium">
              \${formatTrend(alert.sk2mDiff)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-center">
              <button onclick="deleteAlert('\${alert.symbol}', '\${alert.timeframe || ''}')" 
                      class="text-red-400 hover:text-red-300 hover:bg-red-900 hover:bg-opacity-30 p-2 rounded transition-all duration-200" 
                      title="Delete this alert">
                🗑️
              </button>
            </td>
          </tr>
        \`
      }).join('')
    }
    
    previousData = [...data]
  } catch (error) {
    console.error('Error fetching alerts:', error)
  }
}

function initializePage() {
  updateSortIndicators()
  fetchAlerts()
}

setInterval(fetchAlerts, 2000)
initializePage()
</script>
</body>
</html>`
}

// --------- Express routes ---------
app.get('/', (req, res) => {
  res.send(getMainHTML())
})

// API: TradingView webhook - 新的歷史追蹤實現
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
  // 返 object，前端可以 filter
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