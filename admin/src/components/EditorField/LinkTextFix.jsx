import { useEffect, useRef, useState } from 'react';
import { Button, Field, Flex, TextInput } from '@strapi/design-system';
import { isAmbiguousLinkText } from '../../../../shared/quality.mjs';
import { MAX_LINK_TEXT } from '../../../../shared/content-insights.mjs';

/**
 * 2.9: the "Fix" of a "click here" finding, inside its row of the Quality panel. The editor types
 * a text that says where the link goes; Apply writes it as the link's text (the address stays).
 * Nothing is written automatically. Enter applies, Escape cancels (and does not close the panel).
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {string} props.id - Unique id of the text field.
 * @param {(text: string) => Promise<boolean>} props.onApply - Writes the text; false when the link changed meanwhile.
 * @param {() => void} props.onCancel - Closes the form.
 * @returns {JSX.Element} Form.
 */
export const LinkTextFix = ({ t, id, onApply, onCancel }) => {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const apply = async () => {
    const value = text.replace(/\s+/g, ' ').trim();
    if (!value) {
      setError(t('editor.quality.linkText.empty', 'Enter a link text.'));
      return;
    }
    if (isAmbiguousLinkText(value)) {
      setError(t('editor.quality.linkText.ambiguous', 'This text still does not say where the link goes.'));
      return;
    }
    setBusy(true);
    const ok = await onApply(value);
    setBusy(false);
    if (!ok)
      setError(t('editor.quality.linkText.stale', 'The link changed meanwhile. Check the content again.'));
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={2} paddingLeft={2} paddingRight={2} paddingBottom={3}>
      <Field.Root
        name={id}
        id={id}
        error={error || undefined}
        hint={t(
          'editor.quality.linkText.hint',
          'Say where the link goes, for example the title of the page.'
        )}
      >
        <Field.Label>{t('editor.quality.linkText.label', 'New link text')}</Field.Label>
        <TextInput
          ref={inputRef}
          value={text}
          maxLength={MAX_LINK_TEXT}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              apply();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
        />
        <Field.Hint />
        <Field.Error />
      </Field.Root>
      <Flex gap={2} wrap="wrap">
        <Button size="S" onClick={apply} loading={busy}>
          {t('editor.quality.linkText.apply', 'Change link text')}
        </Button>
        <Button size="S" variant="tertiary" onClick={onCancel} disabled={busy}>
          {t('editor.quality.linkText.cancel', 'Cancel')}
        </Button>
      </Flex>
    </Flex>
  );
};

export default LinkTextFix;
