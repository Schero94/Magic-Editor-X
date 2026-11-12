'use strict';

const { service, sendEditorError } = require('./helpers');
const { createLogger } = require('../utils/logger');
const { z } = require('../utils/validation');

/** POST /media/byUrl body (2.4). */
const mediaByUrlSchema = z.strictObject({
  url: z.string().min(1).max(2048),
  kind: z.enum(['video', 'audio', 'track']),
});

/**
 * Editor.js helper endpoints. Responses follow the Editor.js tool contracts
 * (`{ success: 1, ... }` / `{ success: 0, message }`).
 */
module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);
  const editor = () => service(strapi, 'editor');

  return {
    /**
     * @route GET /magic-editor-x/link?url=
     * @auth admin; plugin::magic-editor-x.access
     * @sideeffect Outbound HTTP GET to a public URL (SSRF-guarded, 2 MiB, no private hosts).
     */
    async linkPreview(ctx) {
      const { url } = ctx.query;
      if (typeof url !== 'string' || !url || url.length > 2048) {
        ctx.status = 400;
        ctx.body = { success: 0, message: 'A URL is required' };
        return;
      }
      try {
        ctx.body = await editor().linkPreview(url);
      } catch (error) {
        sendEditorError(ctx, error, 'The link preview could not be loaded', logger, 'link preview');
      }
    },

    /**
     * @route POST /magic-editor-x/image/byFile (multipart field "image")
     * @auth admin; plugin::magic-editor-x.access + plugin::upload.assets.create
     * @sideeffect Creates a Media Library file owned by the admin.
     */
    async uploadImageFile(ctx) {
      try {
        ctx.body = await editor().uploadImageFile(ctx.request.files, ctx.state.user);
      } catch (error) {
        sendEditorError(ctx, error, 'The image could not be uploaded', logger, 'image upload');
      }
    },

    /**
     * @route POST /magic-editor-x/image/byUrl { url }
     * @auth admin; plugin::magic-editor-x.access + plugin::upload.assets.create
     * @sideeffect Downloads a public image (SSRF-guarded) and creates a Media Library file.
     */
    async uploadImageUrl(ctx) {
      const url = ctx.request.body && ctx.request.body.url;
      if (typeof url !== 'string' || !url || url.length > 2048) {
        ctx.status = 400;
        ctx.body = { success: 0, message: 'A URL is required' };
        return;
      }
      try {
        ctx.body = await editor().uploadImageUrl(url, ctx.state.user);
      } catch (error) {
        sendEditorError(ctx, error, 'The image could not be loaded from this URL', logger, 'image by URL');
      }
    },

    /**
     * @route POST /magic-editor-x/media/byUrl { url, kind: 'video'|'audio'|'track' }
     * @auth admin; plugin::magic-editor-x.access + plugin::upload.assets.create
     * @sideeffect Downloads a public video/audio/WebVTT file (SSRF-guarded, size cap, type and
     *   signature checked) and creates a Media Library file owned by the admin.
     */
    async uploadMediaUrl(ctx) {
      const parsed = mediaByUrlSchema.safeParse(ctx.request.body);
      if (!parsed.success) {
        ctx.status = 400;
        ctx.body = { success: 0, message: 'A URL and a media kind are required' };
        return;
      }
      try {
        ctx.body = await editor().uploadMediaUrl(parsed.data.url, parsed.data.kind, ctx.state.user);
      } catch (error) {
        sendEditorError(ctx, error, 'The file could not be loaded from this URL', logger, 'media by URL');
      }
    },

    /**
     * @route POST /magic-editor-x/file/upload (multipart field "file")
     * @auth admin; plugin::magic-editor-x.access + plugin::upload.assets.create
     * @sideeffect Creates a Media Library file owned by the admin.
     */
    async uploadAttachment(ctx) {
      try {
        ctx.body = await editor().uploadAttachment(ctx.request.files, ctx.state.user);
      } catch (error) {
        sendEditorError(ctx, error, 'The file could not be uploaded', logger, 'attachment upload');
      }
    },

    /**
     * @route GET /magic-editor-x/content-types
     * @auth admin; plugin::magic-editor-x.access
     * @returns {{ data: object[] }} API content types the caller can read in the Content Manager.
     */
    async contentTypes(ctx) {
      ctx.body = { data: service(strapi, 'access').readableContentTypes(ctx.state.userAbility) };
    },
  };
};
