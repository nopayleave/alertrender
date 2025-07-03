import express from 'express';
import path from 'path';
import fs from 'fs';
const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Store webhook data
let stockData = [];

// Sample data for demonstration
const sampleData = [
  {
    symbol: "AAPL",
    price: 150.25,
    priceChange: 2.35,
    volume: 1250000,
    "2m930signal": 45,
    "2m932signal": 52,
    "2m1000signal": 48,
    s30sSignal: 75,
    s1mSignal: -100,
    s5mSignal: 300,
    sk2mDiff: 5.2
  },
  {
    symbol: "TSLA",
    price: 248.90,
    priceChange: -1.85,
    volume: 890000,
    "2m930signal": 30,
    "2m932signal": 25,
    "2m1000signal": 35,
    s30sSignal: -180,
    s1mSignal: 120,
    s5mSignal: -300,
    sk2mDiff: -2.1
  },
  {
    symbol: "MSFT",
    price: 338.15,
    priceChange: 0.95,
    volume: 675000,
    "2m930signal": 60,
    "2m932signal": 58,
    "2m1000signal": 65,
    s30sSignal: 280,
    s1mSignal: 45,
    s5mSignal: -75,
    sk2mDiff: 1.8
  }
];

// Initialize with sample data
stockData = sampleData;

// Webhook endpoint to receive data from Pine Script
app.post('/webhook', (req, res) => {
  console.log('Received webhook data:', req.body);
  
  try {
    // Parse the webhook data
    const data = req.body;
    
    // Find existing stock or add new one
    const existingIndex = stockData.findIndex(stock => stock.symbol === data.symbol);
    
    if (existingIndex !== -1) {
      stockData[existingIndex] = { ...stockData[existingIndex], ...data };
    } else {
      stockData.push(data);
    }
    
    console.log('Updated stock data:', stockData);
    res.status(200).json({ message: 'Data received successfully' });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to get stock data
app.get('/api/webhook-data', (req, res) => {
  res.json(stockData);
});

// Reset endpoint to clear all stock data
app.delete('/api/reset-data', (req, res) => {
  console.log('Resetting stock data...');
  stockData = sampleData; // Reset to sample data
  console.log('Stock data reset to sample data');
  res.json({ message: 'Stock data has been reset to sample data', count: stockData.length });
});

// Serve the main dashboard
app.get('/', (req, res) => {
  res.redirect('/alerts');
});

// Serve the alerts dashboard
app.get('/alerts', (req, res) => {
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Stock Alert Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
         <style>
         .refresh-btn {
             transition: transform 0.2s ease;
         }
         .refresh-btn:hover {
             transform: scale(1.05);
         }
         
         /* Dark theme overrides */
         body.dark {
             background-color: #0f172a;
             color: #e2e8f0;
         }
         
         .dark-card {
             background-color: #1e293b;
             border: 1px solid #334155;
         }
         
         .dark-table-header {
             background-color: #334155;
             color: #f1f5f9;
         }
         
         .dark-table-row:hover {
             background-color: #475569;
         }
         
         .dark-table-row-alt {
             background-color: #1e293b;
         }
         
         .dark-loading {
             background-color: #1e293b;
             border: 1px solid #334155;
         }
         
         /* Signal color overrides for dark theme */
         .signal-green-light-dark {
             background-color: #065f46;
             color: #d1fae5;
         }
         
         .signal-green-dark-dark {
             background-color: #064e3b;
             color: #a7f3d0;
         }
         
         .signal-white-dark {
             background-color: #374151;
             color: #f3f4f6;
         }
         
         .signal-red-light-dark {
             background-color: #7f1d1d;
             color: #fecaca;
         }
         
         .signal-red-dark-dark {
             background-color: #991b1b;
             color: #fca5a5;
         }
     </style>
 </head>
 <body class="dark bg-gray-900 min-h-screen text-gray-100">
         <div class="container mx-auto px-4 py-8">
         <div class="mb-6 flex justify-between items-center">
             <h1 class="text-3xl font-bold text-gray-100">Stock Alert Dashboard</h1>
             <div class="flex gap-3">
                 <button onclick="resetData()" class="refresh-btn bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-semibold shadow-lg">
                     🗑️ Reset Data
                 </button>
                 <button onclick="fetchData()" class="refresh-btn bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold shadow-lg">
                     🔄 Refresh Data
                 </button>
             </div>
         </div>
         
         <div id="loading" class="text-center py-8 hidden dark-loading rounded-lg">
             <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
             <p class="mt-2 text-gray-300">Loading stock data...</p>
         </div>
         
         <div id="error" class="bg-red-900 border border-red-600 text-red-200 px-4 py-3 rounded mb-4 hidden"></div>
         
         <div id="tableContainer" class="dark-card rounded-lg shadow-xl overflow-hidden">
             <div class="overflow-x-auto">
                 <table class="min-w-full">
                     <thead>
                         <tr class="dark-table-header text-sm font-semibold">
                             <th class="px-4 py-3 text-left">Ticker</th>
                             <th class="px-4 py-3 text-center">Price</th>
                             <th class="px-4 py-3 text-center">Chg%</th>
                             <th class="px-4 py-3 text-center">Vol</th>
                             <th class="px-4 py-3 text-center">Open</th>
                             <th class="px-4 py-3 text-center">Open Trend</th>
                             <th class="px-4 py-3 text-center">S30s</th>
                             <th class="px-4 py-3 text-center">S1m</th>
                             <th class="px-4 py-3 text-center">S5m</th>
                             <th class="px-4 py-3 text-center">Trend</th>
                         </tr>
                     </thead>
                     <tbody id="tableBody">
                         <!-- Data will be populated here -->
                     </tbody>
                 </table>
             </div>
         </div>
         
         <div id="lastUpdate" class="text-center text-gray-400 text-sm mt-4"></div>
     </div>

    <script>
        let stockData = [];

        // Get background color based on signal value (dark theme)
        function getBgColor(value) {
            if (value >= 250) return "signal-green-dark-dark";
            if (value >= 50) return "signal-green-light-dark";
            if (value > -50) return "signal-white-dark";
            if (value >= -250) return "signal-red-light-dark";
            return "signal-red-dark-dark";
        }

        // Format trend direction
        function getTrendDirection(value) {
            if (value > 0) return "↑ Up";
            if (value < 0) return "↓ Down";
            return "- Flat";
        }

        // Format number with commas
        function formatNumber(num) {
            return num?.toLocaleString() || '-';
        }

        // Format price to 2 decimal places
        function formatPrice(price) {
            return price?.toFixed(2) || '-';
        }

        // Format percentage to 2 decimal places
        function formatPercentage(pct) {
            return pct?.toFixed(2) + '%' || '-';
        }

        // Render table with stock data
        function renderTable() {
            const tableBody = document.getElementById('tableBody');
            
            if (stockData.length === 0) {
                tableBody.innerHTML = \`
                    <tr>
                        <td colspan="10" class="px-4 py-8 text-center text-gray-400">
                            No stock data available. Click "Refresh Data" to load data.
                        </td>
                    </tr>
                \`;
                return;
            }

            tableBody.innerHTML = stockData.map(row => {
                // Calculate Open: 2m932signal - 2m930signal
                const openValue = (row["2m932signal"] || 0) - (row["2m930signal"] || 0);
                const openDirection = getTrendDirection(openValue);
                
                // Calculate Open Trend: 2m1000signal - 2m932signal
                const openTrendValue = (row["2m1000signal"] || 0) - (row["2m932signal"] || 0);
                const openTrendDirection = getTrendDirection(openTrendValue);
                
                // Calculate Trend from sk2mDiff
                const trendDirection = getTrendDirection(row.sk2mDiff || 0);

                return \`
                    <tr class="dark-table-row border-b border-gray-700 hover:bg-gray-700 transition-colors">
                        <td class="px-4 py-3 font-bold text-gray-100">\${row.symbol || '-'}</td>
                        <td class="px-4 py-3 text-center text-gray-200">\${formatPrice(row.price)}</td>
                        <td class="px-4 py-3 text-center \${(row.priceChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'}">\${formatPercentage(row.priceChange)}</td>
                        <td class="px-4 py-3 text-center text-sm text-gray-300">\${formatNumber(row.volume)}</td>
                        <td class="px-4 py-3 text-center text-sm text-gray-300">\${openDirection}</td>
                        <td class="px-4 py-3 text-center text-sm text-gray-300">\${openTrendDirection}</td>
                        <td class="px-4 py-3 text-center text-sm font-semibold \${getBgColor(row.s30sSignal || 0)} rounded">\${row.s30sSignal || '-'}</td>
                        <td class="px-4 py-3 text-center text-sm font-semibold \${getBgColor(row.s1mSignal || 0)} rounded">\${row.s1mSignal || '-'}</td>
                        <td class="px-4 py-3 text-center text-sm font-semibold \${getBgColor(row.s5mSignal || 0)} rounded">\${row.s5mSignal || '-'}</td>
                        <td class="px-4 py-3 text-center text-sm text-gray-300">\${trendDirection}</td>
                    </tr>
                \`;
            }).join('');
        }

        // Fetch data from API endpoint
        async function fetchData() {
            const loading = document.getElementById('loading');
            const error = document.getElementById('error');
            const lastUpdate = document.getElementById('lastUpdate');
            
            loading.classList.remove('hidden');
            error.classList.add('hidden');
            
            try {
                const response = await fetch('/api/webhook-data');
                
                if (!response.ok) {
                    throw new Error('Failed to fetch data');
                }
                
                const data = await response.json();
                stockData = Array.isArray(data) ? data : [data];
                
                renderTable();
                lastUpdate.textContent = 'Last updated: ' + new Date().toLocaleTimeString();
                
            } catch (err) {
                // If API fails, show sample data
                stockData = [
                    {
                        symbol: "AAPL",
                        price: 150.25,
                        priceChange: 2.35,
                        volume: 1250000,
                        "2m930signal": 45,
                        "2m932signal": 52,
                        "2m1000signal": 48,
                        s30sSignal: 75,
                        s1mSignal: -100,
                        s5mSignal: 300,
                        sk2mDiff: 5.2
                    },
                    {
                        symbol: "TSLA",
                        price: 248.90,
                        priceChange: -1.85,
                        volume: 890000,
                        "2m930signal": 30,
                        "2m932signal": 25,
                        "2m1000signal": 35,
                        s30sSignal: -180,
                        s1mSignal: 120,
                        s5mSignal: -300,
                        sk2mDiff: -2.1
                    },
                    {
                        symbol: "MSFT",
                        price: 338.15,
                        priceChange: 0.95,
                        volume: 675000,
                        "2m930signal": 60,
                        "2m932signal": 58,
                        "2m1000signal": 65,
                        s30sSignal: 280,
                        s1mSignal: 45,
                        s5mSignal: -75,
                        sk2mDiff: 1.8
                    }
                ];
                
                renderTable();
                error.textContent = 'Using sample data. API Error: ' + err.message;
                error.classList.remove('hidden');
                lastUpdate.textContent = 'Sample data loaded: ' + new Date().toLocaleTimeString();
                console.error('Error fetching data:', err);
            }
            
            loading.classList.add('hidden');
        }

        // Reset data function
        async function resetData() {
            const loading = document.getElementById('loading');
            const error = document.getElementById('error');
            const lastUpdate = document.getElementById('lastUpdate');
            
            if (!confirm('Are you sure you want to reset all stock data? This will clear all webhook data and reset to sample data.')) {
                return;
            }
            
            loading.classList.remove('hidden');
            error.classList.add('hidden');
            
            try {
                const response = await fetch('/api/reset-data', {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                if (!response.ok) {
                    throw new Error('Failed to reset data');
                }
                
                const result = await response.json();
                
                // Refresh the display
                await fetchData();
                
                lastUpdate.textContent = 'Data reset successful: ' + new Date().toLocaleTimeString();
                
                // Show success message
                error.textContent = result.message + ' (' + result.count + ' sample records)';
                error.classList.remove('hidden');
                error.classList.remove('bg-red-900', 'border-red-600', 'text-red-200');
                error.classList.add('bg-green-900', 'border-green-600', 'text-green-200');
                
                // Hide success message after 3 seconds
                setTimeout(() => {
                    error.classList.add('hidden');
                    error.classList.remove('bg-green-900', 'border-green-600', 'text-green-200');
                    error.classList.add('bg-red-900', 'border-red-600', 'text-red-200');
                }, 3000);
                
            } catch (err) {
                error.textContent = 'Reset failed: ' + err.message;
                error.classList.remove('hidden');
                console.error('Error resetting data:', err);
            }
            
            loading.classList.add('hidden');
        }

        // Initialize with sample data immediately
        stockData = [
            {
                symbol: "AAPL",
                price: 150.25,
                priceChange: 2.35,
                volume: 1250000,
                "2m930signal": 45,
                "2m932signal": 52,
                "2m1000signal": 48,
                s30sSignal: 75,
                s1mSignal: -100,
                s5mSignal: 300,
                sk2mDiff: 5.2
            },
            {
                symbol: "TSLA",
                price: 248.90,
                priceChange: -1.85,
                volume: 890000,
                "2m930signal": 30,
                "2m932signal": 25,
                "2m1000signal": 35,
                s30sSignal: -180,
                s1mSignal: 120,
                s5mSignal: -300,
                sk2mDiff: -2.1
            },
            {
                symbol: "MSFT",
                price: 338.15,
                priceChange: 0.95,
                volume: 675000,
                "2m930signal": 60,
                "2m932signal": 58,
                "2m1000signal": 65,
                s30sSignal: 280,
                s1mSignal: 45,
                s5mSignal: -75,
                sk2mDiff: 1.8
            }
        ];
        
        // Show table immediately
        renderTable();
        document.getElementById('lastUpdate').textContent = 'Sample data loaded: ' + new Date().toLocaleTimeString();
        
        // Auto-refresh every 30 seconds
        setInterval(fetchData, 30000);
        
        // Initial fetch (will update sample data if API is available)
        fetchData();
    </script>
</body>
</html>
  `;
  
  res.send(htmlContent);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/alerts`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`API endpoint: http://localhost:${PORT}/api/webhook-data`);
});
