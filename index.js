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
  
  // Store in full history (all alerts)
  alertsHistory.unshift({
    ...alert,
    receivedAt: Date.now()
  })
  
  // Detect alert type:
  // - Day script: contains changeFromPrevDay and volume but missing price (handles Chg% and Vol columns)
  // - Main script (again.pine): contains price and signals (handles Price and Signal columns)
  const isDayChangeAlert = alert.changeFromPrevDay !== undefined && !alert.price
  
  if (isDayChangeAlert) {
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
  } else {
    // Main script alert (again.pine) - store ALL records, merge with any existing day data
    const alertData = { ...alert }
    
    // Add day change data if available from Day script
    if (dayChangeData[alert.symbol] !== undefined) {
      alertData.changeFromPrevDay = dayChangeData[alert.symbol]
    }
    
    // Add volume data if available from Day script
    if (dayVolumeData[alert.symbol] !== undefined) {
      alertData.volume = dayVolumeData[alert.symbol]
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

// New endpoint to reset/clear all alerts
app.post('/reset-alerts', (req, res) => {
  alerts = []
  alertsHistory = []
  dayChangeData = {}
  dayVolumeData = {}
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
    </head>
    <body class="bg-background min-h-screen pb-20 md:pb-0 md:pt-20">
      <div class="container mx-auto p-6 max-w-7xl">
        <div class="mb-8">
          <h1 class="scroll-m-20 text-4xl font-extrabold tracking-tight text-foreground mb-2">Trading Alert Dashboard</h1>
          <p class="text-muted-foreground text-xl leading-7">Real-time alert data with color-coded price changes</p>
        </div>
        
        <!-- Reset button - top right -->
        <div class="fixed top-4 right-4 z-50">
          <button 
            id="resetButton" 
            onclick="resetAlerts()" 
            class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg shadow-lg transition-colors duration-200 flex items-center gap-2"
            title="Clear all alerts"
          >
            <span>🗑️</span>
            <span class="hidden sm:inline">Reset</span>
          </button>
        </div>
        
        <!-- Search bar - sticky on top for desktop, bottom for mobile -->
        <div class="fixed md:sticky top-auto md:top-0 bottom-0 md:bottom-auto left-0 right-0 z-50 bg-background border-t md:border-t-0 md:border-b border-border p-4 md:p-6">
          <div class="container mx-auto max-w-7xl">
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
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('priceChange')" title="Price change % from previous trading day">
                      Chg% <span id="sort-priceChange" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('volume')">
                      Vol <span id="sort-volume" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('s30_signal')">
                      S30s <span id="sort-s30_signal" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('s1m_signal')">
                      S1m <span id="sort-s1m_signal" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('s5m_signal')">
                      S5m <span id="sort-s5m_signal" class="ml-1 text-xs">⇅</span>
                    </th>
                  </tr>
                </thead>
                <tbody id="alertTable">
                  <tr>
                    <td colspan="8" class="text-center text-muted-foreground py-12 relative">Loading alerts...</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        
        <div class="mt-6 text-center">
          <p class="text-sm text-muted-foreground" id="lastUpdate">Last updated: Never</p>
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

        function formatVolume(vol) {
          if (!vol || vol === 0) return 'N/A';
          if (vol >= 1000000) return (vol / 1000000).toFixed(1) + 'M';
          if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K';
          return vol.toString();
        }

        function getSignalLabelClass(signal) {
          const value = parseFloat(signal);
          if (isNaN(value)) return 'px-2 py-1 text-xs font-semibold bg-muted text-muted-foreground rounded';
          
          if (value >= 250) return 'px-2 py-1 text-xs font-semibold rounded'; // Deep green
          if (value >= 50) return 'px-2 py-1 text-xs font-semibold rounded'; // Light green
          if (value >= -50) return 'px-2 py-1 text-xs font-semibold bg-gray-600 text-gray-100 rounded'; // Dark grey
          if (value >= -250) return 'px-2 py-1 text-xs font-semibold rounded'; // Light red
          return 'px-2 py-1 text-xs font-semibold rounded'; // Deep red
        }

        function getSignalBgColor(signal) {
          const value = parseFloat(signal);
          if (isNaN(value)) return '';
          
          if (value >= 250) return 'background-color: oklch(0.6 0.15 163); color: white;'; // Deep green
          if (value >= 50) return 'background-color: oklch(0.5 0.1 163); color: white;'; // Medium green
          if (value >= -50) return ''; // Light grey (default)
          if (value >= -250) return 'background-color: oklch(0.5 0.15 25.331); color: white;'; // Medium red
          return 'background-color: oklch(0.4 0.2 25.331); color: white;'; // Deep red
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
          const indicators = ['symbol', 'price', 'priceChange', 'volume', 's30_signal', 's1m_signal', 's5m_signal'];
          indicators.forEach(field => {
            document.getElementById('sort-' + field).textContent = '⇅';
          });
          
          // Set current sort indicator
          if (currentSortField) {
            const indicator = document.getElementById('sort-' + currentSortField);
            indicator.textContent = currentSortDirection === 'asc' ? '↑' : '↓';
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
            case 's30_signal':
              return parseFloat(alert.s30_signal) || 0;
            case 's1m_signal':
              return parseFloat(alert.s1m_signal) || 0;
            case 's5m_signal':
              return parseFloat(alert.s5m_signal) || 0;
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

        function renderTable() {
          const alertTable = document.getElementById('alertTable');
          const lastUpdate = document.getElementById('lastUpdate');
          
          if (alertsData.length === 0) {
            alertTable.innerHTML = '<tr><td colspan="8" class="text-center text-muted-foreground py-12 relative">No alerts available</td></tr>';
            lastUpdate.textContent = 'Last updated: Never';
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
            alertTable.innerHTML = '<tr><td colspan="8" class="text-center text-muted-foreground py-12 relative">No tickers match your search</td></tr>';
            lastUpdate.textContent = 'Last updated: ' + new Date(Math.max(...alertsData.map(alert => alert.receivedAt || 0))).toLocaleString();
            return;
          }

          // Update last update time with search info
          const mostRecent = Math.max(...alertsData.map(alert => alert.receivedAt || 0));
          const searchInfo = searchTerm ? \` • Showing \${filteredData.length} of \${alertsData.length}\` : '';
          lastUpdate.textContent = 'Last updated: ' + new Date(mostRecent).toLocaleString() + searchInfo;

          alertTable.innerHTML = filteredData.map(alert => {
            const s30sClass = getSignalLabelClass(alert.s30_signal);
            const s1mClass = getSignalLabelClass(alert.s1m_signal);
            const s5mClass = getSignalLabelClass(alert.s5m_signal);
            const s30sStyle = getSignalBgColor(alert.s30_signal);
            const s1mStyle = getSignalBgColor(alert.s1m_signal);
            const s5mStyle = getSignalBgColor(alert.s5m_signal);
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
                <td class="py-3 px-4 font-mono font-medium text-foreground">$\${alert.price ? parseFloat(alert.price).toLocaleString() : 'N/A'}</td>
                <td class="py-3 px-4 font-mono font-medium" style="\${priceChangeColor}">\${priceChangeDisplay}%</td>
                <td class="py-3 px-4 text-muted-foreground">\${formatVolume(alert.volume)}</td>
                <td class="py-3 px-4"><span class="\${s30sClass}" style="\${s30sStyle}">\${formatSignal(alert.s30_signal)}</span></td>
                <td class="py-3 px-4"><span class="\${s1mClass}" style="\${s1mStyle}">\${formatSignal(alert.s1m_signal)}</span></td>
                <td class="py-3 px-4"><span class="\${s5mClass}" style="\${s5mStyle}">\${formatSignal(alert.s5m_signal)}</span></td>
              </tr>
            \`;
          }).join('');
        }

        function formatSignal(signal) {
          if (!signal && signal !== 0) return 'N/A';
          return Math.round(parseFloat(signal)).toString();
        }

        async function fetchAlerts() {
          try {
            const response = await fetch('/alerts');
            const data = await response.json();
            
            alertsData = data;
            renderTable();
            
          } catch (error) {
            console.error('Error fetching alerts:', error);
            document.getElementById('alertTable').innerHTML = '<tr><td colspan="8" class="text-center text-red-400 py-12 relative">Error loading alerts</td></tr>';
          }
        }

        async function resetAlerts() {
          if (confirm('Are you sure you want to clear all alerts? This cannot be undone.')) {
            try {
              const response = await fetch('/reset-alerts', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                }
              });
              
              if (response.ok) {
                alertsData = [];
                renderTable();
                alert('All alerts have been cleared successfully!');
              } else {
                alert('Failed to clear alerts. Please try again.');
              }
            } catch (error) {
              console.error('Error clearing alerts:', error);
              alert('Error clearing alerts. Please try again.');
            }
          }
        }

        // Fetch alerts once on page load
        fetchAlerts();
      </script>
    </body>
    </html>
  `)
})

app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})
