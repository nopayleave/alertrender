// Test to show difference between records with and without haVsMacdStatus
function formatEnhancedStoch(row) {
  // Extract stochastic data from the row
  const stochK = parseFloat(row.stochK) || 0
  const stochD = parseFloat(row.stochD) || 0
  const stochRefD = parseFloat(row.stochRefD) || 0
  const lastCrossType = row.lastCrossType || ''
  const haValue = row.haValue || 'N/A'
  
  // Check for missing stochastic data
  if (!row.stochK || !row.stochD || !row.stochRefD) {
    return 'No Stoch Data'
  }
  
  // Build stochastic part - simplified format
  let stochPart = ''
  
  // Determine cross direction
  if (lastCrossType.toLowerCase() === 'crossover') {
    stochPart = '↑Cross'
  } else if (lastCrossType.toLowerCase() === 'crossunder') {
    stochPart = '↓Cross'
  } else {
    // No recent cross, show K vs D relationship
    if (stochK > stochD) {
      stochPart = 'K>D'
    } else {
      stochPart = 'K<D'
    }
  }
  
  // Add overbought/oversold context
  if (stochK > 80) {
    stochPart += ' OB'
  } else if (stochK < 20) {
    stochPart += ' OS'
  } else if (stochK > 50) {
    stochPart += ' Bull'
  } else {
    stochPart += ' Bear'
  }
  
  // Use pre-calculated HA vs MACD status if available, otherwise use simple HA trend
  if (row.haVsMacdStatus) {
    return stochPart + ' | ' + row.haVsMacdStatus
  }
  
  // Fallback to simple HA trend indicator
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
  
  return stochPart + ' | ' + haTrend
}

// Test data - some with haVsMacdStatus, some without
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
    haVsMacdStatus: "H>50>S>50"  // HAS haVsMacdStatus
  },
  {
    symbol: "GOOGL",
    signal: "Bullish", 
    haValue: 78.9,
    macdSignal: 56.3,
    stochK: 45.2,
    stochD: 52.8,
    stochRefD: 48.6,
    lastCrossType: "crossover"
    // NO haVsMacdStatus - will use fallback
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
    haVsMacdStatus: "H<-50<S<-50"  // HAS haVsMacdStatus
  },
  {
    symbol: "MSFT",
    signal: "Bearish",
    haValue: -234.5,
    macdSignal: -189.7,
    stochK: 23.1,
    stochD: 31.5,
    stochRefD: 29.8,
    lastCrossType: ""
    // NO haVsMacdStatus - will use fallback
  }
]

console.log("=== COMPARISON: WITH vs WITHOUT haVsMacdStatus ===\n")

testData.forEach(row => {
  const stochContent = formatEnhancedStoch(row)
  const hasField = row.haVsMacdStatus ? "✅ HAS" : "❌ NO"
  
  console.log(`${row.symbol.padEnd(6)} | ${hasField.padEnd(8)} haVsMacdStatus | ${stochContent}`)
  
  if (row.haVsMacdStatus) {
    console.log(`       📊 Using pre-calculated: "${row.haVsMacdStatus}"`)
  } else {
    console.log(`       🔄 Using fallback logic: HA=${row.haValue}, MACD=${row.macdSignal}`)
  }
  console.log("")
})

console.log("🔍 EXPLANATION:")
console.log("• Records WITH haVsMacdStatus show complex format: H>50>S>50")
console.log("• Records WITHOUT haVsMacdStatus show simple format: HA:Strong↑") 
console.log("• The normalizeWebhookData() function generates haVsMacdStatus when missing")
console.log("• Test data was missing this field - that's why you saw simple format!") 