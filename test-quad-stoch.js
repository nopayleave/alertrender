import fetch from 'node-fetch';

// const SERVER_URL = 'http://localhost:3000';
// For testing live server, uncomment below:
const SERVER_URL = 'https://alertrender.onrender.com';

// Sample Quad Stochastic alerts - testing all signal types
const sampleAlerts = [
  {
    symbol: "AAPL",
    quadStochSignal: "Bull_Cross_High",
    crossType: "D1_Cross_Up_D2",
    d1: 72.5,
    d2: 68.3,
    d3: 65.1,
    d4: 62.8,
    k1: 75.2,
    d1Rising: true,
    d2Rising: true,
    d1Above50: true,
    d2Above50: true,
    time: Date.now().toString()
  },
  {
    symbol: "TSLA",
    quadStochSignal: "Bull_D2>D1_Rising",  // THIS IS THE KEY ONE - D2 > D1 but both rising = BULLISH!
    crossType: "None",
    d1: 42.5,
    d2: 48.3,  // D2 higher than D1
    d3: 45.7,
    d4: 43.2,
    k1: 40.8,
    d1Rising: true,    // D1 is rising
    d2Rising: true,    // D2 is rising - both rising = bullish momentum!
    d1Above50: false,
    d2Above50: false,
    time: Date.now().toString()
  },
  {
    symbol: "NVDA",
    quadStochSignal: "Bull_D1>D2_Rising",
    crossType: "None",
    d1: 58.9,
    d2: 54.5,
    d3: 52.3,
    d4: 50.1,
    k1: 61.2,
    d1Rising: true,
    d2Rising: true,
    d1Above50: true,
    d2Above50: true,
    time: Date.now().toString()
  },
  {
    symbol: "GOOGL",
    quadStochSignal: "Bull_Cross_Low",
    crossType: "D1_Cross_Up_D2",
    d1: 35.6,
    d2: 32.8,
    d3: 30.2,
    d4: 28.5,
    k1: 38.9,
    d1Rising: true,
    d2Rising: true,
    d1Above50: false,
    d2Above50: false,
    time: Date.now().toString()
  },
  {
    symbol: "MSFT",
    quadStochSignal: "Bear_Cross_High",
    crossType: "D1_Cross_Down_D2",
    d1: 68.2,
    d2: 72.5,
    d3: 74.8,
    d4: 76.3,
    k1: 65.4,
    d1Rising: false,
    d2Rising: false,
    d1Above50: true,
    d2Above50: true,
    time: Date.now().toString()
  },
  {
    symbol: "AMZN",
    quadStochSignal: "Bear_D1<D2_Falling",
    crossType: "None",
    d1: 32.1,
    d2: 38.7,
    d3: 42.5,
    d4: 45.9,
    k1: 28.6,
    d1Rising: false,
    d2Rising: false,
    d1Above50: false,
    d2Above50: false,
    time: Date.now().toString()
  },
  {
    symbol: "META",
    quadStochSignal: "Bull_Diverging",
    crossType: "None",
    d1: 55.3,
    d2: 48.7,
    d3: 52.1,
    d4: 54.8,
    k1: 58.9,
    d1Rising: true,
    d2Rising: false,
    d1Above50: true,
    d2Above50: false,
    time: Date.now().toString()
  },
  {
    symbol: "NFLX",
    quadStochSignal: "Neutral_D1>D2",
    crossType: "None",
    d1: 52.3,
    d2: 48.9,
    d3: 50.5,
    d4: 51.2,
    k1: 53.1,
    d1Rising: false,
    d2Rising: true,
    d1Above50: true,
    d2Above50: false,
    time: Date.now().toString()
  }
];

async function sendAlert(alert) {
  try {
    const response = await fetch(`${SERVER_URL}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(alert)
    });
    
    if (response.ok) {
      const signalEmoji = alert.quadStochSignal.startsWith('Bull') ? '🟢' : 
                         alert.quadStochSignal.startsWith('Bear') ? '🔴' : '⚪';
      console.log(`✅ ${alert.symbol.padEnd(6)} ${signalEmoji} ${alert.quadStochSignal} (D1: ${alert.d1.toFixed(1)}, D2: ${alert.d2.toFixed(1)})`);
    } else {
      console.log(`❌ Failed to send ${alert.symbol}: ${response.status}`);
    }
  } catch (error) {
    console.error(`❌ Error sending ${alert.symbol}:`, error.message);
  }
}

async function main() {
  console.log('🔄 Sending Quad Stochastic test alerts...\n');
  
  for (const alert of sampleAlerts) {
    await sendAlert(alert);
    await new Promise(resolve => setTimeout(resolve, 500)); // 0.5 second delay
  }
  
  console.log('\n✅ Test complete! Check your dashboard at:');
  console.log(`   ${SERVER_URL}/`);
  console.log('\n📝 Expected results:');
  console.log('   🟢 AAPL:  ↑⚡ HIGH    - Bullish cross in upper zone');
  console.log('   🟢 TSLA:  ↑↑ D2>D1    - Both D1 & D2 rising (D2>D1 BUT STILL BULLISH!)');
  console.log('   🟢 NVDA:  ↑↑ D1>D2    - Both D1 & D2 rising (D1>D2)');
  console.log('   🟢 GOOGL: ↑⚡ LOW     - Bullish cross from oversold');
  console.log('   🔴 MSFT:  ↓⚡ HIGH    - Bearish cross in overbought');
  console.log('   🔴 AMZN:  ↓↓ D1<D2    - Both D1 & D2 falling');
  console.log('   🟢 META:  ↗️ DIV      - Bullish divergence');
  console.log('   ⚪ NFLX:  ⚪ D1>D2    - Neutral mixed momentum');
}

main().catch(console.error);

