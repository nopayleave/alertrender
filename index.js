import express from 'express'
import cors from 'cors'

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// Store alerts in memory
let alerts = []

// Helper function to check if it's currently premarket hours (Eastern Time)
function isCurrentlyPremarket() {
  const now = new Date()
  const etTime = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}))
  const hour = etTime.getHours()
  const minute = etTime.getMinutes()
  
  // Check if it's a weekday (Monday = 1, Sunday = 0)
  const dayOfWeek = etTime.getDay()
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5
  
  if (!isWeekday) return false
  
  // Premarket: 4:00 AM - 9:30 AM ET
  const afterPreStart = hour >= 4
  const beforeMarketOpen = hour < 9 || (hour === 9 && minute < 30)
  
  return afterPreStart && beforeMarketOpen
}

// Helper function to check if it's past 10:00 AM ET
function isCurrentlyPast10AM() {
  const now = new Date()
  const etTime = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}))
  const hour = etTime.getHours()
  
  // Check if it's a weekday
  const dayOfWeek = etTime.getDay()
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5
  
  if (!isWeekday) return false
  
  return hour >= 10
}

// Add dummy data for development
if (process.env.NODE_ENV !== 'production') {
  const currentlyPremarket = isCurrentlyPremarket()
  const currentlyPast10AM = isCurrentlyPast10AM()
  
  alerts = [
    {
      symbol: "AAPL",
      timeframe: "30S",
      time: Date.now().toString(),
      price: 189.45,
      priceChange: 2.34,
      volume: 45678901,
      openSignal: 15.25,
      openTrendSignal: 75.80,
      s30sSignal: 125.45,
      s1mSignal: -75.20,
      s5mSignal: 275.60,
      sk2mDiff: 3.4,
      isPremarket: currentlyPremarket,
      isMarketHours: !currentlyPremarket,
      isPast10AM: currentlyPast10AM
    },
    {
      symbol: "TSLA",
      timeframe: "30S",
      time: Date.now().toString(),
      price: 238.77,
      priceChange: -1.89,
      volume: 32145678,
      openSignal: -25.45,
      openTrendSignal: -85.30,
      s30sSignal: -125.80,
      s1mSignal: 45.60,
      s5mSignal: -275.90,
      sk2mDiff: -2.8,
      isPremarket: currentlyPremarket,
      isMarketHours: !currentlyPremarket,
      isPast10AM: currentlyPast10AM
    },
    {
      symbol: "NVDA",
      timeframe: "30S",
      time: Date.now().toString(),
      price: 456.23,
      priceChange: 3.67,
      volume: 28934567,
      openSignal: 35.75,
      openTrendSignal: 125.45,
      s30sSignal: 85.20,
      s1mSignal: 165.80,
      s5mSignal: 25.30,
      sk2mDiff: 5.2,
      isPremarket: currentlyPremarket,
      isMarketHours: !currentlyPremarket,
      isPast10AM: currentlyPast10AM
    }
  ]
  console.log('🧪 Development mode: Loaded dummy data')
  console.log(`📊 Current market status: Premarket=${currentlyPremarket}, Past10AM=${currentlyPast10AM}`)
}

// Helper functions for formatting
function formatVolume(volume) {
  if (!volume || volume === 'N/A') return 'N/A'
  const num = parseFloat(volume)
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M'
  } else if (num >= 1000) {
    return (num / 1000).toFixed(0) + 'K'
  }
  return Math.round(num).toString()
}

function formatOpenValue(value, isPremarket) {
  // If it's premarket hours, show "Not Yet"
  if (isPremarket) return 'Not Yet'
  
  if (!value || value === 'N/A') return 'N/A'
  const val = parseFloat(value)
  if (isNaN(val)) return 'N/A'
  return val > 0 ? 'Up' : 'Down'
}

function formatOpenTrendValue(value, isPast10AM) {
  // If it's not past 10AM yet, show "Not Yet"
  if (!isPast10AM) return 'Not Yet'
  
  if (!value || value === 'N/A') return 'N/A'
  const val = parseFloat(value)
  if (isNaN(val)) return 'N/A'
  return val > 0 ? 'Up' : 'Down'
}

function formatTrend(sk2mDiff) {
  if (!sk2mDiff || sk2mDiff === 'N/A') return 'N/A'
  const val = parseFloat(sk2mDiff)
  if (isNaN(val)) return 'N/A'
  return val > 0 ? 'Up' : 'Down'
}

function getSignalBgColor(value) {
  if (!value || value === 'N/A') return 'bg-white text-black'
  
  const val = parseFloat(value)
  if (isNaN(val)) return 'bg-white text-black'
  
  if (val >= 250) return 'bg-green-600 text-white'      // Deep green
  if (val >= 50) return 'bg-green-300 text-black'       // Light green
  if (val >= -50) return 'bg-white text-black'          // White
  if (val >= -250) return 'bg-red-300 text-black'       // Light red
  return 'bg-red-600 text-white'                        // Deep red
}

function getMainHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <title>Trading Dashboard</title>
  <style>
    .table-container {
      max-width: 100%;
      overflow-x: auto;
    }
    table {
      min-width: 1200px;
    }
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
        <tbody id="alertsTable" class="bg-gray-800 divide-y divide-gray-700">
        </tbody>
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

function formatVolume(volume) {
  if (!volume || volume === 'N/A') return 'N/A'
  const num = parseFloat(volume)
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M'
  } else if (num >= 1000) {
    return (num / 1000).toFixed(0) + 'K'
  }
  return Math.round(num).toString()
}

function formatOpenValue(value, isPremarket) {
  // If it's premarket hours, show "Not Yet"
  if (isPremarket) return 'Not Yet'
  
  if (!value || value === 'N/A') return 'N/A'
  const val = parseFloat(value)
  if (isNaN(val)) return 'N/A'
  return val > 0 ? 'Up' : 'Down'
}

function formatOpenTrendValue(value, isPast10AM) {
  // If it's not past 10AM yet, show "Not Yet"
  if (!isPast10AM) return 'Not Yet'
  
  if (!value || value === 'N/A') return 'N/A'
  const val = parseFloat(value)
  if (isNaN(val)) return 'N/A'
  return val > 0 ? 'Up' : 'Down'
}

function formatTrend(sk2mDiff) {
  if (!sk2mDiff || sk2mDiff === 'N/A') return 'N/A'
  const val = parseFloat(sk2mDiff)
  if (isNaN(val)) return 'N/A'
  return val > 0 ? 'Up' : 'Down'
}

function getSignalBgColor(value) {
  if (!value || value === 'N/A') return 'bg-white text-black'
  
  const val = parseFloat(value)
  if (isNaN(val)) return 'bg-white text-black'
  
  if (val >= 250) return 'bg-green-600 text-white'      // Deep green
  if (val >= 50) return 'bg-green-300 text-black'       // Light green
  if (val >= -50) return 'bg-white text-black'          // White
  if (val >= -250) return 'bg-red-300 text-black'       // Light red
  return 'bg-red-600 text-white'                        // Deep red
}

function updateMarketStatus() {
  const now = new Date()
  const etTime = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}))
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
  
    // Update market status
    updateMarketStatus()
  
  // Update last update time
  const lastUpdate = document.getElementById('lastUpdate')
  if (data.length > 0) {
    const mostRecent = Math.max(...data.map(alert => parseInt(alert.time)))
    lastUpdate.textContent = 'Last updated: ' + new Date(mostRecent).toLocaleString()
  } else {
    lastUpdate.textContent = 'Last updated: Never'
  }
  
    // Update table
    const alertsTable = document.getElementById('alertsTable')
  const noAlerts = document.getElementById('noAlerts')
  
    if (data.length === 0) {
      alertsTable.innerHTML = ''
    noAlerts.classList.remove('hidden')
  } else {
    noAlerts.classList.add('hidden')
      alertsTable.innerHTML = data.map(alert => {
      // Check if this row was just updated
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

// Auto-refresh every 2 seconds
setInterval(fetchAlerts, 2000)
fetchAlerts()
</script>
</body>
</html>`
}

// Routes
app.get('/', (req, res) => {
  res.send(getMainHTML())
})

app.post('/webhook', (req, res) => {
  const rawAlert = req.body
  console.log('--- RECEIVED WEBHOOK ---')
  console.log('Raw Body:', JSON.stringify(rawAlert, null, 2))
  
  // Validate essential fields
  if (!rawAlert.symbol || rawAlert.symbol.trim() === '') {
    console.log('❌ REJECTED: Missing symbol')
    return res.status(400).json({ error: 'Symbol is required' })
  }
  
  // Normalize the webhook data
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
    sk2mDiff: parseFloat(rawAlert.sk2mDiff) || 0,
    isPremarket: rawAlert.isPremarket === 'true' || rawAlert.isPremarket === true,
    isMarketHours: rawAlert.isMarketHours === 'true' || rawAlert.isMarketHours === true,
    isPast10AM: rawAlert.isPast10AM === 'true' || rawAlert.isPast10AM === true
  }
  
  console.log('📊 Market Status:', {
    premarket: alert.isPremarket,
    marketHours: alert.isMarketHours,
    past10AM: alert.isPast10AM
  })
  
  // Find existing alert for the same symbol and timeframe
  const existingIndex = alerts.findIndex(existing => 
    existing.symbol === alert.symbol && existing.timeframe === alert.timeframe
  )
  
  if (existingIndex !== -1) {
    // Update existing alert
    alerts[existingIndex] = { ...alert, time: Date.now().toString() }
    console.log(`🔄 Updated existing alert for ${alert.symbol}`)
  } else {
    // Add new alert
    alert.time = Date.now().toString()
    alerts.unshift(alert)
    console.log(`➕ Added new alert for ${alert.symbol}`)
  }
  
  // Keep only latest 100 alerts
  if (alerts.length > 100) alerts.pop()
  
  res.sendStatus(200)
})

app.get('/alerts', (req, res) => {
  const validAlerts = alerts.filter(alert => alert.symbol && alert.symbol.trim() !== '')
  res.json(validAlerts)
})

app.post('/delete-alert', (req, res) => {
  const { symbol, timeframe } = req.body
  
  if (!symbol) {
    return res.status(400).json({ error: 'Symbol is required' })
  }
  
  const initialCount = alerts.length
  alerts = alerts.filter(alert => {
    if (timeframe) {
      return !(alert.symbol === symbol && alert.timeframe === timeframe)
    }
    return alert.symbol !== symbol
  })
  
  const deletedCount = initialCount - alerts.length
  
  if (deletedCount > 0) {
    console.log(`🗑️ Deleted ${deletedCount} alert(s) for ${symbol}`)
    res.json({ message: `Deleted ${deletedCount} alert(s) for ${symbol}`, deletedCount })
  } else {
    console.log(`⚠️ No alerts found for ${symbol}`)
    res.status(404).json({ error: 'Alert not found' })
  }
})

app.delete('/alerts', (req, res) => {
  const clearedCount = alerts.length
  alerts.length = 0
  console.log(`🗑️ Cleared ${clearedCount} alerts`)
  res.json({ message: `Cleared ${clearedCount} alerts`, count: clearedCount })
})

app.get('/clear-alerts', (req, res) => {
  const clearedCount = alerts.length
  alerts.length = 0
  console.log(`🗑️ Cleared ${clearedCount} alerts`)
  res.json({ message: `Cleared ${clearedCount} alerts`, previousCount: clearedCount, currentCount: 0 })
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`Alerts in memory: ${alerts.length}`)
  
  if (process.env.NODE_ENV !== 'production') {
    console.log('🧪 Development mode: Dummy data loaded')
  }
})
