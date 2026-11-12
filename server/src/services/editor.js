'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isUtf8 } = require('node:buffer');
const ogs = require('open-graph-scraper');
const { fetchBounded, validateHttpUrl } = require('../utils/url-security');

/**
 * Editor helpers: link previews, uploads into the Strapi Media Library and the
 * content-type list for the embedded-entry picker.
 *
 * Uploads are checked by magic bytes (never by the client's MIME type or file
 * name alone), bounded in size and stored through the Media Library service
 * with the admin as creator, so Media Library permissions and providers apply.
 */

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const HARD_UPLOAD_LIMIT = 500 * 1024 * 1024;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);
const IMAGE_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
};
const ATTACHMENT_TYPES = new Map([
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain'],
  ['.csv', 'text/csv'],
  ['.json', 'application/json'],
  ['.md', 'text/markdown'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.odt', 'application/vnd.oasis.opendocument.text'],
  ['.ods', 'application/vnd.oasis.opendocument.spreadsheet'],
  ['.zip', 'application/zip'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
]);

/**
 * Media by URL (2.4, pasted `<video>`/`<audio>`): accepted response types per
 * kind, the canonical type stored for each and the container its signature
 * must show. `track` is a WebVTT text track.
 */
const MEDIA_TYPES = {
  video: new Map([
    ['video/mp4', ['video/mp4', 'mp4', '.mp4']],
    ['video/quicktime', ['video/quicktime', 'mp4', '.mov']],
    ['video/webm', ['video/webm', 'webm', '.webm']],
    ['video/ogg', ['video/ogg', 'ogg', '.ogv']],
  ]),
  audio: new Map([
    ['audio/mpeg', ['audio/mpeg', 'mp3', '.mp3']],
    ['audio/mp3', ['audio/mpeg', 'mp3', '.mp3']],
    ['audio/mp4', ['audio/mp4', 'mp4', '.m4a']],
    ['audio/x-m4a', ['audio/mp4', 'mp4', '.m4a']],
    ['audio/aac', ['audio/aac', 'aac', '.aac']],
    ['audio/ogg', ['audio/ogg', 'ogg', '.ogg']],
    ['audio/wav', ['audio/wav', 'wav', '.wav']],
    ['audio/x-wav', ['audio/wav', 'wav', '.wav']],
    ['audio/wave', ['audio/wav', 'wav', '.wav']],
    ['audio/webm', ['audio/webm', 'webm', '.weba']],
    ['audio/flac', ['audio/flac', 'flac', '.flac']],
    ['audio/x-flac', ['audio/flac', 'flac', '.flac']],
  ]),
  track: new Map([['text/vtt', ['text/vtt', 'vtt', '.vtt']]]),
};
/** Size cap of a WebVTT track fetched by URL. */
const MAX_TRACK_BYTES = 512 * 1024;
/** Time limit per hop of a media download. */
const MEDIA_TIMEOUT_MS = 60000;
/** Media downloads at once per process (each is buffered in memory up to `uploads.maxMediaBytes`). */
const MAX_MEDIA_DOWNLOADS = 3;

/**
 * Container format of an audio or video file (or a WebVTT track) from its first bytes.
 * @param {Buffer} buffer - File start (at least 12 bytes for most formats).
 * @returns {'mp4'|'webm'|'ogg'|'mp3'|'wav'|'flac'|'aac'|'vtt'|null} Container or null.
 */
function detectMediaContainer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  if (buffer.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (buffer.toString('ascii', 0, 4) === 'fLaC') return 'flac';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
  )
    return 'wav';
  if (buffer.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  // ADTS AAC: sync word 0xFFF, layer 00.
  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return 'aac';
  // MPEG audio frame sync (layer bits not 00).
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && (buffer[1] & 0x06) !== 0) return 'mp3';
  const text = buffer
    .subarray(0, 16)
    .toString('utf8')
    .replace(/^\ufeff/, '');
  if (/^WEBVTT(?:[ \t\r\n]|$)/.test(text)) return 'vtt';
  return null;
}

/**
 * True when a buffer is a WebVTT file: UTF-8, no NUL bytes, starts with `WEBVTT`.
 * @param {Buffer} buffer - Whole file.
 * @returns {boolean} Result.
 */
function isWebVtt(buffer) {
  return (
    Buffer.isBuffer(buffer) && isUtf8(buffer) && !buffer.includes(0) && detectMediaContainer(buffer) === 'vtt'
  );
}

/**
 * Detects a raster image type from its first bytes.
 * @param {Buffer} buffer - File start.
 * @returns {string|null} MIME type or null.
 */
function detectImageMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return 'image/jpeg';
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 4, 8) === 'ftyp' &&
    /^avi[fs]$/.test(buffer.toString('ascii', 8, 12))
  ) {
    return 'image/avif';
  }
  return null;
}

/**
 * Checks that an attachment's content matches its extension.
 * @param {string} extension - Lower-case extension with dot.
 * @param {string} mime - Expected MIME type.
 * @param {Buffer} buffer - File content.
 * @returns {boolean} True when the signature matches.
 */
function matchesAttachmentSignature(extension, mime, buffer) {
  if (IMAGE_MIMES.has(mime)) return detectImageMime(buffer.subarray(0, 16)) === mime;
  if (mime === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (['.zip', '.docx', '.xlsx', '.pptx', '.odt', '.ods'].includes(extension)) {
    return (
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04
    );
  }
  if (['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint'].includes(mime)) {
    return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  if (mime === 'audio/wav')
    return (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WAVE'
    );
  if (mime === 'audio/ogg') return buffer.toString('ascii', 0, 4) === 'OggS';
  if (mime === 'audio/mpeg')
    return buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  if (mime === 'video/mp4') return buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp';
  if (mime === 'video/webm') return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (['text/plain', 'text/csv', 'text/markdown', 'application/json'].includes(mime)) {
    if (!isUtf8(buffer) || buffer.includes(0)) return false;
    if (mime !== 'application/json') return true;
    try {
      JSON.parse(buffer.toString('utf8'));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Makes a file name safe for storage and display.
 * @param {unknown} filename - Client file name.
 * @param {string} fallback - Name used when nothing usable remains.
 * @returns {string} Safe base name.
 */
function safeFilename(filename, fallback) {
  const base = path
    .basename(String(filename || fallback))
    // eslint-disable-next-line no-control-regex -- strip control characters from client file names
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '')
    .trim();
  return base && base !== '.' && base !== '..' ? base.slice(0, 180) : fallback;
}

/**
 * Creates an error with an HTTP status.
 * @param {string} message - Fixed message.
 * @param {number} statusCode - Status.
 * @returns {Error} Error.
 */
const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

module.exports = ({ strapi }, dependencies = {}) => {
  const safeFetch = dependencies.fetchBounded || fetchBounded;
  const scraper = dependencies.ogs || ogs;
  const fileSystem = dependencies.fs || fs;
  const tempRoot = dependencies.tempRoot || os.tmpdir();
  const config = (key, fallback) => {
    const value = strapi.config.get(`plugin::magic-editor-x.${key}`);
    return value === undefined ? fallback : value;
  };
  const limit = (key, fallback) => {
    const value = Number(config(key, fallback));
    return Number.isSafeInteger(value) && value > 0 ? Math.min(value, HARD_UPLOAD_LIMIT) : fallback;
  };

  let mediaDownloads = 0;

  /**
   * Fetch options for a by-URL upload. An origin the owner listed in
   * `uploads.allowPrivateOrigins` (exact `URL.origin`) may be private or
   * loopback (intranet media server, test server); redirects from it are never
   * followed. Every other URL must be public.
   * @param {URL} target - Validated URL.
   * @returns {object} Options for fetchBounded.
   */
  const originOptions = (target) => {
    const allowed = config('uploads.allowPrivateOrigins', []);
    return Array.isArray(allowed) && allowed.includes(target.origin)
      ? { allowPrivate: true, maxRedirects: 0 }
      : { maxRedirects: 2 };
  };

  /**
   * Parses an outbound URL; with a listed private origin the private-address check is skipped.
   * @param {string} input - URL.
   * @returns {URL} Parsed URL.
   */
  const parseTarget = (input) => {
    let origin = '';
    try {
      origin = new URL(input).origin;
    } catch {
      // validateHttpUrl rejects it below
    }
    const allowed = config('uploads.allowPrivateOrigins', []);
    const listed = Array.isArray(allowed) && origin !== '' && allowed.includes(origin);
    return validateHttpUrl(input, { allowPrivate: listed });
  };

  const getSingleFile = (files, names) => {
    for (const name of names) {
      const file = files?.[name];
      if (file) {
        if (Array.isArray(file)) throw httpError('Only one file can be uploaded at a time', 400);
        return file;
      }
    }
    throw httpError('No file provided', 400);
  };

  const fileStats = async (file, maxBytes) => {
    const filepath = file?.filepath || file?.path;
    if (typeof filepath !== 'string') throw httpError('Invalid uploaded file', 400);
    const stats = await fileSystem.promises.stat(filepath);
    if (!stats.isFile() || stats.size < 1) throw httpError('Invalid uploaded file', 400);
    if (stats.size > maxBytes) throw httpError('The file exceeds the configured size limit', 413);
    return { filepath, size: stats.size };
  };

  const readHead = async (filepath, bytes) => {
    const handle = await fileSystem.promises.open(filepath, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  };

  const toMediaLibrary = async (fileData, user) => {
    const uploaded = await strapi
      .plugin('upload')
      .service('upload')
      .upload({ data: {}, files: fileData }, { user });
    const file = Array.isArray(uploaded) ? uploaded[0] : uploaded;
    if (!file) throw new Error('Media upload did not return a file');
    return file;
  };

  const imageResponse = (file) => ({
    success: 1,
    file: {
      url: file.url,
      id: file.id,
      documentId: file.documentId,
      name: file.name,
      alt: file.alternativeText || '',
      size: file.size,
      width: file.width,
      height: file.height,
      mime: file.mime,
      formats: file.formats,
    },
  });

  return {
    /**
     * Fetches Open Graph metadata for a public URL.
     * @param {string} input - URL.
     * @returns {Promise<{ success: 1, link: string, meta: object }>} Editor.js link tool response.
     * @throws {Error} 400 for rejected URLs, 404 when disabled, 502 when the page cannot be read.
     */
    async linkPreview(input) {
      if (config('linkPreview.enabled', true) === false) throw httpError('Link previews are disabled', 404);
      const target = validateHttpUrl(input);
      const { body, url } = await safeFetch(target.href, {
        maxBytes: MAX_PREVIEW_BYTES,
        allowedMimeTypes: ['text/html', 'application/xhtml+xml'],
        timeoutMs: limit('linkPreview.timeoutMs', 8000),
      });
      const { result, error } = await scraper({ html: body.toString('utf8') });
      if (error || !result) throw httpError('The page metadata could not be read', 502);
      const image = Array.isArray(result.ogImage) ? result.ogImage[0] : result.ogImage;
      let imageUrl = '';
      if (image?.url) {
        try {
          imageUrl = new URL(image.url, url).href;
        } catch {
          imageUrl = '';
        }
      }
      return {
        success: 1,
        link: target.href,
        meta: {
          title: String(result.ogTitle || result.dcTitle || target.hostname).slice(0, 500),
          description: String(result.ogDescription || result.dcDescription || '').slice(0, 2000),
          site_name: String(result.ogSiteName || '').slice(0, 200),
          ...(imageUrl ? { image: { url: imageUrl } } : {}),
        },
      };
    },

    /**
     * Uploads an image file into the Media Library.
     * @param {object} files - ctx.request.files.
     * @param {object} user - Admin user.
     * @returns {Promise<object>} Editor.js image tool response.
     */
    async uploadImageFile(files, user) {
      const file = getSingleFile(files, ['image', 'files.image', 'file']);
      const { filepath, size } = await fileStats(file, limit('uploads.maxImageBytes', 10 * 1024 * 1024));
      const mime = detectImageMime(await readHead(filepath, 16));
      if (!mime) throw httpError('The file is not a supported image', 400);
      const name = safeFilename(file.originalFilename || file.name, `image${IMAGE_EXTENSIONS[mime]}`);
      const uploaded = await toMediaLibrary(
        { filepath, originalFilename: name, mimetype: mime, detectedMimeType: mime, size },
        user
      );
      return imageResponse(uploaded);
    },

    /**
     * Downloads a public image URL and stores it in the Media Library.
     * @param {string} input - Image URL.
     * @param {object} user - Admin user.
     * @returns {Promise<object>} Editor.js image tool response.
     */
    async uploadImageUrl(input, user) {
      const target = parseTarget(input);
      const downloaded = await safeFetch(target.href, {
        maxBytes: limit('uploads.maxImageBytes', 10 * 1024 * 1024),
        allowedMimeTypes: [...IMAGE_MIMES],
        ...originOptions(target),
      });
      const mime = detectImageMime(downloaded.body.subarray(0, 16));
      if (!mime) throw httpError('The URL does not point to a supported image', 400);
      const requested = safeFilename(
        path.basename(downloaded.url.pathname),
        `image${IMAGE_EXTENSIONS[mime]}`
      );
      const name = path.extname(requested) ? requested : `${requested}${IMAGE_EXTENSIONS[mime]}`;
      const directory = await fileSystem.promises.mkdtemp(path.join(tempRoot, 'magic-editor-x-'));
      const filepath = path.join(directory, 'upload');
      try {
        await fileSystem.promises.writeFile(filepath, downloaded.body, { flag: 'wx', mode: 0o600 });
        const uploaded = await toMediaLibrary(
          {
            filepath,
            originalFilename: name,
            mimetype: mime,
            detectedMimeType: mime,
            size: downloaded.body.length,
          },
          user
        );
        return imageResponse(uploaded);
      } finally {
        await fileSystem.promises.rm(directory, { recursive: true, force: true });
      }
    },

    /**
     * Downloads a public video, audio or WebVTT file and stores it in the
     * Media Library (2.4, pasted `<video>`/`<audio>`). The response type must
     * be one of the kind's types and the file signature must match it.
     * `data:`, `blob:` and `file:` URLs are refused (http(s) only).
     * @param {string} input - URL.
     * @param {'video'|'audio'|'track'} kind - What the file must be.
     * @param {object} user - Admin user.
     * @returns {Promise<{ success: 1, file: object }>} Media file for the video/audio block.
     * @throws {Error} 400 rejected URL or content, 413 too large, 415 wrong type, 429 busy, 502/504 remote errors.
     */
    async uploadMediaUrl(input, kind, user) {
      const types = MEDIA_TYPES[kind];
      if (!types) throw httpError('Unsupported media kind', 400);
      const target = parseTarget(input);
      if (mediaDownloads >= MAX_MEDIA_DOWNLOADS)
        throw httpError('Too many media downloads at once, try again shortly', 429);
      mediaDownloads += 1;
      let downloaded;
      try {
        downloaded = await safeFetch(target.href, {
          maxBytes: kind === 'track' ? MAX_TRACK_BYTES : limit('uploads.maxMediaBytes', 50 * 1024 * 1024),
          allowedMimeTypes: [...types.keys()],
          timeoutMs: MEDIA_TIMEOUT_MS,
          ...originOptions(target),
        });
      } finally {
        mediaDownloads -= 1;
      }
      const [mime, container, extension] = types.get(downloaded.mimeType);
      const valid =
        kind === 'track'
          ? isWebVtt(downloaded.body)
          : detectMediaContainer(downloaded.body.subarray(0, 16)) === container ||
            // AAC is also delivered in an MP4 container.
            (mime === 'audio/aac' && detectMediaContainer(downloaded.body.subarray(0, 16)) === 'mp4');
      if (!valid) throw httpError('The file content does not match its type', 415);
      const requested = safeFilename(path.basename(downloaded.url.pathname), `${kind}${extension}`);
      const name = path.extname(requested) ? requested : `${requested}${extension}`;
      const directory = await fileSystem.promises.mkdtemp(path.join(tempRoot, 'magic-editor-x-'));
      const filepath = path.join(directory, 'upload');
      try {
        await fileSystem.promises.writeFile(filepath, downloaded.body, { flag: 'wx', mode: 0o600 });
        const uploaded = await toMediaLibrary(
          {
            filepath,
            originalFilename: name,
            mimetype: mime,
            detectedMimeType: mime,
            size: downloaded.body.length,
          },
          user
        );
        return {
          success: 1,
          file: {
            url: uploaded.url,
            id: uploaded.id,
            documentId: uploaded.documentId,
            name: uploaded.name,
            mime: uploaded.mime || mime,
            ext: uploaded.ext,
            hash: uploaded.hash,
            size: uploaded.size,
          },
        };
      } finally {
        await fileSystem.promises.rm(directory, { recursive: true, force: true });
      }
    },

    /**
     * Uploads an attachment into the Media Library.
     * @param {object} files - ctx.request.files.
     * @param {object} user - Admin user.
     * @returns {Promise<object>} Editor.js attaches tool response.
     */
    async uploadAttachment(files, user) {
      const file = getSingleFile(files, ['file', 'files.file']);
      const { filepath, size } = await fileStats(file, limit('uploads.maxFileBytes', 20 * 1024 * 1024));
      const name = safeFilename(file.originalFilename || file.name, 'attachment');
      const extension = path.extname(name).toLowerCase();
      const mime = ATTACHMENT_TYPES.get(extension);
      if (!mime) throw httpError('This file type is not supported', 400);
      const head = await readHead(
        filepath,
        ['text/plain', 'text/csv', 'text/markdown', 'application/json'].includes(mime) ? size : 16
      );
      if (!matchesAttachmentSignature(extension, mime, head))
        throw httpError('The file content does not match its type', 400);
      const uploaded = await toMediaLibrary(
        { filepath, originalFilename: name, mimetype: mime, detectedMimeType: mime, size },
        user
      );
      return {
        success: 1,
        file: {
          url: uploaded.url,
          name: uploaded.name,
          title: uploaded.name,
          size,
          extension: extension.slice(1),
        },
      };
    },

    /** Supported attachment extensions (for the editor's file picker). */
    attachmentTypes() {
      return Array.from(new Set(ATTACHMENT_TYPES.values()));
    },
  };
};

module.exports.detectImageMime = detectImageMime;
module.exports.matchesAttachmentSignature = matchesAttachmentSignature;
module.exports.safeFilename = safeFilename;
module.exports.detectMediaContainer = detectMediaContainer;
module.exports.isWebVtt = isWebVtt;
module.exports.MEDIA_TYPES = MEDIA_TYPES;
