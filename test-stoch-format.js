// Test script to debug formatEnhancedStoch function
const testData = [
  {"symbol":"DOGEUSDT","signal":"Bullish","condition":"HA > 0","price":0.16404,"timeframe":"3","priceChange":0.11,"volume":393870,"haValue":15.4336,"stoch":"<D>0<rD","stochK":55.69,"stochD":57.09,"stochRefD":65.06,"macdSignal":-46.7463,"lastCrossType":"Crossunder","lastPattern":"Lower High","lastCrossValue":56.34,"time":"1751217661677"},
  {"symbol":"ADAUSDT","signal":"Bearish","condition":"HA < 0","price":0.5576,"timeframe":"3","priceChange":0.05,"volume":72431.1,"haValue":-169.231,"stoch":">0>D","stochK":76.68,"stochD":74.74,"stochRefD":51.65,"macdSignal":-283.6325,"lastCrossType":"Crossover","lastPattern":"Higher Low","lastCrossValue":44.28,"time":"1751217665531"},
  {"symbol":"BTCUSD","signal":"Bearish","condition":"HA < 0","price":107553.23,"timeframe":"3","priceChange":-0.01,"volume":3.19132314,"haValue":-347.5684,"stoch":">0>D","stochK":74.24,"stochD":61.42,"stochRefD":25.64,"macdSignal":-376.4602,"lastCrossType":"Crossover","lastPattern":"Standard","lastCrossValue":21.04,"time":"1751217660844"},
  {"symbol":"ETHUSD","signal":"Bearish","condition":"HA < 0","price":2438.76,"timeframe":"3","priceChange":0.04,"volume":96.92539498,"haValue":-141.6716,"stoch":"↓>0>D","stochK":72.23,"stochD":74.72,"stochRefD":49.66,"macdSignal":-208.1533,"lastCrossType":"Crossunder","lastPattern":"Higher High","lastCrossValue":72.23,"time":"1751217661002"},
  {"symbol":"SOLUSD","signal":"Bearish","condition":"HA < 0","price":150.73,"timeframe":"3","priceChange":0.05,"volume":463.93457607,"haValue":-160.4048,"stoch":">0>D","stochK":85.16,"stochD":70.98,"stochRefD":30.77,"macdSignal":-220.4264,"lastCrossType":"Crossover","lastPattern":"Standard","lastCrossValue":24.42,"time":"1751217664828"},
  {"symbol":"ADAUSD","signal":"Bearish","condition":"HA < 0","price":0.5579,"timeframe":"3","priceChange":0.05,"volume":5102.40278699,"haValue":-177.734,"stoch":">0>D","stochK":78.73,"stochD":75.86,"stochRefD":51.75,"macdSignal":-298.8865,"lastCrossType":"Crossover","lastPattern":"Standard","lastCrossValue":42.53,"time":"1751217665819"}
];

function getHAZoneIndicator(haValue) {
  if (!haValue || haValue === 'N/A') return 'H?'
  const value = parseFloat(haValue)
  
  if (isNaN(value)) return 'H?'
  
  if (Math.abs(value) >= 500) {
    return value >= 500 ? 'H≥500' : 'H≤-500'
  } else if (Math.abs(value) >= 50) {
    return value >= 50 ? 'H>50' : 'H<-50'
  } else {
    return 'H±50'
  }
}

function formatEnhancedStoch(row) {
  console.log(`\n=== DEBUG formatEnhancedStoch for ${row.symbol} ===`);
  
  // Extract stochastic data from the row
  const stochK = parseFloat(row.stochK) || 0
  const stochD = parseFloat(row.stochD) || 0
  const stochRefD = parseFloat(row.stochRefD) || 0
  const lastCrossType = row.lastCrossType || ''
  const haValue = row.haValue || 'N/A'
  const macdSignal = row.macdSignal || 'N/A'
  
  console.log('Parsed values:');
  console.log('stochK:', stochK);
  console.log('stochD:', stochD);
  console.log('stochRefD:', stochRefD);
  console.log('lastCrossType:', lastCrossType);
  console.log('haValue:', haValue);
  console.log('macdSignal:', macdSignal);
  
  // Check for missing stochastic data
  if (!row.stochK || !row.stochD || !row.stochRefD) {
    console.log('Missing stoch data - returning early');
    return 'No Stoch Data'
  }
  
  // Determine crossover/crossunder status or K vs D relationship
  let crossStatus = ''
  if (lastCrossType.toLowerCase() === 'crossover' || stochK > stochD) {
    crossStatus = '↑'  // Recent crossover OR K above D
  } else if (lastCrossType.toLowerCase() === 'crossunder' || stochK < stochD) {
    crossStatus = '↓'  // Recent crossunder OR K below D
  }
  
  console.log('crossStatus:', crossStatus);
  
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
  
  console.log('stochPart:', stochPart);
  
  // If HA or MACD missing, show stoch part only
  if (haValue === 'N/A' || macdSignal === 'N/A') {
    console.log('HA or MACD missing');
    return stochPart + ' | Data Incomplete'
  }
  
  // Build HA vs MACD comparison part
  const haZone = getHAZoneIndicator(haValue)
  const haVal = parseFloat(haValue)
  const signalVal = parseFloat(macdSignal)
  
  console.log('haZone:', haZone);
  console.log('haVal:', haVal);
  console.log('signalVal:', signalVal);
  
  // Validate numeric values
  if (isNaN(haVal) || isNaN(signalVal)) {
    console.log('Invalid numeric values');
    return stochPart + ' | Invalid Data'
  }
  
  // Compare HA value with MACD signal
  const comparison = haVal > signalVal ? '>S' : haVal < signalVal ? '<S' : '=S'
  
  // Add range indicator based on HA value (handle both large and small values)
  let rangeIndicator = ''
  if (Math.abs(haVal) >= 500) {
    rangeIndicator = haVal >= 500 ? '>500' : '<-500'
  } else if (Math.abs(haVal) >= 50) {
    rangeIndicator = haVal >= 50 ? '>50' : '<-50'
  } else {
    rangeIndicator = '±50'
  }
  
  console.log('comparison:', comparison);
  console.log('rangeIndicator:', rangeIndicator);
  
  const result = stochPart + ' | ' + haZone + comparison + rangeIndicator
  console.log('Final result:', result);
  return result
}

// Test the function with all data
console.log('=== TESTING ALL SYMBOLS ===');
testData.forEach(row => {
  const result = formatEnhancedStoch(row);
  console.log(`${row.symbol}: ${result}`);
});

console.log('\n=== SUMMARY ===');
testData.forEach(row => {
  const result = formatEnhancedStoch(row);
  console.log(`${row.symbol} (${row.signal}): ${result}`);
}); 