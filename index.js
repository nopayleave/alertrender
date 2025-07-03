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
  // 可加資料驗證/防重覆
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
    <html lang="en" data-theme="dim">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Alert Dashboard</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.10/dist/full.min.css" rel="stylesheet" type="text/css" />
      <script>
        tailwind.config = {
          theme: {
            extend: {}
          }
        }
      </script>
    </head>
    <body class="bg-base-100 min-h-screen">
      <div class="container mx-auto p-6">
        <div class="mb-6">
          <h1 class="text-3xl font-bold text-base-content mb-2">Trading Alert Dashboard</h1>
          <p class="text-base-content/70">Real-time alert data with color-coded price changes</p>
        </div>
        
        <div class="card bg-base-200 shadow-xl">
          <div class="card-body">
            <div class="flex justify-between items-center mb-4">
              <h2 class="card-title text-base-content">Active Alerts</h2>
              <div class="badge badge-primary" id="alertCount">0 alerts</div>
            </div>
            
            <div class="overflow-x-auto">
              <table class="table table-zebra w-full">
                <thead>
                  <tr>
                    <th class="text-base-content">Ticker</th>
                    <th class="text-base-content">Price</th>
                    <th class="text-base-content">Chg%</th>
                    <th class="text-base-content">Vol</th>
                    <th class="text-base-content">S30s</th>
                    <th class="text-base-content">S1m</th>
                    <th class="text-base-content">S5m</th>
                  </tr>
                </thead>
                <tbody id="alertTable">
                  <tr>
                    <td colspan="7" class="text-center text-base-content/50 py-8">Loading alerts...</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
        
        <div class="mt-6 text-center">
          <div class="text-sm text-base-content/70" id="lastUpdate">Last updated: Never</div>
        </div>
      </div>

      <script>
        function formatVolume(vol) {
          if (!vol || vol === 0) return 'N/A';
          if (vol >= 1000000) return (vol / 1000000).toFixed(1) + 'M';
          if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K';
          return vol.toString();
        }

        function getBackgroundColor(changePercent) {
          const change = parseFloat(changePercent);
          if (isNaN(change)) return '';
          
          if (change >= 250) return 'bg-green-800'; // Deep green
          if (change >= 50) return 'bg-green-300'; // Light green
          if (change >= -50) return 'bg-base-100'; // White/default
          if (change >= -250) return 'bg-red-300'; // Light red
          return 'bg-red-800'; // Deep red
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
              alertTable.innerHTML = '<tr><td colspan="7" class="text-center text-base-content/50 py-8">No alerts available</td></tr>';
              alertCount.textContent = '0 alerts';
              lastUpdate.textContent = 'Last updated: Never';
              return;
            }
            
            alertCount.textContent = data.length + ' alert' + (data.length > 1 ? 's' : '');
            
            // Update last update time
            const mostRecent = Math.max(...data.map(alert => alert.receivedAt || 0));
            lastUpdate.textContent = 'Last updated: ' + new Date(mostRecent).toLocaleString();
            
            alertTable.innerHTML = data.map(alert => {
              const bgColor = getBackgroundColor(alert.priceChange);
              return \`
                <tr class="\${bgColor}">
                  <td class="font-bold">\${alert.symbol || 'N/A'}</td>
                  <td>$\${alert.price ? parseFloat(alert.price).toLocaleString() : 'N/A'}</td>
                  <td class="\${parseFloat(alert.priceChange || 0) >= 0 ? 'text-green-600' : 'text-red-600'}">\${alert.priceChange || 'N/A'}%</td>
                  <td>\${formatVolume(alert.volume)}</td>
                  <td>\${formatSignal(alert.s30_signal)}</td>
                  <td>\${formatSignal(alert.s1m_signal)}</td>
                  <td>\${formatSignal(alert.s5m_signal)}</td>
                </tr>
              \`;
            }).join('');
            
          } catch (error) {
            console.error('Error fetching alerts:', error);
            document.getElementById('alertTable').innerHTML = '<tr><td colspan="7" class="text-center text-error py-8">Error loading alerts</td></tr>';
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
