import { forwardRef } from 'react';
import { Box, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { RenderedContent } from '../RenderedContent';
import { isEmptyDocument } from '../../../../shared/templates.mjs';

/**
 * In-field preview (2.3): the field's rendered output (React renderer of
 * `magic-editor-x/react`), shown instead of the editor while the toggle is on.
 * It re-renders from the editor data the field already tracks, so local
 * edits, collaborators' edits, history restores and inserted templates show
 * up as they happen. Inert: no scripts, embeds as placeholders, raw HTML only
 * when the field allows it (sanitised), links do not navigate.
 */

/** Scrolls inside the frame in full screen; the focus ring shows the region has focus. */
const Region = styled(Box)`
  min-width: 0;
  min-height: ${({ $minHeight }) => `${$minHeight}px`};
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: -2px;
  }
  ${({ $fullscreen }) => ($fullscreen ? 'flex: 1 1 auto; overflow: auto;' : '')}
`;

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {object|null} props.data - Current editor data.
 * @param {boolean} props.allowRaw - Render Raw HTML blocks (sanitised).
 * @param {number} props.minHeight - Minimum height in pixels (the field option).
 * @param {boolean} props.fullscreen - Field is in full screen.
 * @param {string} [props.lang] - Content language.
 * @param {'ltr'|'rtl'} [props.dir] - Text direction.
 * @param {string} props.id - Region id (the toggle's aria-controls).
 * @param {import('react').Ref<HTMLElement>} ref - Region element (focused when the preview opens).
 * @returns {JSX.Element} Preview region.
 */
export const FieldPreview = forwardRef(function FieldPreview(
  { t, data, allowRaw, minHeight, fullscreen, lang, dir, id },
  ref
) {
  return (
    <Region
      ref={ref}
      id={id}
      tabIndex={-1}
      role="region"
      aria-label={t('editor.preview.label', 'Rendered preview')}
      paddingTop={4}
      paddingBottom={4}
      paddingLeft={{ initial: 3, medium: 4 }}
      paddingRight={{ initial: 3, medium: 4 }}
      $minHeight={minHeight}
      $fullscreen={fullscreen}
      data-testid="mex-preview"
    >
      {isEmptyDocument(data) ? (
        <Typography variant="omega" textColor="neutral600">
          {t('editor.preview.empty', 'Nothing to preview yet.')}
        </Typography>
      ) : (
        <RenderedContent value={data} t={t} allowRaw={allowRaw} lang={lang} dir={dir} />
      )}
    </Region>
  );
});

export default FieldPreview;
