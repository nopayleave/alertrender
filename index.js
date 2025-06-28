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
<div class="max-w-4xl mx-auto mt-10 p-6 bg-gray-800 rounded-xl shadow-lg">
  <div class="flex justify-between items-center mb-4">
    <h2 class="text-xl font-semibold">Live Alerts Feed</h2>
    <span id="alertCount" class="text-sm bg-gray-700 px-2 py-1 rounded">0 alerts</span>
  </div>
  <table class="min-w-full table-auto">
    <thead class="text-xs uppercase tracking-wider text-gray-400 border-b border-gray-700">
      <tr>
        <th class="py-3 text-left">Ticker</th>
        <th class="py-3 text-left">Action</th>
        <th class="py-3 text-left">Price</th>
        <th class="py-3 text-left">Message</th>
        <th class="py-3 text-left">Timestamp</th>
      </tr>
    </thead>
    <tbody id="alertsTable" class="divide-y divide-gray-700"></tbody>
  </table>
</div>
<script>
async function fetchAlerts() {
  const res = await fetch('/alerts')
  const data = await res.json()
  const table = document.getElementById('alertsTable')
  const count = document.getElementById('alertCount')
  count.textContent = data.length + ' alerts'
  table.innerHTML = data.map(row => {
    const actionClass = row.signal === 'Bullish' ? 'bg-green-600 text-green-100' : 'bg-red-600 text-red-100'
    const arrow = row.signal === 'Bullish' ? '↑ BUY' : '↓ SELL'
    return \`
      <tr>
        <td class="py-2 font-semibold">\${row.symbol}</td>
        <td class="py-2"><span class="px-2 py-1 rounded-full \${actionClass}">\${arrow}</span></td>
        <td class="py-2">\${parseFloat(row.price).toLocaleString()}</td>
        <td class="py-2 text-gray-400">\${row.condition}</td>
        <td class="py-2 text-sm">\${new Date(parseInt(row.time)).toLocaleTimeString()}</td>
      </tr>
    \`
  }).join('')
}
setInterval(fetchAlerts, 2000)
fetchAlerts()
</script>
</body>
</html>
  `)
})

app.post('/webhook', (req, res) => {
  const alert = req.body
  console.log('Received alert:', alert)
  alerts.unshift(alert)
  if (alerts.length > 100) alerts.pop()
  res.sendStatus(200)
})

app.get('/alerts', (req, res) => {
  res.json(alerts)
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
