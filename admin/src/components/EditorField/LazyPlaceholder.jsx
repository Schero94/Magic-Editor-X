import { Box, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { RenderedContent } from '../RenderedContent';
import { isEmptyDocument } from '../../../../shared/templates.mjs';

/**
 * Static stand-in of a field whose editor has not started yet (2.5 lazy
 * start, see useLazyActivation): the saved content rendered with the React
 * renderer (no scripts, embeds as placeholders, lazy images), at least as
 * tall as the editor, so nothing jumps when the editor replaces it. It is a
 * tab stop: focusing or clicking it starts the editor, which then takes the
 * focus.
 */

const Region = styled(Box)`
  min-width: 0;
  min-height: ${({ $minHeight }) => `${$minHeight}px`};
  cursor: text;
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: -2px;
  }
`;

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {unknown} props.value - Saved field value.
 * @param {number} props.minHeight - Minimum height (field option).
 * @param {string} [props.placeholder] - Text of an empty field.
 * @param {boolean} props.allowRaw - Render Raw HTML blocks (sanitised).
 * @param {string} [props.lang] - Content language.
 * @param {'ltr'|'rtl'} [props.dir] - Text direction.
 * @param {() => void} props.onStart - Starts the editor.
 * @returns {JSX.Element} Placeholder.
 */
export const LazyPlaceholder = ({ t, value, minHeight, placeholder, allowRaw, lang, dir, onStart }) => (
  <Region
    tabIndex={0}
    role="group"
    aria-label={t('editor.loading', 'Loading the editor')}
    aria-busy="true"
    paddingTop={4}
    paddingBottom={4}
    paddingLeft={{ initial: 3, medium: 4 }}
    paddingRight={{ initial: 3, medium: 4 }}
    $minHeight={minHeight}
    onFocus={onStart}
    onPointerDown={onStart}
    data-testid="mex-lazy-placeholder"
  >
    {isEmptyDocument(value) ? (
      <Typography variant="omega" textColor="neutral600">
        {placeholder}
      </Typography>
    ) : (
      <RenderedContent value={value} t={t} allowRaw={allowRaw} lang={lang} dir={dir} />
    )}
  </Region>
);

export default LazyPlaceholder;
