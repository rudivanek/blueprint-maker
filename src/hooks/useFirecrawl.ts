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

  const scrapeForStructure = async (url: string): Promise<{ rawHtml: string; screenshot: string } | null> => {
    setLoading(true);
    setError(null);
    setStatus('Crawling site for page structure...');

    try {
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          url,
          formats: ['rawHtml', 'screenshot@fullPage'],
          onlyMainContent: false,
          // Wait for JS to render dynamic content (carousels, lazy-loaded sections, etc.)
          waitFor: 3000,
          // Scroll the full page before capture so lazy-loaded and below-fold content
          // (footer, product galleries, infinite-scroll sections) is fully rendered
          actions: [
            // Give the page an initial moment to settle after load
            { type: 'wait', milliseconds: 1000 },
            // Scroll to bottom — triggers lazy-load for images, sections, footer
            { type: 'scroll', direction: 'down', selector: 'body' },
            { type: 'wait', milliseconds: 1000 },
            // Second scroll pass — catches content that loads progressively
            { type: 'scroll', direction: 'down', selector: 'body' },
            { type: 'wait', milliseconds: 1000 },
            // Scroll back to top so the screenshot starts from the top of the page
            { type: 'scroll', direction: 'up', selector: 'body' },
            { type: 'wait', milliseconds: 500 },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Firecrawl error: ${response.status} — ${err}`);
      }

      const data: FirecrawlResponse = await response.json();
      setStatus('Page structure data received.');

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