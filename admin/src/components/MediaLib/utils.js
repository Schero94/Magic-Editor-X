/**
 * Magic Editor X - Media Library Utilities
 * Helper functions for Media Library integration
 */

/**
 * Create toggle function for Media Library dialog
 * @param {object} params - Parameters
 * @param {function} params.openStateSetter - State setter for open/close
 * @param {function} params.indexStateSetter - State setter for block index
 * @returns {function} Toggle function
 */
export const getToggleFunc = ({ openStateSetter, indexStateSetter }) => {
  return (idx) => {
    // Set the block index if provided
    if (idx !== undefined && idx !== null) {
      indexStateSetter(idx);
    }

    // Toggle open state
    openStateSetter((prev) => !prev);
  };
};

/**
 * Handle media library selection and insert images into editor
 * @param {object} params - Parameters
 * @param {function} params.indexStateSetter - State setter for block index
 * @param {object} params.editor - EditorJS instance
 * @param {array} params.data - Selected files data
 * @param {number} params.index - Block index to insert at
 */
export const changeFunc = ({ indexStateSetter, editor, data, index }) => {
  if (!editor || !data || data.length === 0) {
    indexStateSetter(-1);
    return;
  }

  let insertedBlocksCount = 0;

  // Insert each selected image as a new block
  data.forEach((entry) => {
    // Only process images
    if (!entry.mime || !entry.mime.includes('image')) {
      console.warn('[Magic Editor X] Skipping non-image file:', entry.name);
      return;
    }

    // Prepare image block data
    const newBlockType = 'image';
    const newBlockData = {
      file: {
        url: entry.url.replace(window.location.origin, ''),
        mime: entry.mime,
        height: entry.height,
        width: entry.width,
        size: entry.size,
        alt: entry.alt || entry.name || '',
        formats: entry.formats,
      },
      caption: entry.caption || '',
      withBorder: false,
      withBackground: false,
      stretched: false,
    };

    // Insert the image block
    try {
      editor.blocks.insert(
        newBlockType,
        newBlockData,
        {},
        index + insertedBlocksCount,
        true
      );
      insertedBlocksCount++;
    } catch (error) {
      console.error('[Magic Editor X] Error inserting image block:', error);
    }
  });

  // Delete the placeholder block (media lib trigger block)
  if (insertedBlocksCount > 0) {
    try {
      editor.blocks.delete(index + insertedBlocksCount);
    } catch (error) {
      console.warn('[Magic Editor X] Could not delete placeholder block:', error);
    }
  }

  // Reset index state
  indexStateSetter(-1);
};

/**
 * Format file size to human readable format
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
export const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
};

/**
 * Get image dimensions from URL
 * @param {string} url - Image URL
 * @returns {Promise<{width: number, height: number}>} Image dimensions
 */
export const getImageDimensions = (url) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    
    img.onerror = (error) => {
      reject(error);
    };
    
    img.src = url;
  });
};

/**
 * Check if file type is allowed
 * @param {string} mime - MIME type
 * @param {array} allowedTypes - List of allowed types
 * @returns {boolean} Whether file type is allowed
 */
export const isAllowedFileType = (mime, allowedTypes = ['images']) => {
  if (!mime) return false;

  const typeMap = {
    images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
    videos: ['video/mp4', 'video/webm', 'video/ogg'],
    files: ['application/pdf', 'application/zip', 'text/plain'],
  };

  return allowedTypes.some((type) => {
    const allowedMimes = typeMap[type] || [];
    return allowedMimes.some((allowed) => mime.startsWith(allowed.split('/')[0]));
  });
};

export default {
  getToggleFunc,
  changeFunc,
  formatFileSize,
  getImageDimensions,
  isAllowedFileType,
};

