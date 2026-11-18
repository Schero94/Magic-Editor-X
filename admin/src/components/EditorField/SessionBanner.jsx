import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Box, Button, Flex, Link, Typography, VisuallyHidden } from '@strapi/design-system';
import { CheckCircle, ExternalLink, WarningCircle } from '@strapi/icons';
import styled from 'styled-components';
import { SIGN_IN_WINDOW_NAME, adminBasePath, sessionGuard } from '../../editor/session-guard.mjs';
import { useSessionState } from '../../editor/useSessionGuard';

/** How long the "signed in again" confirmation stays. */
const RESUMED_VISIBLE_MS = 10000;

/**
 * Fixed at the bottom of the viewport, centred, above the page and the full
 * screen editor (notification layer, like Strapi's own toasts).
 */
const Frame = styled.section`
  position: fixed;
  left: ${({ theme }) => theme.spaces[4]};
  right: ${({ theme }) => theme.spaces[4]};
  bottom: ${({ theme }) => theme.spaces[4]};
  z-index: ${({ theme }) => theme.zIndices.notification};
  display: flex;
  justify-content: center;
  pointer-events: none;
  & > * {
    pointer-events: auto;
  }
`;

const Card = styled(Box)`
  width: 100%;
  max-width: 64rem;
  min-width: 0;
  border: 1px solid ${({ theme, $tone }) => theme.colors[$tone === 'success' ? 'success200' : 'warning200']};
`;

const Icon = styled(Box)`
  flex: 0 0 auto;
  display: flex;
  color: ${({ theme, $tone }) => theme.colors[$tone === 'success' ? 'success600' : 'warning600']};
  & svg {
    width: 2rem;
    height: 2rem;
  }
`;

/**
 * Opens the admin login page in a new tab named `magic-editor-x-sign-in`; that
 * tab closes itself after signing in (admin/src/index.js), and this tab adopts
 * the new session without reloading, so the page and the editor stay as they are.
 * @returns {boolean} False when the browser blocked the new tab.
 */
const openSignIn = () => {
  const url = `${window.location.origin}${adminBasePath(window.location.pathname)}/auth/login`;
  const opened = window.open(url, SIGN_IN_WINDOW_NAME);
  if (!opened) return false;
  try {
    opened.focus();
  } catch {
    // focusing another tab is up to the browser
  }
  return true;
};

/**
 * One calm banner per page (2.6) when the admin session ended: "You were
 * signed out. Your changes are kept on this device. Sign in again to save."
 * with one primary action, Sign in again. Every editor field mounts it; only
 * the first mounted field (the leader, `sessionGuard.claimLeader`) renders it,
 * so a page with many fields shows it once. The text sits in a polite live
 * region that exists before it fills, so screen readers announce it without
 * moving the focus; the action is a normal tab stop at the end of the page.
 * After signing in again it says so for 10 seconds.
 * @param {{ t: Function }} props - Translator of the field.
 * @returns {JSX.Element|null} Banner (portal) or nothing.
 */
export const SessionBanner = ({ t }) => {
  const id = useId();
  const titleId = `${id}-title`;
  const session = useSessionState();
  const leader = useSyncExternalStore(sessionGuard.subscribeLeader, sessionGuard.leader, sessionGuard.leader);
  // What the Sign in action did for this end of the session (`opened` or `blocked`).
  const [action, setAction] = useState({ endedAt: null, value: null });
  // The confirmation after signing in again hides after a while (keyed by the resume time).
  const [expiredFor, setExpiredFor] = useState(null);

  useEffect(() => sessionGuard.claimLeader(id), [id]);

  // Signed in again: confirm it for a moment.
  const resumedAt = session.resumedAt;
  useEffect(() => {
    if (!resumedAt) return undefined;
    const timer = setTimeout(() => setExpiredFor(resumedAt), RESUMED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [resumedAt]);

  if (leader !== id || typeof document === 'undefined') return null;
  const ended = session.status === 'ended';
  const resumed = !ended && session.status === 'active' && Boolean(resumedAt) && expiredFor !== resumedAt;
  const opened = action.endedAt === session.endedAt ? action.value : null;
  const tone = ended ? 'warning' : 'success';
  const visible = ended || resumed;

  return createPortal(
    <Frame
      aria-labelledby={visible ? titleId : undefined}
      aria-label={visible ? undefined : t('editor.session.region', 'Session')}
      data-testid="mex-session-banner"
      data-state={ended ? 'ended' : resumed ? 'resumed' : 'idle'}
      hidden={!visible}
    >
      <Card
        $tone={tone}
        background={ended ? 'warning100' : 'success100'}
        hasRadius
        shadow="popupShadow"
        padding={{ initial: 3, medium: 4 }}
      >
        <Flex gap={3} alignItems="flex-start" wrap="wrap">
          <Flex gap={3} alignItems="flex-start" flex="1 1 28rem" minWidth={0}>
            {visible ? (
              <Icon $tone={tone} aria-hidden="true">
                {ended ? <WarningCircle /> : <CheckCircle />}
              </Icon>
            ) : null}
            <Box minWidth={0} role="status" aria-live="polite" aria-atomic="true">
              {ended ? (
                <>
                  <Typography id={titleId} variant="omega" fontWeight="bold" textColor="neutral800" tag="h2">
                    {t('editor.session.ended.title', 'You were signed out.')}
                  </Typography>
                  <Typography variant="omega" textColor="neutral800" tag="p">
                    {t(
                      'editor.session.ended.body',
                      'Your changes are kept on this device. Sign in again to save.'
                    )}
                  </Typography>
                  {opened === 'opened' ? (
                    <Typography variant="pi" textColor="neutral800" tag="p" data-testid="mex-session-opened">
                      {t(
                        'editor.session.opened',
                        'Sign in in the new tab. This page stays open with your changes.'
                      )}
                    </Typography>
                  ) : null}
                </>
              ) : resumed ? (
                <Typography id={titleId} variant="omega" fontWeight="bold" textColor="neutral800" tag="h2">
                  {t(
                    'editor.session.resumed',
                    'You are signed in again. Save the entry to keep your changes.'
                  )}
                </Typography>
              ) : null}
            </Box>
          </Flex>
          {ended ? (
            <Flex direction="column" alignItems="flex-start" gap={2}>
              <Button
                endIcon={<ExternalLink />}
                onClick={() =>
                  setAction({ endedAt: session.endedAt, value: openSignIn() ? 'opened' : 'blocked' })
                }
                data-testid="mex-session-sign-in"
              >
                {t('editor.session.signIn', 'Sign in again')}
                <VisuallyHidden>{t('editor.session.newTab', '(opens a new tab)')}</VisuallyHidden>
              </Button>
              {opened === 'blocked' ? (
                <Typography variant="pi" textColor="neutral800" tag="p" data-testid="mex-session-blocked">
                  {t('editor.session.blocked', 'Your browser blocked the new tab.')}{' '}
                  <Link
                    href={`${adminBasePath(window.location.pathname)}/auth/login`}
                    isExternal
                    data-testid="mex-session-link"
                  >
                    {t('editor.session.blockedLink', 'Open the sign-in page')}
                  </Link>
                </Typography>
              ) : null}
            </Flex>
          ) : null}
        </Flex>
      </Card>
    </Frame>,
    document.body
  );
};

export default SessionBanner;
