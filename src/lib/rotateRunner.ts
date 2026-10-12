import { geonodeService, type GeonodeProxy } from './geonode.ts';
import { fetchWithCuimp } from './cuimpProxy.ts';
import { fetchWithStealthedChromium } from './browserProxy.ts';
import { fetchWithTlsFingerprint, chrome_124_win } from './proxy.ts';

export interface HopAttempt {
  hopNumber: number;
  proxy: string;
  protocol: string;
  country: string;
  statusCode?: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}

export interface RotateOptions {
  maxRetries?: number;
  protocolFilter?: 'all' | 'http' | 'socks5';
  engine?: 'cuimp' | 'browser' | 'tls' | 'auto';
  warmUpSession?: boolean;
  customHeaders?: Record<string, string>;
  timeoutPerHopMs?: number;
}

export interface RotateResult {
  success: boolean;
  finalStatusCode: number;
  statusMessage?: string;
  winningProxy?: string;
  attempts: HopAttempt[];
  payload: any;
  headers?: Record<string, any>;
  cookies?: Array<{ name: string; value: string; domain?: string }>;
  totalLatencyMs: number;
  engine: string;
  targetUrl: string;
}

/**
 * Executes a request iteratively across top candidate proxies using Chrome 124 impersonation or Chromium until a valid 200 OK response is captured
 */
export async function executeWithAutoRotation(
  targetUrl: string,
  options: RotateOptions = {}
): Promise<RotateResult> {
  const overallStart = Date.now();
  const maxRetries = Math.min(Math.max(options.maxRetries || 6, 1), 10);
  const protocolFilter = options.protocolFilter || 'all';
  const engine = options.engine || 'cuimp'; // 'cuimp' uses Chrome 124 TLS+HTTP/2 impersonation
  const warmUp = options.warmUpSession !== false;
  const timeoutPerHop = options.timeoutPerHopMs || 12000;

  console.log(`[AutoRotate] Starting auto-rotation for ${targetUrl} (Max Retries: ${maxRetries}, Engine: ${engine})`);

  let candidates = await geonodeService.getRankedCandidates(protocolFilter);
  if (candidates.length === 0) {
    console.log('[AutoRotate] Pool empty, refreshing candidates...');
    await geonodeService.refreshPool(60, true);
    candidates = await geonodeService.getRankedCandidates(protocolFilter);
  }

  const attempts: HopAttempt[] = [];
  let finalResult: any = null;
  let winningProxy: string | undefined = undefined;

  for (let i = 0; i < Math.min(candidates.length, maxRetries); i++) {
    const candidate = candidates[i];
    const hopNumber = i + 1;
    const protocol = candidate.protocols.includes('socks5') ? 'socks5' : 'http';
    const proxyUrl = `${protocol}://${candidate.ip}:${candidate.port}`;

    console.log(`[AutoRotate] Hop ${hopNumber}/${maxRetries} trying: ${proxyUrl} (${candidate.country})`);
    const hopStart = Date.now();

    try {
      let hopResponse: any;

      if (engine === 'cuimp' || engine === 'auto') {
        // High-performance Chrome 124 impersonate engine with HTTP/2 & TLS handshake
        hopResponse = await fetchWithCuimp(targetUrl, {
          proxy: proxyUrl,
          timeoutMs: timeoutPerHop,
          customHeaders: options.customHeaders,
        });
      } else if (engine === 'browser') {
        // Stealthed Chromium headless browser
        hopResponse = await fetchWithStealthedChromium(targetUrl, {
          profile: chrome_124_win,
          customHeaders: options.customHeaders,
          warmUpSession: warmUp,
          upstreamProxy: proxyUrl,
          timeoutMs: timeoutPerHop,
        });
      } else {
        // Standard TLS Engine
        hopResponse = await fetchWithTlsFingerprint(
          targetUrl,
          chrome_124_win,
          options.customHeaders,
          3
        );
      }

      const hopLatency = Date.now() - hopStart;
      const statusCode = hopResponse.statusCode || 0;
      const isSuccess = statusCode >= 200 && statusCode < 300;

      attempts.push({
        hopNumber,
        proxy: `${candidate.ip}:${candidate.port}`,
        protocol,
        country: candidate.country,
        statusCode,
        latencyMs: hopLatency,
        success: isSuccess,
        error: isSuccess ? undefined : `Status ${statusCode}`,
      });

      geonodeService.recordOutcome(candidate.ip, candidate.port, statusCode, isSuccess);

      if (isSuccess) {
        console.log(`[AutoRotate] 🏆 SUCCESS on Hop ${hopNumber} via ${candidate.ip}:${candidate.port}! Status ${statusCode}`);
        winningProxy = `${candidate.ip}:${candidate.port} (${candidate.country})`;
        finalResult = hopResponse;
        break; // Captured 200 OK!
      } else {
        console.warn(`[AutoRotate] Hop ${hopNumber} returned ${statusCode}, failing over...`);
        finalResult = hopResponse;
      }
    } catch (hopErr: any) {
      const hopLatency = Date.now() - hopStart;
      console.warn(`[AutoRotate] Hop ${hopNumber} error:`, hopErr.message);

      attempts.push({
        hopNumber,
        proxy: `${candidate.ip}:${candidate.port}`,
        protocol,
        country: candidate.country,
        statusCode: 0,
        latencyMs: hopLatency,
        success: false,
        error: hopErr.message || 'Connection error',
      });

      geonodeService.recordOutcome(candidate.ip, candidate.port, 0, false);
    }
  }

  const totalLatencyMs = Date.now() - overallStart;
  const isOverallSuccess = attempts.some((a) => a.success);

  return {
    success: isOverallSuccess,
    finalStatusCode: isOverallSuccess ? 200 : (finalResult?.statusCode || 403),
    statusMessage: finalResult?.statusMessage || (isOverallSuccess ? 'OK' : 'Forbidden'),
    winningProxy,
    attempts,
    payload: finalResult?.data || finalResult?.parsedJson || finalResult?.body || null,
    headers: finalResult?.headers || {},
    cookies: finalResult?.cookies || [],
    totalLatencyMs,
    engine: `ApexProxy Auto-Rotation (${engine})`,
    targetUrl,
  };
}
