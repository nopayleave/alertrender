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

// Serve the main dashboard
app.get('/', (req, res) => {
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
    </style>
</head>
<body class="bg-gray-50 min-h-screen">
    <div class="container mx-auto px-4 py-8">
        <div class="mb-6 flex justify-between items-center">
            <h1 class="text-3xl font-bold text-gray-800">Stock Alert Dashboard</h1>
            <button onclick="fetchData()" class="refresh-btn bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold">
                🔄 Refresh Data
            </button>
        </div>
        
        <div id="loading" class="text-center py-8 hidden">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <p class="mt-2 text-gray-600">Loading stock data...</p>
        </div>
        
        <div id="error" class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 hidden"></div>
        
        <div id="tableContainer" class="bg-white rounded-lg shadow-lg overflow-hidden">
            <div class="overflow-x-auto">
                <table class="min-w-full">
                    <thead>
                        <tr class="bg-gray-100 text-sm font-semibold text-gray-700">
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
        
        <div id="lastUpdate" class="text-center text-gray-500 text-sm mt-4"></div>
    </div>

    <script>
        let stockData = [];

        // Get background color based on signal value
        function getBgColor(value) {
            if (value >= 250) return "bg-green-700 text-white";
            if (value >= 50) return "bg-green-200 text-gray-800";
            if (value > -50) return "bg-white text-gray-800";
            if (value >= -250) return "bg-red-200 text-gray-800";
            return "bg-red-700 text-white";
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
                        <td colspan="10" class="px-4 py-8 text-center text-gray-500">
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
                    <tr class="border-b hover:bg-gray-50 transition-colors">
                        <td class="px-4 py-3 font-bold text-gray-800">\${row.symbol || '-'}</td>
                        <td class="px-4 py-3 text-center">\${formatPrice(row.price)}</td>
                        <td class="px-4 py-3 text-center \${(row.priceChange || 0) >= 0 ? 'text-green-600' : 'text-red-600'}">\${formatPercentage(row.priceChange)}</td>
                        <td class="px-4 py-3 text-center text-sm">\${formatNumber(row.volume)}</td>
                        <td class="px-4 py-3 text-center text-sm">\${openDirection}</td>
                        <td class="px-4 py-3 text-center text-sm">\${openTrendDirection}</td>
                        <td class="px-4 py-3 text-center text-sm font-semibold \${getBgColor(row.s30sSignal || 0)}">\${row.s30sSignal || '-'}</td>
                        <td class="px-4 py-3 text-center text-sm font-semibold \${getBgColor(row.s1mSignal || 0)}">\${row.s1mSignal || '-'}</td>
                        <td class="px-4 py-3 text-center text-sm font-semibold \${getBgColor(row.s5mSignal || 0)}">\${row.s5mSignal || '-'}</td>
                        <td class="px-4 py-3 text-center text-sm">\${trendDirection}</td>
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
                lastUpdate.textContent = \`Last updated: \${new Date().toLocaleTimeString()}\`;
                
            } catch (err) {
                error.textContent = \`Error: \${err.message}\`;
                error.classList.remove('hidden');
                console.error('Error fetching data:', err);
            }
            
            loading.classList.add('hidden');
        }

        // Auto-refresh every 30 seconds
        setInterval(fetchData, 30000);
        
        // Initial load
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
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
});
