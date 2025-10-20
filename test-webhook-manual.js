// Manual Webhook Testing Script
// Run this to test if your webhook endpoint is working

const testWebhook = async (data, description) => {
  console.log(`\n🧪 Testing: ${description}`)
  console.log('📤 Sending:', JSON.stringify(data, null, 2))
  
  try {
    const response = await fetch('http://localhost:3000/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    })
    
    const result = await response.json()
    console.log('✅ Response:', result)
    return true
  } catch (error) {
    console.error('❌ Error:', error.message)
    return false
  }
}

const runTests = async () => {
  console.log('🚀 Starting webhook tests...')
  console.log('📍 Target: http://localhost:3000/webhook')
  
  // Test 1: Main alert from List script
  await testWebhook({
    symbol: "AAPL",
    timeframe: "5",
    time: Date.now().toString(),
    price: 175.50,
    trend: "Bullish",
    vwap: 175.20,
    vwapAbove: true,
    vwapRemark: "UP2",
    ema1: 174.80,
    ema1Tf: "5",
    ema1Above: true,
    ema2: 174.00,
    ema2Tf: "5",
    ema2Above: true,
    trendIndicator: "↑ ↑",
    dayHigh: 176.00,
    dayLow: 174.00,
    dayRange: 2.00,
    rangeStatus: "Up Range",
    macd: 0.25,
    macdSignal: 0.20,
    macdTf: "5",
    rsi: 62.5,
    rsiTf: "5",
    volume: 1500000
  }, "Main List script alert")
  
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  // Test 2: Quad Stochastic D4 Signal - Uptrend
  await testWebhook({
    symbol: "AAPL",
    d4Signal: "D4_Uptrend"
  }, "Quad Stochastic D4 - Uptrend")
  
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  // Test 3: Quad Stochastic D4 Signal - Cross Up 50
  await testWebhook({
    symbol: "TSLA",
    d4Signal: "D4_Cross_Up_50"
  }, "Quad Stochastic D4 - Cross Up 50")
  
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  // Test 4: Quad Stochastic D4 Signal - Cross Down 20 (Oversold)
  await testWebhook({
    symbol: "MSFT",
    d4Signal: "D4_Cross_Down_20"
  }, "Quad Stochastic D4 - Cross Down 20 (Oversold)")
  
  console.log('\n✨ All tests completed!')
  console.log('📊 Check your dashboard at: http://localhost:3000')
  console.log('📜 Check alert history at: http://localhost:3000/alerts/history')
}

// Run the tests
runTests()

