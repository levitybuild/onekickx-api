import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { chrome_124_win, type TlsProfile } from './proxy.ts';

// Initialize stealth plugin
puppeteer.use(StealthPlugin());

export interface BrowserProxyOptions {
  profile?: TlsProfile;
  customHeaders?: Record<string, string>;
  warmUpSession?: boolean;
  upstreamProxy?: string;
  timeoutMs?: number;
}

export interface BrowserProxyResult {
  statusCode: number;
  statusMessage?: string;
  headers: Record<string, string>;
  cookies: Array<{ name: string; value: string; domain?: string }>;
  body: string;
  parsedJson?: any;
  latencyMs: number;
  engine: string;
  warmUpExecuted: boolean;
  upstreamProxyUsed?: string;
  pageTitle?: string;
  finalUrl: string;
}

/**
 * Executes a request through Stealthed Chromium combined with Chrome 124 fingerprint,
 * optional session warm-up, and upstream proxy tunneling.
 */
export async function fetchWithStealthedChromium(
  targetUrl: string,
  options: BrowserProxyOptions = {}
): Promise<BrowserProxyResult> {
  const startTime = Date.now();
  const profile = options.profile || chrome_124_win;
  const timeoutMs = options.timeoutMs || 25000;
  const parsedTarget = new URL(targetUrl);

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--ignore-certificate-errors',
    '--allow-running-insecure-content',
    '--window-size=1920,1080',
    `--user-agent=${profile.headers['User-Agent']}`,
    '--lang=en-US,en',
  ];

  if (options.upstreamProxy && options.upstreamProxy.trim()) {
    launchArgs.push(`--proxy-server=${options.upstreamProxy.trim()}`);
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: launchArgs,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

    // Set headers matching Chrome 124 profile
    const extraHeaders: Record<string, string> = {
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-CH-UA': profile.headers['Sec-CH-UA'] || '"Chromium";v="124", "Google Chrome";v="124"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"Windows"',
      'Referer': `${parsedTarget.origin}/`,
      ...options.customHeaders,
    };
    await page.setExtraHTTPHeaders(extraHeaders);

    let warmUpExecuted = false;

    // Session Warm-Up: Visit root domain first to acquire cookies/tokens if requested
    if (options.warmUpSession) {
      try {
        console.log(`[BrowserProxy] Warming up session at origin: ${parsedTarget.origin}`);
        await page.goto(parsedTarget.origin, {
          waitUntil: 'domcontentloaded',
          timeout: Math.min(10000, timeoutMs),
        });
        warmUpExecuted = true;
        // Brief settle time for JS security challenges/cookies
        await new Promise((r) => setTimeout(r, 1000));
      } catch (warmUpErr) {
        console.warn('[BrowserProxy] Warmup visit error, proceeding to direct call:', warmUpErr);
      }
    }

    let statusCode = 200;
    let headers: Record<string, string> = {};
    let bodyText = '';
    let finalUrl = targetUrl;
    let pageTitle = '';

    if (options.warmUpSession && warmUpExecuted) {
      // In-page execution: execute the fetch inside the initialized browser context
      console.log(`[BrowserProxy] Executing in-page fetch for ${targetUrl}`);
      const inPageResult = await page.evaluate(async (url: string) => {
        try {
          const resp = await fetch(url, {
            headers: {
              'Accept': 'application/json, text/plain, */*',
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'same-origin',
            },
          });
          const headersObj: Record<string, string> = {};
          resp.headers.forEach((val, key) => {
            headersObj[key] = val;
          });
          const text = await resp.text();
          return {
            status: resp.status,
            statusText: resp.statusText,
            headers: headersObj,
            body: text,
            url: resp.url,
          };
        } catch (err: any) {
          return {
            error: err.message || 'In-page fetch failed',
            status: 0,
          };
        }
      }, targetUrl);

      if ((inPageResult as any).error) {
        console.warn('[BrowserProxy] In-page fetch error, falling back to direct navigation:', (inPageResult as any).error);
        const response = await page.goto(targetUrl, {
          waitUntil: 'networkidle2',
          timeout: timeoutMs,
        });
        statusCode = response ? response.status() : 200;
        headers = response ? response.headers() : {};
        finalUrl = page.url();
        pageTitle = await page.title().catch(() => '');
        bodyText = await page.evaluate(() => {
          const pre = document.querySelector('pre');
          if (pre && pre.innerText) return pre.innerText;
          return document.body ? document.body.innerText : '';
        });
      } else {
        statusCode = inPageResult.status;
        headers = inPageResult.headers || {};
        bodyText = inPageResult.body || '';
        finalUrl = inPageResult.url || targetUrl;
        pageTitle = await page.title().catch(() => '');
      }
    } else {
      // Direct page navigation
      console.log(`[BrowserProxy] Direct navigation to ${targetUrl}`);
      const response = await page.goto(targetUrl, {
        waitUntil: 'networkidle2',
        timeout: timeoutMs,
      });

      statusCode = response ? response.status() : 200;
      headers = response ? response.headers() : {};
      finalUrl = page.url();
      pageTitle = await page.title().catch(() => '');

      // Check if response is raw text/JSON or page text
      bodyText = await page.evaluate(() => {
        const pre = document.querySelector('pre');
        if (pre && pre.innerText) return pre.innerText;
        return document.body ? document.body.innerText : '';
      });
    }

    // Capture cookies
    const cookiesRaw = await page.cookies();
    const cookies = cookiesRaw.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
    }));

    let parsedJson: any = null;
    try {
      parsedJson = JSON.parse(bodyText);
    } catch {
      // not JSON
    }

    const latencyMs = Date.now() - startTime;

    return {
      statusCode,
      headers,
      cookies,
      body: bodyText,
      parsedJson,
      latencyMs,
      engine: 'Stealthed Chromium + Chrome 124 Profile',
      warmUpExecuted,
      upstreamProxyUsed: options.upstreamProxy,
      pageTitle,
      finalUrl,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
