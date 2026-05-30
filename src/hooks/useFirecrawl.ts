import { useState } from 'react';

interface FirecrawlResponse {
  success: boolean;
  data?: {
    extract?: Record<string, unknown>;
    rawHtml?: string;
    screenshot?: string;
    metadata?: Record<string, unknown>;
  };
}

export function useFirecrawl(apiKey: string) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const scrapeForDesign = async (url: string): Promise<{ extract: Record<string, unknown>; rawHtml: string } | null> => {
    setLoading(true);
    setError(null);
    setStatus('Connecting to Firecrawl...');

    try {
      setStatus('Crawling site for design data...');
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          url,
          formats: ['extract', 'rawHtml'],
          waitFor: 2000,
          extract: {
            schema: {
              type: 'object',
              properties: {
                brand_name: { type: 'string' },
                colors: { type: 'object', description: 'All brand colors found on the site' },
                fonts: { type: 'array', items: { type: 'string' }, description: 'Font families used' },
                logo_url: { type: 'string' },
                primary_color: { type: 'string' },
                accent_color: { type: 'string' },
                background_color: { type: 'string' },
                text_color: { type: 'string' },
              },
            },
          },
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Firecrawl error: ${response.status} — ${err}`);
      }

      const data: FirecrawlResponse = await response.json();
      setStatus('Design data received.');

      return {
        extract: (data.data?.extract as Record<string, unknown>) || {},
        rawHtml: data.data?.rawHtml || '',
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Attempt a scrape with a given body, returns null on non-500 errors (rethrows those)
  const attemptScrape = async (body: object): Promise<FirecrawlResponse | null> => {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (response.status === 500) return null; // signal to retry with fallback
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Firecrawl error: ${response.status} — ${err}`);
    }

    return response.json();
  };

  const scrapeForStructure = async (url: string): Promise<{ rawHtml: string; screenshot: string } | null> => {
    setLoading(true);
    setError(null);
    setStatus('Fetching HTML and screenshot...');

    try {
      // Attempt 1: full scrape with scroll actions + waitFor
      // Actions scroll the page to trigger lazy-loaded content (footer, galleries, JS sections)
      setStatus('Fetching page (with scroll actions)...');
      let data = await attemptScrape({
        url,
        formats: ['rawHtml', 'screenshot@fullPage'],
        onlyMainContent: false,
        waitFor: 3000,
        actions: [
          { type: 'wait', milliseconds: 1000 },
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1500 },
          { type: 'scroll', direction: 'down' },
          { type: 'wait', milliseconds: 1500 },
          { type: 'scroll', direction: 'up' },
          { type: 'wait', milliseconds: 500 },
        ],
      });

      // Attempt 2: actions not supported on this plan — retry with waitFor only
      if (!data) {
        setStatus('Fetching page (waitFor fallback)...');
        data = await attemptScrape({
          url,
          formats: ['rawHtml', 'screenshot@fullPage'],
          onlyMainContent: false,
          waitFor: 4000,
        });
      }

      // Attempt 3: plain scrape — no extras
      if (!data) {
        setStatus('Fetching page (basic fallback)...');
        data = await attemptScrape({
          url,
          formats: ['rawHtml', 'screenshot@fullPage'],
          onlyMainContent: false,
        });
      }

      if (!data) throw new Error('Firecrawl returned 500 on all attempts. Check your API key or try again.');

      setStatus('Page data received.');

      return {
        rawHtml: data.data?.rawHtml || '',
        screenshot: data.data?.screenshot || '',
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { scrapeForDesign, scrapeForStructure, loading, status, error };
}