import { css } from 'styled-components';

/**
 * Styles for the Editor.js core UI and every tool, scoped under `.mex-editor`.
 *
 * Only Strapi Design System theme tokens are used, so light and dark mode and
 * host theme overrides apply automatically. The admin root font size is
 * 62.5% (1rem = 10px), so sizes come from `theme.fontSizes`/`theme.spaces`.
 * Editor.js defines its own CSS custom properties for popovers; they are
 * re-pointed to theme values here.
 */

const c =
  (name) =>
  ({ theme }) =>
    theme.colors[name];
const s =
  (index) =>
  ({ theme }) =>
    theme.spaces[index];
const f =
  (index) =>
  ({ theme }) =>
    theme.fontSizes[index];
const radius = ({ theme }) => theme.borderRadius;

const ALERT_TONES = {
  primary: ['primary100', 'primary600', 'primary700'],
  secondary: ['secondary100', 'secondary600', 'secondary700'],
  info: ['secondary100', 'secondary600', 'secondary700'],
  success: ['success100', 'success600', 'success700'],
  warning: ['warning100', 'warning600', 'neutral800'],
  danger: ['danger100', 'danger600', 'danger700'],
  light: ['neutral100', 'neutral300', 'neutral800'],
  dark: ['neutral800', 'neutral800', 'neutral0'],
};

const alertTones = Object.entries(ALERT_TONES).map(
  ([type, [bg, border, text]]) => css`
    .mex-alert--${type} {
      background: ${c(bg)};
      border-inline-start-color: ${c(border)};
      color: ${c(text)};
    }
  `
);

export const editorStyles = css`
  .mex-editor {
    --selectionColor: ${c('primary100')};
    --inlineSelectionColor: ${c('primary200')};
    --bg-light: ${c('neutral100')};
    --grayText: ${c('neutral600')};
    --color-dark: ${c('neutral800')};
    --color-active-icon: ${c('primary600')};
    --color-gray-border: ${c('neutral200')};
    --color-line-gray: ${c('neutral150')};
    --content-width: 100%;
    color: ${c('neutral800')};
    font-size: ${f(2)};
    line-height: 1.6;

    .codex-editor {
      z-index: auto;
    }

    .codex-editor__redactor {
      padding-bottom: ${s(6)} !important;
    }

    .ce-block__content,
    .ce-toolbar__content {
      max-width: none;
      margin-inline: 0;
    }

    .ce-block__content {
      padding-inline-start: ${s(1)};
      padding-inline-end: ${s(1)};
    }

    .ce-toolbar__content {
      margin-inline-start: 0;
    }

    .ce-toolbar__actions {
      inset-inline-start: 0;
      inset-inline-end: auto;
      padding-inline-end: 0;
      background: transparent;
    }

    .ce-toolbar__plus,
    .ce-toolbar__settings-btn {
      color: ${c('neutral600')};
      border-radius: ${radius};
      width: 24px;
      height: 24px;

      &:hover {
        background: ${c('neutral150')};
        color: ${c('neutral800')};
      }
    }

    .ce-toolbar__settings-btn[draggable='true'] {
      cursor: grab;
    }

    .ce-block--selected .ce-block__content,
    ::selection {
      background: ${c('primary100')};
    }

    .ce-block--drop-target .ce-block__content::before {
      border-color: ${c('primary600')};
    }

    .ce-block.mex-dragging {
      opacity: 0.4;
    }

    .ce-block.mex-drop-before {
      box-shadow: inset 0 2px 0 ${c('primary600')};
    }

    .ce-block.mex-drop-after {
      box-shadow: inset 0 -2px 0 ${c('primary600')};
    }

    [contenteditable='true']:focus-visible {
      outline: none;
    }

    [data-placeholder]:empty::before,
    .ce-paragraph[data-placeholder]:empty::before,
    .mex-tool__editable[data-placeholder]:empty::before {
      content: attr(data-placeholder);
      color: ${c('neutral600')};
      cursor: text;
    }

    .ce-paragraph,
    .cdx-block {
      padding: ${s(1)} 0;
    }

    .ce-header {
      color: ${c('neutral800')};
      font-weight: 600;
      line-height: 1.25;
      margin: ${s(2)} 0 ${s(1)};
      padding: ${s(1)} 0;
    }

    h1.ce-header {
      font-size: ${f(7)};
    }
    h2.ce-header {
      font-size: ${f(6)};
    }
    h3.ce-header {
      font-size: ${f(5)};
    }
    h4.ce-header {
      font-size: ${f(4)};
    }
    h5.ce-header {
      font-size: ${f(3)};
    }
    h6.ce-header {
      font-size: ${f(2)};
    }

    a {
      color: ${c('primary600')};
      text-decoration: underline;
    }

    mark.cdx-marker {
      background: ${c('warning200')};
      color: ${c('neutral800')};
      padding: 0 2px;
      border-radius: 2px;
    }

    code.inline-code {
      background: ${c('neutral150')};
      color: ${c('neutral800')};
      border-radius: ${radius};
      padding: 1px ${s(1)};
      font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
      font-size: 0.9em;
    }

    .cdx-tooltip {
      border-bottom: 1px dashed ${c('primary600')};
      cursor: help;
    }

    .cdx-input,
    .mex-tool__input,
    .mex-tool__select,
    .mex-inline-input {
      width: 100%;
      min-width: 0;
      border: 1px solid ${c('neutral200')};
      border-radius: ${radius};
      background: ${c('neutral0')};
      color: ${c('neutral800')};
      font-size: ${f(2)};
      padding: ${s(2)} ${s(3)};
      box-shadow: none;
      line-height: 1.43;

      &::placeholder {
        color: ${c('neutral600')};
      }

      &:focus,
      &:focus-visible {
        outline: none;
        border-color: ${c('primary600')};
        box-shadow: ${c('primary600')} 0 0 0 2px;
      }

      &:disabled {
        background: ${c('neutral150')};
        color: ${c('neutral600')};
      }
    }

    .mex-tool__select {
      appearance: auto;
    }

    .cdx-button,
    .mex-tool__button {
      display: inline-flex;
      align-items: center;
      gap: ${s(2)};
      min-height: 32px;
      border: 1px solid ${c('neutral200')};
      border-radius: ${radius};
      background: ${c('neutral0')};
      color: ${c('neutral800')};
      font-size: ${f(1)};
      font-weight: 600;
      padding: ${s(1)} ${s(3)};
      cursor: pointer;
      box-shadow: none;

      &:hover {
        background: ${c('neutral100')};
      }

      &:focus-visible {
        outline: 2px solid ${c('primary600')};
        outline-offset: 2px;
      }

      &:disabled {
        cursor: not-allowed;
        color: ${c('neutral600')};
        background: ${c('neutral150')};
      }

      svg {
        width: 16px;
        height: 16px;
      }
    }

    .mex-tool__button--primary {
      background: ${c('buttonPrimary600')};
      border-color: ${c('buttonPrimary600')};
      color: ${c('buttonNeutral0')};

      &:hover {
        background: ${c('buttonPrimary500')};
      }
    }

    .mex-tool__button-icon {
      display: inline-flex;
    }

    .mex-tool__field {
      display: flex;
      flex-direction: column;
      gap: ${s(1)};
      min-width: 0;
    }

    .mex-tool__label {
      font-size: ${f(1)};
      font-weight: 600;
      color: ${c('neutral800')};
    }

    .mex-tool__grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
      gap: ${s(3)};
      margin: ${s(3)} 0;
    }

    .mex-tool__check,
    .mex-inline-check {
      display: inline-flex;
      align-items: center;
      gap: ${s(2)};
      font-size: ${f(1)};
      color: ${c('neutral800')};
      cursor: pointer;
    }

    .mex-tool__muted {
      color: ${c('neutral600')};
      font-size: ${f(1)};
      margin: ${s(1)} 0;
    }

    .mex-tool__error {
      color: ${c('danger600')};
      font-size: ${f(1)};
      margin: ${s(1)} 0;

      &:empty {
        display: none;
      }
    }

    .mex-tool__caption {
      color: ${c('neutral600')};
      font-size: ${f(1)};
      margin-top: ${s(2)};
      text-align: center;
    }

    /* Popovers (block menu, toolbox, inline toolbar) */
    .ce-popover {
      --color-background: ${c('neutral0')};
      --color-border: ${c('neutral150')};
      --color-shadow: transparent;
      --color-text-primary: ${c('neutral800')};
      --color-text-secondary: ${c('neutral600')};
      --color-border-icon: ${c('neutral200')};
      --color-border-icon-disabled: ${c('neutral150')};
      --color-text-icon-active: ${c('primary600')};
      --color-background-icon-active: ${c('primary100')};
      --color-background-item-focus: ${c('primary100')};
      --color-shadow-item-focus: transparent;
      --color-background-item-hover: ${c('neutral100')};
      --color-background-item-confirm: ${c('danger600')};
      --color-background-item-confirm-hover: ${c('danger700')};
      --border-radius: ${radius};
      --width: 240px;
    }

    .ce-popover__container {
      box-shadow: ${({ theme }) => theme.shadows.popupShadow};
    }

    .ce-popover-item__title,
    .ce-popover-header__text {
      font-size: ${f(2)};
    }

    .ce-popover-item--confirmation .ce-popover-item__title,
    .ce-popover-item--confirmation .ce-popover-item__icon {
      color: ${c('buttonNeutral0')};
    }

    .cdx-search-field {
      background: ${c('neutral100')};
      border-color: ${c('neutral200')};
    }

    .cdx-search-field:focus-within {
      border-color: ${c('primary600')};
    }

    .cdx-search-field__input {
      color: ${c('neutral800')};
      font-size: ${f(2)};
      border: 0;
      outline: none;
      box-shadow: none;
    }

    .ce-inline-tool,
    .ce-inline-toolbar__dropdown {
      color: ${c('neutral800')};

      &:hover {
        background: ${c('neutral100')};
      }
    }

    .ce-inline-tool--active {
      color: ${c('primary600')};
    }

    .mex-inline-actions {
      display: flex;
      flex-direction: column;
      gap: ${s(2)};
      padding: ${s(2)};
      min-width: 24rem;
    }

    .mex-link-picker__toggle {
      align-self: flex-start;
    }

    .mex-link-picker {
      display: flex;
      flex-direction: column;
      gap: ${s(2)};
      width: 100%;
      min-width: 0;
      border-top: 1px solid ${c('neutral150')};
      padding-top: ${s(2)};

      &[hidden] {
        display: none;
      }
    }

    .mex-link-picker__controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: ${s(2)};
    }

    .mex-link-picker__results {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: ${s(1)};
      max-height: 24rem;
      overflow: auto;

      &:empty {
        display: none;
      }
    }

    .mex-link-picker__option {
      display: flex;
      flex-direction: column;
      gap: ${s(1)};
      border: 1px solid ${c('neutral150')};
      border-radius: ${radius};
      background: ${c('neutral0')};
      color: ${c('neutral800')};
      padding: ${s(2)} ${s(3)};
      cursor: pointer;
      font-size: ${f(2)};

      &:hover,
      &[aria-selected='true'] {
        background: ${c('primary100')};
        border-color: ${c('primary600')};
      }

      &[aria-disabled='true'] {
        cursor: not-allowed;
        color: ${c('neutral600')};
      }
    }

    .mex-link-picker__title {
      overflow-wrap: anywhere;
    }

    .mex-link-picker__meta {
      color: ${c('neutral600')};
      font-size: ${f(1)};
    }

    .ce-stub {
      background: ${c('neutral100')};
      color: ${c('neutral800')};
      border: 1px dashed ${c('neutral300')};
      border-radius: ${radius};
    }

    .ce-stub__info {
      color: ${c('neutral600')};
    }

    /* Official tools */
    .cdx-quote {
      border-inline-start: 3px solid ${c('neutral300')};
      padding-inline-start: ${s(4)};
    }

    .cdx-quote__text {
      min-height: 0;
      font-style: italic;
      border: none;
      box-shadow: none;
      padding-inline: 0;
    }

    .cdx-quote__caption {
      border: none;
      box-shadow: none;
      padding-inline: 0;
      color: ${c('neutral600')};
      font-size: ${f(1)};
    }

    .cdx-warning {
      background: ${c('warning100')};
      border-radius: ${radius};
      padding: ${s(3)} ${s(4)};

      &::before {
        display: none;
      }

      .cdx-input {
        background: transparent;
        border: none;
        box-shadow: none;
        padding: ${s(1)} 0;
      }

      .cdx-warning__title {
        font-weight: 600;
      }
    }

    .ce-code__textarea,
    .cdx-list {
      font-size: ${f(2)};
    }

    .ce-code__textarea {
      font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
      background: ${c('neutral100')};
      color: ${c('neutral800')};
      min-height: 120px;
    }

    .cdx-list__checkbox-check {
      border-color: ${c('neutral300')};
      background: ${c('neutral0')};
    }

    .cdx-list__checkbox--checked .cdx-list__checkbox-check {
      background: ${c('primary600')};
      border-color: ${c('primary600')};
      color: ${c('buttonNeutral0')};
    }

    .tc-wrap {
      --color-background: ${c('neutral100')};
      --color-text-secondary: ${c('neutral600')};
      --color-border: ${c('neutral200')};
      --cell-size: 34px;
      --toolbox-icon-size: 18px;
      --toolbox-padding: 6px;
      --toolbox-aiming-field-size: calc(var(--toolbox-icon-size) + 2 * var(--toolbox-padding));
    }

    .tc-table {
      color: ${c('neutral800')};
    }

    .tc-row--selected,
    .tc-cell--selected {
      background: ${c('primary100')};
    }

    .tc-popover {
      --color-border: ${c('neutral150')};
      --color-background: ${c('neutral0')};
      --color-background-hover: ${c('neutral100')};
      --color-background-confirm: ${c('danger600')};
      --color-background-confirm-hover: ${c('danger700')};
      --color-text-confirm: ${c('buttonNeutral0')};
      color: ${c('neutral800')};
    }

    .cdx-attaches {
      background: ${c('neutral0')};
      border: 1px solid ${c('neutral200')};
      border-radius: ${radius};
    }

    .cdx-attaches__title,
    .cdx-attaches__size {
      color: ${c('neutral800')};
    }

    .cdx-attaches__download-button {
      background: ${c('neutral150')};
      color: ${c('neutral800')};
    }

    .image-tool__image {
      background: ${c('neutral100')};
      border-radius: ${radius};
    }

    .image-tool--withBorder .image-tool__image {
      border-color: ${c('neutral200')};
    }

    .image-tool--withBackground .image-tool__image {
      background: ${c('neutral100')};
    }

    .image-tool__caption,
    .embed-tool__caption {
      color: ${c('neutral600')};
    }

    .embed-tool__content {
      max-width: 100%;
      border-radius: ${radius};
    }

    .ce-rawtool__textarea {
      font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
      background: ${c('neutral100')};
      color: ${c('neutral800')};
      border-color: ${c('neutral200')};
    }

    /* Tunes */
    .mex-align--left {
      text-align: left;
    }
    .mex-align--center {
      text-align: center;
    }
    .mex-align--right {
      text-align: right;
    }
    .mex-align--justify {
      text-align: justify;
    }

    .mex-variant--call-out {
      background: ${c('primary100')};
      border-radius: ${radius};
      padding: ${s(3)} ${s(4)};
    }

    .mex-variant--citation {
      border-inline-start: 3px solid ${c('neutral300')};
      padding-inline-start: ${s(4)};
      font-style: italic;
    }

    .mex-variant--details {
      color: ${c('neutral600')};
      font-size: ${f(1)};
    }

    /* Alert */
    .mex-alert {
      border-inline-start: 4px solid ${c('neutral300')};
      border-radius: ${radius};
      padding: ${s(3)} ${s(4)};
      margin: ${s(1)} 0;
    }

    ${alertTones}

    .mex-alert--align-center {
      text-align: center;
    }

    .mex-alert--align-right {
      text-align: right;
    }

    .mex-alert__message {
      min-height: 1.6em;
    }

    /* Delimiter */
    .mex-delimiter {
      height: 1px;
      background: ${c('neutral200')};
      margin: ${s(5)} ${s(8)};
    }

    /* Toggle */
    .mex-toggle {
      display: flex;
      align-items: flex-start;
      gap: ${s(2)};
    }

    .mex-toggle__button {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: ${radius};
      background: transparent;
      color: ${c('neutral600')};
      cursor: pointer;
      transition: transform 0.15s ease;

      &[aria-expanded='true'] {
        transform: rotate(90deg);
      }

      &:hover {
        background: ${c('neutral150')};
      }

      &:focus-visible {
        outline: 2px solid ${c('primary600')};
      }

      svg {
        width: 18px;
        height: 18px;
      }

      @media (prefers-reduced-motion: reduce) {
        transition: none;
      }
    }

    .mex-toggle__title {
      flex: 1;
      min-width: 0;
      font-weight: 600;
      padding: ${s(1)} 0;
    }

    .mex-toggle__count {
      flex: none;
      color: ${c('neutral600')};
      font-size: ${f(1)};
      padding-top: ${s(1)};
    }

    .ce-block.mex-toggle-child .ce-block__content {
      border-inline-start: 2px solid ${c('neutral150')};
      padding-inline-start: calc(${s(8)} + ${s(4)});
    }

    .ce-block.mex-toggle-child--hidden {
      display: none;
    }

    /* Code with highlighting */
    .mex-code {
      border: 1px solid ${c('neutral200')};
      border-radius: ${radius};
      background: ${c('neutral100')};
      overflow: hidden;
    }

    .mex-code__header {
      display: flex;
      justify-content: flex-end;
      padding: ${s(2)};
      border-bottom: 1px solid ${c('neutral200')};

      .mex-tool__select {
        width: auto;
        padding: ${s(1)} ${s(2)};
        font-size: ${f(1)};
      }
    }

    .mex-code__language {
      font-size: ${f(1)};
      color: ${c('neutral600')};
    }

    .mex-code__body {
      display: flex;
      font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
      font-size: ${f(1)};
      line-height: 1.6;
    }

    .mex-code__gutter {
      display: none;
      white-space: pre;
      text-align: end;
      padding: ${s(3)} ${s(2)};
      color: ${c('neutral600')};
      border-inline-end: 1px solid ${c('neutral200')};
      user-select: none;
    }

    .mex-code--numbers .mex-code__gutter {
      display: block;
    }

    .mex-code__stack {
      position: relative;
      flex: 1;
      min-width: 0;
    }

    .mex-code__pre,
    .mex-code__input {
      margin: 0;
      padding: ${s(3)};
      font: inherit;
      line-height: inherit;
      white-space: pre;
      tab-size: 2;
      overflow: auto;
      min-height: 80px;
    }

    .mex-code__pre {
      color: ${c('neutral800')};
      pointer-events: none;
    }

    .mex-code__input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      resize: none;
      border: none;
      background: transparent;
      color: transparent;
      caret-color: ${c('neutral800')};

      &:focus-visible {
        outline: 2px solid ${c('primary600')};
        outline-offset: -2px;
      }

      &::placeholder {
        color: ${c('neutral600')};
      }
    }

    .mex-code__code .token.comment,
    .mex-code__code .token.prolog,
    .mex-code__code .token.doctype,
    .mex-code__code .token.cdata {
      color: ${c('neutral600')};
      font-style: italic;
    }

    .mex-code__code .token.keyword,
    .mex-code__code .token.selector,
    .mex-code__code .token.important,
    .mex-code__code .token.atrule {
      color: ${c('alternative700')};
    }

    .mex-code__code .token.string,
    .mex-code__code .token.char,
    .mex-code__code .token.attr-value,
    .mex-code__code .token.inserted {
      color: ${c('success700')};
    }

    .mex-code__code .token.number,
    .mex-code__code .token.boolean,
    .mex-code__code .token.constant,
    .mex-code__code .token.symbol {
      color: ${c('warning700')};
    }

    .mex-code__code .token.function,
    .mex-code__code .token.class-name,
    .mex-code__code .token.tag {
      color: ${c('primary700')};
    }

    .mex-code__code .token.property,
    .mex-code__code .token.attr-name,
    .mex-code__code .token.variable,
    .mex-code__code .token.regex {
      color: ${c('secondary700')};
    }

    .mex-code__code .token.deleted {
      color: ${c('danger700')};
    }

    .mex-code__code .token.punctuation,
    .mex-code__code .token.operator {
      color: ${c('neutral700')};
    }

    /* Simple image */
    .mex-simple-image__frame {
      border-radius: ${radius};
      overflow: hidden;
      text-align: center;
    }

    .mex-simple-image__img {
      max-width: 100%;
      height: auto;
      display: inline-block;
      vertical-align: bottom;
    }

    .mex-simple-image--border .mex-simple-image__frame {
      border: 1px solid ${c('neutral200')};
    }

    .mex-simple-image--background .mex-simple-image__frame {
      background: ${c('neutral100')};
      padding: ${s(4)};

      .mex-simple-image__img {
        max-width: 60%;
      }
    }

    .mex-simple-image--stretched .mex-simple-image__img {
      width: 100%;
    }

    /* Person */
    .mex-person {
      display: flex;
      gap: ${s(4)};
      align-items: flex-start;
      flex-wrap: wrap;
      border: 1px solid ${c('neutral200')};
      border-radius: ${radius};
      padding: ${s(4)};
    }

    .mex-person__photo {
      position: relative;
      flex: none;
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: ${c('neutral150')};
      overflow: hidden;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    .mex-person__photo-button {
      position: absolute;
      inset-inline-end: 0;
      inset-block-end: 0;
      min-height: 28px;
      padding: ${s(1)};
      border-radius: 50%;
    }

    .mex-person__body {
      flex: 1 1 24rem;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: ${s(2)};
    }

    .mex-person__name {
      font-weight: 600;
      margin: 0;
    }

    .mex-person__description {
      color: ${c('neutral600')};
      margin: 0;
    }

    /* Button block */
    .mex-button-block__stage {
      text-align: center;
      padding: ${s(3)} 0;
    }

    .mex-button-block__preview {
      display: inline-block;
      border-radius: ${radius};
      padding: ${s(2)} ${s(5)};
      font-weight: 600;
      border: 1px solid ${c('buttonPrimary600')};
      overflow-wrap: anywhere;
    }

    .mex-button-block__preview--primary {
      background: ${c('buttonPrimary600')};
      color: ${c('buttonNeutral0')};
    }

    .mex-button-block__preview--secondary {
      background: ${c('neutral150')};
      color: ${c('neutral800')};
      border-color: ${c('neutral200')};
    }

    .mex-button-block__preview--outline {
      background: transparent;
      color: ${c('primary600')};
      border-color: ${c('primary600')};
    }

    .mex-button-block__preview--ghost {
      background: transparent;
      color: ${c('primary600')};
      border-color: transparent;
    }

    .mex-button-block__preview--danger {
      background: ${c('danger600')};
      color: ${c('buttonNeutral0')};
      border-color: ${c('danger600')};
    }

    .mex-button-block__preview--success {
      background: ${c('success600')};
      color: ${c('buttonNeutral0')};
      border-color: ${c('success600')};
    }

    /* Link preview */
    .mex-link__card {
      display: flex;
      gap: ${s(4)};
      align-items: stretch;
      border: 1px solid ${c('neutral200')};
      border-radius: ${radius};
      padding: ${s(3)} ${s(4)};
      background: ${c('neutral0')};
      color: ${c('neutral800')};
      text-decoration: none;
    }

    .mex-link__text {
      flex: 1;
      min-width: 0;
    }

    .mex-link__title {
      font-weight: 600;
      margin: 0 0 ${s(1)};
      overflow-wrap: anywhere;
    }

    .mex-link__description {
      color: ${c('neutral600')};
      font-size: ${f(1)};
      margin: 0 0 ${s(1)};
    }

    .mex-link__site {
      color: ${c('neutral600')};
      font-size: ${f(1)};
      margin: 0;
      overflow-wrap: anywhere;
    }

    .mex-link__image {
      flex: none;
      width: 96px;
      height: 72px;
      object-fit: cover;
      border-radius: ${radius};
    }

    /* Embedded entry and custom blocks */
    .mex-entry,
    .mex-custom {
      border: 1px solid ${c('neutral200')};
      border-radius: ${radius};
      padding: ${s(3)} ${s(4)};
      background: ${c('neutral0')};
    }

    .mex-entry__card {
      display: flex;
      align-items: flex-start;
      gap: ${s(3)};
    }

    .mex-entry__icon,
    .mex-custom__icon {
      flex: none;
      display: inline-flex;
      color: ${c('primary600')};

      svg {
        width: 20px;
        height: 20px;
      }
    }

    .mex-entry__text {
      flex: 1;
      min-width: 0;
    }

    .mex-entry__title {
      font-weight: 600;
      margin: 0;
      overflow-wrap: anywhere;
    }

    .mex-entry__meta {
      color: ${c('neutral600')};
      font-size: ${f(1)};
      margin: 0;
    }

    .mex-entry__fields {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: ${s(1)} ${s(3)};
      margin: ${s(2)} 0 0;
      font-size: ${f(1)};

      dt {
        color: ${c('neutral600')};
      }

      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
    }

    .mex-entry__results {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: ${s(1)};
      max-height: 24rem;
      overflow: auto;
    }

    .mex-entry__result {
      width: 100%;
      text-align: start;
      border: 1px solid ${c('neutral150')};
      border-radius: ${radius};
      background: ${c('neutral0')};
      color: ${c('neutral800')};
      padding: ${s(2)} ${s(3)};
      cursor: pointer;
      font-size: ${f(2)};

      &:hover,
      &:focus-visible {
        background: ${c('primary100')};
        border-color: ${c('primary600')};
        outline: none;
      }
    }

    .mex-custom__header {
      display: flex;
      align-items: center;
      gap: ${s(2)};
      color: ${c('neutral600')};
      font-size: ${f(1)};
      font-weight: 600;
      margin-bottom: ${s(2)};
    }

    .mex-custom__content {
      min-height: 1.6em;
    }

    .mex-custom__preview {
      overflow-wrap: anywhere;

      img {
        max-width: 100%;
        height: auto;
      }
    }

    .mex-custom__image {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: ${s(2)};

      img {
        max-width: 12rem;
        max-height: 8rem;
        border-radius: ${radius};
      }
    }

    .mex-media-placeholder {
      border: 1px dashed ${c('neutral300')};
      border-radius: ${radius};
      color: ${c('neutral600')};
      padding: ${s(4)};
      text-align: center;
      font-size: ${f(1)};
    }

    /* Placeholder for embeds and images the admin CSP blocks (csp-guard.js). */
    .mex-csp-blocked {
      display: flex;
      align-items: flex-start;
      gap: ${s(3)};
      max-width: 100%;
      box-sizing: border-box;
      padding: ${s(4)};
      border: 1px solid ${c('warning200')};
      border-inline-start: 4px solid ${c('warning600')};
      border-radius: ${radius};
      background: ${c('warning100')};
      color: ${c('neutral800')};
      font-size: ${f(2)};
      line-height: 1.5;
      overflow-wrap: anywhere;
    }

    .mex-csp-blocked + iframe,
    .mex-csp-blocked + img {
      display: none !important;
    }

    .mex-csp-blocked__icon {
      flex: 0 0 auto;
      display: inline-flex;
      color: ${c('warning700')};
    }

    .mex-csp-blocked__text {
      display: flex;
      flex-direction: column;
      gap: ${s(1)};
      min-width: 0;
    }

    .mex-csp-blocked__text p {
      margin: 0;
    }

    .mex-csp-blocked__title {
      font-weight: 600;
    }

    .mex-csp-blocked__link {
      align-self: flex-start;
      color: ${c('primary700')};
      font-weight: 600;
      text-decoration: underline;
    }

    .mex-csp-blocked__link:focus-visible {
      outline: 2px solid ${c('primary600')};
      outline-offset: 2px;
      border-radius: ${radius};
    }

    ${({ theme }) => theme.breakpoints.medium} {
      .ce-block__content {
        padding-inline-start: ${s(10)};
      }
    }
  }
`;

export default editorStyles;
