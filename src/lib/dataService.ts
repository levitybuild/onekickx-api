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

interface ProxyHealth {
  proxy: string;
  successCount: number;
  failCount: number;
  avgLatencyMs: number;
  lastChecked: number;
}

class OnekickDataService {
  // Map of proxy -> health metrics
  private proxyHealthMap: Map<string, ProxyHealth> = new Map();
  private cache: Map<string, { data: any; timestamp: number; proxy: string }> = new Map();
  private readonly CACHE_TTL_MS = 20 * 1000; // 20s fresh cache for live odds & scores
  private isScanning: boolean = false;

  constructor() {
    // Seed initial elite working proxies verified against SofaScore live football endpoint
    const initialProxies = [
      '27.185.218.213:17981',
      '45.6.224.76:1256',
      '103.31.103.71:8080',
      '120.232.115.170:17981',
      '154.201.127.230:8080',
      '103.175.81.249:8080',
      '194.87.10.245:1234',
    ];

    for (const p of initialProxies) {
      this.proxyHealthMap.set(p, {
        proxy: p,
        successCount: 10,
        failCount: 0,
        avgLatencyMs: 400,
        lastChecked: Date.now(),
      });
    }

    // Start background scanner to continuously broaden and verify pool against live events
    this.startBackgroundBroadener();
  }

  /**
   * Returns sorted array of healthy proxies, healthiest/fastest first
   */
  private getSortedHealthyProxies(): string[] {
    const list = Array.from(this.proxyHealthMap.values());
    list.sort((a, b) => {
      // Score = successCount - (failCount * 3) - (avgLatencyMs / 200)
      const scoreA = a.successCount * 2 - a.failCount * 5 - a.avgLatencyMs / 300;
      const scoreB = b.successCount * 2 - b.failCount * 5 - a.avgLatencyMs / 300;
      return scoreB - scoreA;
    });

    return list.map((item) => item.proxy);
  }

  /**
   * Dispatches concurrent requests across healthiest verified proxies
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

    const candidateList = this.getSortedHealthyProxies();
    if (candidateList.length === 0) {
      candidateList.push('27.185.218.213:17981', '45.6.224.76:1256');
    }

    // Select top 3 healthiest candidates to race in parallel
    const activeCandidates = candidateList.slice(0, 3);
    console.log(`[OnekickDataService] Racing healthiest proxies for ${targetUrl}:`, activeCandidates);

    const racePromises = activeCandidates.map(async (proxy) => {
      const pUrl = proxy.startsWith('http') || proxy.startsWith('socks') ? proxy : `http://${proxy}`;
      const hopStart = Date.now();
      const res = await fetchWithCuimp(targetUrl, {
        proxy: pUrl,
        timeoutMs: 6500,
      });

      const latency = Date.now() - hopStart;
      if (res.statusCode === 200 && res.data) {
        return { proxy, res, latency };
      }
      throw new Error(`Proxy ${proxy} failed with status ${res.statusCode}`);
    });

    try {
      const winner = await Promise.any(racePromises);
      const totalLatency = Date.now() - startTime;

      // Update health metrics (success)
      const health = this.proxyHealthMap.get(winner.proxy);
      if (health) {
        health.successCount++;
        health.avgLatencyMs = Math.round((health.avgLatencyMs * 4 + winner.latency) / 5);
        health.lastChecked = Date.now();
      }

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
        winningProxy: `${winner.proxy} (${winner.latency}ms)`,
        latencyMs: totalLatency,
        cached: false,
      };
    } catch (allFailed) {
      console.warn('[OnekickDataService] First wave race missed, triggering sequential fallback & scan...');

      // Update failure metrics for racers
      for (const proxy of activeCandidates) {
        const h = this.proxyHealthMap.get(proxy);
        if (h) h.failCount++;
      }

      // Fallback: try remaining candidates
      for (const proxy of candidateList.slice(3, 8)) {
        try {
          const pUrl = proxy.startsWith('http') || proxy.startsWith('socks') ? proxy : `http://${proxy}`;
          const hopStart = Date.now();
          const res = await fetchWithCuimp(targetUrl, { proxy: pUrl, timeoutMs: 5500 });
          const latency = Date.now() - hopStart;

          if (res.statusCode === 200 && res.data) {
            const h = this.proxyHealthMap.get(proxy);
            if (h) {
              h.successCount++;
              h.avgLatencyMs = Math.round((h.avgLatencyMs + latency) / 2);
            }
            this.cache.set(targetUrl, { data: res.data, timestamp: Date.now(), proxy });
            return {
              success: true,
              statusCode: 200,
              data: res.data,
              winningProxy: `${proxy} (${latency}ms)`,
              latencyMs: Date.now() - startTime,
              cached: false,
            };
          }
        } catch {
          const h = this.proxyHealthMap.get(proxy);
          if (h) h.failCount++;
        }
      }

      // Trigger background pool broadening immediately
      this.scanAndBroadenPool();

      return {
        success: false,
        statusCode: 403,
        data: { error: 'Upstream rate-limit or proxy timeout; auto-shuffling pool.' },
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Background task: strictly verifies proxies against SofaScore live football events before adding
   */
  async scanAndBroadenPool() {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      console.log('[OnekickDataService] Broadening and strictly verifying proxies against SofaScore live events...');
      const candidateUrls = [
        'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=yes&anonymity=elite',
        'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
        'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
      ];

      const rawProxies = new Set<string>();

      // 1. Fetch from Geonode API
      await new Promise<void>((resolve) => {
        https.get(
          'https://proxylist.geonode.com/api/proxy-list?limit=60&page=1&sort_by=lastChecked&sort_type=desc&anonymityLevel=elite&anonymityLevel=anonymous',
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

      // 2. Fetch from ProxyScrape and GitHub lists
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

      // Sample 120 candidates for strict SofaScore live events verification
      const sampleBatch = Array.from(rawProxies).slice(0, 120);
      await Promise.allSettled(
        sampleBatch.map(async (proxy) => {
          try {
            const hopStart = Date.now();
            const res = await fetchWithCuimp('https://www.sofascore.com/api/v1/event/16115794/odds/1/all', {
              proxy: `http://${proxy}`,
              timeoutMs: 4000,
            });
            const latency = Date.now() - hopStart;

            // Only mark proxies elite when the actual odds endpoint returns JSON successfully.
            if (res.statusCode === 200 && res.data && typeof res.data === 'object') {
              console.log(`[OnekickDataService] Verified SofaScore odds proxy added: ${proxy} (${latency}ms)`);
              this.proxyHealthMap.set(proxy, {
                proxy,
                successCount: 5,
                failCount: 0,
                avgLatencyMs: latency,
                lastChecked: Date.now(),
              });
            }
          } catch {
            // failed verification
          }
        })
      );

      console.log(`[OnekickDataService] Broadening complete. Verified pool contains ${this.proxyHealthMap.size} healthy proxies.`);
    } finally {
      this.isScanning = false;
    }
  }

  private startBackgroundBroadener() {
    setTimeout(() => this.scanAndBroadenPool(), 6000);
    setInterval(() => this.scanAndBroadenPool(), 4 * 60 * 1000);
  }

  getPoolSize(): number {
    return this.proxyHealthMap.size;
  }

  getVerifiedList(): string[] {
    return this.getSortedHealthyProxies();
  }
}

export const onekickDataService = new OnekickDataService();
