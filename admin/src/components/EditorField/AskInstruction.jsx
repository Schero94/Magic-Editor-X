import { Button, Field, Flex, Textarea, Typography } from '@strapi/design-system';
import styled from 'styled-components';

/**
 * "Ask AI…" instruction input (2.9): a DS Textarea with a character count and
 * the admin's recent instructions as quick picks (stored in this browser only,
 * `editor/ai-recent.js`). The server checks and cleans the instruction again.
 */

const Picks = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spaces[2]};
  min-width: 0;
`;

const Pick = styled.li`
  min-width: 0;
  max-width: 100%;
`;

const PICK_CHARS = 48;

/**
 * Short label of a recent instruction.
 * @param {string} text - Instruction.
 * @returns {string} Label.
 */
const shortLabel = (text) => (text.length > PICK_CHARS ? `${text.slice(0, PICK_CHARS - 1).trim()}…` : text);

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {string} props.value - Instruction.
 * @param {(value: string) => void} props.onChange - Changes the instruction.
 * @param {number} props.max - Longest instruction (`config.ai.maxInstructionChars`).
 * @param {string[]} props.recent - Recent instructions, newest first.
 * @param {string} [props.error] - Error text.
 * @param {string} [props.name] - Field name (unique per dialog).
 * @returns {JSX.Element} Input.
 */
export const AskInstruction = ({ t, value, onChange, max, recent, error, name = 'mex-ai-instruction' }) => (
  <Flex direction="column" alignItems="stretch" gap={3}>
    <Field.Root
      name={name}
      required
      error={error}
      hint={t(
        'editor.ai.ask.hint',
        'Say what the assistant should do with the text, for example "Turn this into a short list". {count} of {max} characters.',
        { count: value.length, max }
      )}
    >
      <Field.Label>{t('editor.ai.ask.label', 'Your instruction')}</Field.Label>
      <Textarea
        value={value}
        maxLength={max}
        onChange={(event) => onChange(String(event.target.value).slice(0, max))}
        data-testid="mex-ai-instruction"
      />
      <Field.Hint />
      <Field.Error />
    </Field.Root>
    {recent.length ? (
      <Flex direction="column" alignItems="stretch" gap={2}>
        <Typography variant="sigma" textColor="neutral600" tag="h3" id={`${name}-recent`}>
          {t('editor.ai.ask.recent', 'Recent instructions')}
        </Typography>
        <Picks aria-labelledby={`${name}-recent`}>
          {recent.map((text) => (
            <Pick key={text}>
              <Button
                size="S"
                variant="tertiary"
                onClick={() => onChange(text.slice(0, max))}
                aria-label={t('editor.ai.ask.useRecent', 'Use the instruction: {text}', { text })}
                title={text}
                data-testid="mex-ai-recent"
              >
                {shortLabel(text)}
              </Button>
            </Pick>
          ))}
        </Picks>
      </Flex>
    ) : null}
  </Flex>
);

export default AskInstruction;
