import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from 'styled-components';
import {
  Check,
  Code,
  Duplicate,
  GridFour,
  GridNine,
  Image,
  Images,
  Link,
  List,
  Minus,
  MusicNotes,
  Palette,
  Play,
  Plus,
  PuzzlePiece,
  Sparkle,
  StrikeThrough,
  Trash,
  Underline,
  Upload,
  User,
  WarningCircle,
  ArrowLeft,
  ArrowRight,
} from '@strapi/icons';

/**
 * Strapi Design System icons as SVG markup for the Editor.js tools (2.7.8, native look). Editor.js
 * takes icons as strings (toolbox `icon`, tune and popover items, `innerHTML` of tool buttons), so
 * the @strapi/icons React components are rendered once with `renderToStaticMarkup`. The icons read
 * `theme.colors` (styled-components `useTheme`) only to map token fills; with `fill="currentColor"`
 * an empty theme is enough. Tools keep their own SVG only where @strapi/icons has no match.
 */
const NO_THEME = { colors: {} };

/**
 * @param {import('react').ComponentType<object>} Icon - @strapi/icons component.
 * @param {number} [size=20] - Width and height in px (the Editor.js icon slot).
 * @returns {string} SVG markup, `currentColor`, hidden from assistive technology.
 */
export const dsIcon = (Icon, size = 20) =>
  renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: NO_THEME },
      createElement(Icon, { width: size, height: size, 'aria-hidden': 'true', focusable: 'false' })
    )
  );

/** DS icons for the tool icons that have an equivalent in @strapi/icons 2.3. */
export const DS_ICONS = Object.freeze({
  alert: dsIcon(WarningCircle),
  code: dsIcon(Code),
  person: dsIcon(User),
  image: dsIcon(Image),
  gallery: dsIcon(GridFour),
  video: dsIcon(Play),
  audio: dsIcon(MusicNotes),
  arrowLeft: dsIcon(ArrowLeft),
  arrowRight: dsIcon(ArrowRight),
  link: dsIcon(Link),
  media: dsIcon(Images),
  underline: dsIcon(Underline),
  strike: dsIcon(StrikeThrough),
  sparkle: dsIcon(Sparkle),
  check: dsIcon(Check),
  plus: dsIcon(Plus),
  minus: dsIcon(Minus),
  upload: dsIcon(Upload),
  trash: dsIcon(Trash),
  toc: dsIcon(List),
  copy: dsIcon(Duplicate),
  component: dsIcon(PuzzlePiece),
  table: dsIcon(GridNine),
  color: dsIcon(Palette),
});
