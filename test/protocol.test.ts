import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { chatRequest, frame, gzipFrame, jwtRequest, metadata, streamText, toolMarker } from '../src/protocol.js';
import { decode, stringField, Writer } from '../src/protobuf.js';
const done = () => frame(Buffer.from('{}'), 2);
describe('strict Connect/protobuf transport', () => {
  it('encodes API key field3 and user JWT21, message roles5/1/2/4 and tool references', () => {
    expect(stringField(decode(metadata('fixture-api', 'fixture-jwt')), 3)).toBe('fixture-api');
    expect(stringField(decode(metadata('fixture-api', 'fixture-jwt')), 21)).toBe('fixture-jwt');
    expect(decode(jwtRequest('fixture'))[0]?.field).toBe(1);
    const data = decode(chatRequest('api', 'jwt', 'sys', [{ role: 'user', content: 'u' }, { role: 'assistant', content: 'a', call: { id: 'c', name: 'restricted_exec', args: {} } }, { role: 'tool', content: 'result', callId: 'c' }], '[]'));
    expect(stringField(data, 3)).toBe('[]');
    const messages = data.filter(f => f.field === 2).map(f => decode(f.value as Buffer));
    expect(messages.map(m => m.find(f => f.field === 2)?.value)).toEqual([5, 1, 2, 4]);
    expect(messages[2]?.some(f => f.field === 6)).toBe(true); expect(stringField(messages[3]!, 7)).toBe('c');
  });
  it('reads gzip field2 and fallback3 and string-aware JSON tool markers', () => {
    const text = streamText(Buffer.concat([gzipFrame(new Writer().string(2, 'hello ').build()), frame(new Writer().string(3, 'world').build()), done()]));
    expect(text).toBe('hello world');
    expect(toolMarker('thinking[TOOL_CALLS]restricted_exec[ARGS]{"command1":{"op":"rg","pattern":"a}b"}}</s>')).toEqual({ name: 'restricted_exec', args: { command1: { op: 'rg', pattern: 'a}b' } } });
    expect(toolMarker('plain answer')).toBeUndefined();
    // Captured live wire format: no [ARGS] separator, terminal model EOS.
    expect(toolMarker('thinking[TOOL_CALLS]restricted_exec{"command1":{"op":"ls","path":"/codebase"}}</s>'))
      .toEqual({ name: 'restricted_exec', args: { command1: { op: 'ls', path: '/codebase' } } });
    expect(streamText(Buffer.concat([frame(new Writer().string(2, '<ANSWER></ANSWER></s>').build()), done()])))
      .toBe('<ANSWER></ANSWER>');
    expect(() => toolMarker('[TOOL_CALLS]evil[ARGS]{broken')).toThrow('JSON');
  });
  it.each([
    ['partial header', Buffer.from([1, 0])],
    ['partial payload', frame(Buffer.from('x')).subarray(0, 5)],
    ['missing trailer', frame(new Writer().string(2, 'x').build())],
    ['invalid gzip', Buffer.concat([frame(Buffer.from('not gzip'), 1), done()])],
    ['bad trailer', frame(Buffer.from('not json'), 2)],
    ['trailer error', frame(Buffer.from('{"error":{"code":"internal","message":"SECRET"}}'), 2)],
    ['trailing frames', Buffer.concat([done(), done()])],
    ['unknown flag', frame(Buffer.from('x'), 4)],
  ])('fails closed on %s without echoing provider body', (_name, bytes) => {
    expect(() => streamText(bytes)).toThrow();
    try { streamText(bytes); } catch (error) { expect(String(error)).not.toContain('SECRET'); }
  });
  it('caps response, decompressed frame and aggregate decoded bytes', () => {
    expect(() => streamText(Buffer.alloc(4 * 1024 * 1024 + 1))).toThrow('budget');
    expect(() => streamText(Buffer.concat([frame(gzipSync(Buffer.alloc(5000)), 1), done()]), 1024)).toThrow('gzip');
    expect(() => streamText(Buffer.concat([frame(new Writer().string(2, 'x'.repeat(600)).build()), frame(new Writer().string(2, 'x'.repeat(600)).build()), done()]), 1024)).toThrow('budget');
  });
  it.each([Buffer.from([10, 20, 1]), Buffer.from([128]), Buffer.from([0]), Buffer.from([11])])('rejects malformed protobuf %s', buffer => { expect(() => decode(buffer)).toThrow(); });
});
