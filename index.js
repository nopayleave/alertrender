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
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('buy', 'symbol')" style="width: 18%; min-width: 80px;">
                Ticker <span id="buy-symbol-sort" style="margin-left: 0rem; display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('buy', 'price')" style="width: 15%; min-width: 80px;">
                Price <span id="buy-price-sort" style="margin-left: 0rem; display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('buy', 'priceChange')" style="width: 18%; min-width: 70px;">
                Chg% <span id="buy-priceChange-sort" style="margin-left: 0rem; display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('buy', 'volume')" style="width: 13%; min-width: 80px;">
                Vol <span id="buy-volume-sort" style="margin-left: 0rem; display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('buy', 'haValue')" style="width: 11%; min-width: 70px;">
                HA <span id="buy-haValue-sort" style="margin-left: 0rem; display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('buy', 'condition')" style="width: 25%; min-width: 120px;">
                Trend <span id="buy-condition-sort" style="margin-left: 0rem; display: none;"></span>
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
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('sell', 'symbol')" style="width: 18%; min-width: 80px;">
                Ticker <span id="sell-symbol-sort" style="margin-left: 0rem; display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('sell', 'price')" style="width: 15%; min-width: 80px;">
                Price <span id="sell-price-sort" style="margin-left: 0rem; display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('sell', 'priceChange')" style="width: 18%; min-width: 70px;">
                Chg% <span id="sell-priceChange-sort" style="margin-left: 0rem; display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('sell', 'volume')" style="width: 13%; min-width: 80px;">
                Vol <span id="sell-volume-sort" style="margin-left: 0rem; display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('sell', 'haValue')" style="width: 11%; min-width: 70px;">
                HA <span id="sell-haValue-sort" style="margin-left: 0rem; display: none;"></span>
              </th>
              <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('sell', 'condition')" style="width: 25%; min-width: 120px;">
                Trend <span id="sell-condition-sort" style="margin-left: 0rem; display: none;"></span>
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

function formatVolume(volume) {
  if (!volume || volume === 'N/A') return 'N/A'
  const num = parseFloat(volume)
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M'
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K'
  }
  return num.toString()
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
          <td class="py-3 px-4 font-semibold text-green-400 relative">
            <div class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" 
                   viewBox="0 0 24 24" 
                   fill="currentColor" 
                   class="w-4 h-4 cursor-pointer hover:text-green-300 transition-colors duration-200"
                   onmouseenter="showChart('\${row.symbol}', event)"
                   onmouseleave="hideChart()"
                   title="Hover for chart preview">
                <path d="M5 3V19H21V21H3V3H5ZM20.2929 6.29289L21.7071 7.70711L16 13.4142L13 10.415L8.70711 14.7071L7.29289 13.2929L13 7.58579L16 10.585L20.2929 6.29289Z"></path>
              </svg>
              <span class="hover:text-green-300 hover:underline cursor-pointer transition-colors duration-200"
                    onclick="window.open('https://www.tradingview.com/chart/?symbol=\${row.symbol}', '_blank')"
                    title="Click to open TradingView">
                \${row.symbol}
              </span>
            </div>
          </td>
          <td class="py-3 px-4 text-white">$\${parseFloat(row.price).toLocaleString()}</td>
          <td class="py-3 px-4 text-white \${parseFloat(row.priceChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'}">\${row.priceChange || 'N/A'}%</td>
          <td class="py-3 px-4 text-white text-xs">\${formatVolume(row.volume)}</td>
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
          <td class="py-3 px-4 font-semibold text-red-400 relative">
            <div class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" 
                   viewBox="0 0 24 24" 
                   fill="currentColor" 
                   class="w-4 h-4 cursor-pointer hover:text-red-300 transition-colors duration-200"
                   onmouseenter="showChart('\${row.symbol}', event)"
                   onmouseleave="hideChart()"
                   title="Hover for chart preview">
                <path d="M5 3V19H21V21H3V3H5ZM20.2929 6.29289L21.7071 7.70711L16 13.4142L13 10.415L8.70711 14.7071L7.29289 13.2929L13 7.58579L16 10.585L20.2929 6.29289Z"></path>
              </svg>
              <span class="hover:text-red-300 hover:underline cursor-pointer transition-colors duration-200"
                    onclick="window.open('https://www.tradingview.com/chart/?symbol=\${row.symbol}', '_blank')"
                    title="Click to open TradingView">
                \${row.symbol}
              </span>
            </div>
          </td>
          <td class="py-3 px-4 text-white">$\${parseFloat(row.price).toLocaleString()}</td>
          <td class="py-3 px-4 text-white \${parseFloat(row.priceChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'}">\${row.priceChange || 'N/A'}%</td>
          <td class="py-3 px-4 text-white text-xs">\${formatVolume(row.volume)}</td>
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

// Chart overlay functionality
let chartOverlay = null
let hoverTimeout = null

function showChart(symbol, event) {
  // Clear any existing timeout
  clearTimeout(hoverTimeout)
  
  // Add delay before showing chart
  hoverTimeout = setTimeout(() => {
    hideChart() // Hide any existing chart
    
    // Create overlay
    chartOverlay = document.createElement('div')
    chartOverlay.id = 'chart-overlay'
    chartOverlay.style.cssText = \`
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 800px;
      height: 500px;
      background: #1e1e1e;
      border: 2px solid #374151;
      border-radius: 8px;
      z-index: 1000;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      overflow: hidden;
    \`
    
    // Create TradingView widget
    const widgetContainer = document.createElement('div')
    widgetContainer.style.cssText = 'height: 100%; width: 100%;'
    
    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.type = 'text/javascript'
    script.async = true
    script.innerHTML = JSON.stringify({
      allow_symbol_change: false,
      calendar: false,
      details: false,
      hide_side_toolbar: true,
      hide_top_toolbar: false,
      hide_legend: true,
      hide_volume: false,
      hotlist: false,
      interval: '3',
      locale: 'en',
      save_image: false,
      style: '1',
      symbol: symbol,
      theme: 'dark',
      timezone: 'Etc/UTC',
      backgroundColor: '#0F0F0F',
      gridColor: 'rgba(242, 242, 242, 0.06)',
      watchlist: [],
      withdateranges: false,
      range: '1D',
      compareSymbols: [],
      show_popup_button: false,
      popup_height: '500',
      popup_width: '800',
      studies: ['STD;VWAP', 'STD;Stochastic'],
      autosize: true
    })
    
    widgetContainer.appendChild(script)
    chartOverlay.appendChild(widgetContainer)
    document.body.appendChild(chartOverlay)
    
    // Add backdrop
    const backdrop = document.createElement('div')
    backdrop.id = 'chart-backdrop'
    backdrop.style.cssText = \`
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 999;
    \`
    backdrop.onclick = hideChart
    document.body.appendChild(backdrop)
  }, 0) // 0ms delay - immediate
}

function hideChart() {
  clearTimeout(hoverTimeout)
  
  const overlay = document.getElementById('chart-overlay')
  const backdrop = document.getElementById('chart-backdrop')
  
  if (overlay) overlay.remove()
  if (backdrop) backdrop.remove()
  
  chartOverlay = null
}

// Close chart on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideChart()
})

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
