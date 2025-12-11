import React from 'react';
import { useIntl } from 'react-intl';
import { Box, Typography, Flex, Button, Divider } from '@strapi/design-system';
import { ClockIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import styled from 'styled-components';
import { getTranslation } from '../utils/getTranslation';

const PanelWrapper = styled(Box)`
  width: 320px;
  background: ${({ theme }) => theme.colors.neutral0};
  border: 1px solid ${({ theme }) => theme.colors.neutral150};
  border-radius: 8px;
  box-shadow: ${({ theme }) => theme.shadows.filterShadow};
  display: flex;
  flex-direction: column;
  max-height: 70vh;
`;

const Header = styled(Flex)`
  padding: 12px 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
`;

const Content = styled(Box)`
  padding: 12px 16px;
  overflow-y: auto;
`;

const Item = styled(Box)`
  padding: 10px 12px;
  border: 1px solid ${({ theme }) => theme.colors.neutral150};
  border-radius: 6px;
  margin-bottom: 10px;
`;

const Meta = styled(Typography)`
  color: ${({ theme }) => theme.colors.neutral500};
  font-size: 12px;
`;

const PremiumBadge = styled(Box)`
  background: ${({ theme }) => theme.colors.primary100};
  color: ${({ theme }) => theme.colors.primary600};
  border-radius: 6px;
  padding: 8px 10px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  margin-top: 8px;
`;

/**
 * Safely parses a date value to a valid Date object
 * @param {string|Date|number|null|undefined} value - The value to parse
 * @returns {Date|null} Valid Date object or null
 */
const safeDateFrom = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  try {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
};

/**
 * Safely formats a date string to locale string
 * @param {string|Date} dateValue - The date to format
 * @returns {string} Formatted date or fallback text
 */
const formatDate = (dateValue) => {
  const date = safeDateFrom(dateValue);
  if (!date) return '—';
  try {
    return date.toLocaleString();
  } catch {
    return '—';
  }
};

/**
 * Version History Panel
 * Displays snapshot list with restore actions.
 */
const VersionHistoryPanel = ({
  snapshots,
  loading,
  error,
  onRestore,
  onCreate,
  tier,
  onClose,
}) => {
  const { formatMessage } = useIntl();
  const canRestore = tier !== 'free';

  const t = (id, defaultMessage) =>
    formatMessage(
      { id: getTranslation(id), defaultMessage },
      {},
    );

  return (
    <PanelWrapper data-testid="version-history-panel">
      <Header justifyContent="space-between" alignItems="center">
        <Flex gap={8} alignItems="center">
          <ClockIcon width={18} />
          <Typography fontWeight="bold">
            {t('versionHistory.title', 'Version History')}
          </Typography>
        </Flex>
        <Button size="S" variant="tertiary" onClick={onClose}>
          {t('versionHistory.close', 'Close')}
        </Button>
      </Header>

      <Content>
        {loading && (
          <Typography>{t('versionHistory.loading', 'Loading versions...')}</Typography>
        )}
        {error && (
          <Typography textColor="danger600">
            {error}
          </Typography>
        )}

        {!loading && !error && snapshots.length === 0 && (
          <Typography>{t('versionHistory.noSnapshots', 'No versions saved yet')}</Typography>
        )}

        {!loading && !error && snapshots.map((snap) => (
          <Item key={snap.documentId || snap.id}>
            <Flex justifyContent="space-between" alignItems="center">
              <Typography fontWeight="bold">
                {t('versionHistory.version', 'Version')} {snap.version}
              </Typography>
              <Typography variant="pi">
                {formatDate(snap.createdAt)}
              </Typography>
            </Flex>
            <Meta>
              {t('versionHistory.createdBy', 'By')}{' '}
              {snap.createdBy?.firstname
                ? `${snap.createdBy.firstname} ${snap.createdBy.lastname || ''}`.trim()
                : '—'}
            </Meta>

            <Divider marginTop={2} marginBottom={2} />

            {canRestore ? (
              <Flex gap={8}>
                <Button
                  size="S"
                  variant="secondary"
                  onClick={() => onRestore?.(snap)}
                >
                  {t('versionHistory.restore', 'Restore')}
                </Button>
              </Flex>
            ) : (
              <PremiumBadge>
                <ExclamationTriangleIcon width={16} />
                {t('versionHistory.premiumOnly', 'Premium feature')}
              </PremiumBadge>
            )}
          </Item>
        ))}

        <Divider marginTop={4} marginBottom={4} />

        {canRestore ? (
          <Button size="S" fullWidth variant="default" onClick={onCreate} disabled={loading}>
            {t('versionHistory.create', 'Create Snapshot')}
          </Button>
        ) : (
          <Box>
            <Button size="S" fullWidth variant="default" disabled>
              {t('versionHistory.create', 'Create Snapshot')}
            </Button>
            <PremiumBadge style={{ marginTop: '8px', width: '100%', justifyContent: 'center' }}>
              <ExclamationTriangleIcon width={16} />
              {t('versionHistory.premiumOnly', 'Premium feature')}
            </PremiumBadge>
          </Box>
        )}
      </Content>
    </PanelWrapper>
  );
};

export default VersionHistoryPanel;

