import { Divider } from '@strapi/design-system';
import { useT, SectionCard } from '../../components/ui';
import { AiActionsEditor } from './AiActionsEditor';
import { StyleGuideEditor } from './StyleGuideEditor';
import { providerName } from './AiSection';

/**
 * "AI actions and style guide" (2.12.3): what editors get from the assistant, separate from the
 * provider connection in "AI assistant". Before, both lived in one card of about 1,200 px. The
 * editors keep their own h3 headings and stay part of the page draft (Save, Discard, Blocker).
 * @param {object} props - Props.
 * @param {object} props.form - useConfigurationForm() result.
 * @param {boolean} props.readOnly - True without settings.update.
 * @returns {JSX.Element|null} Section, or nothing when the server sends neither setting.
 */
export const AiActionsSection = ({ form, readOnly }) => {
  const t = useT();
  const { draft, errors, setField } = form;
  const hasActions = Array.isArray(draft.actions);
  const hasStyleGuide = typeof draft.styleGuide === 'string';
  if (!hasActions && !hasStyleGuide) return null;
  return (
    <SectionCard
      title={t('settings.ai.extras.title', 'AI actions and style guide')}
      subtitle={t(
        'settings.ai.extras.subtitle',
        'Your own AI actions in the editor and the house style the assistant follows. They work once the AI assistant is on.'
      )}
    >
      {hasActions ? (
        <AiActionsEditor
          actions={draft.actions}
          onChange={(next) => setField('actions', next)}
          readOnly={readOnly}
          error={errors.actions}
        />
      ) : null}
      {hasActions && hasStyleGuide ? <Divider /> : null}
      {hasStyleGuide ? (
        <StyleGuideEditor form={form} readOnly={readOnly} providerName={providerName(t, draft)} />
      ) : null}
    </SectionCard>
  );
};

export default AiActionsSection;
