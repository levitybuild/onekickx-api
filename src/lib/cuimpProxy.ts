import { get as cuimpGet } from 'cuimp';

export interface CuimpProxyResult {
  statusCode: number;
  data: any;
  headers?: Record<string, any>;
  latencyMs: number;
  engine: string;
  proxyUsed?: string;
  success: boolean;
}

/**
 * Fetches target URL using curl-impersonate Chrome 124 binary with full TLS and HTTP/2 handshake
 */
export async function fetchWithCuimp(
  targetUrl: string,
  options: {
    proxy?: string;
    timeoutMs?: number;
    customHeaders?: Record<string, string>;
  } = {}
): Promise<CuimpProxyResult> {
  const startTime = Date.now();
  const parsed = new URL(targetUrl);

  const defaultHeaders: Record<string, string> = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': `${parsed.origin}/`,
    'Origin': parsed.origin,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    ...options.customHeaders,
  };

  try {
    const config: any = {
      browser: 'chrome124',
      timeout: options.timeoutMs || 10000,
      headers: defaultHeaders,
    };

    if (options.proxy && options.proxy.trim()) {
      config.proxy = options.proxy.trim();
    }

    const res = await (cuimpGet as any)(targetUrl, config);

    const latencyMs = Date.now() - startTime;
    const isSuccess = res && res.status >= 200 && res.status < 300;

    return {
      statusCode: res ? res.status : 0,
      data: res ? res.data : null,
      headers: (res ? res.headers : {}) as any,
      latencyMs,
      engine: 'Chrome 124 Impersonate Engine (curl-impersonate)',
      proxyUsed: options.proxy,
      success: isSuccess,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      statusCode: 0,
      data: null,
      latencyMs,
      engine: 'Chrome 124 Impersonate Engine (curl-impersonate)',
      proxyUsed: options.proxy,
      success: false,
    };
  }
}
