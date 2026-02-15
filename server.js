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
      'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    ];
    
    const allProxies = new Set();
    
    for (const source of sources) {
      try {
        const response = await fetch(source, { timeout: 5000 });
        const text = await response.text();
        const proxies = text.split('\n')
          .map(p => p.trim())
          .filter(p => p && p.includes(':'));
        
        proxies.forEach(p => allProxies.add(p));
      } catch (e) {
        console.log(`Failed to fetch from ${source}`);
      }
    }
    
    workingProxies = Array.from(allProxies);
    lastProxyUpdate = Date.now();
    console.log(`Updated proxy list: ${workingProxies.length} proxies`);
    
  } catch (error) {
    console.error('Failed to update proxy list:', error.message);
  }
}

// Try fetching through multiple proxies
async function fetchThroughProxy(targetUrl, maxAttempts = 5) {
  if (Date.now() - lastProxyUpdate > PROXY_REFRESH_INTERVAL) {
    await updateProxyList();
  }
  
  if (workingProxies.length === 0) {
    throw new Error('No proxies available');
  }
  
  const attempts = Math.min(maxAttempts, workingProxies.length);
  
  for (let i = 0; i < attempts; i++) {
    const proxy = workingProxies[i];
    
    try {
      console.log(`Attempt ${i + 1}/${attempts} using proxy: ${proxy}`);
      
      const agent = new HttpsProxyAgent(`http://${proxy}`);
      
      const response = await fetch(targetUrl, {
        agent,
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
          'Cache-Control': 'no-cache'
        }
      });
      
      if (response.ok) {
        console.log(`✓ Success with proxy: ${proxy}`);
        return response;
      }
      
    } catch (error) {
      console.log(`✗ Failed with proxy ${proxy}: ${error.message}`);
      // Remove failed proxy
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
    proxies: workingProxies.length,
    lastUpdate: new Date(lastProxyUpdate).toISOString(),
    usage: 'GET /proxy?url=https://example.com'
  });
});

// Proxy endpoint
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'url parameter required' });
  }
  
  try {
    const response = await fetchThroughProxy(targetUrl);
    const data = await response.text();
    
    res.set('Content-Type', response.headers.get('content-type') || 'text/plain');
    res.send(data);
    
  } catch (error) {
    res.status(502).json({ 
      error: 'Proxy failed', 
      message: error.message,
      proxiesAvailable: workingProxies.length
    });
  }
});

// Initialize proxy list on startup
updateProxyList();

app.listen(PORT, () => {
  console.log(`Indian Proxy Relay running on port ${PORT}`);
});