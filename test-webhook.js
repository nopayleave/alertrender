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

main().catch(console.error); 