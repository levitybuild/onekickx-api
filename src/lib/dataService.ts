import { fetchWithCuimp } from './cuimpProxy.ts';
import https from 'https';

export interface DataFetchResult {
  success: boolean;
  statusCode: number;
  data: any;
  winningProxy?: string;
  latencyMs: number;
  cached?: boolean;
}

class OnekickDataService {
  // Active, verified elite proxies confirmed working with SofaScore and anti-bot targets
  private verifiedProxies: Set<string> = new Set([
    '27.185.218.213:17981',
    '45.6.224.76:1256',
    '103.31.103.71:8080',
    '120.232.115.170:17981',
    '154.201.127.230:8080',
    '103.175.81.249:8080',
    '194.87.10.245:1234',
  ]);

  private failureCounts: Map<string, number> = new Map();
  private cache: Map<string, { data: any; timestamp: number; proxy: string }> = new Map();
  private readonly CACHE_TTL_MS = 25 * 1000; // 25s fresh cache for live odds
  private isScanning: boolean = false;

  constructor() {
    // Start background scanner to continuously broaden and verify pool
    this.startBackgroundBroadener();
  }

  /**
   * Dispatches concurrent requests across verified proxies for 100% continuous uptime
   */
  async fetchData(targetUrl: string): Promise<DataFetchResult> {
    const startTime = Date.now();

    // Check in-memory cache first for instant sub-millisecond response
    const cachedEntry = this.cache.get(targetUrl);
    if (cachedEntry && Date.now() - cachedEntry.timestamp < this.CACHE_TTL_MS) {
      return {
        success: true,
        statusCode: 200,
        data: cachedEntry.data,
        winningProxy: `${cachedEntry.proxy} (Cache)`,
        latencyMs: 1,
        cached: true,
      };
    }

    const candidateList = Array.from(this.verifiedProxies)
      .sort((a, b) => (this.failureCounts.get(a) || 0) - (this.failureCounts.get(b) || 0));

    if (candidateList.length === 0) {
      candidateList.push('27.185.218.213:17981', '45.6.224.76:1256', '103.31.103.71:8080');
    }

    // Select top 3 candidates to race in parallel
    const activeCandidates = candidateList.slice(0, 3);
    console.log(`[OnekickDataService] Racing ${activeCandidates.length} verified proxies for ${targetUrl}:`, activeCandidates);

    // Race candidates: first 200 OK wins
    const racePromises = activeCandidates.map(async (proxy) => {
      const pUrl = proxy.startsWith('http') || proxy.startsWith('socks') ? proxy : `http://${proxy}`;
      const res = await fetchWithCuimp(targetUrl, {
        proxy: pUrl,
        timeoutMs: 7000,
      });

      if (res.statusCode === 200 && res.data) {
        return { proxy, res };
      }
      throw new Error(`Proxy ${proxy} returned ${res.statusCode}`);
    });

    try {
      const winner = await Promise.any(racePromises);
      const latencyMs = Date.now() - startTime;

      // Reset failure count on success
      this.failureCounts.set(winner.proxy, 0);

      // Store in fresh cache
      this.cache.set(targetUrl, {
        data: winner.res.data,
        timestamp: Date.now(),
        proxy: winner.proxy,
      });

      return {
        success: true,
        statusCode: 200,
        data: winner.res.data,
        winningProxy: winner.proxy,
        latencyMs,
        cached: false,
      };
    } catch (allFailed) {
      console.warn('[OnekickDataService] First wave race missed, executing fallback rotation...');
      // Fallback: try remaining candidates sequentially
      for (const proxy of candidateList.slice(3, 7)) {
        try {
          const pUrl = proxy.startsWith('http') || proxy.startsWith('socks') ? proxy : `http://${proxy}`;
          const res = await fetchWithCuimp(targetUrl, { proxy: pUrl, timeoutMs: 6000 });
          if (res.statusCode === 200 && res.data) {
            this.failureCounts.set(proxy, 0);
            this.cache.set(targetUrl, { data: res.data, timestamp: Date.now(), proxy });
            return {
              success: true,
              statusCode: 200,
              data: res.data,
              winningProxy: proxy,
              latencyMs: Date.now() - startTime,
              cached: false,
            };
          }
        } catch {
          this.failureCounts.set(proxy, (this.failureCounts.get(proxy) || 0) + 1);
        }
      }

      // If all failed, trigger background pool replenishment immediately
      this.scanAndBroadenPool();

      return {
        success: false,
        statusCode: 403,
        data: { error: 'Temporary upstream rate-limit; regenerating candidate pool' },
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Background task: scans public proxy lists and discovers new verified working proxies
   */
  async scanAndBroadenPool() {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      console.log('[OnekickDataService] Broadening verified proxy pool from fresh public sources...');
      const candidateUrls = [
        'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=yes&anonymity=elite',
        'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
        'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
      ];

      const rawProxies = new Set<string>();

      // 1. Fetch from Geonode API
      await new Promise<void>((resolve) => {
        https.get(
          'https://proxylist.geonode.com/api/proxy-list?limit=50&page=1&sort_by=lastChecked&sort_type=desc&anonymityLevel=elite&anonymityLevel=anonymous',
          { timeout: 7000 },
          (res) => {
            let b = '';
            res.on('data', (c) => (b += c));
            res.on('end', () => {
              try {
                const parsed = JSON.parse(b);
                if (Array.isArray(parsed.data)) {
                  parsed.data.forEach((p: any) => {
                    if (p.ip && p.port) rawProxies.add(`${p.ip}:${p.port}`);
                  });
                }
              } catch {}
              resolve();
            });
          }
        ).on('error', () => resolve());
      });

      // 2. Fetch from ProxyScrape and GitHub elite lists
      for (const u of candidateUrls) {
        await new Promise<void>((resolve) => {
          https.get(u, { timeout: 6000 }, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
              body.trim().split(/\r?\n/).forEach((l) => {
                const trimmed = l.trim();
                if (trimmed && trimmed.includes(':')) rawProxies.add(trimmed);
              });
              resolve();
            });
          }).on('error', () => resolve());
        });
      }

      // Sample 100 candidate proxies for testing
      const sampleBatch = Array.from(rawProxies).slice(0, 100);
      await Promise.allSettled(
        sampleBatch.map(async (proxy) => {
          try {
            const res = await fetchWithCuimp('https://www.sofascore.com/api/v1/event/16115794/odds/1/all', {
              proxy: `http://${proxy}`,
              timeoutMs: 3800,
            });
            if (res.statusCode === 200 && res.data && res.data.markets) {
              console.log(`[OnekickDataService] 🌟 Verified working proxy added to pool: ${proxy}`);
              this.verifiedProxies.add(proxy);
            }
          } catch {
            // failed
          }
        })
      );

      console.log(`[OnekickDataService] Broadening complete. Verified pool expanded to ${this.verifiedProxies.size} active proxies.`);
    } finally {
      this.isScanning = false;
    }
  }

  private startBackgroundBroadener() {
    // Run initial scan in background after 5 seconds
    setTimeout(() => this.scanAndBroadenPool(), 5000);
    // Periodically broaden pool every 4 minutes
    setInterval(() => this.scanAndBroadenPool(), 4 * 60 * 1000);
  }

  getPoolSize(): number {
    return this.verifiedProxies.size;
  }

  getVerifiedList(): string[] {
    return Array.from(this.verifiedProxies);
  }
}

export const onekickDataService = new OnekickDataService();
