/**
 * Embed services Magic Editor X configures itself on top of @editorjs/embed 2.7.7.
 *
 * 2.5 pins @editorjs/embed to 2.7.x because 2.8.0 declares `engines.node >=24`
 * while the plugin supports Node 22 (npm warns with EBADENGINE on install).
 * 2.8.0 added two things 2.4 users relied on, restored here as custom services
 * (the tool accepts `{ regex, embedUrl, html, height, width, id }` per service):
 * - YouTube Shorts URLs (`youtube.com/shorts/<id>`) in the YouTube pattern;
 * - Figma files, boards and prototypes. The 2.8.0 pattern was optional and
 *   matched any text, so this one requires a Figma document URL.
 *
 * Service definitions follow @editorjs/embed 2.8.0 (MIT, CodeX). Stored blocks
 * are unchanged: `service`, `source`, `embed`, `width`, `height` keep their meaning.
 */

/** Query parameters of a YouTube link that the embed URL keeps, mapped to the player's names. */
const YOUTUBE_PARAMS = { start: 'start', end: 'end', t: 'start', time_continue: 'start', list: 'list' };

/**
 * YouTube video id plus the supported player parameters from the regex groups.
 * @param {Array<string|undefined>} groups - Id group and query group of the match.
 * @returns {string} `<id>` or `<id>?start=…&list=…`.
 */
export const youtubeId = ([matchedId, query]) => {
  let id = matchedId;
  if (!query && id) return id;
  const params = String(query || '')
    .slice(1)
    .split('&')
    .map((pair) => {
      const [key, value = ''] = pair.split('=');
      if (!id && key === 'v') {
        id = value;
        return null;
      }
      if (!YOUTUBE_PARAMS[key] || value === 'LL' || value.startsWith('RDMM') || value.startsWith('FL'))
        return null;
      return `${YOUTUBE_PARAMS[key]}=${value}`;
    })
    .filter(Boolean);
  return `${id}?${params.join('&')}`;
};

/** Custom service definitions passed to the embed tool's `services` config. */
export const EMBED_SERVICES = {
  youtube: {
    regex:
      /(?:https?:\/\/)?(?:www\.)?(?:(?:youtu\.be\/)|(?:youtube\.com)\/(?:v\/|u\/\w\/|embed\/|watch|shorts\/))(?:(?:\?v=)?([^#&?=]*))?((?:[?&]\w*=\w*)*)/,
    embedUrl: 'https://www.youtube.com/embed/<%= remote_id %>',
    html: '<iframe style="width:100%;" height="320" frameborder="0" allowfullscreen></iframe>',
    height: 320,
    width: 580,
    id: youtubeId,
  },
  figma: {
    regex: /(https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|board|slides)\/[A-Za-z0-9]+[^\s"'<>]*)/,
    embedUrl: 'https://www.figma.com/embed?embed_host=share&url=<%= remote_id %>',
    html: "<iframe height='450' scrolling='no' frameborder='no' allowtransparency='true' allowfullscreen='true' style='width: 100%;'></iframe>",
    height: 300,
    width: 600,
  },
};
