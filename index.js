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
let previousQSValues = {} // Store previous QS values to detect changes

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
    // Check if values changed compared to previous update
    const prevQS = previousQSValues[alert.symbol] || {}
    const d4Changed = prevQS.d4 !== alert.d4
    const directionChanged = 
      prevQS.d1Direction !== alert.d1Direction ||
      prevQS.d2Direction !== alert.d2Direction ||
      prevQS.d3Direction !== alert.d3Direction ||
      prevQS.d4Direction !== alert.d4Direction
    
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
      changeTimestamp: Date.now(),
      timestamp: Date.now()
    }
    
    // Store current values as previous for next comparison
    previousQSValues[alert.symbol] = {
      d4: alert.d4,
      d4Signal: alert.d4Signal,
      d1Direction: alert.d1Direction,
      d2Direction: alert.d2Direction,
      d3Direction: alert.d3Direction,
      d4Direction: alert.d4Direction
    }
    
    console.log(`✅ D4 signal stored for ${alert.symbol}: ${alert.d4Signal}, D4 value: ${alert.d4}, Changed: ${changeDirection}/${arrowChangeDirection}`)
    
    // Also update existing alert if it exists (don't create new one)
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
      alerts[existingIndex].quadStochD4 = alert.d4
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
        alertData.quadStochD4 = quadStochInfo.d4
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
  previousQSValues = {}
  res.json({ status: 'ok', message: 'All alerts cleared' })
})

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

        <!-- Calculator Inputs -->
        <div class="bg-card rounded-lg shadow-lg p-4 border border-border mb-4">
          <div class="flex gap-4 items-end">
            <!-- Portfolio Value with Currency Toggle -->
            <div class="flex-1">
              <label class="block text-xs font-medium text-muted-foreground mb-1">
                Portfolio Value
              </label>
              <div class="flex gap-2">
                <input 
                  type="number" 
                  id="portfolioValue" 
                  placeholder="10000"
                  class="flex-1 px-3 py-2 bg-secondary border border-border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-lg"
                  oninput="calculate()"
                  value="10000"
                />
                <select 
                  id="currency" 
                  class="px-3 py-2 bg-secondary border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  onchange="calculate()"
                >
                  <option value="USD">USD</option>
                  <option value="HKD">HKD</option>
                </select>
              </div>
            </div>

            <!-- Share Price (Always USD) -->
            <div class="flex-1">
              <label class="block text-xs font-medium text-muted-foreground mb-1">
                Stock Price (USD)
              </label>
              <input 
                type="number" 
                id="sharePrice" 
                placeholder="50"
                step="0.01"
                class="w-full px-3 py-2 bg-secondary border border-border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-lg"
                oninput="calculate()"
                value="50"
              />
            </div>
          </div>
        </div>

        <!-- Allocation Results -->
        <div class="bg-card rounded-lg shadow-lg p-4 border border-border mb-4">
          <div id="allocationList" class="space-y-2">
            <!-- Results will be populated here -->
          </div>
        </div>

        <!-- % Cheatsheet -->
        <div class="bg-card rounded-lg shadow-lg p-4 border border-border mb-4">
          <h3 class="text-lg font-semibold text-foreground mb-3">% Cheatsheet</h3>
          <p class="text-xs text-muted-foreground mb-3">Required shares to earn target profit from price moves</p>
          <div class="overflow-x-auto">
            <table class="w-full text-sm" id="cheatsheetTable">
              <thead>
                <tr class="border-b border-border">
                  <th class="text-left py-2 px-2 text-muted-foreground">Target Profit <span id="profitCurrency" class="text-xs">(USD)</span></th>
                  <th class="text-center py-2 px-2 text-muted-foreground">1% Move</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">2% Move</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">5% Move</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">10% Move</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">15% Move</th>
                  <th class="text-center py-2 px-2 text-muted-foreground">20% Move</th>
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
            cheatsheetBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted-foreground py-4">Enter stock price to see cheatsheet</td></tr>';
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

            return \`
              <div class="flex items-center justify-between p-3 bg-secondary rounded border border-border hover:border-blue-500 transition-colors">
                <div class="flex items-baseline gap-2">
                  <span class="text-2xl font-bold text-blue-400">\${numShares.toLocaleString()}</span>
                  <span class="text-sm text-muted-foreground">shares</span>
                  <span class="text-lg font-semibold text-foreground">= \${percent}%</span>
                </div>
                <div class="text-right">
                  <div class="text-base font-semibold text-green-400">$\${actualCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
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
          
          const percentMoves = [1, 2, 5, 10, 15, 20];
          
          cheatsheetBody.innerHTML = profitTargets.map(profit => {
            const cells = percentMoves.map(movePercent => {
              // Convert profit to USD if in HKD
              const profitUSD = currency === 'HKD' ? profit / HKD_TO_USD : profit;
              
              // Formula: Required Shares = Target Profit (USD) / (Stock Price × Move %)
              const profitPerShare = sharePrice * (movePercent / 100);
              const requiredShares = profitUSD / profitPerShare;
              const roundedShares = roundToNice(requiredShares);
              
              return \`<td class="text-center py-2 px-2 text-foreground font-semibold">\${roundedShares.toLocaleString()}</td>\`;
            }).join('');
            
            return \`
              <tr class="border-b border-border/50 hover:bg-secondary/30">
                <td class="text-left py-2 px-2 text-green-400 font-semibold">\${currencySymbol}\${profit.toLocaleString()}</td>
                \${cells}
              </tr>
            \`;
          }).join('');
        }

        // Calculate on page load
        calculate();
      </script>
    </body>
    </html>
  `)
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
          <div class="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
            <div>
              <h1 class="scroll-m-20 text-4xl font-extrabold tracking-tight text-foreground mb-2">Trading Alert Dashboard</h1>
            </div>
            <div>
              <a href="/calculator" class="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors shadow-lg">
                📊 Calculator
              </a>
            </div>
          </div>
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
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('vwap')" title="Volume Weighted Average Price & % difference">
                      VWAP <span id="sort-vwap" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('vwapPosition')" title="VWAP Band Zone">
                      Position <span id="sort-vwapPosition" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('vwapCrossing')" title="VWAP Crossing Status">
                      Remark <span id="sort-vwapCrossing" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('quadStoch')" title="Quad Stochastic D4 Value">
                      QS D4 Value <span id="sort-quadStoch" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('qsArrow')" title="D1/D2/D3/D4 Direction Arrows">
                      QS Arrow <span id="sort-qsArrow" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('qstoch')" title="Quad Stochastic D4 Trend & Crossings">
                      QS D4 <span id="sort-qstoch" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('rsi')">
                      <span title="Relative Strength Index">RSI</span> <span id="sort-rsi" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('macd')">
                      <span title="MACD Histogram">MACD Hist</span> <span id="sort-macd" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('volume')">
                      <span title="Volume since 9:30 AM">Vol</span> <span id="sort-volume" class="ml-1 text-xs">⇅</span>
                    </th>
                  </tr>
                </thead>
                <tbody id="alertTable">
                  <tr>
                    <td colspan="12" class="text-center text-muted-foreground py-12 relative">Loading alerts...</td>
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
          const indicators = ['symbol', 'price', 'vwap', 'vwapPosition', 'vwapCrossing', 'quadStoch', 'qsArrow', 'qstoch', 'rsi', 'macd', 'priceChange', 'volume'];
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
            case 'vwap':
              return parseFloat(alert.vwap) || 0;
            case 'vwapPosition':
              return alert.vwapRemark || '';
            case 'vwapCrossing':
              return (alert.vwapCrossing === true || alert.vwapCrossing === 'true') ? 'Crossing' : 'Normal';
            case 'quadStoch':
              // Sort by D4 value numerically
              return parseFloat(alert.quadStochD4) || 0;
            case 'qsArrow':
              // Sort by number of up arrows (bullish first)
              const d1Dir = alert.d1Direction || 'flat';
              const d2Dir = alert.d2Direction || 'flat';
              const d3Dir = alert.d3Direction || 'flat';
              const d4Dir = alert.d4Direction || 'flat';
              const upCount = [d1Dir, d2Dir, d3Dir, d4Dir].filter(d => d === 'up').length;
              return upCount;
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
            case 'macd':
              return parseFloat(alert.macdHistogram) || 0;
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
            alertTable.innerHTML = '<tr><td colspan="12" class="text-center text-muted-foreground py-12 relative">No alerts available</td></tr>';
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
            alertTable.innerHTML = '<tr><td colspan="12" class="text-center text-muted-foreground py-12 relative">No tickers match your search</td></tr>';
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
            
            // Calculate VWAP percentage difference
            let vwapDiffDisplay = '';
            let vwapDiffColor = '';
            if (alert.price && alert.vwap) {
              const price = parseFloat(alert.price);
              const vwap = parseFloat(alert.vwap);
              const vwapDiff = ((price - vwap) / vwap) * 100;
              const sign = vwapDiff >= 0 ? '+' : '';
              vwapDiffDisplay = \` (\${sign}\${vwapDiff.toFixed(2)}%)\`;
              vwapDiffColor = vwapDiff >= 0 ? 'text-green-400' : 'text-red-400';
            }
            
            // RSI color coding (overbought/oversold)
            const rsiValue = parseFloat(alert.rsi);
            const rsiClass = rsiValue >= 70 ? 'text-red-400 font-semibold' : 
                             rsiValue <= 30 ? 'text-green-400 font-semibold' : 
                             'text-muted-foreground';
            
            // MACD Histogram color coding
            const macdHistogramValue = parseFloat(alert.macdHistogram);
            const macdClass = macdHistogramValue > 0 ? 'text-green-400 font-semibold' : 
                              macdHistogramValue < 0 ? 'text-red-400 font-semibold' : 
                              'text-muted-foreground';
            
            // VWAP color coding (price above/below)
            const vwapClass = alert.vwapAbove === 'true' || alert.vwapAbove === true ? 'text-green-400 font-semibold' : 
                              alert.vwapAbove === 'false' || alert.vwapAbove === false ? 'text-red-400 font-semibold' : 
                              'text-foreground';
            
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
            
            // Quad Stochastic Signal Display - showing D4 value
            let quadStochDisplay = '-';
            let quadStochClass = 'text-muted-foreground';
            let quadStochTitle = 'No D4 value available';
            
            const d4Val = alert.quadStochD4;
            
            if (d4Val !== undefined && d4Val !== null) {
              const d4Num = parseFloat(d4Val);
              quadStochDisplay = d4Num.toFixed(1);
              
              // Color coding based on D4 value
              if (d4Num >= 80) {
                quadStochClass = 'text-red-400 font-bold'; // Overbought
                quadStochTitle = \`D4: \${d4Num.toFixed(1)} (Overbought)\`;
              } else if (d4Num >= 50) {
                quadStochClass = 'text-green-400 font-semibold'; // Bullish
                quadStochTitle = \`D4: \${d4Num.toFixed(1)} (Bullish)\`;
              } else if (d4Num >= 20) {
                quadStochClass = 'text-yellow-400'; // Neutral
                quadStochTitle = \`D4: \${d4Num.toFixed(1)} (Neutral)\`;
              } else {
                quadStochClass = 'text-lime-400 font-semibold'; // Oversold
                quadStochTitle = \`D4: \${d4Num.toFixed(1)} (Oversold)\`;
              }
            }
            
            // QS Arrow Display - showing D1/D2/D3/D4 directions
            const d1Dir = alert.d1Direction || 'flat';
            const d2Dir = alert.d2Direction || 'flat';
            const d3Dir = alert.d3Direction || 'flat';
            const d4Dir = alert.d4Direction || 'flat';
            
            const getArrow = (dir) => {
              if (dir === 'up') return '↑';
              if (dir === 'down') return '↓';
              return '→';
            };
            
            const getArrowColor = (dir) => {
              if (dir === 'up') return 'text-green-400';
              if (dir === 'down') return 'text-red-400';
              return 'text-gray-400';
            };
            
            const qsArrowDisplay = \`
              <span class="\${getArrowColor(d1Dir)}">\${getArrow(d1Dir)}</span>
              <span class="\${getArrowColor(d2Dir)}">\${getArrow(d2Dir)}</span>
              <span class="\${getArrowColor(d3Dir)}">\${getArrow(d3Dir)}</span>
              <span class="\${getArrowColor(d4Dir)}">\${getArrow(d4Dir)}</span>
            \`;
            
            const qsArrowTitle = \`D1: \${d1Dir}, D2: \${d2Dir}, D3: \${d3Dir}, D4: \${d4Dir}\`;
            
            // Check if QS values changed recently (within last 2 minutes) and determine color
            const qsChangeAge = alert.qsChangeTimestamp ? (Date.now() - alert.qsChangeTimestamp) / 60000 : 999;
            const d4RecentlyChanged = alert.qsD4Changed && qsChangeAge <= 2;
            const directionRecentlyChanged = alert.qsDirectionChanged && qsChangeAge <= 2;
            
            // Color based on bullish/bearish change direction
            let qsD4CellClass = '';
            if (d4RecentlyChanged && alert.qsChangeDirection) {
              if (alert.qsChangeDirection === 'bullish') {
                qsD4CellClass = 'bg-green-900/50 animate-pulse';
              } else if (alert.qsChangeDirection === 'bearish') {
                qsD4CellClass = 'bg-red-900/50 animate-pulse';
              }
            }
            
            let qsArrowCellClass = '';
            if (directionRecentlyChanged && alert.qsArrowChangeDirection) {
              if (alert.qsArrowChangeDirection === 'bullish') {
                qsArrowCellClass = 'bg-green-900/50 animate-pulse';
              } else if (alert.qsArrowChangeDirection === 'bearish') {
                qsArrowCellClass = 'bg-red-900/50 animate-pulse';
              }
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
                <td class="py-3 px-4 font-mono \${vwapClass}" title="Price \${alert.vwapAbove === 'true' || alert.vwapAbove === true ? 'above' : 'below'} VWAP">
                  $\${alert.vwap ? parseFloat(alert.vwap).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : 'N/A'}
                  <span class="\${vwapDiffColor} text-sm">\${vwapDiffDisplay}</span>
                </td>
                <td class="py-3 px-4 font-bold \${positionClass}" title="VWAP Band Zone">\${alert.vwapRemark || 'N/A'}</td>
                <td class="py-3 px-4 font-bold \${remarkClass}" title="\${remarkDisplay === 'Crossing' ? 'VWAP Crossing Detected!' : 'No Recent VWAP Crossing'}">\${remarkDisplay}</td>
                <td class="py-3 px-4 font-bold \${quadStochClass}" title="\${quadStochTitle}">\${quadStochDisplay}</td>
                <td class="py-3 px-4 text-lg \${qsArrowCellClass}" title="\${qsArrowTitle}">\${qsArrowDisplay}</td>
                <td class="py-3 px-4 font-bold \${qstochClass} \${qsD4CellClass}" title="\${qstochTitle}">\${qstochDisplay}</td>
                <td class="py-3 px-4 font-mono \${rsiClass}" title="RSI\${alert.rsiTf ? ' [' + alert.rsiTf + ']' : ''}">\${alert.rsi ? parseFloat(alert.rsi).toFixed(1) : 'N/A'}</td>
                <td class="py-3 px-4 font-mono \${macdClass}" title="MACD Histogram\${alert.macdTf ? ' [' + alert.macdTf + ']' : ''}">\${alert.macdHistogram ? parseFloat(alert.macdHistogram).toFixed(3) : 'N/A'}</td>
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
