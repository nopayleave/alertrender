function getHAZoneIndicator(haValue) {
  if (!haValue || haValue === 'N/A') return 'H?'
  const value = parseFloat(haValue)
  
  if (isNaN(value)) return 'H?'
  
  // Handle both large integer values and small decimal values
  if (Math.abs(value) >= 500) {
    return value >= 500 ? 'H≥500' : 'H≤-500'
  } else if (Math.abs(value) >= 50) {
    return value >= 50 ? 'H>50' : 'H<-50'
  } else {
    return 'H±50'
  }
}

function formatEnhancedStoch(row) {
  // Extract stochastic data from the row
  const stochK = parseFloat(row.stochK) || 0
  const stochD = parseFloat(row.stochD) || 0
  const stochRefD = parseFloat(row.stochRefD) || 0
  const lastCrossType = row.lastCrossType || ''
  const haValue = row.haValue || 'N/A'
  // Use only actual MACD signal values - no fallback estimation
  let macdSignal = row.macdSignal
  if (!macdSignal || macdSignal === 'N/A' || macdSignal === '' || macdSignal === 0) {
    macdSignal = 'N/A'
  }
  
  console.log(`Debug for ${row.symbol}:`, {
    stochK, stochD, stochRefD, lastCrossType, haValue, macdSignal
  });
  
  // Check for missing stochastic data
  if (!row.stochK || !row.stochD || !row.stochRefD) {
    return 'No Stoch Data'
  }
  
  // Determine crossover/crossunder status or K vs D relationship
  let crossStatus = ''
  if (lastCrossType.toLowerCase() === 'crossover' || stochK > stochD) {
    crossStatus = '↑'  // Recent crossover OR K above D
  } else if (lastCrossType.toLowerCase() === 'crossunder' || stochK < stochD) {
    crossStatus = '↓'  // Recent crossunder OR K below D
  }
  
  // Build the stochastic status string
  let stochPart = ''
  if (crossStatus) {
    // Recent crossover/crossunder cases
    if (crossStatus === '↑') {
      // Crossover cases
      if (stochK > 50 && stochK > stochRefD) {
        stochPart = '↑>50>rD'
      } else if (stochK > 50 && stochK < stochRefD) {
        stochPart = '↑>50<rD'
      } else if (stochK < 50 && stochK > stochRefD) {
        stochPart = '↑<50>rD'
      } else {
        stochPart = '↑<50<rD'
      }
    } else {
      // Crossunder cases
      if (stochK > 50 && stochK > stochRefD) {
        stochPart = '↓>50>rD'
      } else if (stochK > 50 && stochK < stochRefD) {
        stochPart = '↓>50<rD'
      } else if (stochK < 50 && stochK > stochRefD) {
        stochPart = '↓<50>rD'
      } else {
        stochPart = '↓<50<rD'
      }
    }
  } else {
    // No recent cross - current position cases
    if (stochK < stochD) {
      // Below primary D cases
      if (stochK > 50 && stochK < stochRefD) {
        stochPart = '<D>50<rD'
      } else if (stochK < 50 && stochK > stochRefD) {
        stochPart = '<D<50>rD'
      } else if (stochK < 50 && stochK < stochRefD) {
        stochPart = '<D<50<rD'
      }
    }
    
    // Standard position cases (above D or no specific pattern)
    if (!stochPart) {
      if (stochK > 50 && stochK > stochRefD) {
        stochPart = '>50>rD'
      } else if (stochK > 50 && stochK < stochRefD) {
        stochPart = '>50<rD'
      } else if (stochK < 50 && stochK > stochRefD) {
        stochPart = '<50>rD'
      } else {
        stochPart = '<50<rD'
      }
    }
  }
  
  console.log(`StochPart for ${row.symbol}: ${stochPart}`);
  
  // If HA missing, show stoch part only
  if (haValue === 'N/A') {
    return stochPart + ' | HA Data Missing'
  }
  
  // Build HA vs MACD comparison part
  const haZone = getHAZoneIndicator(haValue)
  const haVal = parseFloat(haValue)
  const signalVal = parseFloat(macdSignal)
  
  console.log(`HA Zone for ${row.symbol}: ${haZone}, haVal: ${haVal}, signalVal: ${signalVal}`);
  
  // Validate numeric values
  if (isNaN(haVal)) {
    return stochPart + ' | Invalid HA Data'
  }
  
  // If MACD signal is missing or invalid, show data incomplete
  if (isNaN(signalVal)) {
    return stochPart + ' | MACD Signal Missing'
  }
  let finalSignalVal = signalVal
  
  // Compare HA value with MACD signal
  const comparison = haVal > finalSignalVal ? '>S' : haVal < finalSignalVal ? '<S' : '=S'
  
  // Add range indicator based on HA value (handle both large and small values)
  let rangeIndicator = ''
  if (Math.abs(haVal) >= 500) {
    rangeIndicator = haVal >= 500 ? '>500' : '<-500'
  } else if (Math.abs(haVal) >= 50) {
    rangeIndicator = haVal >= 50 ? '>50' : '<-50'
  } else {
    rangeIndicator = '±50'
  }
  
  // No MACD estimation - use only real values
  
  const result = stochPart + ' | ' + haZone + comparison + rangeIndicator
  console.log(`Final result for ${row.symbol}: ${result}`);
  
  return result
}

// Test data from your alerts plus edge cases
const testData = [
  {
    symbol: "AAPL",
    haValue: 125.7,
    macdSignal: 98.5,
    stochK: 72.3,
    stochD: 68.1,
    stochRefD: 65.4,
    lastCrossType: "crossover"
  },
  {
    symbol: "TSLA",
    haValue: -89.2,
    macdSignal: -45.8,
    stochK: 28.7,
    stochD: 35.2,
    stochRefD: 38.9,
    lastCrossType: "crossunder"
  },
  {
    symbol: "NVDA",
    haValue: 567.8,
    macdSignal: 423.2,
    stochK: 83.4,
    stochD: 79.6,
    stochRefD: 76.8,
    lastCrossType: ""
  },
  // Edge cases that might cause issues
  {
    symbol: "EDGE1",
    haValue: -89.2,
    macdSignal: null, // Missing MACD signal
    stochK: 28.7,
    stochD: 35.2,
    stochRefD: 38.9,
    lastCrossType: "crossunder"
  },
  {
    symbol: "EDGE2", 
    haValue: 45.3,  // Small HA value
    macdSignal: 0,  // Zero MACD signal
    stochK: 35.1,
    stochD: 42.8,
    stochRefD: 38.2,
    lastCrossType: ""
  },
  {
    symbol: "EDGE3",
    haValue: 'N/A', // Missing HA value
    macdSignal: 12.5,
    stochK: 67.2,
    stochD: 58.4,
    stochRefD: 61.1,
    lastCrossType: "crossover"
  }
];

console.log("Testing formatEnhancedStoch function with edge cases:");
testData.forEach(data => {
  console.log(`\n=== Testing ${data.symbol} ===`);
  const result = formatEnhancedStoch(data);
  console.log(`Result: ${result}\n`);
}); 