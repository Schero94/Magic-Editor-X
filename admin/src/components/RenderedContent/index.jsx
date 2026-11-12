import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { MagicEditorXContent } from '../../../../shared/frameworks/react.mjs';
import { sanitizeRawPreview } from './sanitize-raw';
import { loadMath } from '../../editor/math-view';
import { MATH_ATTRIBUTE } from '../../../../shared/sanitize-policy.mjs';

/**
 * Rendered output of Magic Editor X content inside the admin (field preview,
 * template previews). Uses the public React renderer (`magic-editor-x/react`)
 * with inert options: raw HTML only when `allowRaw` is set (the field allows
 * the block and the server keeps raw HTML) and then sanitised again with
 * DOMPurify; embeds become a labelled link placeholder (no third-party
 * iframes, no scripts); links do not navigate away from the admin.
 * Prose styling uses Design System tokens only, so it follows dark mode.
 */

/**
 * Prose surface for the render tree classes (`mex-*`). Headings, lists,
 * tables (own scroll region), code with line numbers (CSS counters),
 * quotes and responsive images.
 */
const Prose = styled.div`
  min-width: 0;
  color: ${({ theme }) => theme.colors.neutral800};
  font-size: ${({ theme }) => theme.fontSizes[2]};
  line-height: ${({ theme }) => theme.lineHeights[6]};
  overflow-wrap: anywhere;

  & > * + * {
    margin-top: ${({ theme }) => theme.spaces[3]};
  }
  & h1,
  & h2,
  & h3,
  & h4,
  & h5,
  & h6 {
    color: ${({ theme }) => theme.colors.neutral800};
    font-weight: ${({ theme }) => theme.fontWeights.bold};
    line-height: ${({ theme }) => theme.lineHeights[2]};
    margin-top: ${({ theme }) => theme.spaces[5]};
  }
  & h1 {
    font-size: ${({ theme }) => theme.fontSizes[6]};
  }
  & h2 {
    font-size: ${({ theme }) => theme.fontSizes[5]};
  }
  & h3 {
    font-size: ${({ theme }) => theme.fontSizes[4]};
  }
  & h4,
  & h5,
  & h6 {
    font-size: ${({ theme }) => theme.fontSizes[3]};
  }
  & a {
    color: ${({ theme }) => theme.colors.primary600};
    text-decoration: underline;
  }
  & a:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 2px;
  }
  & ul,
  & ol {
    padding-inline-start: ${({ theme }) => theme.spaces[6]};
  }
  & ul {
    list-style: disc;
  }
  & ol {
    list-style: decimal;
  }
  & li + li {
    margin-top: ${({ theme }) => theme.spaces[1]};
  }
  & .mex-checklist {
    list-style: none;
    padding-inline-start: 0;
  }
  & .mex-checklist-item input {
    margin-inline-end: ${({ theme }) => theme.spaces[2]};
  }
  & .mex-quote {
    border-inline-start: 4px solid ${({ theme }) => theme.colors.primary200};
    padding-inline-start: ${({ theme }) => theme.spaces[4]};
    margin-inline: 0;
  }
  & .mex-quote blockquote {
    font-style: italic;
    margin: 0;
  }
  & figcaption {
    color: ${({ theme }) => theme.colors.neutral600};
    font-size: ${({ theme }) => theme.fontSizes[1]};
    margin-top: ${({ theme }) => theme.spaces[1]};
  }
  & img {
    max-width: 100%;
    height: auto;
  }
  & .mex-image img {
    display: block;
  }
  & .mex-image-border img {
    border: 1px solid ${({ theme }) => theme.colors.neutral200};
  }
  & .mex-image-background {
    background: ${({ theme }) => theme.colors.neutral100};
    padding: ${({ theme }) => theme.spaces[3]};
  }
  & .mex-table-scroll {
    max-width: 100%;
    overflow-x: auto;
  }
  & table {
    border-collapse: collapse;
    min-width: 50%;
  }
  & th,
  & td {
    border: 1px solid ${({ theme }) => theme.colors.neutral200};
    padding: ${({ theme }) => `${theme.spaces[1]} ${theme.spaces[2]}`};
    text-align: start;
    vertical-align: top;
  }
  & th {
    background: ${({ theme }) => theme.colors.neutral100};
    font-weight: ${({ theme }) => theme.fontWeights.bold};
  }
  & pre {
    background: ${({ theme }) => theme.colors.neutral100};
    border: 1px solid ${({ theme }) => theme.colors.neutral200};
    border-radius: ${({ theme }) => theme.borderRadius};
    padding: ${({ theme }) => theme.spaces[3]};
    overflow-x: auto;
    max-width: 100%;
  }
  & pre,
  & code {
    font-family: ${({ theme }) => (theme.fonts && theme.fonts.code) || 'monospace'};
    font-size: ${({ theme }) => theme.fontSizes[1]};
    overflow-wrap: normal;
  }
  & :not(pre) > code {
    background: ${({ theme }) => theme.colors.neutral150};
    border-radius: ${({ theme }) => theme.borderRadius};
    padding: 0 ${({ theme }) => theme.spaces[1]};
  }
  & .mex-code-lines code {
    counter-reset: mex-line;
  }
  & .mex-code-line {
    counter-increment: mex-line;
  }
  & .mex-code-line::before {
    content: counter(mex-line);
    display: inline-block;
    min-width: 3ch;
    margin-inline-end: ${({ theme }) => theme.spaces[3]};
    color: ${({ theme }) => theme.colors.neutral600};
    text-align: end;
    user-select: none;
  }
  & .mex-warning,
  & .mex-alert,
  & .mex-embed-placeholder {
    background: ${({ theme }) => theme.colors.neutral100};
    border: 1px solid ${({ theme }) => theme.colors.neutral200};
    border-radius: ${({ theme }) => theme.borderRadius};
    padding: ${({ theme }) => theme.spaces[3]};
  }
  & .mex-warning {
    border-inline-start: 4px solid ${({ theme }) => theme.colors.warning600};
  }
  & .mex-warning p {
    margin: 0;
  }
  & .mex-toggle summary {
    cursor: pointer;
    font-weight: ${({ theme }) => theme.fontWeights.bold};
  }
  & hr {
    border: 0;
    border-top: 1px solid ${({ theme }) => theme.colors.neutral200};
    margin-block: ${({ theme }) => theme.spaces[5]};
  }
  & .mex-align-center {
    text-align: center;
  }
  & .mex-align-right {
    text-align: end;
  }
  & .mex-link-preview a,
  & .mex-personality {
    display: flex;
    flex-wrap: wrap;
    gap: ${({ theme }) => theme.spaces[2]};
    border: 1px solid ${({ theme }) => theme.colors.neutral200};
    border-radius: ${({ theme }) => theme.borderRadius};
    padding: ${({ theme }) => theme.spaces[3]};
  }
  & .mex-link-image,
  & .mex-personality-photo {
    max-width: 8rem;
  }
  & .mex-field + .mex-field {
    margin-top: ${({ theme }) => theme.spaces[1]};
  }
  /* 2.4: math (MathML, or the TeX source while the renderer loads) and footnotes. */
  & .mex-math-display {
    display: block;
    overflow-x: auto;
    text-align: center;
    font-size: ${({ theme }) => theme.fontSizes[3]};
  }
  & .mex-footnote-ref a {
    text-decoration: none;
    font-weight: ${({ theme }) => theme.fontWeights.bold};
  }
  & .mex-footnotes {
    border-top: 1px solid ${({ theme }) => theme.colors.neutral200};
    padding-top: ${({ theme }) => theme.spaces[3]};
    font-size: ${({ theme }) => theme.fontSizes[1]};
  }
  & .mex-footnotes-label {
    font-size: ${({ theme }) => theme.fontSizes[2]};
    margin-top: 0;
  }
  & .mex-footnotes-list {
    padding-inline-start: ${({ theme }) => theme.spaces[5]};
  }
  & .mex-footnote-back {
    text-decoration: none;
  }
`;

/**
 * True when a value has math (a math block or inline math), so the math
 * renderer is worth loading.
 * @param {unknown} value - Field value.
 * @returns {boolean} Result.
 */
const hasMath = (value) => {
  const blocks = value && typeof value === 'object' && Array.isArray(value.blocks) ? value.blocks : null;
  if (!blocks) return typeof value === 'string' && value.includes(MATH_ATTRIBUTE);
  return blocks.some(
    (block) =>
      block && (block.type === 'math' || (block.data && JSON.stringify(block.data).includes(MATH_ATTRIBUTE)))
  );
};

/**
 * Host name of a URL, or '' when it cannot be parsed.
 * @param {string|null|undefined} url - URL.
 * @returns {string} Host.
 */
const hostOf = (url) => {
  try {
    return url ? new URL(url).host : '';
  } catch {
    return '';
  }
};

/**
 * Embed placeholder: names the source instead of loading a third-party frame
 * (no scripts, no CSP violations in the admin).
 * @param {{ block: { data: { source?: string, embed?: string, service?: string, caption?: string } }, helpers: object }} props - Renderer props.
 * @returns {JSX.Element} Placeholder.
 */
const EmbedPlaceholder = ({ block, helpers, t }) => {
  const source = helpers.url(block.data.source || block.data.embed, ['https', 'http']);
  const host = hostOf(source);
  return (
    <figure className="mex-embed mex-embed-placeholder" data-mex-preview="embed">
      <Typography variant="omega" textColor="neutral800">
        {host
          ? t('editor.preview.embedFrom', 'Embedded content from {host}', { host })
          : t('editor.preview.embed', 'Embedded content')}
      </Typography>
      {source ? (
        <Typography variant="pi" tag="p">
          <a href={source} rel="nofollow noopener noreferrer">
            {source}
          </a>
        </Typography>
      ) : null}
      {block.data.caption ? <figcaption>{helpers.inline(block.data.caption)}</figcaption> : null}
    </figure>
  );
};

/**
 * Table wrapper with its own horizontal scroll region (keyboard reachable).
 * @param {{ children: import('react').ReactNode, t: Function }} props - Default table output.
 * @returns {JSX.Element} Wrapper.
 */
const TableScroll = ({ children, t }) => (
  // A scroll region needs to be focusable so keyboard users can scroll it (WCAG 2.1.1).
  <div
    className="mex-table-scroll"
    tabIndex={0}
    role="region"
    aria-label={t('editor.preview.table', 'Table')}
  >
    {children}
  </div>
);

/**
 * @param {object} props - Props.
 * @param {unknown} props.value - Field value (Editor.js document).
 * @param {Function} props.t - Translator.
 * @param {boolean} [props.allowRaw=false] - Render Raw HTML blocks (sanitised).
 * @param {string} [props.lang] - Content language.
 * @param {'ltr'|'rtl'} [props.dir] - Text direction.
 * @param {Map<string, object[]>} [props.synced] - Sources of synced blocks (renderer option `synced`); without it they render nothing.
 * @returns {JSX.Element} Rendered content.
 */
export const RenderedContent = ({ value, t, allowRaw = false, lang, dir, synced }) => {
  // 2.4: MathML through the math helper (separate chunk), loaded only when the value has math.
  const [math, setMath] = useState(null);
  const needsMath = hasMath(value);
  useEffect(() => {
    if (!needsMath || math) return undefined;
    let active = true;
    loadMath()
      .then((module) => {
        if (active) setMath(() => module.renderMath);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [needsMath, math]);
  // Footnote ids of this preview (several previews may be on one page).
  const reactId = useId();
  const prefix = `mex-p${reactId.replace(/[^A-Za-z0-9]/g, '')}-`;
  const proseRef = useRef(null);
  const options = useMemo(
    () => ({
      rawHtml: allowRaw ? 'allow' : 'sanitize',
      sanitizeRaw: allowRaw ? sanitizeRawPreview : undefined,
      code: { lineNumbers: true },
      synced,
      math: math || undefined,
      footnotes: {
        prefix,
        label: t('editor.preview.footnotes', 'Footnotes'),
        // `{n}` stays a placeholder for the renderer.
        backLabel: t('editor.preview.footnoteBack', 'Back to reference {n}', { n: '{n}' }),
      },
    }),
    [allowRaw, synced, math, prefix, t]
  );
  const components = useMemo(
    () => ({
      embed: (props) => <EmbedPlaceholder {...props} t={t} />,
      table: ({ children }) => <TableScroll t={t}>{children}</TableScroll>,
    }),
    [t]
  );
  // Links and downloads stay inside the admin: the preview is for reading.
  const stop = (event) => {
    const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    event.preventDefault();
    // Footnote references and back links move within the preview.
    const href = link.getAttribute('href') || '';
    if (href.startsWith('#') && proseRef.current) {
      const target = proseRef.current.querySelector(`[id="${CSS.escape(href.slice(1))}"]`);
      if (target) {
        target.scrollIntoView({ block: 'center' });
        const focusable = target.matches('a') ? target : target.querySelector('a');
        if (focusable) focusable.focus();
      }
    }
  };
  return (
    <Prose
      ref={proseRef}
      className="mex-preview"
      lang={lang}
      dir={dir}
      onClickCapture={stop}
      data-testid="mex-rendered"
    >
      <MagicEditorXContent value={value} options={options} components={components} />
    </Prose>
  );
};

export default RenderedContent;
