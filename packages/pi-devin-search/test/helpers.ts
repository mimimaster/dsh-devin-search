import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const liveSignal = () => new AbortController().signal;
export async function tempDir(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'pi-devin-auth-')));
}
export const cleanup = (path: string) => rm(path, { recursive: true, force: true });
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
export async function server(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const instance = createServer(handler);
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve));
  const address = instance.address();
  if (!address || typeof address === 'string') throw new Error('bind');
  return {
    base: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () => new Promise<void>(resolve => { instance.close(() => resolve()); instance.closeAllConnections(); }),
  };
}
export async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
export function jwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.sig`;
}
