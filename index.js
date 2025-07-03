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
  res.send('Webhook server running! See /api/alerts for data.')
})

app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})
