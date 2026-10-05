import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginApiError, parseLoginState, startLoginApiPoll, submitLoginCode } from '../src/client/login-api.js';
import { DevinLoginCommandCard } from '../src/client/components/DevinLoginCommandCard.js';
import { deriveLoginCardModel } from '../src/client/login-card-model.js';
import { getDevinLiveState, resetDevinLiveState } from '../src/client/login-live-state.js';
import { LOGIN_CODE_PATH, LOGIN_STATE_PATH } from '../src/login-state.js';
import { deferred } from './helpers.js';
const id = 'A'.repeat(32);
const url = 'https://app.devin.ai/auth/cli/continue?state=fixture&code_challenge=x&code_challenge_method=S256';
const text = `Login pending.\nLogin attempt: ${id}\nLogin mode: code\nOpen this URL: ${url}`;
const pending = { attemptId: id, mode: 'code', phase: 'pending' };
beforeEach(resetDevinLiveState);

describe('remote login browser client', () => {
  it('renders a labelled masked paste field and never prefills it from command text', () => {
    const html = renderToStaticMarkup(createElement(DevinLoginCommandCard, { node: { kind: 'command', commandId: 'c', name: 'devin-login', args: null, time: 10, outcome: { kind: 'success', text } } }));
    expect(html).toContain('一次性授权码'); expect(html).toContain('type="password"'); expect(html).toContain('value=""');
    expect(html).toContain('提交授权码'); expect(html).toContain('在浏览器中打开授权');
    expect(html).not.toContain('127.0.0.1');
  });
  it('validates attempt-specific state and ignores a late terminal publication from another attempt', () => {
    expect(parseLoginState(pending, id)).toEqual(pending);
    expect(parseLoginState({ ...pending, attemptId: 'B'.repeat(32), phase: 'authorized' }, id)).toBeNull();
    expect(parseLoginState({ ...pending, phase: 'invented' }, id)).toBeNull();
    expect(deriveLoginCardModel({ kind: 'success', text }, { phase: 'authorized', at: 50, attemptId: 'B'.repeat(32) }, { commandTime: 10 })).toMatchObject({ kind: 'waiting', attemptId: id, mode: 'code' });
  });
  it('sends code only in authenticated same-origin POST body; provider/auth failures do not publish success', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ...pending, phase: 'authorized' })));
    const state = await submitLoginCode(id, 'private-code', undefined, fetcher);
    expect(state.phase).toBe('authorized');
    const [path, options] = fetcher.mock.calls[0]! as unknown as [string, RequestInit];
    expect(path).toBe(LOGIN_CODE_PATH); expect(path).not.toContain('private-code');
    expect(options).toMatchObject({ method: 'POST', credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', redirect: 'error' });
    expect(JSON.parse(options.body as string)).toEqual({ attemptId: id, code: 'private-code' });
    expect(getDevinLiveState().phase).toBe('unknown');
    await expect(submitLoginCode(id, 'private-code', undefined, async () => new Response('private-code', { status: 401 }))).rejects.toBeInstanceOf(LoginApiError);
    expect(getDevinLiveState().phase).toBe('unknown');
  });
  it('polls DSH, not localhost, and publishes only confirmed authorization for the right attempt', async () => {
    let phase = 'pending'; const onState = vi.fn(); const onError = vi.fn();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ...pending, phase })));
    const stop = startLoginApiPoll(id, onState, onError, { fetcher, intervalMs: 10 });
    try {
      await vi.waitFor(() => expect(onState).toHaveBeenCalled());
      expect(fetcher.mock.calls[0]![0]).toBe(`${LOGIN_STATE_PATH}?attemptId=${id}`);
      expect(getDevinLiveState().phase).toBe('unknown');
      phase = 'authorized';
      await vi.waitFor(() => expect(getDevinLiveState()).toMatchObject({ phase: 'authorized', attemptId: id }));
      expect(onError).not.toHaveBeenCalled();
    } finally { stop(); }
  });
  it('expired/unauthenticated polls stop and report an error; unmounted requests cannot publish', async () => {
    for (const status of [401, 403, 404]) {
      const fetcher = vi.fn(async () => new Response('', { status })); const onError = vi.fn();
      const stop = startLoginApiPoll(id, vi.fn(), onError, { fetcher, intervalMs: 10 });
      await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(fetcher).toHaveBeenCalledTimes(1); stop();
    }
    const late = deferred<Response>(); const seen = vi.fn();
    const stop = startLoginApiPoll(id, seen, vi.fn(), { fetcher: () => late.promise }); stop();
    late.resolve(new Response(JSON.stringify({ ...pending, phase: 'authorized' })));
    await Promise.resolve(); await Promise.resolve();
    expect(seen).not.toHaveBeenCalled(); expect(getDevinLiveState().phase).toBe('unknown');
  });
});
