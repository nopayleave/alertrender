// index.js (Express)
const express = require('express');
const path = require('path');
const app = express();
app.use(express.json());

let alerts = []; // 記憶體存儲最新 Alerts

// Webhook endpoint（TradingView Webhook POST JSON）
app.post('/webhook', (req, res) => {
  const body = req.body;
  // 支援單個或多個 symbol
  if (Array.isArray(body)) {
    alerts = body;
  } else {
    // 只更新同 symbol，其他唔 overwrite
    const idx = alerts.findIndex(a => a.symbol === body.symbol);
    if (idx > -1) alerts[idx] = body;
    else alerts.push(body);
  }
  res.json({ success: true });
});

// 前端拉數據 API
app.get('/api/alerts', (req, res) => {
  res.json(alerts);
});

// Serve 靜態 React build
app.use(express.static(path.join(__dirname, 'client', 'build')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'build', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
