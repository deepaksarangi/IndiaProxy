const express = require('express');
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = process.env.PORT || 3000;

// Cache for working proxies
let workingProxies = [];
let lastProxyUpdate = 0;
const PROXY_REFRESH_INTERVAL = 300000; // 5 minutes

// Fetch fresh Indian proxies
async function updateProxyList() {
  try {
    const sources = [
      'https://www.proxy-list.download/api/v1/get?type=http&anon=elite&country=IN',
      'https://api.proxyscrape.com/v2/?request=get&protocol=http&timeout=10000&country=IN',
    ];
    
    const allProxies = new Set();
    
    for (const source of sources) {
      try {
        const response = await fetch(source, { timeout: 5000 });
        const text = await response.text();
        const proxies = text.split('\n')
          .map(p => p.trim())
          .filter(p => p && p.includes(':') && p.split(':').length === 2);
        
        proxies.forEach(p => allProxies.add(p));
      } catch (e) {
        console.log(`Failed to fetch from ${source}`);
      }
    }
    
    workingProxies = Array.from(allProxies);
    lastProxyUpdate = Date.now();
    console.log(`[${new Date().toISOString()}] Updated proxy list: ${workingProxies.length} proxies`);
    
  } catch (error) {
    console.error('Failed to update proxy list:', error.message);
  }
}

// Try fetching through multiple proxies with custom headers
async function fetchThroughProxy(targetUrl, customHeaders = {}, maxAttempts = 5) {
  if (Date.now() - lastProxyUpdate > PROXY_REFRESH_INTERVAL) {
    await updateProxyList();
  }
  
  if (workingProxies.length === 0) {
    throw new Error('No proxies available');
  }
  
  const attempts = Math.min(maxAttempts, workingProxies.length);
  
  // Default headers merged with custom headers
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': '*/*',
    'Cache-Control': 'no-cache',
    ...customHeaders // Override with custom headers
  };
  
  for (let i = 0; i < attempts; i++) {
    const proxy = workingProxies[i];
    
    try {
      console.log(`[${new Date().toISOString()}] Attempt ${i + 1}/${attempts} using proxy: ${proxy}`);
      
      const agent = new HttpsProxyAgent(`http://${proxy}`);
      
      const response = await fetch(targetUrl, {
        agent,
        timeout: 15000,
        headers: headers
      });
      
      if (response.ok) {
        console.log(`[${new Date().toISOString()}] ✓ Success with proxy: ${proxy}`);
        return response;
      }
      
      console.log(`[${new Date().toISOString()}] Proxy ${proxy} returned status: ${response.status}`);
      
    } catch (error) {
      console.log(`[${new Date().toISOString()}] ✗ Failed with proxy ${proxy}: ${error.message}`);
      // Remove failed proxy from the pool
      workingProxies.splice(i, 1);
      i--;
    }
  }
  
  throw new Error('All proxy attempts failed');
}

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    service: 'Indian IP Proxy Relay',
    proxies: workingProxies.length,
    lastUpdate: new Date(lastProxyUpdate).toISOString(),
    uptime: process.uptime(),
    usage: {
      endpoint: '/proxy',
      params: {
        url: 'Target URL (required)',
        headers: 'JSON string of custom headers (optional)'
      },
      example: '/proxy?url=https://example.com&headers={"User-Agent":"Custom"}'
    }
  });
});

// Main proxy endpoint
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ 
      error: 'Missing url parameter',
      usage: '/proxy?url=https://example.com'
    });
  }
  
  // Parse custom headers if provided
  let customHeaders = {};
  if (req.query.headers) {
    try {
      customHeaders = JSON.parse(req.query.headers);
      console.log(`[${new Date().toISOString()}] Custom headers received:`, customHeaders);
    } catch (e) {
      return res.status(400).json({ 
        error: 'Invalid headers parameter',
        message: 'headers must be valid JSON'
      });
    }
  }
  
  try {
    const response = await fetchThroughProxy(targetUrl, customHeaders);
    const data = await response.text();
    
    console.log(`[${new Date().toISOString()}] Response length: ${data.length} bytes`);
    
    // Set response headers
    res.set('Content-Type', response.headers.get('content-type') || 'text/plain');
    res.set('X-Proxied-From', 'India');
    res.set('X-Proxy-Status', 'Success');
    
    res.send(data);
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Proxy failed:`, error.message);
    
    res.status(502).json({ 
      error: 'Proxy request failed', 
      message: error.message,
      proxiesAvailable: workingProxies.length,
      suggestion: 'Try again in a few moments'
    });
  }
});

// Proxy status endpoint
app.get('/status', (req, res) => {
  res.json({
    proxies: {
      total: workingProxies.length,
      sample: workingProxies.slice(0, 5),
      lastUpdate: new Date(lastProxyUpdate).toISOString()
    },
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version
    }
  });
});

// Initialize proxy list on startup
updateProxyList();

// Refresh proxy list periodically
setInterval(updateProxyList, PROXY_REFRESH_INTERVAL);

app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Indian Proxy Relay Server running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] Ready to proxy requests through Indian IPs`);
});