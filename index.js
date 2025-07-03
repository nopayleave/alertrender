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
                border: "hsl(214.3 31.8% 91.4%)",
                input: "hsl(214.3 31.8% 91.4%)",
                ring: "hsl(222.2 84% 4.9%)",
                background: "hsl(0 0% 100%)",
                foreground: "hsl(222.2 84% 4.9%)",
                primary: {
                  DEFAULT: "hsl(222.2 47.4% 11.2%)",
                  foreground: "hsl(210 40% 98%)",
                },
                secondary: {
                  DEFAULT: "hsl(210 40% 96%)",
                  foreground: "hsl(222.2 84% 4.9%)",
                },
                muted: {
                  DEFAULT: "hsl(210 40% 96%)",
                  foreground: "hsl(215.4 16.3% 46.9%)",
                },
                accent: {
                  DEFAULT: "hsl(210 40% 96%)",
                  foreground: "hsl(222.2 84% 4.9%)",
                },
                card: {
                  DEFAULT: "hsl(0 0% 100%)",
                  foreground: "hsl(222.2 84% 4.9%)",
                },
              }
            }
          }
        }
      </script>
    </head>
    <body class="bg-background min-h-screen">
      <div class="container mx-auto p-6 max-w-7xl">
        <div class="mb-8">
          <h1 class="text-4xl font-bold text-foreground mb-2">Trading Alert Dashboard</h1>
          <p class="text-muted-foreground text-lg">Real-time alert data with color-coded price changes</p>
        </div>
        
        <div class="bg-card rounded-lg border border-border shadow-sm">
          <div class="p-6">

            
            <div class="overflow-x-auto">
              <table class="w-full">
                <thead>
                  <tr class="border-b border-border">
                    <th class="text-left py-3 px-4 font-medium text-muted-foreground">Ticker</th>
                    <th class="text-left py-3 px-4 font-medium text-muted-foreground">Price</th>
                    <th class="text-left py-3 px-4 font-medium text-muted-foreground">Chg%</th>
                    <th class="text-left py-3 px-4 font-medium text-muted-foreground">Vol</th>
                    <th class="text-left py-3 px-4 font-medium text-muted-foreground">S30s</th>
                    <th class="text-left py-3 px-4 font-medium text-muted-foreground">S1m</th>
                    <th class="text-left py-3 px-4 font-medium text-muted-foreground">S5m</th>
                  </tr>
                </thead>
                <tbody id="alertTable">
                  <tr>
                    <td colspan="7" class="text-center text-muted-foreground py-12">Loading alerts...</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        
        <div class="mt-6 text-center">
          <div class="text-sm text-muted-foreground" id="lastUpdate">Last updated: Never</div>
        </div>
      </div>

      <script>
        function formatVolume(vol) {
          if (!vol || vol === 0) return 'N/A';
          if (vol >= 1000000) return (vol / 1000000).toFixed(1) + 'M';
          if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K';
          return vol.toString();
        }

        function getSignalLabelClass(signal) {
          const value = parseFloat(signal);
          if (isNaN(value)) return 'px-2 py-1 text-xs font-medium bg-muted text-muted-foreground rounded';
          
          if (value >= 250) return 'px-2 py-1 text-xs font-medium rounded'; // Deep green
          if (value >= 50) return 'px-2 py-1 text-xs font-medium rounded'; // Light green
          if (value >= -50) return 'px-2 py-1 text-xs font-medium bg-gray-200 text-gray-700 rounded'; // Light grey
          if (value >= -250) return 'px-2 py-1 text-xs font-medium rounded'; // Light red
          return 'px-2 py-1 text-xs font-medium rounded'; // Deep red
        }

        function getSignalBgColor(signal) {
          const value = parseFloat(signal);
          if (isNaN(value)) return '';
          
          if (value >= 250) return 'background-color: oklch(0.7 0.1 163); color: black;'; // Deep green
          if (value >= 50) return 'background-color: oklch(0.85 0.05 163); color: black;'; // Light green
          if (value >= -50) return ''; // Light grey (default)
          if (value >= -250) return 'background-color: oklch(0.8 0.12 25.331); color: black;'; // Light red
          return 'background-color: oklch(0.637 0.237 25.331); color: white;'; // Deep red
        }

        function formatSignal(signal) {
          if (!signal && signal !== 0) return 'N/A';
          return parseFloat(signal).toFixed(2);
        }

        async function fetchAlerts() {
          try {
            const response = await fetch('/alerts');
            const data = await response.json();
            
            const alertTable = document.getElementById('alertTable');
            const alertCount = document.getElementById('alertCount');
            const lastUpdate = document.getElementById('lastUpdate');
            
            if (data.length === 0) {
              alertTable.innerHTML = '<tr><td colspan="7" class="text-center text-muted-foreground py-12">No alerts available</td></tr>';
              alertCount.textContent = '0 alerts';
              lastUpdate.textContent = 'Last updated: Never';
              return;
            }
            
            alertCount.textContent = data.length + ' alert' + (data.length > 1 ? 's' : '');
            
            // Update last update time
            const mostRecent = Math.max(...data.map(alert => alert.receivedAt || 0));
            lastUpdate.textContent = 'Last updated: ' + new Date(mostRecent).toLocaleString();
            
            alertTable.innerHTML = data.map(alert => {
              const s30sClass = getSignalLabelClass(alert.s30_signal);
              const s1mClass = getSignalLabelClass(alert.s1m_signal);
              const s5mClass = getSignalLabelClass(alert.s5m_signal);
              const s30sStyle = getSignalBgColor(alert.s30_signal);
              const s1mStyle = getSignalBgColor(alert.s1m_signal);
              const s5mStyle = getSignalBgColor(alert.s5m_signal);
              return \`
                <tr class="border-b border-border hover:bg-muted/50 transition-colors">
                  <td class="py-3 px-4 font-semibold text-foreground">\${alert.symbol || 'N/A'}</td>
                  <td class="py-3 px-4 font-mono text-foreground">$\${alert.price ? parseFloat(alert.price).toLocaleString() : 'N/A'}</td>
                  <td class="py-3 px-4 font-mono \${parseFloat(alert.priceChange || 0) >= 0 ? 'text-green-600' : 'text-red-600'}">\${alert.priceChange || 'N/A'}%</td>
                  <td class="py-3 px-4 text-muted-foreground">\${formatVolume(alert.volume)}</td>
                  <td class="py-3 px-4"><span class="\${s30sClass}" style="\${s30sStyle}">\${formatSignal(alert.s30_signal)}</span></td>
                  <td class="py-3 px-4"><span class="\${s1mClass}" style="\${s1mStyle}">\${formatSignal(alert.s1m_signal)}</span></td>
                  <td class="py-3 px-4"><span class="\${s5mClass}" style="\${s5mStyle}">\${formatSignal(alert.s5m_signal)}</span></td>
                </tr>
              \`;
            }).join('');
            
          } catch (error) {
            console.error('Error fetching alerts:', error);
            document.getElementById('alertTable').innerHTML = '<tr><td colspan="7" class="text-center text-red-600 py-12">Error loading alerts</td></tr>';
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
