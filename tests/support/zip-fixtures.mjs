import { crc32, deflateRawSync } from "node:zlib";

const u16 = value => { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value & 0xffff); return buffer; };
const u32 = value => { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value >>> 0); return buffer; };

/**
 * Builds a ZIP archive. Entry fields override the real header values so tests can write
 * archives whose headers lie (size, CRC, flags, unix mode).
 */
export function buildZip(entries, { count } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = Buffer.from(entry.data ?? "");
    const method = entry.method === "deflate" ? 8 : 0;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(entry.name);
    const crc = entry.crc ?? crc32(raw);
    const declared = entry.declaredSize ?? raw.length;
    const compressed = entry.compressedSize ?? body.length;
    const flags = entry.flags ?? 0;
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(crc), u32(compressed), u32(declared), u16(name.length), u16(0), name, body]);
    const central = Buffer.concat([u32(0x02014b50), u16(entry.madeBy ?? 20), u16(20), u16(flags), u16(method), u16(0), u16(0), u32(crc), u32(compressed), u32(declared), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(entry.externalAttributes ?? 0), u32(offset), name]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const total = count ?? entries.length;
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(total), u16(total), u32(directory.length), u32(offset), u16(0)]);
  return new Uint8Array(Buffer.concat([...locals, directory, eocd]));
}

export const UNIX_MADE_BY = (3 << 8) | 20;
export const unixMode = mode => ((mode << 16) >>> 0);
