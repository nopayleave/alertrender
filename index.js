import express from 'express'
import cors from 'cors'

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// 儲存 alert JSON
let alerts = []

// Webhook for TradingView POST
app.post('/webhook', (req, res) => {
  const alert = req.body
  
  // Remove any existing alerts for the same symbol
  alerts = alerts.filter(existingAlert => existingAlert.symbol !== alert.symbol)
  
  // Add the new alert to the front
  alerts.unshift({
    ...alert,
    receivedAt: Date.now()
  })
  
  // 只保留最新 500 筆
  alerts = alerts.slice(0, 500)
  res.json({ status: 'ok' })
})

// API 俾前端 fetch
app.get('/alerts', (req, res) => {
  res.json(alerts)
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
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors sticky left-0 bg-card z-10 md:relative md:bg-transparent shadow-[2px_0_4px_rgba(0,0,0,0.1)] md:shadow-none w-auto whitespace-nowrap" onclick="sortTable('symbol')">
                      Ticker <span id="sort-symbol" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('price')">
                      Price <span id="sort-price" class="ml-1 text-xs">⇅</span>
                    </th>
                    <th class="text-left py-3 px-4 font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors" onclick="sortTable('priceChange')">
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
                    <td colspan="7" class="text-center text-muted-foreground py-12 relative">Loading alerts...</td>
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
        let currentSortField = null;
        let currentSortDirection = 'asc';
        let alertsData = [];
        
        // Search state
        let searchTerm = '';

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

        function getSortValue(alert, field) {
          switch(field) {
            case 'symbol':
              return alert.symbol || '';
            case 'price':
              return parseFloat(alert.price) || 0;
            case 'priceChange':
              return parseFloat(alert.priceChange) || 0;
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

        function renderTable() {
          const alertTable = document.getElementById('alertTable');
          const lastUpdate = document.getElementById('lastUpdate');
          
          if (alertsData.length === 0) {
            alertTable.innerHTML = '<tr><td colspan="7" class="text-center text-muted-foreground py-12 relative">No alerts available</td></tr>';
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

          // Sort filtered data
          if (currentSortField) {
            filteredData.sort((a, b) => {
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
            alertTable.innerHTML = '<tr><td colspan="7" class="text-center text-muted-foreground py-12 relative">No tickers match your search</td></tr>';
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
            return \`
              <tr class="border-b border-border hover:bg-muted/50 transition-colors">
                <td class="py-3 px-4 font-medium text-foreground sticky left-0 bg-card z-10 md:relative md:bg-transparent shadow-[2px_0_4px_rgba(0,0,0,0.1)] md:shadow-none w-auto whitespace-nowrap">\${alert.symbol || 'N/A'}</td>
                <td class="py-3 px-4 font-mono font-medium text-foreground">$\${alert.price ? parseFloat(alert.price).toLocaleString() : 'N/A'}</td>
                <td class="py-3 px-4 font-mono font-medium" style="\${parseFloat(alert.priceChange || 0) >= 0 ? 'color: oklch(0.75 0.15 163);' : 'color: oklch(0.7 0.25 25.331);'}">\${alert.priceChange || 'N/A'}%</td>
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
            document.getElementById('alertTable').innerHTML = '<tr><td colspan="7" class="text-center text-red-400 py-12 relative">Error loading alerts</td></tr>';
          }
        }

        // Fetch alerts every 2 seconds
        setInterval(fetchAlerts, 2000);
        fetchAlerts();
      </script>
    </body>
    </html>
  `)
})

app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})
