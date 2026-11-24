import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Box, Flex, IconButton, LinkButton, Popover, Typography } from '@strapi/design-system';
import { Crop, ExternalLink } from '@strapi/icons';
import { useNotification } from '@strapi/strapi/admin';
import styled from 'styled-components';
import { mediaLibraryAssetHref, mediaLibraryFileId } from '../../../../shared/media-library.mjs';
import { API } from '../../utils/api';

/**
 * "Edit in Media Library" in the image block (2.11).
 *
 * Strapi has no API to open its crop dialog from a plugin, but Strapi 5.54+
 * opens the asset details drawer of a file from `/admin/plugins/upload?assetId=<id>`,
 * and its Crop button opens Crop & Focus. The button opens a popover that
 * says what cropping does (it replaces the file everywhere it is used) and
 * links to the drawer in a new tab: the entry stays open with its unsaved
 * changes, exactly like "Edit source" of a synced block.
 *
 * When the person comes back to this tab (window focus or the tab becomes
 * visible), the file is read again with Strapi's own `GET /upload/files/:id`
 * (`plugin::upload.read`) and the block takes the new URL, size and formats;
 * the Media Library's focal point becomes the block's focal point when the
 * block has none.
 */

// Sits in the row of the "Set focal point" button (`.mex-focal__row`).
const Root = styled(Box)`
  display: inline-flex;
`;

const Body = styled(Box)`
  width: min(36rem, calc(100vw - 3.2rem));
`;

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {string} props.uploadPath - Admin URL of the Media Library page (`useHref('/plugins/upload')`).
 * @param {Function} props.get - `useFetchClient().get`.
 * @param {() => object|null} props.getFile - Current `file` of the block.
 * @param {(listener: () => void) => () => void} props.subscribe - Called when the block shows another file.
 * @param {(fresh: object) => boolean} props.applyFile - Takes the Media Library file; true when the block changed.
 * @returns {JSX.Element|null} Button and popover, or nothing without a Media Library file.
 */
export const MediaEditControl = ({ t, uploadPath, get, getFile, subscribe, applyFile }) => {
  const { toggleNotification } = useNotification();
  // The block can show another file later (replace, upload): follow it.
  const fileId = useSyncExternalStore(subscribe, () => mediaLibraryFileId(getFile()));
  const [open, setOpen] = useState(false);
  const awaitingRef = useRef(false);
  const busyRef = useRef(false);
  const abortRef = useRef(null);

  const refresh = useCallback(async () => {
    const id = mediaLibraryFileId(getFile());
    if (!id || busyRef.current) return;
    busyRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { data } = await get(API.uploadFile(id), { signal: controller.signal });
      if (controller.signal.aborted) return;
      const file =
        data && typeof data === 'object' && data.data && typeof data.data === 'object' ? data.data : data;
      if (applyFile(file))
        toggleNotification({
          type: 'success',
          message: t('editor.mediaEdit.updated', 'The image was updated from the Media Library.'),
        });
    } catch (error) {
      if (controller.signal.aborted) return;
      const status = error && error.response ? error.response.status : null;
      toggleNotification({
        type: 'warning',
        message:
          status === 404
            ? t('editor.mediaEdit.missing', 'This image is no longer in the Media Library.')
            : t('editor.mediaEdit.refreshFailed', 'The image could not be updated from the Media Library.'),
      });
    } finally {
      busyRef.current = false;
    }
  }, [get, getFile, applyFile, toggleNotification, t]);

  // Back in this tab after opening the Media Library: read the file again.
  useEffect(() => {
    const onReturn = () => {
      if (!awaitingRef.current || document.visibilityState === 'hidden') return;
      refresh();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [refresh]);

  const href = fileId ? mediaLibraryAssetHref(uploadPath, fileId) : null;
  if (!href) return null;
  const label = t('editor.mediaEdit.button', 'Edit in Media Library');
  return (
    <Root data-testid="mex-media-edit">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger>
          <IconButton label={label} variant="tertiary" size="S" data-testid="mex-media-edit-button">
            <Crop />
          </IconButton>
        </Popover.Trigger>
        <Popover.Content side="bottom" align="start" aria-label={label}>
          <Body padding={3} data-testid="mex-media-edit-popover">
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Typography variant="omega" fontWeight="bold" textColor="neutral800" tag="h3">
                {t('editor.mediaEdit.title', 'Crop and focus in the Media Library')}
              </Typography>
              <Typography variant="pi" textColor="neutral800">
                {t(
                  'editor.mediaEdit.warning',
                  'Cropping replaces this file in the Media Library. Every entry that uses this image shows the cropped version.'
                )}
              </Typography>
              <Typography variant="pi" textColor="neutral600">
                {t(
                  'editor.mediaEdit.hint',
                  'The Media Library opens in a new tab, so your unsaved changes here stay. The image here updates when you come back.'
                )}
              </Typography>
              <Flex>
                <LinkButton
                  href={href}
                  isExternal
                  variant="secondary"
                  size="S"
                  endIcon={<ExternalLink />}
                  onClick={() => {
                    awaitingRef.current = true;
                    setOpen(false);
                  }}
                  data-testid="mex-media-edit-open"
                >
                  {t('editor.mediaEdit.open', 'Open in Media Library')}
                </LinkButton>
              </Flex>
            </Flex>
          </Body>
        </Popover.Content>
      </Popover.Root>
    </Root>
  );
};

export default MediaEditControl;
