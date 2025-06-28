import express from 'express'
import cors from 'cors'

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

let alerts = []

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <title>TradingView Alerts Feed</title>
</head>
<body class="bg-gray-900 text-gray-100">
<div class="max-w-7xl mx-auto mt-6 p-6">
  <div class="text-center mb-6">
    <h1 class="text-2xl font-bold mb-2">Live Trading Alerts Dashboard</h1>
    <p id="lastUpdate" class="text-sm text-gray-400">Last updated: Never</p>
  </div>
  
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <!-- BUY/BULLISH TABLE -->
    <div class="bg-gray-800 rounded-xl shadow-lg overflow-hidden">
      <div class="bg-green-700 px-4 py-3">
        <h2 class="text-lg font-semibold text-white flex items-center">
          <span class="text-xl mr-2">📈</span>
          Bullish Signals (BUY)
        </h2>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full table-auto">
          <thead class="text-xs uppercase tracking-wider text-gray-400 border-b border-gray-700">
            <tr>
              <th class="py-3 px-4 text-left">Ticker</th>
              <th class="py-3 px-4 text-left">Price</th>
              <th class="py-3 px-4 text-left">Message</th>
            </tr>
          </thead>
          <tbody id="buyTable" class="divide-y divide-gray-700"></tbody>
        </table>
        <div id="noBuyAlerts" class="text-center py-8 text-gray-500 hidden">
          <span class="text-4xl mb-2 block">📊</span>
          No bullish signals yet
        </div>
      </div>
    </div>

    <!-- SELL/BEARISH TABLE -->
    <div class="bg-gray-800 rounded-xl shadow-lg overflow-hidden">
      <div class="bg-red-700 px-4 py-3">
        <h2 class="text-lg font-semibold text-white flex items-center">
          <span class="text-xl mr-2">📉</span>
          Bearish Signals (SELL)
        </h2>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full table-auto">
          <thead class="text-xs uppercase tracking-wider text-gray-400 border-b border-gray-700">
            <tr>
              <th class="py-3 px-4 text-left">Ticker</th>
              <th class="py-3 px-4 text-left">Price</th>
              <th class="py-3 px-4 text-left">Message</th>
            </tr>
          </thead>
          <tbody id="sellTable" class="divide-y divide-gray-700"></tbody>
        </table>
        <div id="noSellAlerts" class="text-center py-8 text-gray-500 hidden">
          <span class="text-4xl mb-2 block">📊</span>
          No bearish signals yet
        </div>
      </div>
    </div>
  </div>
</div>

<script>
let previousData = []

async function fetchAlerts() {
  const res = await fetch('/alerts')
  const data = await res.json()
  
  // Separate buy and sell signals
  const buyAlerts = data.filter(alert => alert.signal === 'Bullish')
  const sellAlerts = data.filter(alert => alert.signal === 'Bearish')
  
  // Sort by most recent update first
  buyAlerts.sort((a, b) => parseInt(b.time) - parseInt(a.time))
  sellAlerts.sort((a, b) => parseInt(b.time) - parseInt(a.time))
  
     // Update last update time
   const lastUpdate = document.getElementById('lastUpdate')
   if (data.length > 0) {
     const mostRecent = Math.max(...data.map(alert => parseInt(alert.time)))
     lastUpdate.textContent = 'Last updated: ' + new Date(mostRecent).toLocaleString()
   } else {
     lastUpdate.textContent = 'Last updated: Never'
   }
  
  // Update buy table
  const buyTable = document.getElementById('buyTable')
  const noBuyAlerts = document.getElementById('noBuyAlerts')
  
  if (buyAlerts.length === 0) {
    buyTable.innerHTML = ''
    noBuyAlerts.classList.remove('hidden')
  } else {
    noBuyAlerts.classList.add('hidden')
    buyTable.innerHTML = buyAlerts.map(row => {
      // Check if this row was just updated
      const wasUpdated = previousData.length > 0 && 
        previousData.find(prev => prev.symbol === row.symbol && prev.time !== row.time)
      const highlightClass = wasUpdated ? 'bg-green-900 bg-opacity-30' : ''
      
      return \`
        <tr class="transition-colors duration-500 hover:bg-gray-700 \${highlightClass}">
          <td class="py-3 px-4 font-semibold text-green-400">\${row.symbol}</td>
          <td class="py-3 px-4 text-green-300">$\${parseFloat(row.price).toLocaleString()}</td>
          <td class="py-3 px-4 text-gray-300 text-sm">\${row.condition}</td>
        </tr>
      \`
    }).join('')
  }
  
  // Update sell table
  const sellTable = document.getElementById('sellTable')
  const noSellAlerts = document.getElementById('noSellAlerts')
  
  if (sellAlerts.length === 0) {
    sellTable.innerHTML = ''
    noSellAlerts.classList.remove('hidden')
  } else {
    noSellAlerts.classList.add('hidden')
    sellTable.innerHTML = sellAlerts.map(row => {
      // Check if this row was just updated
      const wasUpdated = previousData.length > 0 && 
        previousData.find(prev => prev.symbol === row.symbol && prev.time !== row.time)
      const highlightClass = wasUpdated ? 'bg-red-900 bg-opacity-30' : ''
      
      return \`
        <tr class="transition-colors duration-500 hover:bg-gray-700 \${highlightClass}">
          <td class="py-3 px-4 font-semibold text-red-400">\${row.symbol}</td>
          <td class="py-3 px-4 text-red-300">$\${parseFloat(row.price).toLocaleString()}</td>
          <td class="py-3 px-4 text-gray-300 text-sm">\${row.condition}</td>
        </tr>
      \`
    }).join('')
  }
  
  previousData = [...data]
}

setInterval(fetchAlerts, 2000)
fetchAlerts()
</script>
</body>
</html>
  `)
})

app.post('/webhook', (req, res) => {
  const alert = req.body
  console.log('Received alert:', alert)
  
  // Find existing alert for the same symbol
  const existingIndex = alerts.findIndex(existing => existing.symbol === alert.symbol)
  
  if (existingIndex !== -1) {
    // Update existing alert
    alerts[existingIndex] = { ...alert, time: Date.now().toString() }
    console.log(`Updated existing alert for ${alert.symbol}`)
  } else {
    // Add new alert
    alert.time = Date.now().toString()
    alerts.unshift(alert)
    console.log(`Added new alert for ${alert.symbol}`)
  }
  
  // Keep only the latest 100 unique tickers
  if (alerts.length > 100) alerts.pop()
  
  res.sendStatus(200)
})

app.get('/alerts', (req, res) => {
  res.json(alerts)
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
