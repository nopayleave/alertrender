import express from 'express'
import cors from 'cors'

const app = express()
const port = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// Conditional dummy data - only for localhost/development
let alerts = []

// Add dummy data only in development (localhost) - disabled for production
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== undefined) {
  alerts = [
    {
      symbol: "AAPL",
      timeframe: "30S",
      time: Date.now().toString(),
      price: 189.45,
      open: 187.12,
      high: 190.25,
      low: 186.80,
      close: 189.45,
      priceChange: 2.34,
      priceChangeCandle: 1.24,
      volume: 45678901,
      macdSignal: 0.0234,
      stochK: 72.3,
      openSignal: 0.0045,
      openTrendSignal: 0.0067,
      s30sSignal: 0.0123,
      s1mSignal: 0.0156,
      s5mSignal: 0.0189,
      sk2mDiff: 3.4
    },
    {
      symbol: "TSLA",
      timeframe: "30S",
      time: Date.now().toString(),
      price: 238.77,
      open: 241.50,
      high: 242.10,
      low: 237.90,
      close: 238.77,
      priceChange: -1.89,
      priceChangeCandle: -1.13,
      volume: 32145678,
      macdSignal: -0.0458,
      stochK: 28.7,
      openSignal: -0.0234,
      openTrendSignal: -0.0456,
      s30sSignal: -0.0156,
      s1mSignal: -0.0089,
      s5mSignal: -0.0234,
      sk2mDiff: -2.8
    },
    {
      symbol: "NVDA",
      timeframe: "30S",
      time: Date.now().toString(),
      price: 456.23,
      open: 453.12,
      high: 458.90,
      low: 452.45,
      close: 456.23,
      priceChange: 3.67,
      priceChangeCandle: 0.68,
      volume: 28934567,
      macdSignal: 0.0423,
      stochK: 83.4,
      openSignal: 0.0234,
      openTrendSignal: 0.0345,
      s30sSignal: 0.0423,
      s1mSignal: 0.0398,
      s5mSignal: 0.0456,
      sk2mDiff: 5.2
    },
    {
      symbol: "MSFT",
      timeframe: "30S",
      time: Date.now().toString(),
      price: 378.91,
      open: 380.12,
      high: 381.45,
      low: 378.23,
      close: 378.91,
      priceChange: -0.95,
      priceChangeCandle: -0.32,
      volume: 19876543,
      macdSignal: -0.0189,
      stochK: 23.1,
      openSignal: -0.0123,
      openTrendSignal: -0.0234,
      s30sSignal: -0.0189,
      s1mSignal: -0.0156,
      s5mSignal: -0.0267,
      sk2mDiff: -4.1
    },
    {
      symbol: "GOOGL",
      timeframe: "30S",
      time: Date.now().toString(),
      price: 142.34,
      open: 141.89,
      high: 142.78,
      low: 141.45,
      close: 142.34,
      priceChange: 1.56,
      priceChangeCandle: 0.32,
      volume: 15432198,
      macdSignal: 0.0056,
      stochK: 45.2,
      openSignal: 0.0023,
      openTrendSignal: 0.0034,
      s30sSignal: 0.0056,
      s1mSignal: 0.0048,
      s5mSignal: 0.0067,
      sk2mDiff: 1.8
    },
    {
      symbol: "AMZN",
      timeframe: "30S",
      time: Date.now().toString(),
      price: 156.78,
      open: 158.34,
      high: 159.12,
      low: 156.45,
      close: 156.78,
      priceChange: -2.11,
      priceChangeCandle: -0.98,
      volume: 22109876,
      macdSignal: -0.0098,
      stochK: 67.4,
      openSignal: -0.0045,
      openTrendSignal: -0.0067,
      s30sSignal: -0.0098,
      s1mSignal: -0.0089,
      s5mSignal: -0.0123,
      sk2mDiff: -3.2
    },
    {
      symbol: "META",
      timeframe: "30S",
      time: Date.now().toString(),
      price: 498.12,
      open: 495.67,
      high: 499.45,
      low: 494.23,
      close: 498.12,
      priceChange: 4.23,
      priceChangeCandle: 0.49,
      volume: 18765432,
      macdSignal: 0.0289,
      stochK: 76.8,
      openSignal: 0.0156,
      openTrendSignal: 0.0234,
      s30sSignal: 0.0289,
      s1mSignal: 0.0267,
      s5mSignal: 0.0345,
      sk2mDiff: 4.6
    },
    {
      symbol: "NFLX",
      timeframe: "30S",
      time: Date.now().toString(),
      price: 445.67,
      open: 447.89,
      high: 448.23,
      low: 445.12,
      close: 445.67,
      priceChange: -1.78,
      priceChangeCandle: -0.50,
      volume: 12345678,
      macdSignal: -0.0034,
      stochK: 38.9,
      openSignal: -0.0023,
      openTrendSignal: -0.0045,
      s30sSignal: -0.0034,
      s1mSignal: -0.0029,
      s5mSignal: -0.0056,
      sk2mDiff: -2.1
    },
    {
      symbol: "AMD",
      timeframe: "30S",
      time: Date.now().toString(),
      price: 134.56,
      open: 132.89,
      high: 135.12,
      low: 132.45,
      close: 134.56,
      priceChange: 5.12,
      priceChangeCandle: 1.26,
      volume: 35678901,
      macdSignal: 0.0187,
      stochK: 89.2,
      openSignal: 0.0089,
      openTrendSignal: 0.0123,
      s30sSignal: 0.0187,
      s1mSignal: 0.0178,
      s5mSignal: 0.0234,
      sk2mDiff: 6.3
    },
    {
      symbol: "INTC",
      timeframe: "30S",
      time: Date.now().toString(),
      price: 45.23,
      open: 46.78,
      high: 47.12,
      low: 45.01,
      close: 45.23,
      priceChange: -3.45,
      priceChangeCandle: -3.31,
      volume: 28901234,
      macdSignal: -0.0087,
      stochK: 32.6,
      openSignal: -0.0056,
      openTrendSignal: -0.0078,
      s30sSignal: -0.0087,
      s1mSignal: -0.0079,
      s5mSignal: -0.0123,
      sk2mDiff: -5.4
    }
  ]
  console.log('🧪 Development mode: Loaded dummy data for testing')
}

// Extract formatEnhancedStoch function to main scope
function formatEnhancedStoch(row) {
  // Check if we have the required stochastic data
  if (!row.stochK || !row.stochD || !row.stochRefD) {
    return 'No Stoch Data';
  }
  
  // Extract stochastic data from the row
  const stochK = parseFloat(row.stochK) || 0;
  const stochD = parseFloat(row.stochD) || 0;
  const stochRefD = parseFloat(row.stochRefD) || 0;
  const lastCrossType = row.lastCrossType || '';
  
  // Determine crossover/crossunder status or K vs D relationship
  let crossStatus = '';
  if (lastCrossType.toLowerCase() === 'crossover' || stochK > stochD) {
    crossStatus = '↑';  // Recent crossover OR K above D
  } else if (lastCrossType.toLowerCase() === 'crossunder' || stochK < stochD) {
    crossStatus = '↓';  // Recent crossunder OR K below D
  }
  
  // Build the stochastic status string
  let stochPart = '';
  if (crossStatus !== '') {
    if (crossStatus === '↑') {
      if (stochK > 50 && stochK > stochRefD) {
        stochPart = '↑>50>rD';
      } else if (stochK > 50 && stochK < stochRefD) {
        stochPart = '↑>50<rD';
      } else if (stochK < 50 && stochK > stochRefD) {
        stochPart = '↑<50>rD';
      } else {
        stochPart = '↑<50<rD';
      }
    } else { // crossStatus === '↓'
      if (stochK > 50 && stochK > stochRefD) {
        stochPart = '↓>50>rD';
      } else if (stochK > 50 && stochK < stochRefD) {
        stochPart = '↓>50<rD';
      } else if (stochK < 50 && stochK > stochRefD) {
        stochPart = '↓<50>rD';
      } else {
        stochPart = '↓<50<rD';
      }
    }
  } else {
    // No recent cross, show K vs D vs RefD relationship
    if (stochK > 50 && stochK > stochRefD) {
      stochPart = '>50>rD';
    } else if (stochK > 50 && stochK < stochRefD) {
      stochPart = '>50<rD';
    } else if (stochK < 50 && stochK > stochRefD) {
      stochPart = '<50>rD';
    } else {
      stochPart = '<50<rD';
    }
  }
  
  // Get HA vs MACD status
  const haVsMacdStatus = row.haVsMacdStatus || '';
  
  // HA status is optional, so we can return just the stoch momentum if it's not present
  if (!haVsMacdStatus) {
    return stochPart;
  }
  
  // Decode HTML entities from haVsMacdStatus
  const decodedStatus = haVsMacdStatus
    .replace(/\\u003C/g, '<')
    .replace(/\\u003E/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
    
  return stochPart + ' | ' + decodedStatus;
}



// Enhanced pattern recognition display
function formatPatternInfo(row) {
  const lastPattern = row.lastPattern || '';
  const lastCrossType = row.lastCrossType || '';
  const lastCrossValue = parseFloat(row.lastCrossValue) || 0;
  
  if (!lastPattern || lastPattern === 'Standard' || lastPattern === 'Initial') {
    return lastCrossType ? `${lastCrossType} @${lastCrossValue.toFixed(1)}` : 'No Pattern';
  }
  
  // Enhanced pattern display with emojis
  const patternEmojis = {
    'Higher Low': '📈',
    'Lower High': '📉',
    'Higher High': '⬆️',
    'Lower Low': '⬇️'
  };
  
  const emoji = patternEmojis[lastPattern] || '🔄';
  return `${emoji} ${lastPattern} @${lastCrossValue.toFixed(1)}`;
}

// Enhanced market open cross formatting
function formatOpenCross(row) {
  const openCrossType = row.openCrossType || '';
  const openStochK = parseFloat(row.openStochK) || 0;
  const openStochD = parseFloat(row.openStochD) || 0;
  const openStochRefD = parseFloat(row.openStochRefD) || 0;
  const isPremarket = row.isPremarket || false;
  
  // If no open cross data available
  if (!row.openCrossType) {
    return 'No Data';
  }
  
  // Determine cross symbol and strength
  let crossSymbol = '';
  let strength = '';
  
  if (openCrossType.toLowerCase() === 'crossover') {
    crossSymbol = '↑';
    // Determine strength based on position relative to reference
    if (openStochK > openStochRefD && openStochK > 50) {
      strength = 'Strong';
    } else if (openStochK > openStochRefD) {
      strength = 'Mild';
    } else {
      strength = 'Weak';
    }
  } else if (openCrossType.toLowerCase() === 'crossunder') {
    crossSymbol = '↓';
    if (openStochK < openStochRefD && openStochK < 50) {
      strength = 'Strong';
    } else if (openStochK < openStochRefD) {
      strength = 'Mild';
    } else {
      strength = 'Weak';
    }
  }
  
  // Build the cross status with strength indicator
  const prefix = isPremarket ? 'P' : 'M'; // P=Premarket, M=Market
  return `${prefix} ${crossSymbol}${strength.charAt(0)} @${openStochK.toFixed(0)}`;
}

// Generates a detailed stochastic relationship string, e.g., "K > D > rD < 50"
function formatStochDetail(row) {
  const k = parseFloat(row.stochK);
  const d = parseFloat(row.stochD);
  const rd = parseFloat(row.stochRefD);

  if (isNaN(k) || isNaN(d) || isNaN(rd)) {
    return 'N/A';
  }

  const k_rounded = Math.round(k);
  const k_vs_d = k > d ? '>' : '<';
  const d_vs_rd = d > rd ? '>' : '<';

  return `K${k_rounded} ${k_vs_d} D ${d_vs_rd} rD`;
}

// Get signal background color based on value ranges
function getSignalBgColor(value) {
  if (!value || value === 'N/A') return 'bg-white text-black';
  
  const val = parseFloat(value);
  if (isNaN(val)) return 'bg-white text-black';
  
  if (val >= 250) return 'bg-green-600 text-white';      // Deep green
  if (val >= 50) return 'bg-green-300 text-black';       // Light green
  if (val >= -50) return 'bg-white text-black';          // White
  if (val >= -250) return 'bg-red-300 text-black';       // Light red
  return 'bg-red-600 text-white';                        // Deep red
}

// Format Open and Open Trend values
function formatOpenValue(value) {
  if (!value || value === 'N/A') return 'N/A';
  const val = parseFloat(value);
  if (isNaN(val)) return 'N/A';
  return val > 0 ? 'Up' : 'Down';
}

// Format trend based on 2m SK difference
function formatTrend(sk2mDiff) {
  if (!sk2mDiff || sk2mDiff === 'N/A') return 'N/A';
  const val = parseFloat(sk2mDiff);
  if (isNaN(val)) return 'N/A';
  return val > 0 ? 'Up' : 'Down';
}

function getMainHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <title>TradingView Alerts Feed</title>
</head>
<body class="bg-gray-900 text-gray-100">
<div class="mx-auto mt-6" style="width: 98%; max-width: 100%;">
  <div class="text-center mb-6">
    <h1 class="text-2xl font-bold mb-2">Live Trading Data Dashboard</h1>
    <p id="lastUpdate" class="text-sm text-gray-400">Last updated: Never</p>
  </div>
  
  <!-- UNIFIED TRADING ALERTS TABLE -->
  <div class="bg-gray-800 rounded-xl shadow-lg overflow-hidden">
    <div class="bg-gradient-to-r from-blue-700 to-purple-700 px-4 py-3">
      <h2 class="text-lg font-semibold text-white flex items-center">
        <span class="text-xl mr-2">📊</span>
        Live Trading Data

        <span class="ml-2 text-xs bg-black bg-opacity-30 px-2 py-1 rounded">
          <span class="text-green-300">●</span> Bull (HA>50) 
          <span class="text-yellow-300 ml-1">●</span> Critical (HA±50) 
          <span class="text-red-300 ml-1">●</span> Bear (HA<-50)
        </span>
      </h2>
    </div>
    <div class="overflow-x-auto">
      <table class="min-w-full table-fixed">
        <thead class="text-xs uppercase tracking-wider text-gray-400 border-b border-gray-700">
          <tr>
            <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('unified', 'symbol')" style="width: 8%; min-width: 60px;">
              Ticker <span id="unified-symbol-sort" style="margin-left: 0rem; display: none;"></span>
            </th>
            <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('unified', 'price')" style="width: 8%; min-width: 70px;">
              Price <span id="unified-price-sort" style="margin-left: 0rem; display: none;"></span>
            </th>
            <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('unified', 'priceChange')" style="width: 6%; min-width: 50px;">
              Chg% <span id="unified-priceChange-sort" style="margin-left: 0rem; display: none;"></span>
            </th>
            <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('unified', 'volume')" style="width: 6%; min-width: 50px;">
              Vol <span id="unified-volume-sort" style="margin-left: 0rem; display: none;"></span>
            </th>
            <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('unified', 'openSignal')" style="width: 6%; min-width: 50px;">
              Open <span id="unified-openSignal-sort" style="margin-left: 0rem; display: none;"></span>
            </th>
            <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('unified', 'openTrendSignal')" style="width: 8%; min-width: 70px;">
              Open Trend <span id="unified-openTrendSignal-sort" style="margin-left: 0rem; display: none;"></span>
            </th>
            <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('unified', 's30sSignal')" style="width: 6%; min-width: 50px;">
              S30s <span id="unified-s30sSignal-sort" style="margin-left: 0rem; display: none;"></span>
            </th>
            <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('unified', 's1mSignal')" style="width: 6%; min-width: 50px;">
              S1m <span id="unified-s1mSignal-sort" style="margin-left: 0rem; display: none;"></span>
            </th>
            <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('unified', 's5mSignal')" style="width: 6%; min-width: 50px;">
              S5m <span id="unified-s5mSignal-sort" style="margin-left: 0rem; display: none;"></span>
            </th>
            <th class="py-3 px-4 text-left cursor-pointer hover:bg-gray-600" onclick="sortTable('unified', 'sk2mDiff')" style="width: 6%; min-width: 50px;">
              Trend <span id="unified-sk2mDiff-sort" style="margin-left: 0rem; display: none;"></span>
            </th>
            <th class="py-3 px-4 text-center" style="width: 4%; min-width: 40px;">
              <span title="Delete alerts">🗑️</span>
            </th>
          </tr>
        </thead>
        <tbody id="unifiedTable" class="divide-y divide-gray-700"></tbody>
      </table>
      <div id="noAlerts" class="text-center py-8 text-gray-500 hidden">
        <span class="text-4xl mb-2 block">📊</span>
        No trading data yet
      </div>
    </div>
  </div>
</div>

<script>
let previousData = []
let sortState = {
  unified: { column: 'symbol', direction: 'asc' }
}


function formatVolume(volume) {
  if (!volume || volume === 'N/A') return 'N/A'
  const num = parseFloat(volume)
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M'
  } else if (num >= 1000) {
    return (num / 1000).toFixed(0) + 'K'
  }
  return Math.round(num).toString()
}

function getHAGrade(haValue) {
  if (!haValue || haValue === 'N/A') return 'N/A'
  const value = parseFloat(haValue)
  
  if (value >= 0) {
    // Bullish grades
    if (value >= 500) return 'S+'
    if (value >= 350) return 'S'
    if (value >= 200) return 'A+'
    if (value >= 100) return 'A'
    if (value >= 50) return 'B'
    return 'C'
  } else {
    // Bearish grades
    if (value <= -500) return 'S+'
    if (value <= -350) return 'S'
    if (value <= -200) return 'A+'
    if (value <= -100) return 'A'
    if (value <= -50) return 'B'
    return 'C'
  }
}

function getRowBackgroundClass(haValue) {
  if (!haValue || haValue === 'N/A') return 'bg-gray-800'
  const value = parseFloat(haValue)
  
  if (value > 50) {
    return 'bg-green-900 bg-opacity-40 border-l-4 border-green-500' // Bull
  } else if (value < -50) {
    return 'bg-red-900 bg-opacity-40 border-l-4 border-red-500' // Bear
  } else {
    return 'bg-yellow-900 bg-opacity-30 border-l-4 border-yellow-500' // Critical
  }
}

function getHAGradeStyle(haValue, signal) {
  if (!haValue || haValue === 'N/A') return 'bg-gray-600 text-black'
  const grade = getHAGrade(haValue)
  const isBullish = signal === 'Bullish'
  
  if (isBullish) {
    // Bullish signal styles (green tones)
    switch(grade) {
      case 'S+': return 'bg-green-600 text-black'
      case 'S': return 'bg-green-500 text-black'
      case 'A+': return 'bg-green-400 text-black'
      case 'A': return 'bg-green-300 text-black'
      case 'B': return 'bg-yellow-400 text-black'
      case 'C': return 'bg-orange-400 text-black'
      default: return 'bg-gray-600 text-black'
    }
  } else {
    // Bearish signal styles (red tones)
    switch(grade) {
      case 'S+': return 'bg-red-600 text-black'
      case 'S': return 'bg-red-500 text-black'
      case 'A+': return 'bg-red-400 text-black'
      case 'A': return 'bg-red-300 text-black'
      case 'B': return 'bg-yellow-400 text-black'
      case 'C': return 'bg-orange-400 text-black'
      default: return 'bg-gray-600 text-black'
    }
  }
}

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

function formatHAvsSignal(row) {
  const haValue = row.haValue
  const macdSignal = row.macdSignal
  
  if (!haValue || haValue === 'N/A' || !macdSignal || macdSignal === 'N/A') {
    return 'N/A'
  }
  
  const haVal = parseFloat(haValue)
  const signalVal = parseFloat(macdSignal)
  
  if (isNaN(haVal) || isNaN(signalVal)) {
    return 'N/A'
  }
  
  const haValRounded = Math.round(haVal)
  const comparison = haVal > signalVal ? '>' : haVal < signalVal ? '<' : '='
  
  return 'H' + haValRounded + comparison + 'S'
}

function getTradingZoneLogic(row) {
  const haValue = row.haValue || 'N/A'
  const stochStatus = row.stoch || ''
  const lastPattern = row.lastPattern || ''
  
  if (haValue === 'N/A') return { display: row.condition || 'N/A', tooltip: '' }
  
  const haVal = parseFloat(haValue)
  
  // Detect stochastic patterns
  const isHigherLow = lastPattern.includes('Higher Low') || stochStatus.includes('Higher Low')
  const isLowerHigh = lastPattern.includes('Lower High') || stochStatus.includes('Lower High')
  const isCrossover = stochStatus.includes('↑') // K crosses above D
  const isCrossunder = stochStatus.includes('↓') // K crosses below D
  const isKAboveD = stochStatus.includes('>D') || (!stochStatus.includes('<D') && !isCrossunder)
  const isKBelowD = stochStatus.includes('<D') || isCrossunder
  
  if (haVal >= 500) {
    return { display: '🔵 Extreme Bullish', tooltip: 'DO NOT SHORT' }
  } else if (haVal >= 51 && haVal <= 499) {
    if ((isHigherLow && isCrossover) || isKAboveD) {
      return { display: '🟢 SBull', tooltip: 'Higher Low crossover detected or K>D' }
    } else if ((isLowerHigh && isCrossunder) || isKBelowD) {
      return { display: '🟢 Bullish', tooltip: 'Lower High crossunder detected or K<D' }
    }
    return { display: '🟢 SBull', tooltip: 'Maintain long bias' }
  } else if (haVal >= -50 && haVal <= 50) {
    if (isCrossover) {
      return { display: '⚪ Critical Zone tend Buy', tooltip: 'Trend decision point - Crossover detected' }
    } else if (isCrossunder) {
      return { display: '⚪ Critical Zone tend Sell', tooltip: 'Trend decision point - Crossunder detected' }
    }
    return { display: '⚪ Critical Zone', tooltip: 'Trend decision point' }
  } else if (haVal >= -499 && haVal <= -51) {
    if ((isLowerHigh && isCrossunder) || isKAboveD) {
      return { display: '🟠 Bearish', tooltip: 'Lower High crossunder detected or K>D' }
    } else if ((isHigherLow && isCrossover) || isKBelowD) {
      return { display: '🟠 SBearish', tooltip: 'Higher Low crossover detected or K<D' }
    }
    return { display: '🟠 SBearish', tooltip: 'Maintain short bias' }
  } else if (haVal <= -500) {
    return { display: '🔴 Extreme Bearish', tooltip: 'DO NOT LONG' }
  }
  
  return { display: row.condition || 'N/A', tooltip: '' }
}

// Show initial sort indicators after DOM loads
function initializeSortIndicators() {
  setTimeout(() => {
    updateSortIndicators()
  }, 100)
}

function sortTable(tableType, column) {
  const currentSort = sortState[tableType]
  
  // Toggle direction if same column, otherwise default to ascending
  if (currentSort.column === column) {
    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc'
  } else {
    currentSort.column = column
    currentSort.direction = 'asc'
  }
  
  // Update sort indicators
  updateSortIndicators()
  
  // Trigger data refresh to apply new sorting
  fetchAlerts()
}



async function deleteAlert(symbol, timeframe) {
  if (!confirm(\`Are you sure you want to delete the alert for \${symbol}?\`)) {
    return
  }
  
  try {
    const response = await fetch('/delete-alert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ symbol, timeframe })
    })
    
    if (response.ok) {
      // Refresh the alerts display
      fetchAlerts()
    } else {
      alert('Failed to delete alert')
    }
  } catch (error) {
    console.error('Error deleting alert:', error)
    alert('Error deleting alert')
  }
}

function updateSortIndicators() {
  // Hide all sort indicators first
  const allSortSpans = document.querySelectorAll('[id$="-sort"]')
  allSortSpans.forEach(span => {
    span.style.display = 'none'
    span.textContent = ''
  })
  
  // Show and update active sort indicators
  Object.keys(sortState).forEach(tableType => {
    const { column, direction } = sortState[tableType]
    const sortSpan = document.getElementById(\`\${tableType}-\${column}-sort\`)
    if (sortSpan) {
      sortSpan.style.display = 'inline'
      sortSpan.textContent = direction === 'asc' ? '↑' : '↓'
    }
  })
}

function applySorting(alerts, tableType) {
  const { column, direction } = sortState[tableType]
  
  return alerts.sort((a, b) => {
    let aVal = a[column]
    let bVal = b[column]
    
    // Handle numeric columns
    if (column === 'price' || column === 'priceChange' || column === 'volume' || 
        column === 'openSignal' || column === 'openTrendSignal' || 
        column === 's30sSignal' || column === 's1mSignal' || column === 's5mSignal' || 
        column === 'sk2mDiff') {
      aVal = parseFloat(aVal) || 0
      bVal = parseFloat(bVal) || 0
    } else {
      // Handle string columns
      aVal = (aVal || '').toString().toLowerCase()
      bVal = (bVal || '').toString().toLowerCase()
    }
    
    if (direction === 'asc') {
      return aVal > bVal ? 1 : aVal < bVal ? -1 : 0
    } else {
      return aVal < bVal ? 1 : aVal > bVal ? -1 : 0
    }
  })
}

async function fetchAlerts() {
  const res = await fetch('/alerts')
  const data = await res.json()
  
  // Apply current sorting to data
  const sortedData = applySorting([...data], 'unified')
  
  // Update last update time
  const lastUpdate = document.getElementById('lastUpdate')
  if (data.length > 0) {
    const mostRecent = Math.max(...data.map(alert => parseInt(alert.time)))
    lastUpdate.textContent = 'Last updated: ' + new Date(mostRecent).toLocaleString()
  } else {
    lastUpdate.textContent = 'Last updated: Never'
  }
  
  // Update unified table
  const unifiedTable = document.getElementById('unifiedTable')
  const noAlerts = document.getElementById('noAlerts')
  
  if (sortedData.length === 0) {
    unifiedTable.innerHTML = ''
    noAlerts.classList.remove('hidden')
    // Update no alerts message
    const noAlertsSpan = noAlerts.querySelector('span:last-child')
    if (noAlertsSpan) {
      noAlertsSpan.textContent = 'No trading data yet'
    }
  } else {
    noAlerts.classList.add('hidden')
    unifiedTable.innerHTML = sortedData.map(row => {
      // Check if this row was just updated
      const wasUpdated = previousData.length > 0 && 
        previousData.find(prev => prev.symbol === row.symbol && prev.time !== row.time)
      const updateHighlight = wasUpdated ? 'ring-2 ring-blue-400 ring-opacity-50' : ''
      
      // Get background color based on HA value
      const bgClass = getRowBackgroundClass(row.haValue)
      
      // Get signal color and icon
      const signalColor = row.signal === 'Bullish' ? 'text-green-400' : 'text-red-400'
      const signalIcon = row.signal === 'Bullish' ? '📈' : '📉'
      
      return \`
        <tr class="transition-all duration-500 hover:bg-gray-700 hover:bg-opacity-60 \${bgClass} \${updateHighlight}">
          <td class="py-3 px-4 font-semibold text-white relative">
            <div class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" 
                   viewBox="0 0 24 24" 
                   fill="currentColor" 
                   class="w-4 h-4 cursor-pointer hover:text-blue-300 transition-colors duration-200"
                   onclick="showChart('\${row.symbol}', event)"
                   title="Click for chart preview">
                <path d="M5 3V19H21V21H3V3H5ZM20.2929 6.29289L21.7071 7.70711L16 13.4142L13 10.415L8.70711 14.7071L7.29289 13.2929L13 7.58579L16 10.585L20.2929 6.29289Z"></path>
              </svg>
              <span class="hover:text-blue-300 hover:underline cursor-pointer transition-colors duration-200"
                    onclick="window.open('https://www.tradingview.com/chart/?symbol=\${row.symbol}', '_blank')"
                    title="Click to open TradingView">
                \${row.symbol}
              </span>
            </div>
          </td>
          <td class="py-3 px-4 text-white">$\${parseFloat(row.price).toLocaleString()}</td>
          <td class="py-3 px-4 \${parseFloat(row.priceChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'}">\${row.priceChange || 'N/A'}%</td>
          <td class="py-3 px-4 text-white text-xs">\${formatVolume(row.volume)}</td>
          <td class="py-3 px-4 text-white text-xs">\${formatOpenValue(row.openSignal)}</td>
          <td class="py-3 px-4 text-white text-xs">\${formatOpenValue(row.openTrendSignal)}</td>
          <td class="py-3 px-4 text-xs">
            <span class="\${getSignalBgColor(row.s30sSignal)} px-2 py-1 rounded font-semibold">
              \${parseFloat(row.s30sSignal || 0).toFixed(1)}
            </span>
          </td>
          <td class="py-3 px-4 text-xs">
            <span class="\${getSignalBgColor(row.s1mSignal)} px-2 py-1 rounded font-semibold">
              \${parseFloat(row.s1mSignal || 0).toFixed(1)}
            </span>
          </td>
          <td class="py-3 px-4 text-xs">
            <span class="\${getSignalBgColor(row.s5mSignal)} px-2 py-1 rounded font-semibold">
              \${parseFloat(row.s5mSignal || 0).toFixed(1)}
            </span>
          </td>
          <td class="py-3 px-4 text-white text-xs font-semibold">\${formatTrend(row.sk2mDiff)}</td>
          <td class="py-3 px-4 text-center">
            <button onclick="deleteAlert('\${row.symbol}', '\${row.timeframe || ''}')" 
                    class="text-red-400 hover:text-red-300 hover:bg-red-900 hover:bg-opacity-30 p-1 rounded transition-all duration-200" 
                    title="Delete this alert">
              🗑️
            </button>
          </td>
        </tr>
      \`
    }).join('')
  }
  
  previousData = [...data]
}

setInterval(fetchAlerts, 2000)
fetchAlerts()

// Chart overlay functionality
let chartOverlay = null

function showChart(symbol, event) {
  // Prevent event bubbling to avoid conflicts
  if (event) {
    event.stopPropagation()
  }
  
  // Hide any existing chart first
  hideChart()
    
    // Create overlay
    chartOverlay = document.createElement('div')
    chartOverlay.id = 'chart-overlay'
    chartOverlay.style.cssText = 
      'position: fixed;' +
      'top: 50%;' +
      'left: 50%;' +
      'transform: translate(-50%, -50%);' +
      'width: 95vw;' +
      'max-width: 1200px;' +
      'height: 85vh;' +
      'max-height: 800px;' +
      'background: #131722;' +
      'border: 2px solid #2a2e39;' +
      'border-radius: 12px;' +
      'z-index: 1000;' +
      'box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);' +
      'overflow: hidden;'
    
    // Create close button
    const closeButton = document.createElement('button')
    closeButton.innerHTML = '×'
    closeButton.style.cssText = 
      'position: absolute;' +
      'top: 10px;' +
      'right: 15px;' +
      'background: rgba(239, 83, 80, 0.8);' +
      'border: none;' +
      'color: white;' +
      'font-size: 24px;' +
      'font-weight: bold;' +
      'width: 32px;' +
      'height: 32px;' +
      'border-radius: 50%;' +
      'cursor: pointer;' +
      'z-index: 1001;' +
      'display: flex;' +
      'align-items: center;' +
      'justify-content: center;' +
      'transition: all 0.2s ease;'
    closeButton.onmouseover = () => closeButton.style.background = 'rgba(239, 83, 80, 1)'
    closeButton.onmouseout = () => closeButton.style.background = 'rgba(239, 83, 80, 0.8)'
    closeButton.onclick = hideChart
    chartOverlay.appendChild(closeButton)
    
    // Create TradingView widget container
    const widgetContainer = document.createElement('div')
    widgetContainer.className = 'tradingview-widget-container'
    widgetContainer.style.cssText = 'height: 100%; width: 100%;'
    
    // Create main widget div
    const widgetDiv = document.createElement('div')
    widgetDiv.className = 'tradingview-widget-container__widget'
    widgetDiv.style.cssText = 'height: calc(100% - 32px); width: 100%;'
    
    // Create copyright div
    const copyrightDiv = document.createElement('div')
    copyrightDiv.className = 'tradingview-widget-copyright'
    copyrightDiv.innerHTML = '<a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank"><span style="color: #2196F3;">Track all markets on TradingView</span></a>'
    copyrightDiv.style.cssText = 'height: 32px; display: flex; align-items: center; justify-content: center; background: #131722;'
    
    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.type = 'text/javascript'
    script.async = true
    script.innerHTML = JSON.stringify({
      allow_symbol_change: false,
      calendar: false,
      details: false,
      hide_side_toolbar: true,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_volume: false,
      hotlist: false,
      interval: '3',
      locale: 'en',
      save_image: false,
      style: '1',
      symbol: symbol,
      theme: 'dark',
      timezone: 'Etc/UTC',
      backgroundColor: '#0F0F0F',
      gridColor: 'rgba(242, 242, 242, 0.06)',
      watchlist: [],
      withdateranges: false,
      range: '1D',
      compareSymbols: [],
      show_popup_button: true,
      popup_height: '650',
      popup_width: '1000',
      studies: [
        'STD;VWAP',
        'STD;Stochastic',
        'STD;MACD'
      ],
      autosize: true
    })
    
    widgetDiv.appendChild(script)
    widgetContainer.appendChild(widgetDiv)
    widgetContainer.appendChild(copyrightDiv)
    chartOverlay.appendChild(widgetContainer)
    document.body.appendChild(chartOverlay)
    
    // Add backdrop
    const backdrop = document.createElement('div')
    backdrop.id = 'chart-backdrop'
    backdrop.style.cssText = 
      'position: fixed;' +
      'top: 0;' +
      'left: 0;' +
      'width: 100%;' +
      'height: 100%;' +
      'background: rgba(0, 0, 0, 0.5);' +
      'z-index: 999;'
    backdrop.onclick = hideChart
    document.body.appendChild(backdrop)
}

function hideChart() {
  const overlay = document.getElementById('chart-overlay')
  const backdrop = document.getElementById('chart-backdrop')
  
  if (overlay) overlay.remove()
  if (backdrop) backdrop.remove()
  
  chartOverlay = null
}

// Close chart on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideChart()
})

// Initialize sort indicators on page load
initializeSortIndicators()
</script>
</body>
</html>`
}

app.get('/', (req, res) => {
  res.send(getMainHTML())
})

// Function to normalize and enhance webhook data
function normalizeWebhookData(rawAlert) {
  // Normalize field names to consistent camelCase
  const normalized = {
    symbol: rawAlert.symbol,
    signal: rawAlert.signal,
    condition: rawAlert.condition,
    price: rawAlert.price,
    timeframe: rawAlert.timeframe,
    // OHLC data from Pine Script
    open: rawAlert.open,
    high: rawAlert.high,
    low: rawAlert.low,
    close: rawAlert.close,
    // Price change data
    priceChange: rawAlert.priceChange || rawAlert.pricechange,
    priceChangeCandle: rawAlert.priceChangeCandle || rawAlert.pricechangecandle,
    volume: rawAlert.volume,
    // Technical indicators
    macdSignal: rawAlert.macdSignal || rawAlert.macdsignal,
    stochK: rawAlert.stochK || rawAlert.stochk,
    stochD: rawAlert.stochD || rawAlert.stochd,
    stochRefD: rawAlert.stochRefD || rawAlert.stochrefd,
    // Pine Script specific signals
    openSignal: rawAlert.openSignal || rawAlert.opensignal,
    openTrendSignal: rawAlert.openTrendSignal || rawAlert.opentrendsignal,
    s30sSignal: rawAlert.s30sSignal || rawAlert.s30ssignal,
    s1mSignal: rawAlert.s1mSignal || rawAlert.s1msignal,
    s5mSignal: rawAlert.s5mSignal || rawAlert.s5msignal,
    sk2mDiff: rawAlert.sk2mDiff || rawAlert.sk2mdiff,
    // Legacy fields for backward compatibility
    haValue: rawAlert.haValue || rawAlert.havalue,
    lastCrossType: rawAlert.lastCrossType || rawAlert.lastcrosstype,
    lastPattern: rawAlert.lastPattern || rawAlert.lastpattern,
    lastCrossValue: rawAlert.lastCrossValue || rawAlert.lastcrossvalue,
    // Market open cross tracking fields
    openCrossType: rawAlert.openCrossType || rawAlert.opencrosstype,
    openStochK: rawAlert.openStochK || rawAlert.openstochk,
    openStochD: rawAlert.openStochD || rawAlert.openstochd,
    openStochRefD: rawAlert.openStochRefD || rawAlert.openstochrefd,
    isPremarket: rawAlert.isPremarket || rawAlert.ispremarket || false,
    time: rawAlert.time
  }
  
  // Generate haVsMacdStatus if missing
  if (!rawAlert.haVsMacdStatus && normalized.haValue && normalized.macdSignal) {
    const haVal = parseFloat(normalized.haValue)
    const signalVal = parseFloat(normalized.macdSignal)
    
    if (!isNaN(haVal) && !isNaN(signalVal)) {
      const haValRounded = Math.round(haVal)
      
      // Compare HA with MACD Signal
      const comparison = haVal > signalVal ? '>' : haVal < signalVal ? '<' : '='
      
      normalized.haVsMacdStatus = `HA${haValRounded}${comparison}S`
    }
  } else {
    normalized.haVsMacdStatus = rawAlert.haVsMacdStatus
  }
  
  // Always calculate fresh stoch field using detailed format
  normalized.stoch = formatEnhancedStoch(normalized)
  normalized.stochDetail = formatStochDetail(normalized)
  
  return normalized
}

app.post('/webhook', (req, res) => {
  const rawAlert = req.body
  console.log('--- RECEIVED WEBHOOK ---')
  console.log('Headers:', JSON.stringify(req.headers, null, 2))
  console.log('Raw Body:', JSON.stringify(rawAlert, null, 2))
  
  // Validate essential fields before processing
  if (!rawAlert.symbol || rawAlert.symbol.trim() === '') {
    console.log('❌ REJECTED: Missing or empty symbol/ticker name')
    return res.status(400).json({ error: 'Symbol/ticker name is required' })
  }
  
  const alert = normalizeWebhookData(rawAlert)
  console.log('Normalized Alert:', JSON.stringify(alert, null, 2))
  
  // Validate and ensure critical fields are present
  console.log('--- FIELD VALIDATION ---')
  
  // Core price data
  if (alert.price !== undefined && alert.price !== null) {
    console.log(`✓ Price: ${alert.price}`)
  } else {
    console.log('⚠️ WARNING: Missing Price in webhook data')
  }
  
  // OHLC data
  if (alert.open && alert.high && alert.low && alert.close) {
    console.log(`✓ OHLC data complete: O=${alert.open}, H=${alert.high}, L=${alert.low}, C=${alert.close}`)
  } else {
    console.log('⚠️ WARNING: Incomplete OHLC data in webhook')
  }
  
  // Technical indicators
  if (alert.macdSignal !== undefined && alert.macdSignal !== null) {
    console.log(`✓ MACD Signal: ${alert.macdSignal}`)
  } else {
    console.log('⚠️ WARNING: Missing MACD Signal in webhook data')
  }
  
  if (alert.stochK !== undefined && alert.stochK !== null) {
    console.log(`✓ Stochastic K: ${alert.stochK}`)
  } else {
    console.log('⚠️ WARNING: Missing Stochastic K in webhook data')
  }
  
  // Multi-timeframe signals
  const mtfSignals = ['s30sSignal', 's1mSignal', 's5mSignal']
  mtfSignals.forEach(signal => {
    if (alert[signal] !== undefined && alert[signal] !== null) {
      console.log(`✓ ${signal}: ${alert[signal]}`)
    } else {
      console.log(`⚠️ WARNING: Missing ${signal} in webhook data`)
    }
  })
  
  // Open signals
  if (alert.openSignal !== undefined && alert.openSignal !== null) {
    console.log(`✓ Open Signal: ${alert.openSignal}`)
  } else {
    console.log('⚠️ WARNING: Missing Open Signal in webhook data')
  }
  
  if (alert.openTrendSignal !== undefined && alert.openTrendSignal !== null) {
    console.log(`✓ Open Trend Signal: ${alert.openTrendSignal}`)
  } else {
    console.log('⚠️ WARNING: Missing Open Trend Signal in webhook data')
  }
  
  // SK2M difference
  if (alert.sk2mDiff !== undefined && alert.sk2mDiff !== null) {
    console.log(`✓ SK2M Diff: ${alert.sk2mDiff}`)
  } else {
    console.log('⚠️ WARNING: Missing SK2M Diff in webhook data')
  }
  
  // Legacy fields (for backward compatibility)
  if (alert.haValue !== undefined && alert.haValue !== null) {
    console.log(`✓ HA Value (legacy): ${alert.haValue}`)
  }
  
  if (alert.haVsMacdStatus) {
    console.log(`✓ HA vs MACD Status: ${alert.haVsMacdStatus}`)
  }
  
  // Find existing alert for the same symbol and timeframe
  const existingIndex = alerts.findIndex(existing => existing.symbol === alert.symbol && existing.timeframe === alert.timeframe)
  
  if (existingIndex !== -1) {
    // Update existing alert
    alerts[existingIndex] = { ...alert, time: Date.now().toString() }
    console.log(`🔄 Updated existing alert for ${alert.symbol}`)
  } else {
    // Add new alert
    alert.time = Date.now().toString()
    alerts.unshift(alert)
    console.log(`➕ Added new alert for ${alert.symbol}`)
  }
  
  // Keep only the latest 100 unique tickers
  if (alerts.length > 100) alerts.pop()
  
  res.sendStatus(200)
})

app.get('/alerts', (req, res) => {
  // Filter out alerts without valid symbol names
  const validAlerts = alerts.filter(alert => alert.symbol && alert.symbol.trim() !== '')
  res.json(validAlerts)
})

// Delete individual alert endpoint
app.post('/delete-alert', (req, res) => {
  const { symbol, timeframe } = req.body
  
  if (!symbol) {
    return res.status(400).json({ error: 'Symbol is required' })
  }
  
  // Find and remove the alert
  const initialCount = alerts.length
  alerts = alerts.filter(alert => {
    // If timeframe is provided, match both symbol and timeframe
    if (timeframe) {
      return !(alert.symbol === symbol && alert.timeframe === timeframe)
    }
    // If no timeframe provided, just match symbol
    return alert.symbol !== symbol
  })
  
  const deletedCount = initialCount - alerts.length
  
  if (deletedCount > 0) {
    console.log(`🗑️ Deleted ${deletedCount} alert(s) for ${symbol}${timeframe ? ` (${timeframe})` : ''}`)
    res.json({ message: `Deleted ${deletedCount} alert(s) for ${symbol}`, deletedCount })
  } else {
    console.log(`⚠️ No alerts found for ${symbol}${timeframe ? ` (${timeframe})` : ''}`)
    res.status(404).json({ error: 'Alert not found' })
  }
})

// Clear all alerts endpoint (for admin use)
app.delete('/alerts', (req, res) => {
  alerts.length = 0
  console.log('🗑️ All alerts cleared')
  res.json({ message: 'All alerts cleared', count: 0 })
})

// Alternative clear endpoint using GET (for easier access)
app.get('/clear-alerts', (req, res) => {
  const clearedCount = alerts.length
  alerts.length = 0
  console.log(`🗑️ Cleared ${clearedCount} alerts`)
  res.json({ message: `Cleared ${clearedCount} alerts`, previousCount: clearedCount, currentCount: 0 })
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
  
  // Clean up any invalid alerts without symbol names
  const initialCount = alerts.length
  alerts = alerts.filter(alert => alert.symbol && alert.symbol.trim() !== '')
  if (initialCount !== alerts.length) {
    console.log(`🧹 Cleaned up ${initialCount - alerts.length} invalid alerts without symbol names`)
  }
  
  console.log(`Alerts in memory: ${alerts.length}`)
  
  // Process dummy data for development mode
  if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== undefined && alerts.length > 0) {
    alerts.forEach(alert => {
      // Ensure all dummy alerts have the required fields matching Pine Script structure
      if (!alert.timeframe) alert.timeframe = "30S"
      if (!alert.time) alert.time = Date.now().toString()
      
      // Add legacy fields for backward compatibility with existing UI functions
      if (!alert.stochD) alert.stochD = alert.stochK ? alert.stochK - 5 : 50
      if (!alert.stochRefD) alert.stochRefD = alert.stochD ? alert.stochD - 3 : 47
      if (!alert.lastPattern) alert.lastPattern = "Standard"
      if (!alert.lastCrossValue) alert.lastCrossValue = 0
      if (!alert.openCrossType) alert.openCrossType = "Crossover"
      if (!alert.openStochK) alert.openStochK = alert.stochK || 50
      if (!alert.openStochD) alert.openStochD = alert.stochD || 50
      if (!alert.openStochRefD) alert.openStochRefD = alert.stochRefD || 50
      if (alert.isPremarket === undefined) alert.isPremarket = false
      
      // Generate stoch and stochDetail for UI compatibility
      alert.stoch = formatEnhancedStoch(alert)
      alert.stochDetail = formatStochDetail(alert)
    })
    console.log('✅ Processed dummy data to match Pine Script webhook structure')
  } else if (process.env.NODE_ENV === 'production') {
    console.log('🚀 Production mode: Starting with clean alerts array.')
  }
})
