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
      url: 'https://proxylist.geonode.com/api/proxy-list?limit=50&page=1&sort_by=lastChecked&sort_