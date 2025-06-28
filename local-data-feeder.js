import fetch from 'node-fetch';

// Sample trading data to simulate TradingView alerts
const sampleAlerts = [
  {
    symbol: "AAPL",
    signal: "Bullish",
    condition: "Breakout confirmed",
    price: 189.45,
    priceChange: 2.34,
    volume: 45678901,
    haValue: 0.75,
    time: Date.now().toString()
  },
  {
    symbol: "TSLA",
    signal: "Bearish", 
    condition: "Support broken",
    price: 238.77,
    priceChange: -1.89,
    volume: 32145678,
    haValue: -0.42,
    time: Date.now().toString()
  },
  {
    symbol: "NVDA",
    signal: "Bullish",
    condition: "MACD Bullish Cross",
    price: 456.23,
    priceChange: 3.67,
    volume: 28934567,
    haValue: 0.88,
    time: Date.now().toString()
  },
  {
    symbol: "MSFT",
    signal: "Bearish",
    condition: "Heikin-Ashi Downtrend",
    price: 378.91,
    priceChange: -0.95,
    volume: 19876543,
    haValue: -0.33,
    time: Date.now().toString()
  },
  {
    symbol: "GOOGL",
    signal: "Bullish",
    condition: "OB Signal",
    price: 142.34,
    priceChange: 1.56,
    volume: 15432198,
    haValue: 0.61,
    time: Date.now().toString()
  },
  {
    symbol: "AMZN",
    signal: "Bearish",
    condition: "OS Signal",
    price: 156.78,
    priceChange: -2.11,
    volume: 22109876,
    haValue: -0.55,
    time: Date.now().toString()
  },
  {
    symbol: "META",
    signal: "Bullish",
    condition: "Bullish Trend",
    price: 498.12,
    priceChange: 4.23,
    volume: 18765432,
    haValue: 0.92,
    time: Date.now().toString()
  },
  {
    symbol: "NFLX",
    signal: "Bearish",
    condition: "Bearish Trend", 
    price: 445.67,
    priceChange: -1.78,
    volume: 12345678,
    haValue: -0.67,
    time: Date.now().toString()
  }
];

// Configuration
const WEBHOOK_URL = 'http://localhost:3000/webhook';
const FEED_INTERVAL = 3000; // 3 seconds between alerts
const RANDOM_MODE = false; // Set to true for random alerts, false for sequential

class LocalDataFeeder {
  constructor() {
    this.currentIndex = 0;
    this.isRunning = false;
  }

  // Generate random alert data
  generateRandomAlert() {
    const symbols = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NFLX', 'AMD', 'INTC'];
    const signals = ['Bullish', 'Bearish'];
    const conditions = [
      'Breakout confirmed', 'Support broken', 'MACD Bullish Cross', 'MACD Bearish Cross',
      'Heikin-Ashi Uptrend', 'Heikin-Ashi Downtrend', 'OB Signal', 'OS Signal',
      'Bullish Trend', 'Bearish Trend'
    ];

    const signal = signals[Math.floor(Math.random() * signals.length)];
    const basePrice = Math.random() * 500 + 50; // Random price between 50-550
    const priceChange = (Math.random() - 0.5) * 10; // Random change between -5% to +5%
    
    return {
      symbol: symbols[Math.floor(Math.random() * symbols.length)],
      signal: signal,
      condition: conditions[Math.floor(Math.random() * conditions.length)],
      price: parseFloat(basePrice.toFixed(2)),
      priceChange: parseFloat(priceChange.toFixed(2)),
      volume: Math.floor(Math.random() * 50000000) + 1000000, // 1M to 50M volume
      haValue: parseFloat(((Math.random() - 0.5) * 2).toFixed(2)), // -1 to 1
      time: Date.now().toString()
    };
  }

  // Send alert to webhook
  async sendAlert(alert) {
    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(alert)
      });

      if (response.ok) {
        console.log(`✅ Sent ${alert.signal} alert for ${alert.symbol} at $${alert.price}`);
      } else {
        console.error(`❌ Failed to send alert: ${response.status}`);
      }
    } catch (error) {
      console.error(`❌ Error sending alert:`, error.message);
    }
  }

  // Start feeding data
  start() {
    if (this.isRunning) {
      console.log('⚠️  Data feeder is already running');
      return;
    }

    this.isRunning = true;
    console.log(`🚀 Starting local data feeder...`);
    console.log(`📡 Webhook URL: ${WEBHOOK_URL}`);
    console.log(`⏱️  Interval: ${FEED_INTERVAL}ms`);
    console.log(`🎲 Random mode: ${RANDOM_MODE ? 'ON' : 'OFF'}`);
    console.log('---');

    this.intervalId = setInterval(() => {
      let alert;
      
      if (RANDOM_MODE) {
        alert = this.generateRandomAlert();
      } else {
        alert = { ...sampleAlerts[this.currentIndex] };
        alert.time = Date.now().toString();
        this.currentIndex = (this.currentIndex + 1) % sampleAlerts.length;
      }

      this.sendAlert(alert);
    }, FEED_INTERVAL);
  }

  // Stop feeding data
  stop() {
    if (!this.isRunning) {
      console.log('⚠️  Data feeder is not running');
      return;
    }

    clearInterval(this.intervalId);
    this.isRunning = false;
    console.log('🛑 Data feeder stopped');
  }

  // Send a single alert
  async sendSingle(symbol = null) {
    let alert;
    
    if (symbol) {
      // Find alert with specific symbol or create one
      alert = sampleAlerts.find(a => a.symbol === symbol.toUpperCase()) || this.generateRandomAlert();
      if (!sampleAlerts.find(a => a.symbol === symbol.toUpperCase())) {
        alert.symbol = symbol.toUpperCase();
      }
    } else if (RANDOM_MODE) {
      alert = this.generateRandomAlert();
    } else {
      alert = { ...sampleAlerts[this.currentIndex] };
      this.currentIndex = (this.currentIndex + 1) % sampleAlerts.length;
    }
    
    alert.time = Date.now().toString();
    await this.sendAlert(alert);
  }

  // Send all sample alerts at once
  async sendBatch() {
    console.log('📦 Sending batch of sample alerts...');
    for (const alert of sampleAlerts) {
      const alertCopy = { ...alert };
      alertCopy.time = Date.now().toString();
      await this.sendAlert(alertCopy);
      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between alerts
    }
    console.log('✅ Batch sending complete');
  }
}

// CLI interface
const feeder = new LocalDataFeeder();

// Handle command line arguments
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'start':
    feeder.start();
    break;
  
  case 'stop':
    feeder.stop();
    process.exit(0);
    break;
  
  case 'single':
    const symbol = args[1];
    feeder.sendSingle(symbol);
    break;
  
  case 'batch':
    feeder.sendBatch();
    break;
  
  case 'random':
    // Enable random mode and start
    const originalMode = RANDOM_MODE;
    Object.defineProperty(global, 'RANDOM_MODE', { value: true, writable: false });
    feeder.start();
    break;
  
  default:
    console.log(`
🔧 Local Data Feeder for TradingView Webhook Server

Usage:
  node local-data-feeder.js <command> [options]

Commands:
  start                 Start continuous data feeding
  stop                  Stop data feeding  
  single [SYMBOL]       Send single alert (optionally for specific symbol)
  batch                 Send all sample alerts at once
  random                Start feeding with random data
  help                  Show this help message

Examples:
  node local-data-feeder.js start
  node local-data-feeder.js single AAPL
  node local-data-feeder.js batch
  node local-data-feeder.js random

Make sure your webhook server is running on http://localhost:3000 first!
    `);
    break;
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n🛑 Received interrupt signal');
  feeder.stop();
  process.exit(0);
}); 