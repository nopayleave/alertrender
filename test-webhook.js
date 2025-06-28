import fetch from 'node-fetch';

const LIVE_SERVER = 'https://alertrender.onrender.com';
const LOCAL_SERVER = 'http://localhost:3001';

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
      haValue: 0.0234
    },
    {
      symbol: "ETHUSD", 
      signal: "Bearish",
      condition: "HA < 0",
      price: 3150.00,
      timeframe: "4h",
      priceChange: -1.87,
      volume: 890000,
      haValue: -0.0156
    },
    {
      symbol: "AAPL",
      signal: "Bullish", 
      condition: "HA > 0",
      price: 195.50,
      timeframe: "1d",
      priceChange: 0.98,
      volume: 45000000,
      haValue: 0.0089
    }
  ];

  console.log('🧪 Sending test data to local server...');
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
    console.log('🌐 Your local server is at: http://localhost:3001');
    console.log('🌍 Your live server is at: https://alertrender.onrender.com');
  }
}

main().catch(console.error); 