import { useState } from 'react';
import { DESIGN_SYSTEM_EXTRACTION_PROMPT, STRUCTURE_IMPORT_PROMPT } from '../lib/prompts';
import { toast } from '../components/ui/Toast';
import type { Section, GlobalSettings, AIProvider } from '../types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

interface OpenAIResponse {
  choices: Array<{ message: { content: string } }>;
}

async function callAnthropic(apiKey: string, messages: Message[], systemPrompt: string): Promise<string> {
  const maxTokens = 16000;
  console.log('Max tokens (Anthropic):', maxTokens);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => response.text());
    console.error('Anthropic API error:', JSON.stringify(errorBody, null, 2));
    const message = typeof errorBody === 'object' && errorBody !== null
      ? (errorBody as { error?: { message?: string } }).error?.message ?? JSON.stringify(errorBody)
      : String(errorBody);
    throw new Error(`Anthropic API error: ${response.status} — ${message}`);
  }

  const data: AnthropicResponse = await response.json();
  return data.content[0]?.text ?? '';
}

async function callOpenAI(apiKey: string, messages: Message[], systemPrompt: string): Promise<string> {
  const maxTokens = 32000;
  console.log('Max tokens (OpenAI):', maxTokens);
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => response.text());
    console.error('OpenAI API error:', JSON.stringify(errorBody, null, 2));
    const message = typeof errorBody === 'object' && errorBody !== null
      ? (errorBody as { error?: { message?: string } }).error?.message ?? JSON.stringify(errorBody)
      : String(errorBody);
    throw new Error(`OpenAI API error: ${response.status} — ${message}`);
  }

  const data: OpenAIResponse = await response.json();
  return data.choices[0]?.message?.content ?? '';
}

function cleanHtml(html: string): string {
  // Collect font CDN URLs before any tags are removed
  const fontUrlPatterns = [
    /fonts\.googleapis\.com\/css2?[^"'\s]*/g,
    /fonts\.bunny\.net\/css[^"'\s]*/g,
    /use\.typekit\.net\/[^"'\s]*/g,
  ];
  const detectedFontUrls: string[] = [];
  for (const pattern of fontUrlPatterns) {
    const matches = html.match(pattern);
    if (matches) detectedFontUrls.push(...matches);
  }
  const uniqueFontUrls = [...new Set(detectedFontUrls)];
  console.log('Detected font URLs:', uniqueFontUrls);

  const fontComment = uniqueFontUrls.length > 0
    ? `<!-- DETECTED FONT URLS: ${uniqueFontUrls.join(', ')} -->\n`
    : '';

  // Preserve font CDN <link> tags by replacing them with placeholders before stripping
  const fontLinkPlaceholders: string[] = [];
  const htmlWithPlaceholders = html.replace(
    /<link\b[^>]*(?:fonts\.googleapis\.com|fonts\.bunny\.net|typekit\.net)[^>]*>/gi,
    (match) => {
      const idx = fontLinkPlaceholders.length;
      fontLinkPlaceholders.push(match);
      return `__FONT_LINK_${idx}__`;
    }
  );

  const cleaned = htmlWithPlaceholders
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+class="[^"]*"/gi, '')
    .replace(/\s+class='[^']*'/gi, '')
    .replace(/\s+data-[a-z0-9-]+(?:="[^"]*"|='[^']*')?/gi, '')
    .replace(/\s+aria-[a-z-]+(?:="[^"]*"|='[^']*')?/gi, '')
    .replace(/\s+id="(?![\w-]*anchor[\w-]*)([^"]*)"/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Restore font link tags
  const restored = fontLinkPlaceholders.reduce(
    (acc, tag, idx) => acc.replace(`__FONT_LINK_${idx}__`, tag),
    cleaned
  );

  return fontComment + restored;
}

function truncateHtml(html: string, firstChars: number, lastChars: number): string {
  const total = firstChars + lastChars;
  if (html.length <= total) return html;
  const head = html.slice(0, firstChars);
  const tail = html.slice(-lastChars);
  return `${head}\n\n<!-- ... middle content truncated for length ... -->\n\n${tail}`;
}

export function useAI(provider: AIProvider, anthropicKey: string, openaiKey: string) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeKey = provider === 'openai' ? openaiKey : anthropicKey;

  const callAI = async (messages: Message[], systemPrompt: string): Promise<string | null> => {
    if (provider === 'openai') {
      return callOpenAI(activeKey, messages, systemPrompt);
    }
    return callAnthropic(activeKey, messages, systemPrompt);
  };

  const generateDesignSystem = async (
    extractData: Record<string, unknown>,
    rawHtml: string
  ): Promise<string | null> => {
    setLoading(true);
    setError(null);
    setStatus('Analyzing design system with AI...');

    try {
      const cssBlocks: string[] = [];
      const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
      let match;
      while ((match = styleRegex.exec(rawHtml)) !== null) {
        cssBlocks.push(match[1]);
      }
      const inlineStyles: string[] = [];
      const inlineRegex = /style="([^"]+)"/gi;
      while ((match = inlineRegex.exec(rawHtml)) !== null) {
        inlineStyles.push(match[1]);
      }

      const userMessage = `Here is the branding extract data from the website:
\`\`\`json
${JSON.stringify(extractData, null, 2)}
\`\`\`

Here are the CSS blocks extracted from the page:
\`\`\`css
${cssBlocks.slice(0, 5).join('\n\n')}
\`\`\`

Sample inline styles found:
\`\`\`
${inlineStyles.slice(0, 50).join('\n')}
\`\`\`

Please generate the complete design.md file following the exact format specified in the system prompt. Resolve ALL CSS variables to their actual hex values.`;

      setStatus('AI is generating design system...');
      const result = await callAI([{ role: 'user', content: userMessage }], DESIGN_SYSTEM_EXTRACTION_PROMPT);
      setStatus('Design system generated.');
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const importPageStructure = async (rawHtml: string, compactMode = false): Promise<{
    sections: Partial<Section>[];
    globals: Partial<GlobalSettings>;
    wasTruncated: boolean;
  } | null> => {
    setLoading(true);
    setError(null);
    setStatus('Analyzing page structure with AI...');

    try {
      const cleaned = cleanHtml(rawHtml);
      console.log('HTML before clean:', rawHtml.length, 'chars — after clean:', cleaned.length, 'chars');
      const truncatedHtml = truncateHtml(cleaned, 60000, 20000);
      console.log('HTML sent to AI:', truncatedHtml.length, 'chars');

      const compactInstruction = compactMode
        ? '\n\nCOMPACT MODE: Use maximum 2 sentences per layout_description. Minimize all text fields. Prioritize completeness over detail — it is better to capture ALL sections briefly than to describe half the page in detail.'
        : '';

      const userMessage = `Here is the raw HTML from the webpage. Extract all sections and globals:${compactInstruction}

\`\`\`html
${truncatedHtml}
\`\`\`

Return a valid JSON object following the exact format in the system prompt. Include ALL sections in page order.`;

      console.log('Sending to AI, prompt length:', userMessage.length, compactMode ? '(compact mode)' : '');
      setStatus(compactMode ? 'AI is extracting page structure (compact mode)...' : 'AI is extracting page structure...');
      const result = await callAI([{ role: 'user', content: userMessage }], STRUCTURE_IMPORT_PROMPT);

      console.log('AI raw response:', result);

      if (!result) return null;

      const trimmed = result.trim();
      const looksComplete = trimmed.endsWith('}') || trimmed.endsWith('}```');
      if (!looksComplete) {
        console.warn('Response may be truncated — raw response does not end with closing brace');
      }

      setStatus('Parsing AI response...');
      const stripped = result.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      const jsonMatch = stripped.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not parse JSON from AI response');

      const parsed = JSON.parse(jsonMatch[0]);
      console.log('Parsed sections:', parsed.sections?.length, parsed.sections);
      console.log('Extracted globals:', JSON.stringify(parsed.globals, null, 2));
      setStatus('Page structure imported.');
      return {
        sections: parsed.sections || [],
        globals: parsed.globals || {},
        wasTruncated: !looksComplete,
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { generateDesignSystem, importPageStructure, loading, status, error, provider };
}
