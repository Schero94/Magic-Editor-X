/**
 * Bounded ZIP reader for imported Word files (2.11). A .docx file is a ZIP
 * archive of XML parts, and an untrusted archive can be a "zip bomb": a few
 * kilobytes that inflate to gigabytes. So nothing is inflated before the
 * archive passed these checks:
 *
 * 1. The file itself is at most `maxFileBytes` (10 MiB).
 * 2. The central directory is read and checked first: at most `maxEntries`
 *    entries, no duplicate names, no encryption, only "stored" and
 *    "deflate", no multi-disk or ZIP64 archive, every entry's data inside the
 *    file, the sum of all declared uncompressed sizes at most
 *    `maxTotalBytes` (50 MiB), and no entry above `maxRatio` (100:1) between
 *    its declared uncompressed and compressed size (entries under
 *    `ratioFloor`, 1 KiB, are too small to matter and are not ratio-checked).
 * 3. Only the parts the caller asks for are inflated, each at most
 *    `maxEntryBytes` (20 MiB), with fflate's streaming `Inflate` in
 *    `chunkBytes` (4 KiB) slices of compressed input: the output is counted
 *    while it arrives and the entry is refused as soon as it exceeds the size
 *    its directory record declared, so a lying header cannot make the reader
 *    allocate more than the declared size plus one slice's worth of output
 *    (DEFLATE expands at most about 1032:1, so about 4 MiB).
 *
 * fflate's own `unzipSync` is not used: it allocates from the declared sizes
 * (fflate issue #311, CVE-2026-122146, disputed by the maintainer, who
 * recommends the `filter` option); this reader enforces the limits itself.
 * Pure ESM, no DOM: the unit tests run it under `node --test`.
 */

import { Inflate } from 'fflate';

/** Limits of the import reader. */
export const ZIP_LIMITS = Object.freeze({
  maxFileBytes: 10 * 1024 * 1024,
  maxEntries: 1000,
  maxTotalBytes: 50 * 1024 * 1024,
  maxRatio: 100,
  ratioFloor: 1024,
  maxEntryBytes: 20 * 1024 * 1024,
  chunkBytes: 4096,
});

/** Error with a stable `code` the import dialog maps to a message. */
export class ImportError extends Error {
  /**
   * @param {string} code - Stable error code (`FILE_TOO_LARGE`, `ZIP_RATIO`, ...).
   * @param {string} [message] - Developer message (never shown to users).
   */
  constructor(code, message) {
    super(message || code);
    this.name = 'ImportError';
    this.code = code;
  }
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const ZIP64_MARK_32 = 0xffffffff;
const ZIP64_MARK_16 = 0xffff;

const u16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);
const u32 = (bytes, offset) =>
  (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)) + bytes[offset + 3] * 0x1000000;

const nameDecoder = new TextDecoder('utf-8');

/**
 * Reads and checks the central directory. Inflates nothing.
 * @param {Uint8Array} bytes - The whole file.
 * @param {Partial<typeof ZIP_LIMITS>} [limits] - Overrides (tests).
 * @returns {{ entries: Array<{ name: string, method: number, compressedSize: number, size: number, dataStart: number }>, totalBytes: number }} Directory.
 * @throws {ImportError} `FILE_TOO_LARGE`, `NOT_ZIP`, `ZIP_CORRUPT`, `ZIP_UNSUPPORTED`, `ZIP_ENCRYPTED`, `ZIP_TOO_MANY_ENTRIES`, `ZIP_TOO_LARGE`, `ZIP_RATIO`.
 */
export const readZipDirectory = (bytes, limits = {}) => {
  const max = { ...ZIP_LIMITS, ...limits };
  if (!(bytes instanceof Uint8Array)) throw new TypeError('readZipDirectory needs a Uint8Array');
  if (bytes.length > max.maxFileBytes) throw new ImportError('FILE_TOO_LARGE');
  if (bytes.length < 22 || u32(bytes, 0) !== LOCAL_HEADER) throw new ImportError('NOT_ZIP');
  // The end-of-directory record is in the last 22 + 65535 (comment) bytes.
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset -= 1) {
    if (u32(bytes, offset) === END_OF_DIRECTORY) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new ImportError('ZIP_CORRUPT', 'no end of central directory');
  const disk = u16(bytes, end + 4);
  const directoryDisk = u16(bytes, end + 6);
  const onDisk = u16(bytes, end + 8);
  const count = u16(bytes, end + 10);
  const directorySize = u32(bytes, end + 12);
  const directoryOffset = u32(bytes, end + 16);
  if (count === ZIP64_MARK_16 || directorySize === ZIP64_MARK_32 || directoryOffset === ZIP64_MARK_32)
    throw new ImportError('ZIP_UNSUPPORTED', 'zip64');
  if (disk !== 0 || directoryDisk !== 0 || onDisk !== count)
    throw new ImportError('ZIP_UNSUPPORTED', 'multi-disk');
  if (count > max.maxEntries) throw new ImportError('ZIP_TOO_MANY_ENTRIES');
  if (directoryOffset + directorySize > end) throw new ImportError('ZIP_CORRUPT', 'directory outside file');
  const entries = [];
  const names = new Set();
  let totalBytes = 0;
  let cursor = directoryOffset;
  const directoryEnd = directoryOffset + directorySize;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > directoryEnd || u32(bytes, cursor) !== CENTRAL_HEADER)
      throw new ImportError('ZIP_CORRUPT', 'bad directory record');
    const flags = u16(bytes, cursor + 8);
    const method = u16(bytes, cursor + 10);
    const compressedSize = u32(bytes, cursor + 20);
    const size = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const localOffset = u32(bytes, cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > directoryEnd) throw new ImportError('ZIP_CORRUPT', 'record past directory');
    const name = nameDecoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    // Bit 0: encrypted; bit 6: strong encryption.
    if (flags & 0x41) throw new ImportError('ZIP_ENCRYPTED');
    if (compressedSize === ZIP64_MARK_32 || size === ZIP64_MARK_32 || localOffset === ZIP64_MARK_32)
      throw new ImportError('ZIP_UNSUPPORTED', 'zip64 entry');
    if (method !== 0 && method !== 8) throw new ImportError('ZIP_UNSUPPORTED', `method ${method}`);
    if (method === 0 && compressedSize !== size) throw new ImportError('ZIP_CORRUPT', 'stored size');
    if (names.has(name)) throw new ImportError('ZIP_CORRUPT', 'duplicate entry name');
    names.add(name);
    totalBytes += size;
    if (totalBytes > max.maxTotalBytes) throw new ImportError('ZIP_TOO_LARGE');
    if (size > max.ratioFloor && (compressedSize === 0 || size / compressedSize > max.maxRatio))
      throw new ImportError('ZIP_RATIO');
    if (localOffset + 30 > directoryOffset || u32(bytes, localOffset) !== LOCAL_HEADER)
      throw new ImportError('ZIP_CORRUPT', 'bad local header');
    const dataStart = localOffset + 30 + u16(bytes, localOffset + 26) + u16(bytes, localOffset + 28);
    if (dataStart + compressedSize > directoryOffset)
      throw new ImportError('ZIP_CORRUPT', 'entry data outside file');
    entries.push({ name, method, compressedSize, size, dataStart });
    cursor = next;
  }
  return { entries, totalBytes };
};

/**
 * Inflates one checked entry with a running output count.
 * @param {Uint8Array} bytes - The whole file.
 * @param {{ name: string, method: number, compressedSize: number, size: number, dataStart: number }} entry - Entry from `readZipDirectory`.
 * @param {{ maxEntryBytes?: number, chunkBytes?: number, pause?: () => Promise<void>, pauseEvery?: number }} [options] - Limits; `pause` is awaited every `pauseEvery` slices so a long inflate does not block the page.
 * @returns {Promise<Uint8Array>} The entry's bytes (exactly `entry.size` long).
 * @throws {ImportError} `ENTRY_TOO_LARGE`, `ZIP_SIZE_MISMATCH` (more output than declared), `ZIP_CORRUPT`.
 */
export const inflateEntry = async (bytes, entry, options = {}) => {
  const maxEntryBytes = options.maxEntryBytes ?? ZIP_LIMITS.maxEntryBytes;
  const chunkBytes = options.chunkBytes ?? ZIP_LIMITS.chunkBytes;
  const pauseEvery = options.pauseEvery ?? 64;
  if (entry.size > maxEntryBytes) throw new ImportError('ENTRY_TOO_LARGE');
  const data = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  if (entry.method === 0) return data.slice();
  if (data.length === 0) {
    if (entry.size === 0) return new Uint8Array(0);
    throw new ImportError('ZIP_CORRUPT', 'empty deflate data');
  }
  const out = new Uint8Array(entry.size);
  let written = 0;
  let finished = false;
  const inflater = new Inflate((part, final) => {
    if (written + part.length > entry.size) throw new ImportError('ZIP_SIZE_MISMATCH');
    out.set(part, written);
    written += part.length;
    if (final) finished = true;
  });
  try {
    for (let offset = 0, slice = 0; offset < data.length; offset += chunkBytes, slice += 1) {
      const stop = Math.min(offset + chunkBytes, data.length);
      inflater.push(data.subarray(offset, stop), stop === data.length);
      if (options.pause && slice % pauseEvery === pauseEvery - 1) await options.pause();
    }
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError('ZIP_CORRUPT', 'invalid deflate data');
  }
  if (!finished || written !== entry.size)
    throw new ImportError('ZIP_CORRUPT', 'size differs from directory');
  return out;
};
