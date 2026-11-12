import { useEffect, useId, useRef, useState } from 'react';
import { Box, Field, Textarea, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { MAX_COMMENT_LENGTH } from '../../../../shared/comments.mjs';
import { insertMention, mentionQueryAt } from '../../../../shared/comment-mentions.mjs';

/**
 * Comment text input with @mentions (2.4). Typing `@` opens a list of people
 * who can read this field's comments (`search`, GET /comments/mentionable);
 * picking one inserts `@<name>` and adds the person to `mentions`. The text
 * stays plain text. ARIA combobox pattern: the textarea owns the listbox,
 * Arrow keys move, Enter or Tab picks, Escape closes the list (a second
 * Escape cancels the edit). Ctrl/Cmd+Enter submits.
 */

const Anchor = styled(Box)`
  position: relative;
  min-width: 0;
`;

const Popover = styled.ul`
  position: absolute;
  inset-inline: 0;
  top: 100%;
  z-index: 4;
  margin: ${({ theme }) => theme.spaces[1]} 0 0;
  padding: ${({ theme }) => theme.spaces[1]};
  list-style: none;
  max-height: 24rem;
  overflow-y: auto;
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.filterShadow};
`;

const Option = styled.li`
  padding: ${({ theme }) => `${theme.spaces[2]} ${theme.spaces[3]}`};
  border-radius: ${({ theme }) => theme.borderRadius};
  cursor: pointer;
  color: ${({ theme }) => theme.colors.neutral800};
  overflow-wrap: anywhere;
  &[aria-selected='true'] {
    background: ${({ theme }) => theme.colors.primary100};
    color: ${({ theme }) => theme.colors.primary700};
  }
`;

const Status = styled.li`
  padding: ${({ theme }) => `${theme.spaces[2]} ${theme.spaces[3]}`};
`;

/** Delay before a search runs while typing. */
const SEARCH_DELAY_MS = 200;

/**
 * @param {object} props - Props.
 * @param {string} props.name - Field name.
 * @param {string} props.label - Label.
 * @param {string} [props.hint] - Hint under the input.
 * @param {string} props.value - Text.
 * @param {(value: string) => void} props.onChange - Text change.
 * @param {Array<{ id: string, name: string }>} props.mentions - Picked mentions.
 * @param {(mentions: Array<{ id: string, name: string }>) => void} props.onMentionsChange - Mention list change.
 * @param {((text: string) => Promise<Array<{ id: string, name: string }>>)|null} props.search - People search (null: no mentions).
 * @param {() => void} props.onSubmit - Ctrl/Cmd+Enter.
 * @param {() => void} props.onCancel - Escape (when the list is closed).
 * @param {Function} props.t - Translator.
 * @param {boolean} [props.autoFocus] - Focus on mount.
 * @returns {JSX.Element} Input.
 */
export const MentionTextarea = ({
  name,
  label,
  hint,
  value,
  onChange,
  mentions,
  onMentionsChange,
  search,
  onSubmit,
  onCancel,
  t,
  autoFocus = false,
}) => {
  const listId = useId();
  const inputRef = useRef(null);
  const [query, setQuery] = useState(null);
  const [state, setState] = useState({ loading: false, error: false, people: [] });
  const [active, setActive] = useState(0);
  const requestRef = useRef(0);
  const open = Boolean(search) && query !== null;

  // Search with a short delay; only the newest answer is shown.
  useEffect(() => {
    if (!search || query === null) return undefined;
    const id = requestRef.current + 1;
    requestRef.current = id;
    const timer = window.setTimeout(() => {
      search(query.query).then(
        (people) => {
          if (requestRef.current !== id) return;
          setState({ loading: false, error: false, people });
          setActive(0);
        },
        () => {
          if (requestRef.current !== id) return;
          setState({ loading: false, error: true, people: [] });
        }
      );
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search, query]);

  /** Reads the `@query` at the caret. */
  const updateQuery = (text, caret) => {
    if (!search) return;
    const found = mentionQueryAt(text, caret);
    const same = Boolean(found && query && query.start === found.start && query.query === found.query);
    if (same) return;
    setQuery(found);
    if (found) setState((current) => ({ ...current, loading: true, error: false }));
  };

  const pick = (person) => {
    const element = inputRef.current;
    if (!person || !query || !element) return;
    const caret = element.selectionStart;
    const next = insertMention(value, query.start, caret, person.name);
    onChange(next.text);
    if (!mentions.some((mention) => mention.id === person.id))
      onMentionsChange([...mentions, { id: person.id, name: person.name }]);
    setQuery(null);
    window.requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(next.caret, next.caret);
    });
  };

  const onKeyDown = (event) => {
    if (open && state.people.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((index) => (index + 1) % state.people.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((index) => (index - 1 + state.people.length) % state.people.length);
        return;
      }
      if ((event.key === 'Enter' && !(event.metaKey || event.ctrlKey)) || event.key === 'Tab') {
        event.preventDefault();
        pick(state.people[active]);
        return;
      }
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (open) setQuery(null);
      else onCancel();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      // Strapi 5.61's edit view saves on Ctrl/Cmd+Enter (window keydown): posting a comment must not
      // save the entry too (or answer 403 for reviewers), so the key stops here.
      event.preventDefault();
      event.stopPropagation();
      onSubmit();
    }
  };

  const optionId = (index) => `${listId}-option-${index}`;
  let status = null;
  if (open && state.loading && !state.people.length)
    status = t('editor.comments.mentions.searching', 'Searching people…');
  else if (open && state.error) status = t('editor.comments.mentions.failed', 'People could not be loaded.');
  else if (open && !state.loading && !state.people.length)
    status = t('editor.comments.mentions.none', 'No one found who can read these comments.');

  return (
    <Field.Root name={name} hint={hint}>
      <Field.Label>{label}</Field.Label>
      <Anchor>
        <Textarea
          ref={inputRef}
          value={value}
          maxLength={MAX_COMMENT_LENGTH}
          role={search ? 'combobox' : undefined}
          aria-autocomplete={search ? 'list' : undefined}
          aria-expanded={search ? open : undefined}
          aria-controls={search ? listId : undefined}
          aria-activedescendant={open && state.people.length ? optionId(active) : undefined}
          onChange={(event) => {
            onChange(event.target.value);
            updateQuery(event.target.value, event.target.selectionStart);
          }}
          onSelect={(event) => updateQuery(event.target.value, event.target.selectionStart)}
          onBlur={() => window.setTimeout(() => setQuery(null), 150)}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
        />
        {open ? (
          <Popover
            id={listId}
            role="listbox"
            aria-label={t('editor.comments.mentions.list', 'People to mention')}
            data-testid="mex-mention-list"
          >
            {state.people.map((person, index) => (
              <Option
                key={person.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active ? 'true' : 'false'}
                data-testid="mex-mention-option"
                onMouseDown={(event) => {
                  // Keep focus in the textarea.
                  event.preventDefault();
                  pick(person);
                }}
                onMouseEnter={() => setActive(index)}
              >
                <Typography variant="omega" textColor="inherit">
                  {person.name}
                </Typography>
              </Option>
            ))}
            {status ? (
              <Status role="presentation">
                <Typography variant="pi" textColor="neutral600">
                  {status}
                </Typography>
              </Status>
            ) : null}
          </Popover>
        ) : null}
      </Anchor>
      {hint ? <Field.Hint /> : null}
    </Field.Root>
  );
};

export default MentionTextarea;
