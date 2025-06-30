import fetch from 'node-fetch';

const LIVE_SERVER = 'https://alertrender.onrender.com';
const LOCAL_SERVER = 'http://localhost:3000';

// Function to fetch alerts from live server
async function fetchLiveAlerts() {
  try {
    const response = await fetch(`${LIVE_SERVER}/alerts`);
    const alerts = await response.json();
    console.log(`📡 Fetched ${alerts.length} alerts from live server`);
    return alerts;
  } catch (error) {
    console.error('❌ Error fetching from live server:', error.message);
    return [];
  }
}

// Function to send alert to local server
async function sendToLocal(alert) {
  try {
    const response = await fetch(`${LOCAL_SERVER}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(alert)
    });
    
    if (response.ok) {
      console.log(`✅ Sent ${alert.symbol} to local server`);
    } else {
      console.log(`❌ Failed to send ${alert.symbol}: ${response.status}`);
    }
  } catch (error) {
    console.error(`❌ Error sending to local server:`, error.message);
  }
}

// Function to send sample test data
async function sendTestData() {
  const testAlerts = [
    {
      symbol: "BTCUSD",
      signal: "Bullish",
      condition: "HA > 0",
      price: 67500.00,
      timeframe: "1h",
      priceChange: 2.45,
      volume: 1250000,
      haValue: 0.0234,
      stoch: "↑>0>D",
      stochK: 65.23,
      stochD: 58.91,
      stochRefD: 45.67,
      macdSignal: 0.0156,
      lastCrossType: "Crossover",
      lastPattern: "Higher Low",
      lastCrossValue: 62.45,
      openCrossType: "Crossover",
      openStochK: 68.45,
      openStochD: 62.33,
      openStochRefD: 48.91,
      isPremarket: false
    },
    {
      symbol: "ETHUSD", 
      signal: "Bearish",
      condition: "HA < 0",
      price: 3150.00,
      timeframe: "4h",
      priceChange: -1.87,
      volume: 890000,
      haValue: -0.0156,
      stoch: "↓<0<D",
      stochK: -15.34,
      stochD: -8.76,
      stochRefD: 12.45,
      macdSignal: -0.0089,
      lastCrossType: "Crossunder",
      lastPattern: "Lower High",
      lastCrossValue: -12.67,
      openCrossType: "Crossunder",
      openStochK: 42.18,
      openStochD: 55.67,
      openStochRefD: 38.22,
      isPremarket: true
    },
    {
      symbol: "AAPL",
      signal: "Bullish", 
      condition: "HA > 0",
      price: 195.50,
      timeframe: "1d",
      priceChange: 0.98,
      volume: 45000000,
      haValue: 0.0089,
      stoch: ">0>D",
      stochK: 72.14,
      stochD: 69.82,
      stochRefD: 56.33,
      macdSignal: 0.0234,
      lastCrossType: "Crossover",
      lastPattern: "Standard",
      lastCrossValue: 68.91,
      openCrossType: "Crossover",
      openStochK: 35.67,
      openStochD: 28.44,
      openStochRefD: 52.18,
      isPremarket: false
    },
    {
      symbol: "TSLA",
      signal: "Bearish",
      condition: "HA < 0",
      price: 238.77,
      timeframe: "15m",
      priceChange: -2.34,
      volume: 32000000,
      haValue: -0.0123,
      stoch: "<D<0<rD",
      stochK: -25.67,
      stochD: -18.92,
      stochRefD: -12.34,
      macdSignal: -0.0145,
      lastCrossType: "Crossunder",
      lastPattern: "Lower Low",
      lastCrossValue: -21.34,
      openCrossType: "Crossunder",
      openStochK: 58.91,
      openStochD: 65.23,
      openStochRefD: 42.77,
      isPremarket: false
    },
    {
      symbol: "NVDA",
      signal: "Bullish",
      condition: "HA > 0",
      price: 456.23,
      timeframe: "30m",
      priceChange: 3.67,
      volume: 28000000,
      haValue: 0.0345,
      stoch: "↑<0>D",
      stochK: -8.45,
      stochD: -15.23,
      stochRefD: -22.67,
      macdSignal: 0.0198,
      lastCrossType: "Crossover",
      lastPattern: "Higher Low",
      lastCrossValue: -11.78
    },
    {
      symbol: "MSFT",
      signal: "Bearish",
      condition: "HA < 0",
      price: 378.91,
      timeframe: "2h",
      priceChange: -0.95,
      volume: 19000000,
      haValue: -0.0234,
      stoch: "↓>0<D",
      stochK: 23.56,
      stochD: 31.78,
      stochRefD: 45.89,
      macdSignal: -0.0067,
      lastCrossType: "Crossunder",
      lastPattern: "Higher High",
      lastCrossValue: 28.34
    },
    {
      symbol: "GOOGL",
      signal: "Bullish",
      condition: "HA > 0",
      price: 142.34,
      timeframe: "1h",
      priceChange: 1.56,
      volume: 15000000,
      haValue: 0.0178,
      stoch: ">0<D",
      stochK: 45.67,
      stochD: 42.33,
      stochRefD: 67.89,
      macdSignal: 0.0123,
      lastCrossType: "Crossover",
      lastPattern: "Initial",
      lastCrossValue: 43.21
    },
    {
      symbol: "AMZN",
      signal: "Bearish",
      condition: "HA < 0",
      price: 156.78,
      timeframe: "3h",
      priceChange: -2.11,
      volume: 22000000,
      haValue: -0.0189,
      stoch: "<D>0<rD",
      stochK: 12.34,
      stochD: 18.67,
      stochRefD: 34.56,
      macdSignal: -0.0112,
      lastCrossType: "Crossunder",
      lastPattern: "Standard",
      lastCrossValue: 16.89
    }
  ];

  console.log('🧪 Sending comprehensive test data to local server...');
  for (const alert of testAlerts) {
    await sendToLocal(alert);
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
  }
}

// Function to sync live data to local
async function syncLiveToLocal() {
  console.log('🔄 Syncing live data to local server...');
  const liveAlerts = await fetchLiveAlerts();
  
  for (const alert of liveAlerts) {
    await sendToLocal(alert);
    await new Promise(resolve => setTimeout(resolve, 500)); // 0.5 second delay
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--test')) {
    await sendTestData();
  } else if (args.includes('--sync')) {
    await syncLiveToLocal();
  } else {
    console.log('📋 Usage:');
    console.log('  node test-webhook.js --test   # Send sample test data');
    console.log('  node test-webhook.js --sync   # Sync data from live server');
    console.log('');
    console.log('🌐 Your local server is at: http://localhost:3000');
    console.log('🌍 Your live server is at: https://alertrender.onrender.com');
  }
}

// Test script to simulate webhook data normalization
function normalizeWebhookData(rawAlert) {
  // Normalize field names to consistent camelCase
  const normalized = {
    symbol: rawAlert.symbol,
    signal: rawAlert.signal,
    condition: rawAlert.condition,
    price: rawAlert.price,
    timeframe: rawAlert.timeframe,
    priceChange: rawAlert.priceChange || rawAlert.pricechange,
    volume: rawAlert.volume,
    haValue: rawAlert.haValue || rawAlert.havalue,
    stoch: rawAlert.stoch,
    stochK: rawAlert.stochK || rawAlert.stochk,
    stochD: rawAlert.stochD || rawAlert.stochd,
    stochRefD: rawAlert.stochRefD || rawAlert.stochrefd,
    macdSignal: rawAlert.macdSignal || rawAlert.macdsignal,
    lastCrossType: rawAlert.lastCrossType || rawAlert.lastcrosstype,
    lastPattern: rawAlert.lastPattern || rawAlert.lastpattern,
    lastCrossValue: rawAlert.lastCrossValue || rawAlert.lastcrossvalue,
    time: rawAlert.time
  }
  
  // Generate haVsMacdStatus if missing
  if (!rawAlert.haVsMacdStatus && normalized.haValue && normalized.macdSignal) {
    const haVal = parseFloat(normalized.haValue)
    const signalVal = parseFloat(normalized.macdSignal)
    
    if (!isNaN(haVal) && !isNaN(signalVal)) {
      // Generate HA zone indicator
      let haZone = ''
      if (Math.abs(haVal) >= 500) {
        haZone = haVal >= 500 ? 'H≥500' : 'H≤-500'
      } else if (Math.abs(haVal) >= 50) {
        haZone = haVal >= 50 ? 'H>50' : 'H<-50'
      } else {
        haZone = 'H±50'
      }
      
      // Compare HA with MACD Signal
      const comparison = haVal > signalVal ? '>S' : haVal < signalVal ? '<S' : '=S'
      
      // Add range indicator
      let rangeIndicator = ''
      if (Math.abs(haVal) >= 500) {
        rangeIndicator = haVal >= 500 ? '>500' : '<-500'
      } else if (Math.abs(haVal) >= 50) {
        rangeIndicator = haVal >= 50 ? '>50' : '<-50'
      } else {
        rangeIndicator = '±50'
      }
      
      normalized.haVsMacdStatus = haZone + comparison + rangeIndicator
    }
  } else {
    normalized.haVsMacdStatus = rawAlert.haVsMacdStatus
  }
  
  return normalized
}

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

// Test data based on the actual live webhook data structure
const testWebhookData = [
  {
    "symbol": "ADAUSDT",
    "signal": "Bearish",
    "condition": "HA < 0",
    "price": 0.5682,
    "timeframe": "3",
    "priceChange": -0.16,
    "volume": 202139.1,
    "haValue": -182.6516,
    "stoch": ">0>D",
    "stochK": 26.45,
    "stochD": 23.88,
    "stochRefD": 14.3,
    "macdSignal": -101.2221,
    "lastCrossType": "Crossover",
    "lastPattern": "Standard",
    "lastCrossValue": 17.17,
    "time": "1751252229654"
  },
  {
    "symbol": "DOGEUSDT", 
    "signal": "Bearish",
    "condition": "HA < 0",
    "price": 0.16755,
    "timeframe": "3", 
    "priceChange": -0.13,
    "volume": 761839,
    "haValue": -130.747,
    "stoch": "↓>0<d",
    "stochk": 9.86,  // lowercase
    "stochd": 10.15, // lowercase
    "stochrefd": 13.87, // lowercase
    "macdsignal": -11.3093, // lowercase
    "lastcrosstype": "crossunder", // lowercase
    "lastpattern": "lower high", // lowercase
    "lastcrossvalue": 9.86,
    "time": "1751252225006"
  },
  {
    "symbol": "ETHUSD",
    "signal": "Bullish", 
    "condition": "HA > 0",
    "price": 2501.21,
    "timeframe": "3",
    "priceChange": -0.1,
    "volume": 148.87279718,
    "haValue": 84.7246,
    "stoch": ">0>D",
    "stochK": 20.84,
    "stochD": 18.03,
    "stochRefD": 18.89,
    "macdSignal": 176.3499,
    "lastCrossType": "Crossover",
    "lastPattern": "Standard",
    "lastCrossValue": 25.27,
    "time": "1751252220754"
  }
]

console.log("=== WEBHOOK DATA NORMALIZATION TEST ===\n")

testWebhookData.forEach(rawData => {
  console.log(`--- ${rawData.symbol} (Raw Data) ---`)
  console.log(`Signal: ${rawData.signal}`)
  console.log(`HA Value: ${rawData.haValue || rawData.havalue}`)
  console.log(`MACD Signal: ${rawData.macdSignal || rawData.macdsignal}`)
  console.log(`Stoch K/D/RefD: ${rawData.stochK || rawData.stochk}/${rawData.stochD || rawData.stochd}/${rawData.stochRefD || rawData.stochrefd}`)
  console.log(`Cross Type: ${rawData.lastCrossType || rawData.lastcrosstype}`)
  
  const normalized = normalizeWebhookData(rawData)
  console.log(`\n--- ${normalized.symbol} (Normalized) ---`)
  console.log(`✓ HA Value: ${normalized.haValue}`)
  console.log(`✓ MACD Signal: ${normalized.macdSignal}`)
  console.log(`✓ Stoch K/D/RefD: ${normalized.stochK}/${normalized.stochD}/${normalized.stochRefD}`)
  console.log(`✓ Cross Type: ${normalized.lastCrossType}`)
  console.log(`✓ Generated haVsMacdStatus: ${normalized.haVsMacdStatus}`)
  
  const stochContent = formatEnhancedStoch(normalized)
  console.log(`✓ Final Stoch Display: ${stochContent}`)
  console.log("")
})

main().catch(console.error); 