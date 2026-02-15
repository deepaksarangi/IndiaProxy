const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Hardcoded backup Indian proxies (update these regularly)
const BACKUP_INDIAN_PROXIES = [
  '103.155.54.73:83',
  '103.148.92.203:8080',
  '103.76.253.60:3128',
  '43.231.21.176:36415',
  '103.155.217.105:41402',
  '103.159.46.2:83',
  '103.81.77.97:83',
  '103.155.54.185:83',
  '103.69.108.10:8080',
  '103.148.178.228:80',
  '117.239.240.202:53281',
  '103.146.31.51:8080',
  '103.79.35.146:32650',
  '103.240.168.138:8080',
  '103.159.194.205:8080'
];

let indianProxies = [...BACKUP_INDIAN_PROXIES];
let lastProxyFetch = 0;

// Multiple proxy sources
async function fetchIndianProxies() {
  const now = Date.now();
  if (now - lastProxyFetch < 180000 && indianProxies.length > 5) {
    return indianProxies; // Cache for 3 minutes
  }

  console.log('[*] Fetching fresh Indian proxy list...');
  
  const sources = [
    // ProxyScrape
    {
      url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=IN&ssl=all&anonymity=all',
      type: 'text'
    },
    // Proxy-list.download
    {
      url: 'https://www.proxy-list.download/api/v1/get?type=http&anon=elite&country=IN',
      type: 'text'
    },
    // Free Proxy List
    {
      url: 'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
      type: 'text'
    },
    // GeoNode
    {
      url: 'https://proxylist.geonode.com/api/proxy-list?limit=50&page=1&sort_by=lastChecked&sort_type=desc&country=IN',
      type: 'json'
    }
  ];

  const allProxies = new Set(BACKUP_INDIAN_PROXIES);

  for (const source of sources) {
    try {
      const response = await axios.get(source.url, { 
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (source.type === 'json') {
        // Handle JSON response (GeoNode format)
        if (response.data && response.data.data) {
          response.data.data.forEach(proxy => {
            if (proxy.ip && proxy.port) {
              allProxies.add(`${proxy.ip}:${proxy.port}`);
            }
          });
        }
      } else {
        // Handle text response
        const proxies = response.data
          .split('\n')
          .map(p => p.trim())
          .filter(p => p && p.includes(':') && p.split(':').length === 2);
        
        proxies.forEach(p => allProxies.add(p));
      }
      
      console.log(`[✓] Fetched from ${source.url.substring(0, 40)}...`);
      
    } catch (err) {
      console.log(`[!] Failed: ${source.url.substring(0, 40)}...`);
    }
  }

  indianProxies = Array.from(allProxies);
  lastProxyFetch = now;
  
  console.log(`[✓] Total proxies available: ${indianProxies.length}`);
  
  return indianProxies;
}

// Try direct fetch without proxy first, then with proxy
async function fetchWithFallback(targetUrl, customHeaders = {}) {
  console.log(`[*] Fetching: ${targetUrl}`);
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': '*/*',
    ...customHeaders
  };

  // Method 1: Try direct fetch (sometimes works)
  try {
    console.log('[*] Attempting direct fetch...');
    const response = await axios.get(targetUrl, {
      headers,
      timeout: 10000,
      validateStatus: () => true
    });
    
    if (response.status === 200 && response.data) {
      console.log('[✓] Direct fetch successful!');
      return {
        data: response.data,
        status: response.status,
        headers: response.headers,
        method: 'direct'
      };
    }
  } catch (err) {
    console.log('[!] Direct fetch failed:', err.message);
  }

  // Method 2: Try with proxies
  const proxies = await fetchIndianProxies();
  
  if (proxies.length === 0) {
    throw new Error('No proxies available');
  }

  console.log(`[*] Trying with ${proxies.length} proxies...`);
  
  const maxAttempts = Math.min(10, proxies.length);
  
  for (let i = 0; i < maxAttempts; i++) {
    const proxyStr = proxies[i];
    const [host, port] = proxyStr.split(':');
    
    try {
      console.log(`[*] Attempt ${i + 1}/${maxAttempts}: ${proxyStr}`);
      
      const response = await axios.get(targetUrl, {
        proxy: {
          host: host,
          port: parseInt(port),
          protocol: 'http'
        },
        headers,
        timeout: 12000,
        validateStatus: () => true
      });

      if (response.status === 200 && response.data) {
        console.log(`[✓] Success with proxy: ${proxyStr}`);
        return {
          data: response.data,
          status: response.status,
          headers: response.headers,
          proxy: proxyStr,
          method: 'proxy'
        };
      } else {
        console.log(`[!] Proxy ${proxyStr} returned status ${response.status}`);
      }

    } catch (error) {
      console.log(`[!] Proxy ${proxyStr} failed: ${error.message}`);
    }
  }

  throw new Error(`All ${maxAttempts} proxy attempts failed`);
}

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Indian IP Proxy Relay',
    version: '2.0.0',
    proxies: {
      available: indianProxies.length,
      lastFetch: new Date(lastProxyFetch).toISOString()
    },
    endpoints: {
      fetch: '/fetch?url=TARGET_URL',
      status: '/status',
      refresh: '/refresh'
    },
    example: '/fetch?url=https://httpbin.org/ip'
  });
});

// Main fetch endpoint
app.get('/fetch', async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({
      error: 'Missing url parameter',
      usage: '/fetch?url=https://example.com'
    });
  }

  let customHeaders = {};
  if (req.query.customHeaders) {
    try {
      customHeaders = JSON.parse(req.query.customHeaders);
    } catch (e) {
      return res.status(400).json({
        error: 'Invalid customHeaders - must be valid JSON'
      });
    }
  }

  try {
    const result = await fetchWithFallback(targetUrl, customHeaders);

    res.set({
      'Content-Type': result.headers['content-type'] || 'text/plain',
      'X-Proxied-From': 'India',
      'X-Proxy-Method': result.method,
      'X-Proxy-IP': result.proxy || 'direct'
    });

    res.send(result.data);

  } catch (error) {
    console.error('[!] All fetch methods failed:', error.message);
    
    res.status(502).json({
      error: 'All fetch methods failed',
      message: error.message,
      proxiesAttempted: Math.min(10, indianProxies.length),
      totalProxies: indianProxies.length,
      suggestion: 'Try /refresh to update proxy list'
    });
  }
});

// Refresh proxies endpoint
app.get('/refresh', async (req, res) => {
  lastProxyFetch = 0; // Force refresh
  await fetchIndianProxies();
  
  res.json({
    message: 'Proxy list refreshed',
    proxies: indianProxies.length,
    sample: indianProxies.slice(0, 5)
  });
});

// Status endpoint
app.get('/status', async (req, res) => {
  res.json({
    proxies: {
      count: indianProxies.length,
      sample: indianProxies.slice(0, 5),
      lastFetch: new Date(lastProxyFetch).toISOString()
    },
    server: {
      uptime: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      node: process.version
    }
  });
});

// Initialize
fetchIndianProxies();
setInterval(fetchIndianProxies, 300000); // Refresh every 5 minutes

app.listen(PORT, () => {
  console.log(`[✓] Server running on port ${PORT}`);
});