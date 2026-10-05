import type { SearchSession } from './search-session.js';
import { boundedBody, check, deadline, DevinError, fail, json, object, redact, request } from './safety.js';
/** Structurally compatible with DSH web search types; this module does not import DSH. */
export interface SearchArg { readonly query: string; readonly maxResults?: number }
export interface SearchSource { readonly url: string; readonly title?: string; readonly snippet?: string; readonly publishedAt?: string }
export interface SearchResult { readonly content?: string; readonly sources: readonly SearchSource[]; readonly truncated: boolean }
export interface SearchProvider { readonly id: string; available(): boolean; search(request: SearchArg, signal?: AbortSignal): Promise<SearchResult> }
export const WEB_PATH = '/exa.api_server_pb.ApiServerService/GetWebSearchResults';
export function webProvider(sessions: SearchSession, options: { hosts?: readonly string[]; fetcher?: typeof fetch; timeoutMs?: number } = {}): SearchProvider {
  return {
    id: 'devin', available: () => sessions.available(),
    async search({ query, maxResults }, caller) {
      if (!query.trim() || query.length > 8192) return fail('bounds', 'Devin query is empty or too long.');
      const limit = Math.min(10, Math.max(1, Math.trunc(maxResults ?? 5)));
      if (!Number.isFinite(limit)) return fail('bounds', 'Invalid Devin result limit.');
      const access = await sessions.access(caller); const signal = deadline(access.signal, options.timeoutMs ?? 20_000);
      let authRejected = 0
      let hostsTried = 0
      for (const host of options.hosts ?? ['https://server.codeium.com', 'https://server.self-serve.windsurf.com']) {
        try {
          hostsTried++
          const response = await request(`${host}${WEB_PATH}`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'connect-protocol-version': '1',
              accept: 'application/json',
              'user-agent': 'windsurf/1.9600.41',
            },
            body: JSON.stringify({
              metadata: {
                apiKey: access.token,
                ideName: 'windsurf',
                ideVersion: '1.9600.41',
                extensionName: 'windsurf',
                extensionVersion: '1.9600.41',
                locale: 'en',
              },
              query: query.trim(),
              limit,
            }),
          }, signal, options.fetcher);
          if (response.status === 401 || response.status === 403) {
            await response.body?.cancel()
            authRejected++
            continue
          }
          if (!response.ok) { await response.body?.cancel(); continue; }
          const payload = object(json(await boundedBody(response, signal, 1024 * 1024)));
          if (!Array.isArray(payload?.results)) return fail('protocol', 'Invalid Devin web search schema.');
          const sources: SearchSource[] = []; let valid = 0;
          const first = (row: Record<string, unknown>, keys: string[], cap: number) => {
            for (const key of keys) if (typeof row[key] === 'string' && (row[key] as string).trim()) return redact((row[key] as string).trim().slice(0, cap), [access.token]);
            return '';
          };
          for (const raw of payload.results) {
            const row = object(raw); if (!row) continue;
            const url = first(row, ['url', 'sourceUrl', 'webUrl', 'link'], 4096);
            try { const parsed = new URL(url); if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) continue; } catch { continue; }
            valid++;
            if (sources.length < limit) sources.push({ url, title: first(row, ['title', 'name', 'webTitle'], 512), snippet: first(row, ['snippet', 'summary', 'text', 'content'], 4096) });
          }
          check(signal); return { sources, truncated: valid > limit };
        } catch (error) {
          if (error instanceof DevinError && error.code === 'login') throw error;
          check(signal);
          if (error instanceof DevinError && error.code !== 'network') throw error;
        }
      }
      // Only revoke when every tried host refused auth — not after a single host blip.
      if (hostsTried > 0 && authRejected === hostsTried) {
        await sessions.revoke(access.token)
        return fail('login', 'Devin session rejected; use /devin-login.')
      }
      return fail('network', 'Devin web search failed on all hosts.');
    },
  };
}
