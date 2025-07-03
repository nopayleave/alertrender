import React, { useState, useEffect } from "react";

// Stock Alert Dashboard with data fetching
export default function StockTable() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Get background color based on signal value
  const getBg = (v) => {
    if (v >= 250) return "bg-green-700 text-white";
    if (v >= 50) return "bg-green-200 text-gray-800";
    if (v > -50) return "bg-white text-gray-800";
    if (v >= -250) return "bg-red-200 text-gray-800";
    return "bg-red-700 text-white";
  };

  // Format trend direction
  const getTrendDirection = (value) => {
    if (value > 0) return "↑ Up";
    if (value < 0) return "↓ Down";
    return "- Flat";
  };

  // Fetch data from webhook/API endpoint
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      let response;
      
      // Try to fetch from webhook endpoint
      try {
        response = await fetch('/api/webhook-data');
        if (!response.ok) throw new Error('Webhook endpoint not available');
      } catch (webhookError) {
        // Try to fetch from local JSON file
        try {
          response = await fetch('/stock-data.json');
          if (!response.ok) throw new Error('Local JSON file not available');
        } catch (localError) {
          // Use sample data for demonstration
          throw new Error('No data source available');
        }
      }
      
      const fetchedData = await response.json();
      setData(Array.isArray(fetchedData) ? fetchedData : [fetchedData]);
      setLastUpdate(new Date().toLocaleTimeString());
      
    } catch (err) {
      // Use sample data for demonstration
      setData([
        {
          symbol: "AAPL",
          price: 150.25,
          priceChange: 2.35,
          volume: 1250000,
          "2m930signal": 45,
          "2m932signal": 52,
          "2m1000signal": 48,
          s30sSignal: 75,
          s1mSignal: -100,
          s5mSignal: 300,
          sk2mDiff: 5.2
        },
        {
          symbol: "TSLA",
          price: 248.90,
          priceChange: -1.85,
          volume: 890000,
          "2m930signal": 30,
          "2m932signal": 25,
          "2m1000signal": 35,
          s30sSignal: -180,
          s1mSignal: 120,
          s5mSignal: -300,
          sk2mDiff: -2.1
        },
        {
          symbol: "MSFT",
          price: 338.15,
          priceChange: 0.95,
          volume: 675000,
          "2m930signal": 60,
          "2m932signal": 58,
          "2m1000signal": 65,
          s30sSignal: 280,
          s1mSignal: 45,
          s5mSignal: -75,
          sk2mDiff: 1.8
        }
      ]);
      setError(`Using sample data. Error: ${err.message}`);
      setLastUpdate(new Date().toLocaleTimeString());
    }
    
    setLoading(false);
  };

  // Auto-refresh every 30 seconds
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="p-4 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <p className="mt-2 text-gray-600">Loading stock data...</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6 flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-800">Stock Alert Dashboard</h1>
          <button 
            onClick={fetchData}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold transition-transform hover:scale-105"
          >
            🔄 Refresh Data
          </button>
        </div>
        
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-100 text-sm font-semibold text-gray-700">
                  <th className="px-4 py-3 text-left">Ticker</th>
                  <th className="px-4 py-3 text-center">Price</th>
                  <th className="px-4 py-3 text-center">Chg%</th>
                  <th className="px-4 py-3 text-center">Vol</th>
                  <th className="px-4 py-3 text-center">Open</th>
                  <th className="px-4 py-3 text-center">Open Trend</th>
                  <th className="px-4 py-3 text-center">S30s</th>
                  <th className="px-4 py-3 text-center">S1m</th>
                  <th className="px-4 py-3 text-center">S5m</th>
                  <th className="px-4 py-3 text-center">Trend</th>
                </tr>
              </thead>
              <tbody>
                {data.length === 0 ? (
                  <tr>
                    <td colSpan="10" className="px-4 py-8 text-center text-gray-500">
                      No stock data available. Click "Refresh Data" to load data.
                    </td>
                  </tr>
                ) : (
                  data.map((row, i) => {
                    // Open: 2m932signal - 2m930signal
                    const openValue = (row["2m932signal"] ?? 0) - (row["2m930signal"] ?? 0);
                    const openStr = getTrendDirection(openValue);
                    
                    // Open Trend: 2m1000signal - 2m932signal
                    const openTrendValue = (row["2m1000signal"] ?? 0) - (row["2m932signal"] ?? 0);
                    const openTrendStr = getTrendDirection(openTrendValue);
                    
                    // Trend: sk2mDiff
                    const trendStr = getTrendDirection(row.sk2mDiff ?? 0);

                    return (
                      <tr key={i} className="border-b hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-bold text-gray-800">{row.symbol || '-'}</td>
                        <td className="px-4 py-3 text-center">{row.price?.toFixed(2) || '-'}</td>
                        <td className={`px-4 py-3 text-center ${(row.priceChange || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {row.priceChange?.toFixed(2) + '%' || '-'}
                        </td>
                        <td className="px-4 py-3 text-center text-sm">{row.volume?.toLocaleString() || '-'}</td>
                        <td className="px-4 py-3 text-center text-sm">{openStr}</td>
                        <td className="px-4 py-3 text-center text-sm">{openTrendStr}</td>
                        <td className={`px-4 py-3 text-center text-sm font-semibold ${getBg(row.s30sSignal ?? 0)}`}>
                          {row.s30sSignal ?? '-'}
                        </td>
                        <td className={`px-4 py-3 text-center text-sm font-semibold ${getBg(row.s1mSignal ?? 0)}`}>
                          {row.s1mSignal ?? '-'}
                        </td>
                        <td className={`px-4 py-3 text-center text-sm font-semibold ${getBg(row.s5mSignal ?? 0)}`}>
                          {row.s5mSignal ?? '-'}
                        </td>
                        <td className="px-4 py-3 text-center text-sm">{trendStr}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        
        {lastUpdate && (
          <div className="text-center text-gray-500 text-sm mt-4">
            Last updated: {lastUpdate}
          </div>
        )}
      </div>
    </div>
  );
}
