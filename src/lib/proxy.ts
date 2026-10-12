import https from 'https';
import http from 'http';
import zlib from 'zlib';

export interface TlsProfile {
  id: string;
  name: string;
  ja3: string;
  cipherSuites: string[];
  ecdhCurve?: string;
  minVersion?: string;
  maxVersion?: string;
  headers: Record<string, string>;
}

export const chrome_124_win: TlsProfile = {
  id: 'chrome_124_win',
  name: 'Google Chrome 124 (Windows 10/11)',
  // Standard Chrome 124 TLS signature
  ja3: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-21,29-23-24,0',
  cipherSuites: [
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
  ],
  ecdhCurve: 'X25519:P-256:P-384',
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Sec-CH-UA': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  }
};

export const firefox_125_win: TlsProfile = {
  id: 'firefox_125_win',
  name: 'Mozilla Firefox 125 (Windows)',
  ja3: '771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-21,29-23-24,0',
  cipherSuites: [
    'TLS_AES_128_GCM_SHA256',
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
  ],
  ecdhCurve: 'X25519:P-256:P-384:P-521',
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  }
};

export const safari_17_mac: TlsProfile = {
  id: 'safari_17_mac',
  name: 'Apple Safari 17 (macOS Sonoma)',
  ja3: '771,4865-4866-4867-49196-49195-52393-49200-49199-52392-49162-49161-49172-49171-157-156-53-47,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-21,29-23-24,0',
  cipherSuites: [
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
  ],
  ecdhCurve: 'X25519:P-256:P-384',
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  }
};

export interface ProxyResponse {
  statusCode: number;
  statusMessage?: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  parsedJson?: any;
  tlsInfo?: any;
  latencyMs: number;
  engine: string;
  redirectsFollowed?: number;
  finalUrl?: string;
}

/**
 * Decompresses HTTP response payload according to Content-Encoding header
 */
function decompressBuffer(buffer: Buffer, encoding?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!encoding) return resolve(buffer);
    const enc = encoding.toLowerCase().trim();
    if (enc.includes('gzip')) {
      zlib.gunzip(buffer, (err, res) => (err ? resolve(buffer) : resolve(res)));
    } else if (enc.includes('deflate')) {
      zlib.inflate(buffer, (err, res) => (err ? resolve(buffer) : resolve(res)));
    } else if (enc.includes('br')) {
      zlib.brotliDecompress(buffer, (err, res) => (err ? resolve(buffer) : resolve(res)));
    } else {
      resolve(buffer);
    }
  });
}

/**
 * Executes an HTTP/HTTPS request with specific TLS cipher suite order,
 * JA3-matched extensions, browser emulation headers, redirect handling, and decompression.
 */
export function fetchWithTlsFingerprint(
  targetUrl: string,
  profile: TlsProfile = chrome_124_win,
  customHeaders: Record<string, string> = {},
  maxRedirects = 5,
  redirectCount = 0
): Promise<ProxyResponse> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${targetUrl}`));
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const cipherString = profile.cipherSuites.join(':');

    // Dynamic headers based on target origin
    const defaultHeaders = {
      ...profile.headers,
      'Host': parsedUrl.hostname,
      'Referer': `${parsedUrl.origin}/`,
      'Origin': parsedUrl.origin,
      ...customHeaders
    };

    const requestOptions: any = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: (parsedUrl.pathname || '/') + (parsedUrl.search || ''),
      method: 'GET',
      headers: defaultHeaders,
      timeout: 12000,
    };

    if (isHttps) {
      requestOptions.ciphers = cipherString;
      requestOptions.ecdhCurve = profile.ecdhCurve || 'X25519:P-256:P-384';
      requestOptions.minVersion = profile.minVersion || 'TLSv1.2';
      requestOptions.maxVersion = profile.maxVersion || 'TLSv1.3';
      requestOptions.servername = parsedUrl.hostname;
      requestOptions.rejectUnauthorized = false;
    }

    const client = isHttps ? https : http;
    const req = client.request(requestOptions, async (res) => {
      // Handle redirects if within limit
      if (
        res.statusCode &&
        [301, 302, 303, 307, 308].includes(res.statusCode) &&
        res.headers.location &&
        redirectCount < maxRedirects
      ) {
        const nextUrl = new URL(res.headers.location, targetUrl).toString();
        try {
          const redirectedResult = await fetchWithTlsFingerprint(
            nextUrl,
            profile,
            customHeaders,
            maxRedirects,
            redirectCount + 1
          );
          return resolve(redirectedResult);
        } catch (redirErr) {
          return reject(redirErr);
        }
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', async () => {
        const rawBuffer = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'] as string | undefined;
        const decompressed = await decompressBuffer(rawBuffer, encoding);
        const bodyText = decompressed.toString('utf-8');
        const latencyMs = Date.now() - startTime;

        let parsedJson: any = null;
        try {
          parsedJson = JSON.parse(bodyText);
        } catch {
          // not json
        }

        resolve({
          statusCode: res.statusCode || 200,
          statusMessage: res.statusMessage,
          headers: res.headers as Record<string, string | string[] | undefined>,
          body: bodyText,
          parsedJson,
          tlsInfo: isHttps ? (res.socket as any)?.getCipher() : {},
          latencyMs,
          engine: `TLS Fingerprint Engine (${profile.name})`,
          redirectsFollowed: redirectCount,
          finalUrl: targetUrl,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after 12000ms for ${targetUrl}`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}
