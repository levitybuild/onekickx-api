import https from 'https';

export interface JinaProxyResult {
  statusCode: number;
  data: any;
  markdownText: string;
  latencyMs: number;
  engine: string;
  finalUrl: string;
  usage?: any;
}

/**
 * Fetches target URL through Jina AI Reader API (r.jina.ai)
 */
export async function fetchWithJinaReader(
  targetUrl: string,
  returnFormat: 'json' | 'text' | 'markdown' = 'json'
): Promise<JinaProxyResult> {
  const startTime = Date.now();
  const jinaUrl = `https://r.jina.ai/${targetUrl}`;

  return new Promise((resolve, reject) => {
    const req = https.get(
      jinaUrl,
      {
        headers: {
          'Accept': 'application/json',
          'X-Return-Format': returnFormat,
          'User-Agent': 'ApexProxy-DevEngine/1.0',
        },
        timeout: 15000,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          try {
            const parsed = JSON.parse(rawData);
            resolve({
              statusCode: res.statusCode || 200,
              data: parsed.data || parsed,
              markdownText: parsed.data?.text || parsed.data?.content || rawData,
              latencyMs,
              engine: 'Jina AI Reader Engine (r.jina.ai)',
              finalUrl: jinaUrl,
              usage: parsed.data?.usage || parsed.meta?.usage,
            });
          } catch {
            resolve({
              statusCode: res.statusCode || 200,
              data: null,
              markdownText: rawData,
              latencyMs,
              engine: 'Jina AI Reader Engine (r.jina.ai)',
              finalUrl: jinaUrl,
            });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Jina Reader timed out after 15000ms`));
    });

    req.on('error', reject);
  });
}
