import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  chrome_124_win,
  firefox_125_win,
  safari_17_mac,
  fetchWithTlsFingerprint,
  type TlsProfile,
} from './src/lib/proxy.ts';
import { fetchWithStealthedChromium } from './src/lib/browserProxy.ts';
import { fetchWithCuimp } from './src/lib/cuimpProxy.ts';
import { fetchWithJinaReader } from './src/lib/jinaProxy.ts';
import { geonodeService } from './src/lib/geonode.ts';
import { executeWithAutoRotation } from './src/lib/rotateRunner.ts';
import { onekickDataService } from './src/lib/dataService.ts';

const PROFILES: Record<string, TlsProfile> = {
  chrome_124_win,
  firefox_125_win,
  safari_17_mac,
};

async function startServer() {
  const app = express();
  app.use(express.json());
  let dataApiControl = {
    enabled: true,
    statusCode: 503,
    message: 'API temporarily unavailable',
  };

  // Open CORS middleware for /api/data and API consumers
  app.use('/api/data', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Dedicated /api/data endpoint requested by user: isolated high-reliability sports & odds gateway
  const handleDataRequest = async (req: express.Request, res: express.Response) => {
    const targetUrl = (req.method === 'POST' ? req.body.url : req.query.url) as string;
    if (!targetUrl || !targetUrl.trim()) {
      return res.status(400).json({ error: 'Missing required "url" parameter' });
    }

    try {
      new URL(targetUrl.trim());
    } catch {
      return res.status(400).json({ error: `Invalid URL format: "${targetUrl}"` });
    }

    try {
      const result = await onekickDataService.fetchData(targetUrl.trim());
      return res.status(result.statusCode).json(result);
    } catch (err: any) {
      return res.status(502).json({
        success: false,
        statusCode: 502,
        error: err.message || 'Data service execution failed',
      });
    }
  };

  app.get('/api/data/control', (_req, res) => {
    res.json(dataApiControl);
  });

  app.put('/api/data/control', (req, res) => {
    const { enabled, statusCode, message } = req.body ?? {};
    const code = Number(statusCode);

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: '"enabled" must be a boolean' });
    }
    if (!Number.isInteger(code) || code < 200 || code > 599 || [204, 205, 304].includes(code)) {
      return res.status(400).json({ error: 'Use a response code from 200–599 that includes a response body' });
    }
    if (typeof message !== 'string' || message.length > 2000) {
      return res.status(400).json({ error: '"message" must be text of 2000 characters or fewer' });
    }

    dataApiControl = { enabled, statusCode: code, message };
    return res.json(dataApiControl);
  });

  const handleControlledDataRequest = (req: express.Request, res: express.Response) => {
    if (!dataApiControl.enabled) {
      return res.status(dataApiControl.statusCode).type('text/plain').send(dataApiControl.message);
    }
    return handleDataRequest(req, res);
  };

  app.get('/api/data/pool', (req, res) => {
    res.json({
      status: 'active',
      verifiedCount: onekickDataService.getPoolSize(),
      verifiedProxies: onekickDataService.getVerifiedList(),
      scanningIntervalMinutes: 4,
    });
  });

  app.get('/api/data', handleControlledDataRequest);
  app.post('/api/data', handleControlledDataRequest);

  // GET /api/profiles - Returns supported TLS & Browser signatures
  app.get('/api/profiles', (req, res) => {
    res.json({
      profiles: Object.values(PROFILES).map((p) => ({
        id: p.id,
        name: p.name,
        ja3: p.ja3,
        cipherSuites: p.cipherSuites,
        headers: p.headers,
      })),
    });
  });

  // GET /api/geonode/pool - Returns live candidate proxies from Geonode
  app.get('/api/geonode/pool', async (req, res) => {
    try {
      const protocol = (req.query.protocol as any) || 'all';
      const pool = await geonodeService.getPool(protocol);
      const stats = geonodeService.getStats();
      res.json({
        pool,
        stats,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to retrieve Geonode pool', message: err.message });
    }
  });

  // POST /api/geonode/refresh - Force refreshes the Geonode pool
  app.post('/api/geonode/refresh', async (req, res) => {
    try {
      const limit = Number(req.body.limit) || 60;
      const pool = await geonodeService.refreshPool(limit, true);
      res.json({
        success: true,
        count: pool.length,
        pool,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to refresh Geonode pool', message: err.message });
    }
  });

  // POST /api/proxy/rotate - Iterative Auto-Rotation across Geonode pool
  app.post('/api/proxy/rotate', async (req, res) => {
    const { url, maxRetries, protocolFilter, engine, warmUp, customHeaders } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Missing required "url" parameter' });
    }

    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: `Invalid URL format: "${url}"` });
    }

    try {
      const result = await executeWithAutoRotation(url, {
        maxRetries: Number(maxRetries) || 5,
        protocolFilter: protocolFilter || 'all',
        engine: engine || 'browser',
        warmUpSession: warmUp !== false,
        customHeaders,
      });
      res.json(result);
    } catch (err: any) {
      console.error('[Rotate Error]:', err);
      res.status(502).json({
        error: 'Auto-rotation runner failed',
        message: err.message || String(err),
      });
    }
  });

  // Main Proxy Dispatcher (GET or POST)
  const handleProxyRequest = async (req: express.Request, res: express.Response) => {
    const isPost = req.method === 'POST';
    const params = isPost ? req.body : req.query;

    const targetUrl = (params.url as string)?.trim();
    const engine = (params.engine as string) || 'tls'; // 'tls' | 'browser' | 'jina'
    const profileKey = (params.profile as string) || 'chrome_124_win';
    const profile = PROFILES[profileKey] || chrome_124_win;
    const warmUp = params.warmUp === true || params.warmUp === 'true';
    const upstreamProxy = (params.upstreamProxy as string)?.trim() || undefined;

    let customHeaders: Record<string, string> = {};
    if (params.customHeaders) {
      if (typeof params.customHeaders === 'string') {
        try {
          customHeaders = JSON.parse(params.customHeaders);
        } catch {
          // ignore
        }
      } else if (typeof params.customHeaders === 'object') {
        customHeaders = params.customHeaders;
      }
    }

    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing required "url" parameter' });
    }

    try {
      new URL(targetUrl);
    } catch {
      return res.status(400).json({ error: `Invalid URL format: "${targetUrl}"` });
    }

    console.log(`[Proxy] Engine=${engine} Profile=${profileKey} URL=${targetUrl}`);

    try {
      if (engine === 'cuimp') {
        const result = await fetchWithCuimp(targetUrl, {
          proxy: upstreamProxy,
          customHeaders,
        });
        return res.json(result);
      }

      if (engine === 'jina') {
        const result = await fetchWithJinaReader(targetUrl);
        return res.json(result);
      }

      if (engine === 'browser') {
        const result = await fetchWithStealthedChromium(targetUrl, {
          profile,
          customHeaders,
          warmUpSession: warmUp,
          upstreamProxy,
          timeoutMs: 25000,
        });
        return res.json(result);
      }

      // Default: TLS Fingerprint Engine
      const result = await fetchWithTlsFingerprint(
        targetUrl,
        profile,
        customHeaders,
        5
      );
      return res.json(result);
    } catch (err: any) {
      console.error(`[Proxy Error] ${engine} failed for ${targetUrl}:`, err);
      return res.status(502).json({
        error: 'Proxy execution failed',
        message: err.message || String(err),
        engine,
        targetUrl,
      });
    }
  };

  app.get('/api/proxy', handleProxyRequest);
  app.post('/api/proxy', handleProxyRequest);

  // Diagnostics check endpoint
  app.get('/api/diagnostics', async (req, res) => {
    const stats = geonodeService.getStats();
    res.json({
      status: 'operational',
      serverIp: '34.34.246.85 (Google Cloud Datacenter ASN15169)',
      engines: [
        {
          id: 'rotate',
          name: 'Geonode Auto-Rotation Multi-Hop Engine',
          features: ['Elite Proxy Cycling', 'Auto 403 Failover', 'Health Ranking', 'Hop Ledger'],
        },
        {
          id: 'browser',
          name: 'Stealthed Chromium + Chrome 124 Profile',
          features: ['Puppeteer Stealth', 'Automation Masking', 'Session Warmup', 'Upstream Tunnel'],
        },
        {
          id: 'tls',
          name: 'Direct TLS Fingerprint Engine',
          features: ['JA3 Mimicry', 'Cipher Suite Ordering', 'Zlib Decompression', 'Redirect Following'],
        },
        {
          id: 'jina',
          name: 'Jina AI Reader Engine',
          features: ['Reader API (r.jina.ai)', 'LLM Markdown Formatting'],
        },
      ],
      activeProfile: chrome_124_win.id,
      geonodePool: stats,
      timestamp: new Date().toISOString(),
    });
  });

  if (process.env.NODE_ENV === 'production') {
    const frontendPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(frontendPath));
    app.get('*', (_req, res) => res.sendFile(path.join(frontendPath, 'index.html')));
  } else {
    // Mount Vite middleware for the Replit preview SPA.
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        allowedHosts: true,
        cors: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = Number.parseInt(process.env.PORT || '5000', 10);
  app.listen(port, '0.0.0.0', () => {
    console.log(`ApexProxy server listening on port ${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
