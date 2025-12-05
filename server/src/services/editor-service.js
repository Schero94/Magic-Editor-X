/**
 * Magic Editor X - Editor Service
 * Business logic for link preview and image upload
 */
'use strict';

const ogs = require('open-graph-scraper');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

module.exports = ({ strapi }) => ({
  /**
   * Fetch OpenGraph metadata for a URL
   * @param {string} url - URL to fetch metadata from
   * @returns {object} EditorJS compatible link data
   */
  async fetchLinkMeta(url) {
    try {
      const options = {
        url,
        timeout: 10000,
        fetchOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; MagicEditorX/1.0)',
          },
        },
      };

      const { result, error } = await ogs(options);

      if (error) {
        strapi.log.warn('[Magic Editor X] OGS error:', error);
        return {
          success: 1,
          meta: {
            title: url,
            description: '',
            image: undefined,
          },
        };
      }

      // Extract image URL
      let imageUrl = undefined;
      if (result.ogImage) {
        if (Array.isArray(result.ogImage) && result.ogImage.length > 0) {
          imageUrl = { url: result.ogImage[0].url };
        } else if (result.ogImage.url) {
          imageUrl = { url: result.ogImage.url };
        }
      }

      return {
        success: 1,
        meta: {
          title: result.ogTitle || result.dcTitle || url,
          description: result.ogDescription || result.dcDescription || '',
          image: imageUrl,
          siteName: result.ogSiteName || '',
          url: result.ogUrl || url,
        },
      };
    } catch (error) {
      strapi.log.error('[Magic Editor X] Link meta fetch error:', error);
      
      // Return basic result even on error
      return {
        success: 1,
        meta: {
          title: url,
          description: '',
          image: undefined,
        },
      };
    }
  },

  /**
   * Upload image from multipart form data
   * @param {object} ctx - Koa context
   * @returns {object} EditorJS compatible upload result
   */
  async uploadByFile(ctx) {
    try {
      // Get files from request
      const { files } = ctx.request;

      if (!files || !files['files.image']) {
        throw new Error('No file provided');
      }

      const file = files['files.image'];
      
      // Upload to Strapi's media library
      const uploadService = strapi.plugin('upload').service('upload');
      
      const uploadedFiles = await uploadService.upload({
        data: {},
        files: Array.isArray(file) ? file : [file],
      });

      const uploadedFile = uploadedFiles[0];

      return {
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
      };
    } catch (error) {
      strapi.log.error('[Magic Editor X] File upload error:', error);
      throw error;
    }
  },

  /**
   * Download and upload image from URL
   * @param {string} imageUrl - URL of image to download
   * @returns {object} EditorJS compatible upload result
   */
  async uploadByUrl(imageUrl) {
    try {
      // Parse URL to get filename
      const parsedUrl = new URL(imageUrl);
      const pathname = parsedUrl.pathname;
      const ext = path.extname(pathname) || '.jpg';
      const name = path.basename(pathname, ext) || 'image';
      const filename = `${name}${ext}`;

      // Create temp file path
      const tempDir = path.join(strapi.dirs.static.public, 'uploads', 'temp');
      
      // Ensure temp directory exists
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const tempFilePath = path.join(tempDir, `${Date.now()}-${filename}`);

      // Download file
      const buffer = await this.downloadFile(imageUrl);
      
      // Write to temp file
      await fs.promises.writeFile(tempFilePath, buffer);

      // Get file stats
      const stats = await fs.promises.stat(tempFilePath);

      // Prepare file for upload
      const fileData = {
        path: tempFilePath,
        name: filename,
        type: this.getMimeType(ext),
        size: stats.size,
      };

      // Upload to Strapi's media library
      const uploadService = strapi.plugin('upload').service('upload');
      
      const uploadedFiles = await uploadService.upload({
        data: {},
        files: fileData,
      });

      // Clean up temp file
      try {
        await fs.promises.unlink(tempFilePath);
      } catch (unlinkError) {
        strapi.log.warn('[Magic Editor X] Could not delete temp file:', unlinkError);
      }

      const uploadedFile = uploadedFiles[0];

      return {
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
      };
    } catch (error) {
      strapi.log.error('[Magic Editor X] URL upload error:', error);
      throw error;
    }
  },

  /**
   * Download file from URL
   * @param {string} url - URL to download from
   * @returns {Promise<Buffer>} File buffer
   */
  downloadFile(url) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      const request = protocol.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MagicEditorX/1.0)',
        },
      }, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return this.downloadFile(response.headers.location)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }

        const chunks = [];
        
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });

      request.on('error', reject);
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
    });
  },

  /**
   * Get MIME type from file extension
   * @param {string} ext - File extension
   * @returns {string} MIME type
   */
  getMimeType(ext) {
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
      // Documents
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // Archives
      '.zip': 'application/zip',
      '.rar': 'application/vnd.rar',
      '.7z': 'application/x-7z-compressed',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      // Text
      '.txt': 'text/plain',
      '.csv': 'text/csv',
      '.json': 'application/json',
      '.xml': 'application/xml',
      // Audio
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      // Video
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
    };

    return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
  },

  /**
   * Upload attachment file (for Attaches Tool)
   * @param {object} ctx - Koa context
   * @returns {object} EditorJS compatible attachment result
   */
  async uploadAttachment(ctx) {
    try {
      // Get files from request
      const { files } = ctx.request;

      // Check for file in different possible field names
      const file = files?.file || files?.['files.file'] || Object.values(files || {})[0];

      if (!file) {
        throw new Error('No file provided');
      }

      // Upload to Strapi's media library
      const uploadService = strapi.plugin('upload').service('upload');
      
      const uploadedFiles = await uploadService.upload({
        data: {},
        files: Array.isArray(file) ? file : [file],
      });

      const uploadedFile = uploadedFiles[0];

      // Get file extension for title
      const ext = path.extname(uploadedFile.name);

      return {
        success: 1,
        file: {
          url: uploadedFile.url,
          name: uploadedFile.name,
          title: uploadedFile.name,
          size: uploadedFile.size,
          extension: ext.replace('.', ''),
        },
      };
    } catch (error) {
      strapi.log.error('[Magic Editor X] Attachment upload error:', error);
      throw error;
    }
  },
});

