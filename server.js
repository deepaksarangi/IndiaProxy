const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log('Query params:', req.query);
  next();
});

// Cache for working proxies
let indianProxies = [];
let lastProxyFetch = 0;

// Fetch Indian proxy list
async function fetchIndianProxies() {
  const now = Date.now();
  if (now - lastProxyFetch < 300000 && indianProxies.length > 0) {
    return indianProxies; // Use cached proxies (5 min cache)
  }

  console.log('[*] Fetching fresh Indian proxy list...');
  
  try {
    const sources = [
      'https://api.proxyscrape.com/v2/?request=get&protocol=http&timeout=10000&country=IN&ssl=all',
      'https://www.proxy-list.download/api/v1/get?type=http&anon=elite&country=IN',
    ];

    const allProxies = new Set();

    for (const source of sources) {
      try {
        const response = await axios.get(source, { timeout: 5000 });
        const proxies = response.data
          .split('\n')
          .map(p => p.trim())
          .filter(p => p && p.includes(':'));
        
        proxies.forEach(p => allProxies.add(p));
      } catch (err) {
        console.log(`[!] Failed to fetch from ${source}`);
      }
    }

    indianProxies = Array.from(allProxies).slice(0, 20); // Keep top 20
    lastProxyFetch = now;
    console.log(`[✓] Fetched ${indianProxies.length} Indian proxies`);
    
    return indianProxies;
  } catch (error) {
    console.error('[!] Error fetching proxies:', error.message);
    return indianProxies; // Return old list if available
  }
}

// Try fetching through proxies
async function fetchThroughProxy(targetUrl, customHeaders = {}) {
  const proxies = await fetchIndianProxies();
  
  if (proxies.length === 0) {
    throw new Error('No Indian proxies available');
  }

  console.log(`[*] Attempting to fetch ${targetUrl}`);
  console.log(`[*] Custom headers:`, customHeaders);
  console.log(`[*] Available proxies: ${proxies.length}`);

  // Try up to 5 proxies
  const maxAttempts = Math.min(5, proxies.length);
  
  for (let i = 0; i < maxAttempts; i++) {
    const proxy = proxies[i];
    const [host, port] = proxy.split(':');
    
    try {
      console.log(`[*] Attempt ${i + 1}/${maxAttempts} with proxy: ${proxy}`);
      
      const response = await axios.get(targetUrl, {
        proxy: {
          host: host,
          port: parseInt(port)
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
          ...customHeaders
        },
        timeout: 15000,
        validateStatus: () => true // Accept any status code
      });

      if (response.status === 200) {
        console.log(`[✓] Success with proxy ${proxy}`);
        return {
          data: response.data,
          status: response.status,
          headers: response.headers,
          proxy: proxy
        };
      } else {
        console.log(`[!] Proxy ${proxy} returned status ${response.status}`);
      }

    } catch (error) {
      console.log(`[!] Proxy ${proxy} failed: ${error.message}`);
      continue;
    }
  }

  throw new Error('All proxy attempts failed');
}

// Root endpoint - Health check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Indian IP Proxy Relay',
    version: '1.0.0',
    endpoints: {
      health: 'GET /',
      proxy: 'GET /fetch?url=TARGET_URL',
      status: 'GET /status'
    },
    usage: {
      example: '/fetch?url=https://example.com',
      withHeaders: '/fetch?url=https://example.com&customHeaders={"User-Agent":"Mozilla"}'
    },
    proxies: indianProxies.length,
    uptime: process.uptime()
  });
});

// Main proxy endpoint
app.get('/fetch', async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({
      error: 'Missing url parameter',
      usage: '/fetch?url=https://example.com',
      example: '/fetch?url=https://zee5.cloud-hatchh.workers.dev/?token=xxx'
    });
  }

  // Parse custom headers if provided
  let customHeaders = {};
  if (req.query.customHeaders) {
    try {
      customHeaders = JSON.parse(req.query.customHeaders);
    } catch (e) {
      return res.status(400).json({
        error: 'Invalid customHeaders parameter',
        message: 'customHeaders must be valid JSON string'
      });
    }
  }

  try {
    const result = await fetchThroughProxy(targetUrl, customHeaders);

    res.set({
      'Content-Type': result.headers['content-type'] || 'text/plain',
      'X-Proxied-From': 'India',
      'X-Proxy-IP': result.proxy,
      'X-Proxy-Status': 'Success'
    });

    res.send(result.data);

  } catch (error) {
    console.error('[!] Fetch failed:', error.message);
    
    res.status(502).json({
      error: 'Proxy request failed',
      message: error.message,
      proxiesAvailable: indianProxies.length,
      suggestion: 'Try again - proxies are being refreshed'
    });
  }
});

// Status endpoint
app.get('/status', async (req, res) => {
  await fetchIndianProxies(); // Refresh proxies
  
  res.json({
    proxies: {
      count: indianProxies.length,
      sample: indianProxies.slice(0, 3),
      lastFetch: new Date(lastProxyFetch).toISOString()
    },
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: ['/', '/fetch', '/status'],
    yourRequest: {
      method: req.method,
      path: req.path,
      query: req.query
    }
  });
});

// Initialize proxy list on startup
fetchIndianProxies();

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[✓] Server running on port ${PORT}`);
  console.log(`[✓] Endpoints:`);
  console.log(`    GET /          - Health check`);
  console.log(`    GET /fetch     - Proxy requests`);
  console.log(`    GET /status    - Proxy status`);
});