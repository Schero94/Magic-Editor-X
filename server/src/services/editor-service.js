'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isUtf8 } = require('node:buffer');
const ogs = require('open-graph-scraper');
const { fetchBounded, validateHttpUrl } = require('../utils/url-security');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const ATTACHMENT_TYPES = new Map([
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain'],
  ['.csv', 'text/csv'],
  ['.json', 'application/json'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
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

function detectImageMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/)) return 'image/gif';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function safeFilename(filename, fallback) {
  const basename = path.basename(String(filename || fallback)).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return basename && basename !== '.' && basename !== '..' ? basename.slice(0, 180) : fallback;
}

function matchesAttachmentSignature(extension, mime, buffer) {
  if (IMAGE_MIMES.has(mime)) return detectImageMime(buffer.subarray(0, 16)) === mime;
  if (mime === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (['.zip', '.docx', '.xlsx', '.pptx'].includes(extension)) {
    return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  }
  if (mime === 'application/msword' || mime === 'application/vnd.ms-excel' || mime === 'application/vnd.ms-powerpoint') {
    return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }
  if (mime === 'audio/wav') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE';
  if (mime === 'audio/ogg') return buffer.toString('ascii', 0, 4) === 'OggS';
  if (mime === 'audio/mpeg') return buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  if (mime === 'video/mp4') return buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp';
  if (mime === 'video/webm') return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (['text/plain', 'text/csv', 'application/json'].includes(mime)) {
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

module.exports = ({ strapi }, dependencies = {}) => {
  const safeFetch = dependencies.fetchBounded || fetchBounded;
  const scraper = dependencies.ogs || ogs;
  const fileSystem = dependencies.fs || fs;
  const tempRoot = dependencies.tempRoot || os.tmpdir();
  const getMaxBytes = (key) => {
    const configured = Number((strapi.config.get('plugin::magic-editor-x', {}) || {})[key]);
    return Number.isSafeInteger(configured) && configured > 0 ? Math.min(configured, MAX_UPLOAD_BYTES) : MAX_UPLOAD_BYTES;
  };

  const requireAdmin = (ctx) => {
    if (!ctx?.state?.user?.id) {
      const error = new Error('An authenticated Strapi admin is required');
      error.statusCode = 401;
      throw error;
    }
  };

  const getSingleFile = (files, fields) => {
    for (const field of fields) {
      const file = files?.[field];
      if (file) {
        if (Array.isArray(file)) throw Object.assign(new Error('Only one file can be uploaded at a time'), { statusCode: 400 });
        return file;
      }
    }
    throw Object.assign(new Error('No file provided'), { statusCode: 400 });
  };

  const getFileStats = async (file, maxBytes) => {
    const filepath = file?.filepath || file?.path;
    if (typeof filepath !== 'string') throw Object.assign(new Error('Invalid uploaded file'), { statusCode: 400 });
    const stats = await fileSystem.promises.stat(filepath);
    if (!stats.isFile() || stats.size < 1 || stats.size > maxBytes) {
      throw Object.assign(new Error('Uploaded file exceeds the configured size limit'), { statusCode: 413 });
    }
    return stats;
  };

  const upload = async (fileData, user) => {
    const uploadedFiles = await strapi.plugin('upload').service('upload').upload({ data: {}, files: fileData }, { user });
    if (!Array.isArray(uploadedFiles) || !uploadedFiles[0]) throw new Error('Media upload did not return a file');
    return uploadedFiles[0];
  };

  const editorFileResponse = (uploadedFile) => ({
    success: 1,
    file: {
      url: uploadedFile.url,
      name: uploadedFile.name,
      size: uploadedFile.size,
      width: uploadedFile.width,
      height: uploadedFile.height,
      mime: uploadedFile.mime,
      formats: uploadedFile.formats,
    },
  });

  return {
    async fetchLinkMeta(input, ctx) {
      requireAdmin(ctx);
      const target = validateHttpUrl(input);
      const { body } = await safeFetch(target.href, {
        maxBytes: MAX_PREVIEW_BYTES,
        allowedMimeTypes: ['text/html', 'application/xhtml+xml'],
      });
      const { result, error } = await scraper({ html: body.toString('utf8') });
      if (error) throw Object.assign(new Error('Remote page metadata could not be read'), { statusCode: 502 });

      const image = Array.isArray(result.ogImage) ? result.ogImage[0] : result.ogImage;
      return {
        success: 1,
        meta: {
          title: result.ogTitle || result.dcTitle || target.href,
          description: result.ogDescription || result.dcDescription || '',
          image: image?.url ? { url: image.url } : undefined,
          siteName: result.ogSiteName || '',
          url: result.ogUrl || target.href,
        },
      };
    },

    async uploadByFile(ctx) {
      requireAdmin(ctx);
      const file = getSingleFile(ctx.request?.files, ['files.image', 'image']);
      const stats = await getFileStats(file, getMaxBytes('maxImageSize'));
      const filepath = file.filepath || file.path;
      const buffer = await fileSystem.promises.readFile(filepath);
      const mime = detectImageMime(buffer.subarray(0, 16));
      if (!mime || (file.type && file.type !== mime) || (file.mimetype && file.mimetype !== mime)) {
        throw Object.assign(new Error('Uploaded data is not a supported raster image'), { statusCode: 400 });
      }

      const uploadedFile = await upload({
        ...file,
        filepath,
        originalFilename: safeFilename(file.originalFilename || file.name, `image.${mime.split('/')[1]}`),
        mimetype: mime,
        detectedMimeType: mime,
        size: stats.size,
      }, ctx.state.user);
      return editorFileResponse(uploadedFile);
    },

    async uploadByUrl(input, ctx) {
      requireAdmin(ctx);
      const target = validateHttpUrl(input);
      const downloaded = await safeFetch(target.href, {
        maxBytes: getMaxBytes('maxImageSize'),
        allowedMimeTypes: [...IMAGE_MIMES],
      });
      const detectedMime = detectImageMime(downloaded.body.subarray(0, 16));
      if (!detectedMime || detectedMime !== downloaded.mimeType) {
        throw Object.assign(new Error('Remote response is not a supported raster image'), { statusCode: 400 });
      }

      const extension = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' })[detectedMime];
      const requestedName = safeFilename(path.basename(downloaded.url.pathname), `image${extension}`);
      const filename = path.extname(requestedName) ? requestedName : `${requestedName}${extension}`;
      const directory = await fileSystem.promises.mkdtemp(path.join(tempRoot, 'magic-editor-x-'));
      const tempFilePath = path.join(directory, 'upload');
      try {
        await fileSystem.promises.writeFile(tempFilePath, downloaded.body, { flag: 'wx', mode: 0o600 });
        const uploadedFile = await upload({
          filepath: tempFilePath,
          originalFilename: filename,
          mimetype: detectedMime,
          detectedMimeType: detectedMime,
          size: downloaded.body.length,
        }, ctx.state.user);
        return editorFileResponse(uploadedFile);
      } finally {
        await fileSystem.promises.rm(directory, { recursive: true, force: true });
      }
    },

    async uploadAttachment(ctx) {
      requireAdmin(ctx);
      const file = getSingleFile(ctx.request?.files, ['file', 'files.file']);
      const stats = await getFileStats(file, getMaxBytes('maxFileSize'));
      const filename = safeFilename(file.name || file.originalFilename, 'attachment');
      const extension = path.extname(filename).toLowerCase();
      const expectedMime = ATTACHMENT_TYPES.get(extension);
      const suppliedMime = String(file.type || file.mimetype || '').toLowerCase();
      const buffer = await fileSystem.promises.readFile(file.filepath || file.path);
      if (!expectedMime || suppliedMime !== expectedMime || !matchesAttachmentSignature(extension, expectedMime, buffer)) {
        throw Object.assign(new Error('File type is not supported'), { statusCode: 400 });
      }

      const uploadedFile = await upload({
        ...file,
        filepath: file.filepath || file.path,
        originalFilename: filename,
        mimetype: expectedMime,
        size: stats.size,
      }, ctx.state.user);
      return {
        success: 1,
        file: {
          url: uploadedFile.url,
          name: uploadedFile.name,
          title: uploadedFile.name,
          size: stats.size,
          extension: path.extname(uploadedFile.name).slice(1),
        },
      };
    },

    getMimeType(extension) {
      return ATTACHMENT_TYPES.get(String(extension).toLowerCase()) || null;
    },
  };
};

module.exports.detectImageMime = detectImageMime;
module.exports.matchesAttachmentSignature = matchesAttachmentSignature;
