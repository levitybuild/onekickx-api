import https from 'https';

export interface GeonodeProxy {
  ip: string;
  port: string;
  protocols: string[]; // e.g. ['http', 'https', 'socks5']
  anonymityLevel: 'elite' | 'anonymous' | 'transparent';
  country: string;
  speed: number;
  upTime: number;
  lastChecked: number;
  source?: 'geonode' | 'proxyscrape';
  failCount?: number;
  successCount?: number;
  lastStatus?: number;
}

class GeonodeService {
  private cachedPool: GeonodeProxy[] = [];
  private lastFetchedAt: number = 0;
  private readonly CACHE_TTL_MS = 6 * 60 * 1000; // 6 minutes
  private isFetching: boolean = false;
  private failureBlacklist: Map<string, number> = new Map(); // ip:port -> blacklist timestamp
  private verifiedProxies: Set<string> = new Set(['27.185.218.213:17981']); // pre-verified winner

  /**
   * Fetches fresh proxies from Geonode and ProxyScrape public APIs
   */
  async refreshPool(limit: number = 60, force: boolean = false): Promise<GeonodeProxy[]> {
    const now = Date.now();
    if (!force && this.cachedPool.length > 0 && now - this.lastFetchedAt < this.CACHE_TTL_MS) {
      return this.cachedPool;
    }

    if (this.isFetching && this.cachedPool.length > 0) {
      return this.cachedPool;
    }

    this.isFetching = true;
    try {
      console.log('[ProxyPool] Fetching elite candidate proxies from Geonode & ProxyScrape...');

      const [geonodeData, proxyscrapeData] = await Promise.allSettled([
        this.fetchFromGeonode(limit),
        this.fetchFromProxyScrape(),
      ]);

      const newProxies: GeonodeProxy[] = [];

      if (geonodeData.status === 'fulfilled' && Array.isArray(geonodeData.value)) {
        newProxies.push(...geonodeData.value);
      }

      if (proxyscrapeData.status === 'fulfilled' && Array.isArray(proxyscrapeData.value)) {
        newProxies.push(...proxyscrapeData.value);
      }

      // Merge with existing health stats
      const existingMap = new Map(this.cachedPool.map((p) => [`${p.ip}:${p.port}`, p]));

      // Always include verified winners at the top
      this.cachedPool = newProxies.map((p) => {
        const key = `${p.ip}:${p.port}`;
        const existing = existingMap.get(key);
        return {
          ...p,
          failCount: existing?.failCount || 0,
          successCount: this.verifiedProxies.has(key) ? 10 : existing?.successCount || 0,
          lastStatus: this.verifiedProxies.has(key) ? 200 : existing?.lastStatus,
        };
      });

      // Ensure verified winners are present in pool
      for (const verifiedKey of this.verifiedProxies) {
        if (!this.cachedPool.some((p) => `${p.ip}:${p.port}` === verifiedKey)) {
          const [vIp, vPort] = verifiedKey.split(':');
          this.cachedPool.unshift({
            ip: vIp,
            port: vPort,
            protocols: ['http'],
            anonymityLevel: 'elite',
            country: 'RESIDENTIAL',
            speed: 50,
            upTime: 100,
            lastChecked: Date.now(),
            source: 'proxyscrape',
            successCount: 10,
            lastStatus: 200,
          });
        }
      }

      this.lastFetchedAt = now;
      console.log(`[ProxyPool] Total active candidate pool hydrated: ${this.cachedPool.length} proxies.`);
      return this.cachedPool;
    } catch (err: any) {
      console.error('[ProxyPool] Refresh error:', err.message);
      return this.cachedPool;
    } finally {
      this.isFetching = false;
    }
  }

  private fetchFromGeonode(limit: number): Promise<GeonodeProxy[]> {
    return new Promise((resolve) => {
      const url = `https://proxylist.geonode.com/api/proxy-list?limit=${limit}&page=1&sort_by=lastChecked&sort_type=desc&anonymityLevel=elite&anonymityLevel=anonymous`;
      https.get(
        url,
        {
          headers: { 'User-Agent': 'Mozilla/5.0 ApexProxy/2.0', 'Accept': 'application/json' },
          timeout: 10000,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (Array.isArray(parsed.data)) {
                const list = parsed.data.map((p: any) => ({
                  ip: p.ip,
                  port: String(p.port),
                  protocols: p.protocols || ['http'],
                  anonymityLevel: p.anonymityLevel || 'elite',
                  country: p.country || 'GLOBAL',
                  speed: Number(p.speed) || 50,
                  upTime: Number(p.upTime) || 100,
                  lastChecked: Number(p.lastChecked) || Date.now(),
                  source: 'geonode' as const,
                }));
                resolve(list);
                return;
              }
            } catch {
              // ignore
            }
            resolve([]);
          });
        }
      ).on('error', () => resolve([]));
    });
  }

  private fetchFromProxyScrape(): Promise<GeonodeProxy[]> {
    return new Promise((resolve) => {
      const url =
        'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=yes&anonymity=elite';
      https.get(url, { timeout: 8000 }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const lines = data.trim().split(/\r?\n/).filter(Boolean);
          const list: GeonodeProxy[] = lines.map((line) => {
            const [ip, port] = line.split(':');
            return {
              ip: ip.trim(),
              port: port.trim(),
              protocols: ['http'],
              anonymityLevel: 'elite',
              country: 'ELITE',
              speed: 40,
              upTime: 99,
              lastChecked: Date.now(),
              source: 'proxyscrape' as const,
            };
          });
          resolve(list);
        });
      }).on('error', () => resolve([]));
    });
  }

  async getPool(protocolFilter?: 'all' | 'http' | 'socks5'): Promise<GeonodeProxy[]> {
    if (this.cachedPool.length === 0) {
      await this.refreshPool(60);
    }

    if (!protocolFilter || protocolFilter === 'all') {
      return this.cachedPool;
    }

    return this.cachedPool.filter((p) => {
      if (protocolFilter === 'http') {
        return p.protocols.some((pr) => pr.toLowerCase() === 'http' || pr.toLowerCase() === 'https');
      }
      if (protocolFilter === 'socks5') {
        return p.protocols.some((pr) => pr.toLowerCase().includes('socks'));
      }
      return true;
    });
  }

  async getRankedCandidates(protocolFilter?: 'all' | 'http' | 'socks5'): Promise<GeonodeProxy[]> {
    const pool = await this.getPool(protocolFilter);
    const now = Date.now();

    for (const [key, timestamp] of this.failureBlacklist.entries()) {
      if (now - timestamp > 10 * 60 * 1000) {
        this.failureBlacklist.delete(key);
      }
    }

    return [...pool]
      .filter((p) => !this.failureBlacklist.has(`${p.ip}:${p.port}`))
      .sort((a, b) => {
        // Verified winners first
        const aWinner = this.verifiedProxies.has(`${a.ip}:${a.port}`) ? 1 : 0;
        const bWinner = this.verifiedProxies.has(`${b.ip}:${b.port}`) ? 1 : 0;
        if (bWinner !== aWinner) return bWinner - aWinner;

        // Then by success count
        if ((b.successCount || 0) !== (a.successCount || 0)) {
          return (b.successCount || 0) - (a.successCount || 0);
        }

        // Then by lowest fail count
        if ((a.failCount || 0) !== (b.failCount || 0)) {
          return (a.failCount || 0) - (b.failCount || 0);
        }

        return (a.speed || 50) - (b.speed || 50);
      });
  }

  recordOutcome(ip: string, port: string, statusCode: number, success: boolean) {
    const key = `${ip}:${port}`;
    const proxy = this.cachedPool.find((p) => p.ip === ip && p.port === port);
    if (proxy) {
      proxy.lastStatus = statusCode;
      if (success) {
        proxy.successCount = (proxy.successCount || 0) + 1;
        this.failureBlacklist.delete(key);
        this.verifiedProxies.add(key);
      } else {
        proxy.failCount = (proxy.failCount || 0) + 1;
        if (statusCode === 403 || statusCode === 0) {
          this.failureBlacklist.set(key, Date.now());
        }
      }
    }
  }

  getStats() {
    return {
      totalInPool: this.cachedPool.length,
      lastFetchedAt: this.lastFetchedAt,
      verifiedCount: this.verifiedProxies.size,
      blacklistedCount: this.failureBlacklist.size,
    };
  }
}

export const geonodeService = new GeonodeService();
