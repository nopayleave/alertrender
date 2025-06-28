import express from 'express'
import cors from 'cors'

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

let alerts = []

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
