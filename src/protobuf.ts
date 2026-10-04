// Adapted from piwin code-search/backends/windsurf-protobuf.ts (MIT).
// Strict variant: partial fields, unsupported wire types and unsafe integers fail closed.
import { fail } from './safety.js';
export class Writer {
  private chunks: Buffer[] = [];
  int(field: number, value: number): this { this.chunks.push(varint(field * 8), varint(value)); return this; }
  bytes(field: number, value: Buffer): this { this.chunks.push(varint(field * 8 + 2), varint(value.length), value); return this; }
  string(field: number, value: string): this { return this.bytes(field, Buffer.from(value)); }
  build(): Buffer { return Buffer.concat(this.chunks); }
}
function varint(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) return fail('protocol', 'Invalid protobuf integer.');
  const bytes: number[] = [];
  do { const next = value % 128; value = Math.floor(value / 128); bytes.push(next | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
}
export interface Field { field: number; value: Buffer | number }
export function decode(buffer: Buffer): Field[] {
  let offset = 0; const fields: Field[] = [];
  const read = () => {
    let n = 0;
    for (let i = 0; i < 10; i++) {
      const b = buffer[offset++]; if (b === undefined) return fail('protocol', 'Partial protobuf field.');
      n += (b & 127) * 2 ** (i * 7);
      if (!Number.isSafeInteger(n)) return fail('protocol', 'Unsafe protobuf integer.');
      if (!(b & 128)) return n;
    }
    return fail('protocol', 'Malformed protobuf varint.');
  };
  while (offset < buffer.length) {
    const tag = read(); const field = Math.floor(tag / 8); const wire = tag % 8;
    if (!field) return fail('protocol', 'Invalid protobuf tag.');
    if (wire === 0) fields.push({ field, value: read() });
    else if (wire === 2) {
      const length = read(); const end = offset + length;
      if (end > buffer.length) return fail('protocol', 'Partial protobuf payload.');
      fields.push({ field, value: buffer.subarray(offset, end) }); offset = end;
    } else if (wire === 1 || wire === 5) {
      offset += wire === 1 ? 8 : 4;
      if (offset > buffer.length) return fail('protocol', 'Partial protobuf fixed field.');
    } else return fail('protocol', 'Unsupported protobuf wire type.');
    if (fields.length > 16_384) return fail('bounds', 'Too many protobuf fields.');
  }
  return fields;
}
export function stringField(fields: Field[], field: number): string | undefined {
  const value = fields.find(f => f.field === field)?.value;
  return Buffer.isBuffer(value) ? value.toString('utf8') : undefined;
}
