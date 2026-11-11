import { useRef, useState } from 'react';
import { Button, Dialog } from '@strapi/design-system';
import { ConfirmDialog } from '@strapi/strapi/admin';
import { pickFocusTarget } from './restoreDialogFocus.mjs';

/**
 * Trigger plus Strapi ConfirmDialog. The dialog stays open while the action
 * runs and after a failure (the caller shows the error), and focus returns to
 * the trigger or to `fallbackFocusRef` when the trigger is gone.
 * @param {object} props - Props.
 * @param {import('react').ReactElement} props.trigger - Element rendered as Dialog.Trigger child.
 * @param {string} props.title - Question with the glossary verb.
 * @param {import('react').ReactNode} props.body - Who/what is affected, undo info.
 * @param {string} props.confirmLabel - Repeats the verb.
 * @param {() => Promise<void>|void} props.onConfirm - Action; throw to keep the dialog open.
 * @param {'danger'|'danger-light'|'default'|'secondary'} [props.variant='danger'] - Confirm style.
 * @param {boolean} [props.disabled=false] - Disable the trigger.
 * @param {{ current: HTMLElement|null }} [props.fallbackFocusRef] - Focus target when the trigger is gone.
 * @returns {JSX.Element} Dialog.
 */
export const ConfirmAction = ({
  trigger,
  title,
  body,
  confirmLabel,
  onConfirm,
  variant = 'danger',
  disabled = false,
  fallbackFocusRef,
}) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef(null);

  const restoreFocus = () =>
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const target = pickFocusTarget(triggerRef.current, fallbackFocusRef && fallbackFocusRef.current);
      if (target) target.focus();
    });

  const onOpenChange = (next) => {
    if (busy) return;
    setOpen(next);
    if (!next) restoreFocus();
  };

  const confirm = async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
      restoreFocus();
    } catch {
      // The caller reports the error; the dialog stays open so the user can retry or cancel.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger ref={triggerRef} disabled={disabled}>
        {trigger}
      </Dialog.Trigger>
      <ConfirmDialog
        title={title}
        variant={variant}
        endAction={
          <Button fullWidth variant={variant} onClick={confirm} loading={busy} disabled={busy}>
            {confirmLabel}
          </Button>
        }
      >
        {body}
      </ConfirmDialog>
    </Dialog.Root>
  );
};

export default ConfirmAction;
