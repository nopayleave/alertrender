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
<div class="w-full max-w-7xl mx-auto mt-6" style="padding: 0 1vw;">
  <div class="text-center mb-6">
    <h1 class="text-2xl font-bold mb-2">Live Trading Alerts Dashboard</h1>
    <p id="lastUpdate" class="text-sm text-gray-400">Last updated: Never</p>
  </div>
  
  <div class="flex justify-between gap-4">
    <!-- BUY/BULLISH TABLE -->
    <div class="bg-gray-800 rounded-xl shadow-lg overflow-hidden flex-1">
      <div class="bg-green-700 px-4 py-3">
        <h2 class="text-lg font-semibold text-white flex items-center">
          <span class="text-xl mr-2">📈</span>
          Bullish Signals (BUY)
        </h2>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full table-fixed">
          <thead class="text-xs uppercase tracking-wider text-gray-400 border-b border-gray-700">
            <tr>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('buy', 'symbol')" style="width: 18%; min-width: 90px;">
                Ticker <span id="buy-symbol-sort" class="ml-1" style="display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('buy', 'price')" style="width: 15%; min-width: 80px;">
                Price <span id="buy-price-sort" class="ml-1" style="display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('buy', 'priceChange')" style="width: 15%; min-width: 80px;">
                Chg% <span id="buy-priceChange-sort" class="ml-1" style="display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('buy', 'volume')" style="width: 13%; min-width: 75px;">
                Vol <span id="buy-volume-sort" class="ml-1" style="display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('buy', 'haValue')" style="width: 11%; min-width: 65px;">
                HA <span id="buy-haValue-sort" class="ml-1" style="display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('buy', 'condition')" style="width: 28%; min-width: 120px;">
                Trend <span id="buy-condition-sort" class="ml-1" style="display: none;"></span>
              </th>
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
    <div class="bg-gray-800 rounded-xl shadow-lg overflow-hidden flex-1">
      <div class="bg-red-700 px-4 py-3">
        <h2 class="text-lg font-semibold text-white flex items-center">
          <span class="text-xl mr-2">📉</span>
          Bearish Signals (SELL)
        </h2>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-full table-fixed">
          <thead class="text-xs uppercase tracking-wider text-gray-400 border-b border-gray-700">
            <tr>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('sell', 'symbol')" style="width: 18%; min-width: 90px;">
                Ticker <span id="sell-symbol-sort" class="ml-1" style="display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('sell', 'price')" style="width: 15%; min-width: 80px;">
                Price <span id="sell-price-sort" class="ml-1" style="display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('sell', 'priceChange')" style="width: 15%; min-width: 80px;">
                Chg% <span id="sell-priceChange-sort" class="ml-1" style="display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('sell', 'volume')" style="width: 13%; min-width: 75px;">
                Vol <span id="sell-volume-sort" class="ml-1" style="display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('sell', 'haValue')" style="width: 11%; min-width: 65px;">
                HA <span id="sell-haValue-sort" class="ml-1" style="display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('sell', 'condition')" style="width: 28%; min-width: 120px;">
                Trend <span id="sell-condition-sort" class="ml-1" style="display: none;"></span>
              </th>
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
let sortState = {
  buy: { column: 'symbol', direction: 'asc' },
  sell: { column: 'symbol', direction: 'asc' }
}

// Show initial sort indicators after DOM loads
function initializeSortIndicators() {
  setTimeout(() => {
    updateSortIndicators()
  }, 100)
}

function sortTable(tableType, column) {
  const currentSort = sortState[tableType]
  
  // Toggle direction if same column, otherwise default to ascending
  if (currentSort.column === column) {
    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc'
  } else {
    currentSort.column = column
    currentSort.direction = 'asc'
  }
  
  // Update sort indicators
  updateSortIndicators()
  
  // Trigger data refresh to apply new sorting
  fetchAlerts()
}

function updateSortIndicators() {
  // Hide all sort indicators first
  const allSortSpans = document.querySelectorAll('[id$="-sort"]')
  allSortSpans.forEach(span => {
    span.style.display = 'none'
    span.textContent = ''
  })
  
  // Show and update active sort indicators
  Object.keys(sortState).forEach(tableType => {
    const { column, direction } = sortState[tableType]
    const sortSpan = document.getElementById(\`\${tableType}-\${column}-sort\`)
    if (sortSpan) {
      sortSpan.style.display = 'inline'
      sortSpan.textContent = direction === 'asc' ? '↑' : '↓'
    }
  })
}

function applySorting(alerts, tableType) {
  const { column, direction } = sortState[tableType]
  
  return alerts.sort((a, b) => {
    let aVal = a[column]
    let bVal = b[column]
    
    // Handle numeric columns
    if (column === 'price' || column === 'priceChange' || column === 'volume' || column === 'haValue') {
      aVal = parseFloat(aVal) || 0
      bVal = parseFloat(bVal) || 0
    } else {
      // Handle string columns
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

async function fetchAlerts() {
  const res = await fetch('/alerts')
  const data = await res.json()
  
  // Separate buy and sell signals
  const buyAlerts = data.filter(alert => alert.signal === 'Bullish')
  const sellAlerts = data.filter(alert => alert.signal === 'Bearish')
  
  // Apply current sorting
  const sortedBuyAlerts = applySorting([...buyAlerts], 'buy')
  const sortedSellAlerts = applySorting([...sellAlerts], 'sell')
  
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
  
  if (sortedBuyAlerts.length === 0) {
    buyTable.innerHTML = ''
    noBuyAlerts.classList.remove('hidden')
  } else {
    noBuyAlerts.classList.add('hidden')
    buyTable.innerHTML = sortedBuyAlerts.map(row => {
      // Check if this row was just updated
      const wasUpdated = previousData.length > 0 && 
        previousData.find(prev => prev.symbol === row.symbol && prev.time !== row.time)
      const highlightClass = wasUpdated ? 'bg-green-900 bg-opacity-30' : ''
      
      return \`
        <tr class="transition-colors duration-500 hover:bg-gray-700 \${highlightClass}">
          <td class="py-3 px-4 font-semibold text-green-400">
            <a href="https://www.tradingview.com/chart/?symbol=\${row.symbol}" 
               target="_blank" 
               class="hover:text-green-300 hover:underline cursor-pointer transition-colors duration-200"
               title="Open \${row.symbol} chart on TradingView">
              \${row.symbol}
            </a>
          </td>
          <td class="py-3 px-4 text-white">$\${parseFloat(row.price).toLocaleString()}</td>
          <td class="py-3 px-4 text-white \${parseFloat(row.priceChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'}">\${row.priceChange || 'N/A'}%</td>
          <td class="py-3 px-4 text-white text-xs">\${row.volume || 'N/A'}</td>
          <td class="py-3 px-4 text-white text-xs">\${row.haValue || 'N/A'}</td>
          <td class="py-3 px-4 text-white text-sm">\${row.condition}</td>
        </tr>
      \`
    }).join('')
  }
  
  // Update sell table
  const sellTable = document.getElementById('sellTable')
  const noSellAlerts = document.getElementById('noSellAlerts')
  
  if (sortedSellAlerts.length === 0) {
    sellTable.innerHTML = ''
    noSellAlerts.classList.remove('hidden')
  } else {
    noSellAlerts.classList.add('hidden')
    sellTable.innerHTML = sortedSellAlerts.map(row => {
      // Check if this row was just updated
      const wasUpdated = previousData.length > 0 && 
        previousData.find(prev => prev.symbol === row.symbol && prev.time !== row.time)
      const highlightClass = wasUpdated ? 'bg-red-900 bg-opacity-30' : ''
      
      return \`
        <tr class="transition-colors duration-500 hover:bg-gray-700 \${highlightClass}">
          <td class="py-3 px-4 font-semibold text-red-400">
            <a href="https://www.tradingview.com/chart/?symbol=\${row.symbol}" 
               target="_blank" 
               class="hover:text-red-300 hover:underline cursor-pointer transition-colors duration-200"
               title="Open \${row.symbol} chart on TradingView">
              \${row.symbol}
            </a>
          </td>
          <td class="py-3 px-4 text-white">$\${parseFloat(row.price).toLocaleString()}</td>
          <td class="py-3 px-4 text-white \${parseFloat(row.priceChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'}">\${row.priceChange || 'N/A'}%</td>
          <td class="py-3 px-4 text-white text-xs">\${row.volume || 'N/A'}</td>
          <td class="py-3 px-4 text-white text-xs">\${row.haValue || 'N/A'}</td>
          <td class="py-3 px-4 text-white text-sm">\${row.condition}</td>
        </tr>
      \`
    }).join('')
  }
  
  previousData = [...data]
}

setInterval(fetchAlerts, 2000)
fetchAlerts()

// Initialize sort indicators on page load
initializeSortIndicators()
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
