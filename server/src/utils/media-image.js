'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fetchBounded, privateOriginOptions } = require('./url-security');

/**
 * Reads a Media Library image for the alternative text suggestion (2.3).
 *
 * - Picks the largest stored variant (original or a generated format such as
 *   `large`, `medium`, `small`) whose long edge is at most MAX_EDGE pixels and
 *   whose size is under MAX_IMAGE_BYTES, so no image library is needed to
 *   downsize; Strapi's upload plugin already made the smaller formats.
 * - Local files (`/uploads/...`) are read from `<public>/uploads` only: the
 *   resolved real path must stay inside that folder (no traversal, no
 *   symlinks out of it).
 * - Remote provider URLs are fetched through the SSRF-safe `fetchBounded`
 *   (public addresses only, pinned DNS, size and time caps, image MIME types).
 * - 2.4: URLs whose exact origin the owner listed in
 *   `ai.altText.allowPrivateOrigins` (self-hosted S3/MinIO on a private
 *   network) may resolve to private or loopback addresses; they never follow
 *   redirects and never reach link-local or metadata addresses
 *   (`privateOriginOptions`). Every cap above still applies.
 * - The bytes must start with the signature of a supported format; the media
 *   type sent to the provider comes from the bytes, not from the database.
 *
 * Image bytes and URLs (signed URLs carry tokens in the query) are never logged.
 */

/** Formats both Anthropic and OpenAI accept (docs: vision guides, checked 2026-11-12). */
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
/** Raw bytes; base64 adds a third, staying under the 5 MB limit of the strictest platform. */
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
/** Long edge Claude processes without resizing on standard models (vision guide). */
const MAX_EDGE = 1568;

/**
 * Creates an error with an HTTP status and a machine code.
 * @param {string} code - Machine code.
 * @param {number} status - HTTP status.
 * @returns {Error} Error.
 */
const imageError = (code, status) =>
  Object.assign(new Error('Image not usable'), { code, statusCode: status });

/**
 * Detects the image type from the first bytes.
 * @param {Buffer} buffer - Bytes.
 * @returns {string|null} MIME type or null.
 */
const sniffImageType = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  const head = buffer.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  if (
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
};

/**
 * Candidate variants of an upload file row.
 * @param {object} file - `plugin::upload.file` row.
 * @returns {Array<{ url: string, mime: string, width: number, height: number, bytes: number }>} Variants.
 */
const variantsOf = (file) => {
  const list = [
    file,
    ...Object.values(file && file.formats && typeof file.formats === 'object' ? file.formats : {}),
  ];
  return list
    .filter((item) => item && typeof item.url === 'string' && item.url)
    .map((item) => ({
      url: item.url,
      mime: String(item.mime || file.mime || '').toLowerCase(),
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      // Strapi stores sizes in kilobytes.
      bytes: Math.round((Number(item.size) || 0) * 1024),
    }));
};

/**
 * Chooses the variant to send.
 * @param {object} file - Upload file row.
 * @returns {{ url: string, mime: string, width: number, height: number, bytes: number }|null} Variant.
 */
const pickVariant = (file) => {
  const usable = variantsOf(file).filter(
    (item) => SUPPORTED_TYPES.includes(item.mime) && item.bytes > 0 && item.bytes <= MAX_IMAGE_BYTES
  );
  if (!usable.length) return null;
  const edge = (item) => Math.max(item.width, item.height);
  const fitting = usable.filter((item) => edge(item) > 0 && edge(item) <= MAX_EDGE);
  if (fitting.length) return fitting.sort((a, b) => edge(b) - edge(a))[0];
  return usable.sort((a, b) => a.bytes - b.bytes)[0];
};

/**
 * Reads a local upload safely.
 * @param {string} publicDir - Strapi public folder.
 * @param {string} url - `/uploads/...` URL.
 * @returns {Promise<Buffer>} Bytes.
 */
const readLocal = async (publicDir, url) => {
  const pathname = new URL(url, 'http://local.invalid').pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw imageError('IMAGE_UNREADABLE', 404);
  }
  if (decoded.includes('\0')) throw imageError('IMAGE_UNREADABLE', 404);
  const uploads = path.resolve(publicDir, 'uploads');
  const candidate = path.resolve(publicDir, `.${decoded}`);
  if (!candidate.startsWith(`${uploads}${path.sep}`)) throw imageError('IMAGE_UNREADABLE', 404);
  let real;
  let realUploads;
  try {
    real = await fs.promises.realpath(candidate);
    realUploads = await fs.promises.realpath(uploads);
  } catch {
    throw imageError('IMAGE_UNREADABLE', 404);
  }
  if (!real.startsWith(`${realUploads}${path.sep}`)) throw imageError('IMAGE_UNREADABLE', 404);
  const stat = await fs.promises.stat(real);
  if (!stat.isFile()) throw imageError('IMAGE_UNREADABLE', 404);
  if (stat.size > MAX_IMAGE_BYTES) throw imageError('IMAGE_TOO_LARGE', 413);
  return fs.promises.readFile(real);
};

/**
 * Loads the bytes of the chosen variant of an upload file.
 * @param {object} options - Options.
 * @param {object} options.file - Upload file row (URLs already signed for private providers).
 * @param {string} options.publicDir - Strapi public folder.
 * @param {number} [options.timeoutMs] - Time limit for remote files.
 * @param {Function} [options.fetch] - Bounded fetcher (tests).
 * @param {string[]} [options.allowPrivateOrigins] - Owner-listed private storage origins (2.4).
 * @param {Function} [options.resolve] - DNS lookup for listed origins (tests).
 * @returns {Promise<{ mediaType: string, data: string, bytes: number }>} Base64 image.
 * @throws {Error} With `code` IMAGE_UNSUPPORTED (415), IMAGE_TOO_LARGE (413) or IMAGE_UNREADABLE (404/502).
 */
const loadImage = async ({
  file,
  publicDir,
  timeoutMs = 15000,
  fetch = fetchBounded,
  allowPrivateOrigins = [],
  resolve,
}) => {
  const variant = pickVariant(file);
  if (!variant) {
    const anySupported = variantsOf(file).some((item) => SUPPORTED_TYPES.includes(item.mime));
    throw anySupported ? imageError('IMAGE_TOO_LARGE', 413) : imageError('IMAGE_UNSUPPORTED', 415);
  }
  let buffer;
  if (variant.url.startsWith('/') && !variant.url.startsWith('//')) {
    buffer = await readLocal(publicDir, variant.url);
  } else {
    try {
      const privateOrigin = privateOriginOptions(variant.url, allowPrivateOrigins, { resolve });
      const response = await fetch(variant.url, {
        maxBytes: MAX_IMAGE_BYTES,
        allowedMimeTypes: SUPPORTED_TYPES,
        maxRedirects: 2,
        timeoutMs,
        ...(privateOrigin || {}),
      });
      buffer = response.body;
    } catch (error) {
      if (error && error.statusCode === 413) throw imageError('IMAGE_TOO_LARGE', 413);
      throw imageError('IMAGE_UNREADABLE', 502);
    }
  }
  const mediaType = sniffImageType(buffer);
  if (!mediaType) throw imageError('IMAGE_UNSUPPORTED', 415);
  return { mediaType, data: buffer.toString('base64'), bytes: buffer.length };
};

module.exports = { SUPPORTED_TYPES, MAX_IMAGE_BYTES, MAX_EDGE, sniffImageType, pickVariant, loadImage };
