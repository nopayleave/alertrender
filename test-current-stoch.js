// Test script to show current stochastic content formatting
function formatEnhancedStoch(row) {
  // Extract stochastic data from the row
  const stochK = parseFloat(row.stochK) || 0
  const stochD = parseFloat(row.stochD) || 0
  const stochRefD = parseFloat(row.stochRefD) || 0
  const lastCrossType = row.lastCrossType || ''
  const haValue = row.haValue || 'N/A'
  const macdSignal = row.macdSignal || 'N/A'
  
  // Check for missing stochastic data
  if (!row.stochK || !row.stochD || !row.stochRefD) {
    return 'No Stoch Data'
  }
  
  // Simple stochastic status
  let stochStatus = ''
  
  // Determine cross direction
  if (lastCrossType.toLowerCase() === 'crossover') {
    stochStatus = '↑Cross'
  } else if (lastCrossType.toLowerCase() === 'crossunder') {
    stochStatus = '↓Cross'
  } else {
    // No recent cross, show K vs D relationship
    if (stochK > stochD) {
      stochStatus = 'K>D'
    } else {
      stochStatus = 'K<D'
    }
  }
  
  // Add overbought/oversold context
  if (stochK > 80) {
    stochStatus += ' OB'
  } else if (stochK < 20) {
    stochStatus += ' OS'
  } else if (stochK > 50) {
    stochStatus += ' Bull'
  } else {
    stochStatus += ' Bear'
  }
  
  // Simple HA trend indicator
  let haTrend = ''
  if (haValue === 'N/A') {
    haTrend = 'HA:N/A'
  } else {
    const haVal = parseFloat(haValue)
    if (isNaN(haVal)) {
      haTrend = 'HA:Invalid'
    } else if (Math.abs(haVal) >= 500) {
      haTrend = haVal >= 500 ? 'HA:Extreme↑' : 'HA:Extreme↓'
    } else if (Math.abs(haVal) >= 100) {
      haTrend = haVal >= 100 ? 'HA:Strong↑' : 'HA:Strong↓'
    } else if (Math.abs(haVal) >= 50) {
      haTrend = haVal >= 50 ? 'HA:Mild↑' : 'HA:Mild↓'
    } else {
      haTrend = 'HA:Neutral'
    }
  }
  
  return stochStatus + ' | ' + haTrend
}

// Test data from the dummy data in index.js
const testData = [
  {
    symbol: "AAPL",
    signal: "Bullish",
    haValue: 125.7,
    macdSignal: 98.5,
    stochK: 72.3,
    stochD: 68.1,
    stochRefD: 65.4,
    lastCrossType: "crossover",
    stoch: "↑>0>D"
  },
  {
    symbol: "TSLA",
    signal: "Bearish", 
    haValue: -89.2,
    macdSignal: -45.8,
    stochK: 28.7,
    stochD: 35.2,
    stochRefD: 38.9,
    lastCrossType: "crossunder",
    stoch: "↓<0<D"
  },
  {
    symbol: "NVDA",
    signal: "Bullish",
    haValue: 567.8,
    macdSignal: 423.2,
    stochK: 83.4,
    stochD: 79.6,
    stochRefD: 76.8,
    lastCrossType: "",
    stoch: ">0>D"
  },
  {
    symbol: "MSFT",
    signal: "Bearish",
    haValue: -234.5,
    macdSignal: -189.7,
    stochK: 23.1,
    stochD: 31.5,
    stochRefD: 29.8,
    lastCrossType: "",
    stoch: "<D<0<rD"
  },
  {
    symbol: "META",
    signal: "Bullish",
    haValue: 345.6,
    macdSignal: 289.4,
    stochK: 76.8,
    stochD: 71.3,
    stochRefD: 68.9,
    lastCrossType: "",
    stoch: ">0<D"
  }
]

console.log("=== NEW SIMPLIFIED STOCHASTIC CONTENT OUTPUT ===\n")

testData.forEach(row => {
  const stochContent = formatEnhancedStoch(row)
  console.log(`${row.symbol.padEnd(6)} | ${stochContent}`)
  console.log(`       Raw data: K=${row.stochK}, D=${row.stochD}, rD=${row.stochRefD}, Cross=${row.lastCrossType}, HA=${row.haValue}`)
  console.log(`       Original stoch field: "${row.stoch}"`)
  console.log("")
}) 