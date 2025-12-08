/**
 * Magic Editor X - License Settings Page
 * Shows license key and details
 */
import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Badge,
  Flex,
  Alert,
  Button,
  Loader,
  Accordion,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import { getTranslation } from '../utils/getTranslation';
import { 
  ArrowPathIcon,
  KeyIcon,
  UserIcon,
  ShieldCheckIcon,
  SparklesIcon,
  ChartBarIcon,
  DocumentDuplicateIcon,
  ArrowDownTrayIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import styled, { keyframes, css } from 'styled-components';

// Theme
const theme = {
  colors: {
    primary: { 600: '#7C3AED', 100: '#EDE9FE', 50: '#F5F3FF' },
    success: { 600: '#16A34A', 50: '#DCFCE7' },
    warning: { 50: '#FEF3C7' },
    danger: { 50: '#FEE2E2' },
    neutral: { 0: '#FFFFFF', 100: '#F3F4F6', 200: '#E5E7EB', 600: '#4B5563', 800: '#1F2937' }
  },
  shadows: { sm: '0 1px 3px rgba(0,0,0,0.1)' },
  borderRadius: { lg: '12px' }
};

// Animations
const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

// Styled Components
const Container = styled(Box)`
  ${css`animation: ${fadeIn} 0.5s;`}
  max-width: 1400px;
  margin: 0 auto;
`;

const StickySaveBar = styled(Box)`
  position: sticky;
  top: 0;
  z-index: 10;
  background: ${props => props.theme.colors.neutral0};
  border-bottom: 1px solid ${props => props.theme.colors.neutral200};
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
`;

const LicenseKeyBanner = styled(Box)`
  background: linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%);
  border-radius: ${theme.borderRadius.lg};
  padding: 28px 32px;
  color: white;
  position: relative;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(124, 58, 237, 0.25);
  margin-bottom: 24px;
  
  &::after {
    content: '';
    position: absolute;
    top: -50%;
    right: -50%;
    width: 200%;
    height: 200%;
    background: linear-gradient(
      45deg,
      transparent,
      rgba(255, 255, 255, 0.08),
      transparent
    );
    ${css`animation: ${shimmer} 3s infinite;`}
    pointer-events: none;
    z-index: 0;
  }
  
  & > * {
    position: relative;
    z-index: 1;
  }
`;

const LoaderContainer = styled(Flex)`
  min-height: 400px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 16px;
`;

/**
 * License Settings Page Component
 */
const Settings = () => {
  const { formatMessage } = useIntl();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [licenseData, setLicenseData] = useState(null);
  const [limits, setLimits] = useState(null);
  const [error, setError] = useState(null);

  /**
   * Fetch license status from server
   */
  const fetchLicenseStatus = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const [statusRes, limitsRes] = await Promise.all([
        get('/magic-editor-x/license/status'),
        get('/magic-editor-x/license/limits'),
      ]);
      setLicenseData(statusRes.data);
      setLimits(limitsRes.data);
    } catch (err) {
      console.error('[Magic Editor X] Error fetching license:', err);
      setError('Failed to load license information');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Copy license key to clipboard
   */
  const handleCopyLicenseKey = async () => {
    try {
      await navigator.clipboard.writeText(licenseData?.data?.licenseKey || '');
      toggleNotification({
        type: 'success',
        message: t('license.copied', 'License key copied to clipboard!'),
      });
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t('license.copyFailed', 'Failed to copy license key'),
      });
    }
  };

  /**
   * Download license key as text file
   */
  const handleDownloadLicenseKey = () => {
    try {
      const data = licenseData?.data || {};
      const licenseKey = data.licenseKey || '';
      const email = data.email || 'N/A';
      const firstName = data.firstName || '';
      const lastName = data.lastName || '';
      const fullName = `${firstName} ${lastName}`.trim() || 'N/A';
      const tier = licenseData?.tier || 'free';
      
      const content = `Magic Editor X - License Key
===================================

License Key: ${licenseKey}

License Holder Information:
----------------------------------
Name:        ${fullName}
Email:       ${email}

License Status:
----------------------------------
Status:      ${data.isActive ? 'ACTIVE' : 'INACTIVE'}
Tier:        ${tier.toUpperCase()}
Expires:     ${data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : 'Never'}

Features:
----------------------------------
Premium:     ${data.features?.premium ? 'Enabled' : 'Disabled'}
Advanced:    ${data.features?.advanced ? 'Enabled' : 'Disabled'}
Enterprise:  ${data.features?.enterprise ? 'Enabled' : 'Disabled'}

===================================
Generated:   ${new Date().toLocaleString()}
`;
      
      const blob = new Blob([content], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `magic-editor-x-license-${licenseKey.substring(0, 8)}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toggleNotification({
        type: 'success',
        message: t('license.downloaded', 'License key downloaded successfully!'),
      });
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t('license.downloadFailed', 'Failed to download license key'),
      });
    }
  };

  useEffect(() => {
    fetchLicenseStatus();
  }, []);

  if (loading) {
    return (
      <Container>
        <LoaderContainer>
          <Loader>{t('license.loading', 'Loading license information...')}</Loader>
        </LoaderContainer>
      </Container>
    );
  }

  if (error) {
    return (
      <Container>
        <Box padding={8}>
          <Alert variant="danger" title="Error" closeLabel="Close">
            {error}
          </Alert>
        </Box>
      </Container>
    );
  }

  const isValid = licenseData?.valid;
  const isDemo = licenseData?.demo;
  const tier = licenseData?.tier || 'free';
  const data = licenseData?.data || {};
  const collaborators = limits?.limits?.collaborators || { current: 0, max: 2, unlimited: false };

  return (
    <Container>
      {/* Sticky Header */}
      <StickySaveBar paddingTop={5} paddingBottom={5} paddingLeft={6} paddingRight={6}>
        <Flex justifyContent="space-between" alignItems="flex-start">
          <Flex direction="column" gap={1} alignItems="flex-start">
            <Typography variant="alpha" fontWeight="bold">
              {t('license.title', 'License Management')}
            </Typography>
            <Typography variant="epsilon" textColor="neutral600">
              {t('license.subtitle', 'View your Magic Editor X plugin license')}
            </Typography>
          </Flex>
          <Button
            startIcon={<ArrowPathIcon style={{ width: 20, height: 20 }} />}
            onClick={fetchLicenseStatus}
            size="L"
            style={{
              background: 'linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%)',
              color: 'white',
              fontWeight: '600',
              border: 'none',
            }}
          >
            {t('license.refresh', 'Refresh Status')}
          </Button>
        </Flex>
      </StickySaveBar>

      {/* Content */}
      <Box paddingTop={6} paddingLeft={6} paddingRight={6} paddingBottom={10}>
        {/* Status Alert */}
        {isDemo ? (
          <Alert variant="warning" title={t('license.alert.free', 'FREE Mode')} closeLabel="Close">
            {t('license.alert.free.message', "You're using the FREE version with 2 collaborators. Upgrade for more features.")}
          </Alert>
        ) : isValid ? (
          <Alert variant="success" title={t('license.alert.active', 'License Active')} closeLabel="Close">
            {t('license.alert.active.message', 'Your license is active and all features are unlocked.')}
          </Alert>
        ) : (
          <Alert variant="danger" title={t('license.alert.issue', 'License Issue')} closeLabel="Close">
            {t('license.alert.issue.message', "There's an issue with your license. Please check your license status.")}
          </Alert>
        )}

        {/* License Key */}
        {data.licenseKey && (
          <Box marginTop={6}>
            <LicenseKeyBanner>
              <Flex justifyContent="space-between" alignItems="flex-start">
                <Box style={{ flex: 1 }}>
                  <Typography variant="pi" style={{ color: 'rgba(255,255,255,0.8)', marginBottom: '12px', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.5px', display: 'block' }}>
                    {t('license.key', 'License Key')}
                  </Typography>
                  <Typography style={{ color: 'white', fontFamily: 'monospace', fontSize: '28px', fontWeight: 'bold', wordBreak: 'break-all', marginBottom: '16px' }}>
                    {data.licenseKey}
                  </Typography>
                  <Flex gap={2}>
                    <Button
                      onClick={handleCopyLicenseKey}
                      startIcon={<DocumentDuplicateIcon style={{ width: 16, height: 16 }} />}
                      size="S"
                      variant="secondary"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.2)',
                        color: 'white',
                        border: '1px solid rgba(255,255,255,0.3)',
                        fontWeight: '600',
                      }}
                    >
                      {t('license.copyKey', 'Copy Key')}
                    </Button>
                    <Button
                      onClick={handleDownloadLicenseKey}
                      startIcon={<ArrowDownTrayIcon style={{ width: 16, height: 16 }} />}
                      size="S"
                      variant="secondary"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.2)',
                        color: 'white',
                        border: '1px solid rgba(255,255,255,0.3)',
                        fontWeight: '600',
                      }}
                    >
                      {t('license.downloadTxt', 'Download as TXT')}
                    </Button>
                  </Flex>
                </Box>
                <Flex direction="column" gap={2} alignItems="flex-end">
                  <Badge
                    backgroundColor={data.isActive ? "success100" : "danger100"}
                    textColor={data.isActive ? "success700" : "danger700"}
                    style={{ fontSize: '11px', fontWeight: '700', padding: '6px 12px' }}
                  >
                    {data.isActive ? 'ACTIVE' : 'INACTIVE'}
                  </Badge>
                  <Badge
                    style={{ 
                      fontSize: '11px', 
                      fontWeight: '700', 
                      padding: '6px 12px',
                      background: tier === 'free' ? '#6B7280' : '#7C3AED',
                      color: 'white',
                    }}
                  >
                    {tier.toUpperCase()}
                  </Badge>
                </Flex>
              </Flex>
            </LicenseKeyBanner>
          </Box>
        )}

        {/* Details Section */}
        <Box marginTop={6}>
          <Accordion.Root defaultValue="account" collapsible>
            {/* Account Information */}
            <Accordion.Item value="account">
              <Accordion.Header>
                <Accordion.Trigger icon={() => <UserIcon style={{ width: 16, height: 16 }} />}>
                  {t('license.section.account', 'Account Information')}
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  <Flex gap={8} wrap="wrap">
                    <Box style={{ flex: '1', minWidth: '200px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.email', 'Email Address')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.email || t('license.notProvided', 'Not provided')}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '200px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.holder', 'License Holder')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.firstName && data.lastName 
                          ? `${data.firstName} ${data.lastName}`
                          : t('license.notSpecified', 'Not specified')
                        }
                      </Typography>
                    </Box>
                  </Flex>
                </Box>
              </Accordion.Content>
            </Accordion.Item>

            {/* Collaborators */}
            <Accordion.Item value="collaborators">
              <Accordion.Header>
                <Accordion.Trigger icon={() => <UsersIcon style={{ width: 16, height: 16 }} />}>
                  {t('license.section.collaborators', 'Collaborator Limits')}
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  <Flex gap={8} wrap="wrap" alignItems="center">
                    <Box style={{ flex: '1', minWidth: '200px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.currentUsage', 'Current Usage')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold" style={{ fontSize: '24px' }}>
                        {collaborators.current} / {collaborators.unlimited ? t('license.unlimited', 'Unlimited') : collaborators.max}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '200px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.status', 'Status')}
                      </Typography>
                      <Badge
                        backgroundColor={collaborators.canAdd ? "success100" : "danger100"}
                        textColor={collaborators.canAdd ? "success700" : "danger700"}
                        style={{ fontSize: '12px', fontWeight: '600', padding: '6px 12px' }}
                      >
                        {collaborators.canAdd ? t('license.canAddMore', 'Can add more') : t('license.limitReached', 'Limit reached')}
                      </Badge>
                    </Box>
                  </Flex>
                  {!collaborators.canAdd && !collaborators.unlimited && (
                    <Box marginTop={4} padding={4} background="warning100" hasRadius>
                      <Typography variant="omega" textColor="warning700">
                        {t('license.upgradeMessage', 'Upgrade your plan to add more collaborators. Visit https://store.magicdx.dev/')}
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Accordion.Content>
            </Accordion.Item>

            {/* License Details */}
            <Accordion.Item value="details">
              <Accordion.Header>
                <Accordion.Trigger icon={() => <ShieldCheckIcon style={{ width: 16, height: 16 }} />}>
                  {t('license.section.details', 'License Details')}
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  <Flex gap={8} wrap="wrap">
                    <Box style={{ flex: '1', minWidth: '180px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {data.isExpired ? t('license.expiredOn', 'Expired On') : t('license.expiresOn', 'Expires On')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.expiresAt 
                          ? new Date(data.expiresAt).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            })
                          : t('license.never', 'Never')}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '180px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.deviceName', 'Device Name')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.deviceName || t('license.unknown', 'Unknown')}
                      </Typography>
                    </Box>
                  </Flex>
                </Box>
              </Accordion.Content>
            </Accordion.Item>

            {/* Features */}
            <Accordion.Item value="features">
              <Accordion.Header>
                <Accordion.Trigger icon={() => <SparklesIcon style={{ width: 16, height: 16 }} />}>
                  {t('license.section.features', 'Features & Capabilities')}
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  {/* Tier Badges */}
                  <Flex gap={3} style={{ marginBottom: '32px' }}>
                    <Badge
                      backgroundColor={tier === 'free' ? "success100" : "neutral100"}
                      textColor={tier === 'free' ? "success700" : "neutral600"}
                      style={{ 
                        fontSize: '13px', 
                        fontWeight: '700', 
                        padding: '8px 16px',
                        border: tier === 'free' ? '2px solid #dcfce7' : '2px solid #e5e7eb'
                      }}
                    >
                      {tier === 'free' ? '[ACTIVE]' : ''} FREE
                    </Badge>
                    <Badge
                      backgroundColor={tier === 'premium' ? "primary100" : "neutral100"}
                      textColor={tier === 'premium' ? "primary700" : "neutral600"}
                      style={{ 
                        fontSize: '13px', 
                        fontWeight: '700', 
                        padding: '8px 16px',
                        border: tier === 'premium' ? '2px solid #ede9fe' : '2px solid #e5e7eb'
                      }}
                    >
                      {tier === 'premium' ? '[ACTIVE]' : ''} PREMIUM
                    </Badge>
                    <Badge
                      backgroundColor={tier === 'advanced' || tier === 'enterprise' ? "secondary100" : "neutral100"}
                      textColor={tier === 'advanced' || tier === 'enterprise' ? "secondary700" : "neutral600"}
                      style={{ 
                        fontSize: '13px', 
                        fontWeight: '700', 
                        padding: '8px 16px',
                        border: (tier === 'advanced' || tier === 'enterprise') ? '2px solid #ddd6fe' : '2px solid #e5e7eb'
                      }}
                    >
                      {(tier === 'advanced' || tier === 'enterprise') ? '[ACTIVE]' : ''} ADVANCED
                    </Badge>
                  </Flex>
                  
                  {/* Feature List */}
                  <Box padding={5} background="neutral100" hasRadius>
                    <Typography variant="delta" fontWeight="bold" style={{ marginBottom: '16px', display: 'block' }}>
                      {t('license.yourPlanIncludes', 'Your Plan Includes:')}
                    </Typography>
                    <Flex direction="column" gap={2}>
                      <Typography variant="omega" style={{ fontSize: '14px' }}>
                        [OK] {t('license.feature.fullAccess', 'Full Editor Access (all tools)')}
                      </Typography>
                      <Typography variant="omega" style={{ fontSize: '14px' }}>
                        [OK] {t('license.feature.realtimeCollab', 'Real-Time Collaboration')}
                      </Typography>
                      <Typography variant="omega" style={{ fontSize: '14px' }}>
                        [OK] {collaborators.unlimited 
                          ? t('license.feature.collaboratorsUnlimited', 'Unlimited Collaborators')
                          : t('license.feature.collaborators', '{count} Collaborator(s)', { count: collaborators.max })}
                      </Typography>
                      {(tier === 'premium' || tier === 'advanced' || tier === 'enterprise') && (
                        <>
                          <Typography variant="omega" style={{ fontSize: '14px' }}>
                            [OK] {t('license.feature.aiAssistant', 'AI Assistant (Usage-based)')}
                          </Typography>
                          <Typography variant="omega" style={{ fontSize: '14px' }}>
                            [OK] {t('license.feature.versionHistory', 'Version History')}
                          </Typography>
                          <Typography variant="omega" style={{ fontSize: '14px' }}>
                            [OK] {t('license.feature.prioritySupport', 'Priority Support')}
                          </Typography>
                        </>
                      )}
                    </Flex>
                  </Box>
                </Box>
              </Accordion.Content>
            </Accordion.Item>

            {/* System Status */}
            <Accordion.Item value="status">
              <Accordion.Header>
                <Accordion.Trigger icon={() => <ChartBarIcon style={{ width: 16, height: 16 }} />}>
                  {t('license.section.status', 'System Status')}
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  <Flex gap={8} wrap="wrap">
                    <Box style={{ flex: '1', minWidth: '150px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.licenseStatus', 'License Status')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.isActive ? t('license.active', 'Active') : t('license.inactive', 'Inactive')}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '150px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.connection', 'Connection')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.isOnline ? t('license.online', 'Online') : t('license.offline', 'Offline')}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '150px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.lastSync', 'Last Sync')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.lastPingAt 
                          ? new Date(data.lastPingAt).toLocaleTimeString()
                          : t('license.never', 'Never')}
                      </Typography>
                    </Box>
                  </Flex>
                </Box>
              </Accordion.Content>
            </Accordion.Item>
          </Accordion.Root>
        </Box>
      </Box>
    </Container>
  );
};

export default Settings;

