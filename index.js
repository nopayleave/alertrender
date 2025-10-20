import express from 'express'
import cors from 'cors'

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// 儲存 alert JSON
let alerts = [] // All alerts (not just latest per symbol)
let alertsHistory = [] // All historical alerts (backup storage)
let dayChangeData = {} // Store day change data by symbol
let dayVolumeData = {} // Store daily volume data by symbol
let vwapCrossingData = {} // Store VWAP crossing status by symbol with timestamp
let quadStochData = {} // Store Quad Stochastic crossing status by symbol with timestamp
let quadStochD4Data = {} // Store Quad Stochastic D4 trend and crossing data by symbol

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
  
  // Store in full history (all alerts)
  alertsHistory.unshift({
    ...alert,
    receivedAt: Date.now()
  })
  
  // Detect alert type:
  // - Day script: contains changeFromPrevDay and volume but missing price (handles Chg% and Vol columns)
  // - VWAP Crossing alert: contains vwapCrossing flag
  // - Quad Stochastic D1/D2 alert: contains quadStochSignal
  // - Quad Stochastic D4 alert: contains d4Signal field
  // - Main script (again.pine): contains price and signals (handles Price and Signal columns)
  const isDayChangeAlert = alert.changeFromPrevDay !== undefined && !alert.price
  const isVwapCrossingAlert = alert.vwapCrossing === true || alert.vwapCrossing === 'true'
  const isQuadStochAlert = alert.quadStochSignal !== undefined
  const isQuadStochD4Alert = alert.d4Signal !== undefined
  
  // Log alert type detection for debugging
  console.log('📊 Alert type detected:', {
    isDayChangeAlert,
    isVwapCrossingAlert,
    isQuadStochAlert,
    isQuadStochD4Alert,
    symbol: alert.symbol
  })
  
  if (isQuadStochD4Alert) {
    // Quad Stochastic D4 alert - store trend and crossing data
    quadStochD4Data[alert.symbol] = {
      signal: alert.d4Signal,
      timestamp: Date.now()
    }
    console.log(`✅ D4 signal stored for ${alert.symbol}: ${alert.d4Signal}`)
    
    // Also update existing alert if it exists (don't create new one)
    const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
    if (existingIndex !== -1) {
      alerts[existingIndex].quadStochD4Signal = alert.d4Signal
      alerts[existingIndex].receivedAt = Date.now()
      console.log(`✅ Updated existing alert for ${alert.symbol} with D4 signal`)
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
    
    // Also update existing alert if it exists (don't create new one)
    const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
    if (existingIndex !== -1) {
      alerts[existingIndex].quadStochSignal = alert.quadStochSignal
      alerts[existingIndex].quadStochD1 = alert.d1
      alerts[existingIndex].quadStochD2 = alert.d2
      alerts[existingIndex].receivedAt = Date.now()
      console.log(`✅ Updated existing alert for ${alert.symbol} with Quad Stoch signal`)
    }
  } else if (isVwapCrossingAlert) {
    // VWAP Crossing alert - store crossing status with timestamp
    vwapCrossingData[alert.symbol] = {
      crossed: true,
      timestamp: Date.now()
    }
    console.log(`✅ VWAP crossing stored for ${alert.symbol}`)
    
    // Also update existing alert if it exists (don't create new one)
    const existingIndex = alerts.findIndex(a => a.symbol === alert.symbol)
    if (existingIndex !== -1) {
      alerts[existingIndex].vwapCrossing = true
      alerts[existingIndex].receivedAt = Date.now()
      console.log(`✅ Updated existing alert for ${alert.symbol} with VWAP crossing`)
    }
  } else {
    // Main script alert (again.pine) - store ALL records, merge with any existing day data
    const alertData = { ...alert }
    
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
      } else {
        // Crossing is old, expire it
        delete quadStochData[alert.symbol]
        alertData.quadStochSignal = null
      }
    } else {
      alertData.quadStochSignal = null
    }
    
    // Check and add Quad Stochastic D4 trend status if active (within last 30 minutes)
    const quadStochD4Info = quadStochD4Data[alert.symbol]
    if (quadStochD4Info && quadStochD4Info.signal) {
      const ageInMinutes = (Date.now() - quadStochD4Info.timestamp) / 60000
      if (ageInMinutes <= 30) {
        // D4 signal is recent (within 30 minutes), mark it
        alertData.quadStochD4Signal = quadStochD4Info.signal
        console.log(`✅ Merged D4 signal for ${alert.symbol}: ${quadStochD4Info.signal} (age: ${ageInMinutes.toFixed(1)} min)`)
      } else {
        // Signal is old, expire it
        delete quadStochD4Data[alert.symbol]
        alertData.quadStochD4Signal = null
        console.log(`⏰ D4 signal expired for ${alert.symbol} (age: ${ageInMinutes.toFixed(1)} min)`)
      }
    } else {
      alertData.quadStochD4Signal = null
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
    quadStochData: quadStochData,
    vwapCrossingData: vwapCrossingData,
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
  res.json({ status: 'ok', message: 'All alerts cleared' })
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
            max-width: 1360px;
          }
        }
        .mx-auto {
          margin: auto;
        }
        .p-4 {
          padding-bottom: 2rem;
        }
      </style>
    </head>
    <body class="bg-background min-h-screen pb-20 md:pb-0 md:pt-20">
      <div class="container mx-auto" style="max-width:1360px;">
        <div class="mb-8">
          <h1 class="scroll-m-20 text-4xl font-extrabold tracking-tight text-foreground mb-2">Trading Alert Dashboard</h1>
        </div>
        
        <!-- Search bar - sticky on top for desktop, bottom for mobile -->
        <div class="fixed md:sticky top-auto md:top-0 bottom-0 md:bottom-auto left-0 right-0 z-50 bg-background border-t md:border-t-0 md:border-b border-border py-4">
          <div class="container mx-auto" style="max-width:1360px;padding-bottom:1rem;">
            <div class="relative">
              <input 
                type="text" 
                id="searchInput" 
                placeholder="Search tickers..." 
                class="w-full px-3 py-2 pr-10 bg-card border border-border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                onkeyup="filterAlerts()"
                oninput="toggleClearButton()"
              />
              <button 
                id="clearButton" 
                onclick="clearSearch()" 
                class="absolute right-2 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors hidden"
                aria-label="Clear search"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        <div class="bg-card rounded-lg shadow-sm">
          <div>
            <div class="overflow-x-auto">
              <table class="w-full table-auto">
                <thead>
                  <tr class="border-b border-border">
                    <th class="text-left py-3 pl-4 pr-1 font-bold text-muted-foreground w-12">
                      ⭐
                    </th>
                    <th class="text-left py-3 pl-1 pr-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors w-auto whitespace-nowrap" onclick="sortTable('symbol')">
                      Ticker <span id="sort-symbol" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('price')">
                      Price <span id="sort-price" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('trend')" title="Market trend">
                      Trend <span id="sort-trend" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('rangeStatus')" title="Price position in day's range">
                      Range <span id="sort-rangeStatus" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('vwap')" title="Volume Weighted Average Price">
                      VWAP <span id="sort-vwap" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('vwapPosition')" title="VWAP Band Zone">
                      Position <span id="sort-vwapPosition" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('vwapCrossing')" title="VWAP Crossing Status">
                      Remark <span id="sort-vwapCrossing" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('quadStoch')" title="Quad Stochastic D1/D2 Crossing">
                      Quad Stoch <span id="sort-quadStoch" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('qstoch')" title="Quad Stochastic D4 Trend & Crossings">
                      QStoch <span id="sort-qstoch" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('rsi')">
                      <span title="Relative Strength Index">RSI</span> <span id="sort-rsi" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('ema1')">
                      <span title="Fast Exponential Moving Average">EMA1</span> <span id="sort-ema1" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('ema2')">
                      <span title="Slow Exponential Moving Average">EMA2</span> <span id="sort-ema2" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('macd')">
                      <span title="Moving Average Convergence Divergence">MACD</span> <span id="sort-macd" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('volume')">
                      <span title="Volume since 9:30 AM">Vol</span> <span id="sort-volume" class="ml-1 text-xs">⇅</span>
                    </th>
                  </tr>
                </thead>
                <tbody id="alertTable">
                  <tr>
                    <td colspan="15" class="text-center text-muted-foreground py-12 relative">Loading alerts...</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        
        <div class="mt-6 text-center">
          <p class="text-sm text-muted-foreground" id="lastUpdate">Last updated: Never <span id="countdown"></span></p>
        </div>
      </div>

      <script>
        // Sorting state
        let currentSortField = 'symbol'; // Default to alphabetical sorting
        let currentSortDirection = 'asc';
        let alertsData = [];
        
        // Search state
        let searchTerm = '';

        // Starred alerts - stored in localStorage
        let starredAlerts = JSON.parse(localStorage.getItem('starredAlerts')) || {};

        // Countdown state
        let countdownSeconds = 15;
        let countdownInterval = null;

        function formatVolume(vol) {
          if (!vol || vol === 0) return 'N/A';
          if (vol >= 1000000) return (vol / 1000000).toFixed(1) + 'M';
          if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K';
          return vol.toString();
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
          const indicators = ['symbol', 'price', 'trend', 'rangeStatus', 'vwap', 'vwapPosition', 'vwapCrossing', 'quadStoch', 'qstoch', 'rsi', 'ema1', 'ema2', 'macd', 'priceChange', 'volume'];
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

        // Initialize sort indicators on page load
        document.addEventListener('DOMContentLoaded', function() {
          updateSortIndicators();
        });

        function getSortValue(alert, field) {
          switch(field) {
            case 'symbol':
              return alert.symbol || '';
            case 'price':
              return parseFloat(alert.price) || 0;
            case 'trend':
              return alert.trend || '';
            case 'rangeStatus':
              return alert.rangeStatus || '';
            case 'vwap':
              return parseFloat(alert.vwap) || 0;
            case 'vwapPosition':
              return alert.vwapRemark || '';
            case 'vwapCrossing':
              return (alert.vwapCrossing === true || alert.vwapCrossing === 'true') ? 'Crossing' : 'Normal';
            case 'quadStoch':
              // Sort by signal strength (higher = more bullish)
              const sig = alert.quadStochSignal;
              if (sig === 'Bull_Cross_High') return 10;
              if (sig === 'Bull_Cross_Low') return 9;
              if (sig === 'Bull_D1>D2_Rising') return 8;
              if (sig === 'Bull_D2>D1_Rising') return 7;
              if (sig === 'Bull_Diverging') return 6;
              if (sig === 'Neutral_D1>D2') return 5;
              if (sig === 'Neutral_D1<D2') return 4;
              if (sig === 'Neutral') return 3;
              if (sig === 'Bear_Diverging') return 2;
              if (sig === 'Bear_D2<D1_Falling') return 1;
              if (sig === 'Bear_D1<D2_Falling') return 0;
              if (sig === 'Bear_Cross_Low') return -1;
              if (sig === 'Bear_Cross_High') return -2;
              return 3; // Default to neutral
            case 'qstoch':
              // Sort by D4 signal strength (higher = more bullish)
              const d4sig = alert.quadStochD4Signal;
              if (d4sig === 'D4_Uptrend') return 10;
              if (d4sig === 'D4_Cross_Up_80') return 9;
              if (d4sig === 'D4_Cross_Up_50') return 8;
              if (d4sig === 'D4_Cross_Up_20') return 7;
              if (d4sig === 'D4_Cross_Down_20') return 3;
              if (d4sig === 'D4_Cross_Down_50') return 2;
              if (d4sig === 'D4_Cross_Down_80') return 1;
              if (d4sig === 'D4_Downtrend') return 0;
              return 5; // Default to neutral
            case 'rsi':
              return parseFloat(alert.rsi) || 0;
            case 'ema1':
              return parseFloat(alert.ema1) || 0;
            case 'ema2':
              return parseFloat(alert.ema2) || 0;
            case 'macd':
              return parseFloat(alert.macd) || 0;
            case 'priceChange':
              // Calculate price change percentage for sorting
              // Priority 1: Use changeFromPrevDay from Day script if available
              if (alert.changeFromPrevDay !== undefined) {
                return parseFloat(alert.changeFromPrevDay) || 0;
              }
              // Priority 2: Calculate from price and previousClose
              else if (alert.price && alert.previousClose && alert.previousClose !== 0) {
                const close = parseFloat(alert.price);
                const prevDayClose = parseFloat(alert.previousClose);
                const changeFromPrevDay = (close - prevDayClose) / prevDayClose * 100;
                return changeFromPrevDay;
              } 
              // Priority 3: Fallback to legacy priceChange field
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

        function filterAlerts() {
          searchTerm = document.getElementById('searchInput').value.toLowerCase();
          renderTable();
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
          renderTable();
        }

        function isStarred(symbol) {
          return starredAlerts[symbol] || false;
        }

        function updateCountdown() {
          const countdownElem = document.getElementById('countdown');
          if (countdownElem) {
            countdownElem.textContent = \`- \${countdownSeconds}s\`;
          }
        }

        function startCountdown() {
          countdownSeconds = 15;
          updateCountdown();
          
          if (countdownInterval) {
            clearInterval(countdownInterval);
          }
          
          countdownInterval = setInterval(() => {
            countdownSeconds--;
            if (countdownSeconds < 0) {
              countdownSeconds = 15;
            }
            updateCountdown();
          }, 1000);
        }

        function renderTable() {
          const alertTable = document.getElementById('alertTable');
          const lastUpdate = document.getElementById('lastUpdate');
          
          if (alertsData.length === 0) {
            alertTable.innerHTML = '<tr><td colspan="15" class="text-center text-muted-foreground py-12 relative">No alerts available</td></tr>';
            lastUpdate.innerHTML = 'Last updated: Never <span id="countdown"></span>';
            return;
          }

          // Filter data by search term
          let filteredData = alertsData;
          if (searchTerm) {
            filteredData = alertsData.filter(alert => 
              (alert.symbol || '').toLowerCase().includes(searchTerm)
            );
          }

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
            alertTable.innerHTML = '<tr><td colspan="15" class="text-center text-muted-foreground py-12 relative">No tickers match your search</td></tr>';
            lastUpdate.innerHTML = 'Last updated: ' + new Date(Math.max(...alertsData.map(alert => alert.receivedAt || 0))).toLocaleString() + ' <span id="countdown"></span>';
            updateCountdown();
            return;
          }

          // Update last update time with search info
          const mostRecent = Math.max(...alertsData.map(alert => alert.receivedAt || 0));
          const searchInfo = searchTerm ? \` • Showing \${filteredData.length} of \${alertsData.length}\` : '';
          lastUpdate.innerHTML = 'Last updated: ' + new Date(mostRecent).toLocaleString() + searchInfo + ' <span id="countdown"></span>';
          updateCountdown();

          alertTable.innerHTML = filteredData.map(alert => {
            const starred = isStarred(alert.symbol);
            const starIcon = starred ? '⭐' : '☆';
            const starClass = starred ? 'text-yellow-400' : 'text-muted-foreground hover:text-yellow-400';
            
            // Calculate price change percentage in frontend
            let priceChangeDisplay = 'N/A';
            let priceChangeColor = '';
            
            // Priority 1: Use changeFromPrevDay from Day script if available
            if (alert.changeFromPrevDay !== undefined) {
              const changeFromPrevDay = parseFloat(alert.changeFromPrevDay);
              priceChangeDisplay = changeFromPrevDay.toFixed(2);
              priceChangeColor = changeFromPrevDay >= 0 ? 'color: oklch(0.75 0.15 163);' : 'color: oklch(0.7 0.25 25.331);';
            }
            // Priority 2: Calculate from price and previousClose
            else if (alert.price && alert.previousClose && alert.previousClose !== 0) {
              const close = parseFloat(alert.price);
              const prevDayClose = parseFloat(alert.previousClose);
              const changeFromPrevDay = (close - prevDayClose) / prevDayClose * 100;
              priceChangeDisplay = changeFromPrevDay.toFixed(2);
              priceChangeColor = changeFromPrevDay >= 0 ? 'color: oklch(0.75 0.15 163);' : 'color: oklch(0.7 0.25 25.331);';
            } 
            // Priority 3: Fallback to legacy priceChange field
            else if (alert.priceChange) {
              priceChangeDisplay = alert.priceChange;
              priceChangeColor = parseFloat(alert.priceChange || 0) >= 0 ? 'color: oklch(0.75 0.15 163);' : 'color: oklch(0.7 0.25 25.331);';
            }
            
            // Trend color coding
            const trendClass = alert.trend === 'Bullish' ? 'text-green-400 font-semibold' : 
                               alert.trend === 'Bearish' ? 'text-red-400 font-semibold' : 
                               'text-muted-foreground';
            
            // Trend indicator (arrows showing price position vs EMAs)
            const trendIndicator = alert.trendIndicator ? ' ' + alert.trendIndicator : '';
            
            // Range status color coding
            const rangeClass = alert.rangeStatus === 'Up Range' ? 'text-green-400 font-semibold' : 
                               alert.rangeStatus === 'Down Range' ? 'text-red-400 font-semibold' : 
                               'text-muted-foreground';
            
            // RSI color coding (overbought/oversold)
            const rsiValue = parseFloat(alert.rsi);
            const rsiClass = rsiValue >= 70 ? 'text-red-400 font-semibold' : 
                             rsiValue <= 30 ? 'text-green-400 font-semibold' : 
                             'text-muted-foreground';
            
            // MACD color coding
            const macdValue = parseFloat(alert.macd);
            const macdSignalValue = parseFloat(alert.macdSignal);
            const macdClass = macdValue > macdSignalValue ? 'text-green-400' : 
                              macdValue < macdSignalValue ? 'text-red-400' : 
                              'text-muted-foreground';
            
            // VWAP color coding (price above/below)
            const vwapClass = alert.vwapAbove === 'true' || alert.vwapAbove === true ? 'text-green-400 font-semibold' : 
                              alert.vwapAbove === 'false' || alert.vwapAbove === false ? 'text-red-400 font-semibold' : 
                              'text-foreground';
            
            // EMA1 color coding (price above/below)
            const ema1Above = alert.ema1Above === 'true' || alert.ema1Above === true;
            const ema1Below = alert.ema1Above === 'false' || alert.ema1Above === false;
            const ema1Class = ema1Above ? 'text-green-400 font-semibold' : 
                              ema1Below ? 'text-red-400 font-semibold' : 
                              'text-muted-foreground';
            
            // EMA2 color coding (price above/below)
            const ema2Above = alert.ema2Above === 'true' || alert.ema2Above === true;
            const ema2Below = alert.ema2Above === 'false' || alert.ema2Above === false;
            const ema2Class = ema2Above ? 'text-green-400 font-semibold' : 
                              ema2Below ? 'text-red-400 font-semibold' : 
                              'text-muted-foreground';
            
            // VWAP Position color coding (band zone)
            const positionClass = alert.vwapRemark && alert.vwapRemark.startsWith('UP') ? 'text-green-400 font-bold' :
                                  alert.vwapRemark && alert.vwapRemark.startsWith('DN') ? 'text-red-400 font-bold' :
                                  'text-yellow-400 font-semibold';
            
            // VWAP Remark - display "Crossing" if VWAP crossing detected, otherwise "Normal"
            let remarkDisplay = 'Normal';
            let remarkClass = 'text-muted-foreground';
            
            if (alert.vwapCrossing === true || alert.vwapCrossing === 'true') {
              remarkDisplay = 'Crossing';
              remarkClass = 'text-yellow-400 font-bold animate-pulse';
            }
            
            // Quad Stochastic Signal Display
            let quadStochDisplay = '-';
            let quadStochClass = 'text-muted-foreground';
            let quadStochTitle = 'No recent signal';
            
            const signal = alert.quadStochSignal;
            const d1Val = alert.quadStochD1 ? parseFloat(alert.quadStochD1).toFixed(1) : 'N/A';
            const d2Val = alert.quadStochD2 ? parseFloat(alert.quadStochD2).toFixed(1) : 'N/A';
            
            // Bullish signals (Green)
            if (signal === 'Bull_Cross_High') {
              quadStochDisplay = '↑⚡ HIGH';
              quadStochClass = 'text-green-400 font-bold animate-pulse';
              quadStochTitle = \`Bullish Cross in Upper Zone (D1: \${d1Val}, D2: \${d2Val})\`;
            } else if (signal === 'Bull_Cross_Low') {
              quadStochDisplay = '↑⚡ LOW';
              quadStochClass = 'text-green-400 font-bold animate-pulse';
              quadStochTitle = \`Bullish Cross from Oversold (D1: \${d1Val}, D2: \${d2Val})\`;
            } else if (signal === 'Bull_D1>D2_Rising') {
              quadStochDisplay = '↑↑ D1>D2';
              quadStochClass = 'text-green-400 font-semibold';
              quadStochTitle = \`Bullish: D1 above D2, both rising (D1: \${d1Val}, D2: \${d2Val})\`;
            } else if (signal === 'Bull_D2>D1_Rising') {
              quadStochDisplay = '↑↑ D2>D1';
              quadStochClass = 'text-green-400 font-semibold';
              quadStochTitle = \`Bullish Momentum: Both D1 and D2 rising (D1: \${d1Val}, D2: \${d2Val})\`;
            } else if (signal === 'Bull_Diverging') {
              quadStochDisplay = '↗️ DIV';
              quadStochClass = 'text-lime-400 font-semibold';
              quadStochTitle = \`Bullish Divergence: D1 rising, D2 falling (D1: \${d1Val}, D2: \${d2Val})\`;
            }
            // Bearish signals (Red)
            else if (signal === 'Bear_Cross_High') {
              quadStochDisplay = '↓⚡ HIGH';
              quadStochClass = 'text-red-400 font-bold animate-pulse';
              quadStochTitle = \`Bearish Cross in Overbought (D1: \${d1Val}, D2: \${d2Val})\`;
            } else if (signal === 'Bear_Cross_Low') {
              quadStochDisplay = '↓⚡ LOW';
              quadStochClass = 'text-red-400 font-bold animate-pulse';
              quadStochTitle = \`Bearish Cross in Lower Zone (D1: \${d1Val}, D2: \${d2Val})\`;
            } else if (signal === 'Bear_D1<D2_Falling') {
              quadStochDisplay = '↓↓ D1<D2';
              quadStochClass = 'text-red-400 font-semibold';
              quadStochTitle = \`Bearish: D1 below D2, both falling (D1: \${d1Val}, D2: \${d2Val})\`;
            } else if (signal === 'Bear_D2<D1_Falling') {
              quadStochDisplay = '↓↓ D2<D1';
              quadStochClass = 'text-red-400 font-semibold';
              quadStochTitle = \`Bearish Momentum: Both D1 and D2 falling (D1: \${d1Val}, D2: \${d2Val})\`;
            } else if (signal === 'Bear_Diverging') {
              quadStochDisplay = '↘️ DIV';
              quadStochClass = 'text-orange-400 font-semibold';
              quadStochTitle = \`Bearish Divergence: D1 falling, D2 rising (D1: \${d1Val}, D2: \${d2Val})\`;
            }
            // Neutral signals (Yellow/Gray)
            else if (signal === 'Neutral_D1>D2') {
              quadStochDisplay = '⚪ D1>D2';
              quadStochClass = 'text-yellow-400';
              quadStochTitle = \`Neutral: D1 above D2, mixed momentum (D1: \${d1Val}, D2: \${d2Val})\`;
            } else if (signal === 'Neutral_D1<D2') {
              quadStochDisplay = '⚪ D1<D2';
              quadStochClass = 'text-yellow-400';
              quadStochTitle = \`Neutral: D1 below D2, mixed momentum (D1: \${d1Val}, D2: \${d2Val})\`;
            } else if (signal === 'Neutral') {
              quadStochDisplay = '⚪ =';
              quadStochClass = 'text-gray-400';
              quadStochTitle = \`Neutral: D1 equals D2 (D1: \${d1Val}, D2: \${d2Val})\`;
            }
            
            // QStoch D4 Signal Display
            let qstochDisplay = '-';
            let qstochClass = 'text-muted-foreground';
            let qstochTitle = 'No recent D4 signal';
            
            const d4Signal = alert.quadStochD4Signal;
            
            // Uptrend signals (Green)
            if (d4Signal === 'D4_Uptrend') {
              qstochDisplay = '↑ Uptrend';
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
              qstochDisplay = '↓ Downtrend';
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
            
            return \`
              <tr class="border-b border-border hover:bg-muted/50 transition-colors \${starred ? 'bg-muted/20' : ''}">
                <td class="py-3 pl-4 pr-1 text-center">
                  <button 
                    onclick="toggleStar('\${alert.symbol}')" 
                    class="text-xl \${starClass} transition-colors cursor-pointer hover:scale-110 transform"
                    title="\${starred ? 'Remove from favorites' : 'Add to favorites'}"
                  >
                    \${starIcon}
                  </button>
                </td>
                <td class="py-3 pl-1 pr-4 font-medium text-foreground w-auto whitespace-nowrap">\${alert.symbol || 'N/A'}</td>
                <td class="py-3 px-4 font-mono font-medium text-foreground">$\${alert.price ? parseFloat(alert.price).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : 'N/A'}</td>
                <td class="py-3 px-4 font-medium \${trendClass}" title="Price vs EMA1/EMA2">\${(alert.trend || 'N/A') + trendIndicator}</td>
                <td class="py-3 px-4 font-medium \${rangeClass}" title="Day Range: \${alert.dayRange ? '$' + parseFloat(alert.dayRange).toFixed(2) : 'N/A'}">\${alert.rangeStatus ? alert.rangeStatus.replace(' Range', '') : 'N/A'}</td>
                <td class="py-3 px-4 font-mono \${vwapClass}" title="Price \${alert.vwapAbove === 'true' || alert.vwapAbove === true ? 'above' : 'below'} VWAP">$\${alert.vwap ? parseFloat(alert.vwap).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : 'N/A'}</td>
                <td class="py-3 px-4 font-bold \${positionClass}" title="VWAP Band Zone">\${alert.vwapRemark || 'N/A'}</td>
                <td class="py-3 px-4 font-bold \${remarkClass}" title="\${remarkDisplay === 'Crossing' ? 'VWAP Crossing Detected!' : 'No Recent VWAP Crossing'}">\${remarkDisplay}</td>
                <td class="py-3 px-4 font-bold \${quadStochClass}" title="\${quadStochTitle}">\${quadStochDisplay}</td>
                <td class="py-3 px-4 font-bold \${qstochClass}" title="\${qstochTitle}">\${qstochDisplay}</td>
                <td class="py-3 px-4 font-mono \${rsiClass}" title="RSI\${alert.rsiTf ? ' [' + alert.rsiTf + ']' : ''}">\${alert.rsi ? parseFloat(alert.rsi).toFixed(1) : 'N/A'}</td>
                <td class="py-3 px-4 font-mono \${ema1Class}" title="EMA1\${alert.ema1Tf ? ' [' + alert.ema1Tf + ']' : ''} - Price \${ema1Above ? 'above' : ema1Below ? 'below' : 'near'}">$\${alert.ema1 ? parseFloat(alert.ema1).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : 'N/A'}</td>
                <td class="py-3 px-4 font-mono \${ema2Class}" title="EMA2\${alert.ema2Tf ? ' [' + alert.ema2Tf + ']' : ''} - Price \${ema2Above ? 'above' : ema2Below ? 'below' : 'near'}">$\${alert.ema2 ? parseFloat(alert.ema2).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : 'N/A'}</td>
                <td class="py-3 px-4 font-mono \${macdClass}" title="MACD\${alert.macdTf ? ' [' + alert.macdTf + ']' : ''}">\${alert.macd ? parseFloat(alert.macd).toFixed(2) : 'N/A'}</td>
                <td class="py-3 px-4 text-muted-foreground" title="Volume since 9:30 AM: \${alert.volume ? parseInt(alert.volume).toLocaleString() : 'N/A'}">\${formatVolume(alert.volume)}</td>
              </tr>
            \`;
          }).join('');
        }

        async function fetchAlerts() {
          try {
            const response = await fetch('/alerts');
            const data = await response.json();
            
            alertsData = data;
            renderTable();
            startCountdown();
            
          } catch (error) {
            console.error('Error fetching alerts:', error);
            document.getElementById('alertTable').innerHTML = '<tr><td colspan="15" class="text-center text-red-400 py-12 relative">Error loading alerts</td></tr>';
          }
        }

        // Fetch alerts once on page load
        fetchAlerts();
        
        // Auto-refresh every 15 seconds
        setInterval(fetchAlerts, 15000);
      </script>
    </body>
    </html>
  `)
})

app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})
