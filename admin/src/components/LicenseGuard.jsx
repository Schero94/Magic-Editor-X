/**
 * Magic Editor X - License Guard Component
 * Handles license activation for first-time users
 */
import { useState, useEffect } from 'react';
import styled, { keyframes } from 'styled-components';
import {
  Typography,
  Box,
  Flex,
  Button,
  TextInput,
  Loader,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import { CheckIcon, KeyIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { getTranslation } from '../utils/getTranslation';

// Animations
const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const slideUp = keyframes`
  from { 
    opacity: 0;
    transform: translateY(30px);
  }
  to { 
    opacity: 1;
    transform: translateY(0);
  }
`;

// Styled Components
const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(4, 28, 47, 0.85);
  backdrop-filter: blur(8px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${fadeIn} 0.3s ease-out;
  padding: 20px;
`;

const ModalContent = styled(Box)`
  background: white;
  border-radius: 16px;
  width: 100%;
  max-width: 580px;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);
  animation: ${slideUp} 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
`;

const GradientHeader = styled(Box)`
  background: linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%);
  padding: 32px 40px;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: -50%;
    right: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
  }
`;

const IconWrapper = styled.div`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  backdrop-filter: blur(10px);
  border: 2px solid rgba(255, 255, 255, 0.3);

  svg {
    width: 36px;
    height: 36px;
    color: white;
  }
`;

const CloseButton = styled.button`
  position: absolute;
  top: 16px;
  right: 16px;
  background: rgba(255, 255, 255, 0.2);
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  z-index: 10;
  
  svg {
    width: 20px;
    height: 20px;
    color: white;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.3);
    transform: scale(1.1);
  }

  &:active {
    transform: scale(0.95);
  }
`;

const ToggleButton = styled.button`
  background: none;
  border: none;
  color: #7C3AED;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 8px 0;
  text-decoration: underline;
  transition: color 0.2s;
  
  &:hover {
    color: #6d28d9;
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const InfoBox = styled(Box)`
  background: #f0fdf4;
  border: 2px solid #bbf7d0;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
`;

/**
 * License Guard - Shows activation modal if no license exists
 * The editor is FREE, this is just for tracking
 */
const LicenseGuard = ({ children }) => {
  const { formatMessage } = useIntl();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const navigate = useNavigate();

  const [isChecking, setIsChecking] = useState(true);
  const [needsLicense, setNeedsLicense] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [useExistingKey, setUseExistingKey] = useState(false);
  const [existingLicenseKey, setExistingLicenseKey] = useState('');
  const [existingEmail, setExistingEmail] = useState('');
  const [adminUser, setAdminUser] = useState(null);

  useEffect(() => {
    checkLicenseStatus();
    fetchAdminUser();
  }, []);

  /**
   * Fetch current admin user info
   */
  const fetchAdminUser = async () => {
    try {
      const response = await get('/admin/users/me');
      const userData = response.data?.data || response.data;
      if (userData) {
        setAdminUser(userData);
      }
    } catch (error) {
      console.debug('[Magic Editor X] Could not fetch admin user');
    }
  };

  /**
   * Check if license exists
   */
  const checkLicenseStatus = async () => {
    setIsChecking(true);
    try {
      const response = await get('/magic-editor-x/license/status');
      
      if (response.data.valid || response.data.demo === false) {
        setNeedsLicense(false);
      } else {
        // Only show modal if no license key at all
        // FREE mode is fine, we just want them to register
        setNeedsLicense(true);
      }
    } catch (error) {
      console.error('[Magic Editor X] License check error:', error);
      // Don't block the editor, show content
      setNeedsLicense(false);
    } finally {
      setIsChecking(false);
    }
  };

  /**
   * Auto-create FREE license
   */
  const handleAutoCreateLicense = async (e) => {
    e.preventDefault();
    setIsCreating(true);
    
    try {
      const response = await post('/magic-editor-x/license/auto-create', {});
      
      if (response.data && response.data.success) {
        toggleNotification({
          type: 'success',
          message: t('licenseGuard.success.created', 'License created! Reloading...'),
        });
        
        setNeedsLicense(false);
        
        setTimeout(() => {
          window.location.reload();
        }, 500);
      } else {
        throw new Error('Failed to auto-create license');
      }
    } catch (error) {
      console.error('[Magic Editor X] Error:', error);
      toggleNotification({
        type: 'danger',
        message: t('licenseGuard.error.create', 'Failed to create license. Try manual entry.'),
      });
      setIsCreating(false);
      setUseExistingKey(true);
    }
  };

  /**
   * Validate existing license key
   */
  const handleValidateExistingKey = async (e) => {
    e.preventDefault();
    
    if (!existingLicenseKey.trim() || !existingEmail.trim()) {
      toggleNotification({
        type: 'warning',
        message: t('licenseGuard.error.required', 'Please enter both license key and email address'),
      });
      return;
    }

    setIsCreating(true);
    
    try {
      const response = await post('/magic-editor-x/license/store-key', {
        licenseKey: existingLicenseKey.trim(),
        email: existingEmail.trim(),
      });

      if (response.data && response.data.success) {
        toggleNotification({
          type: 'success',
          message: t('licenseGuard.success.activated', 'License activated! Reloading...'),
        });
        
        setNeedsLicense(false);
        
        setTimeout(() => {
          window.location.reload();
        }, 500);
      } else {
        throw new Error('Invalid license');
      }
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message: t('licenseGuard.error.invalid', 'Invalid license key or email address'),
      });
      setIsCreating(false);
    }
  };

  /**
   * Skip activation and use FREE mode
   */
  const handleSkip = () => {
    setNeedsLicense(false);
  };

  /**
   * Close and go back
   */
  const handleClose = () => {
    navigate('/content-manager');
  };

  if (isChecking) {
    return (
      <Box padding={8} style={{ textAlign: 'center' }}>
        <Loader>{t('license.checking', 'Checking license...')}</Loader>
      </Box>
    );
  }

  if (needsLicense) {
    return (
      <ModalOverlay>
        <ModalContent>
          <GradientHeader>
            <CloseButton onClick={handleClose} type="button">
              <XMarkIcon />
            </CloseButton>
            <IconWrapper>
              <KeyIcon />
            </IconWrapper>
            <Box style={{ textAlign: 'center', position: 'relative' }}>
              <Typography
                variant="alpha"
                style={{
                  color: 'white',
                  fontSize: '24px',
                  fontWeight: '700',
                  marginBottom: '12px',
                  display: 'block',
                }}
              >
                {t('licenseGuard.title', 'Activate Magic Editor X')}
              </Typography>
              <Typography
                variant="epsilon"
                style={{
                  color: 'rgba(255, 255, 255, 0.9)',
                  fontSize: '14px',
                  display: 'block',
                }}
              >
                {useExistingKey ? t('licenseGuard.subtitle.existing', 'Enter your existing license key') : t('licenseGuard.subtitle.new', 'Create a FREE license to start using the editor')}
              </Typography>
            </Box>
          </GradientHeader>

          <form onSubmit={useExistingKey ? handleValidateExistingKey : handleAutoCreateLicense}>
            <Box padding={6} paddingLeft={8} paddingRight={8}>
              <Flex direction="column" gap={5} style={{ width: '100%' }}>
                <InfoBox>
                  <Typography variant="omega" style={{ fontSize: '13px', lineHeight: '1.6' }}>
                    [FREE] {t('licenseGuard.info', 'The editor is completely FREE to use! Creating a license helps us track usage and provide better support. You get 2 collaborators included.')}
                  </Typography>
                </InfoBox>

                <Box style={{ textAlign: 'center', width: '100%' }}>
                  <ToggleButton 
                    type="button"
                    onClick={() => setUseExistingKey(!useExistingKey)}
                    disabled={isCreating}
                  >
                    {useExistingKey ? t('licenseGuard.toggleNew', 'Create new license') : t('licenseGuard.toggleExisting', 'Have a license key?')}
                  </ToggleButton>
                </Box>

                {useExistingKey ? (
                  <>
                    <Box style={{ width: '100%' }}>
                      <Typography
                        variant="pi"
                        fontWeight="bold"
                        style={{ marginBottom: '8px', display: 'block' }}
                      >
                        {t('licenseGuard.email', 'Email Address')} *
                      </Typography>
                      <TextInput
                        placeholder={t('licenseGuard.email.placeholder', 'admin@example.com')}
                        type="email"
                        value={existingEmail}
                        onChange={(e) => setExistingEmail(e.target.value)}
                        required
                        disabled={isCreating}
                      />
                    </Box>

                    <Box style={{ width: '100%' }}>
                      <Typography
                        variant="pi"
                        fontWeight="bold"
                        style={{ marginBottom: '8px', display: 'block' }}
                      >
                        {t('licenseGuard.licenseKey', 'License Key')} *
                      </Typography>
                      <TextInput
                        placeholder={t('licenseGuard.licenseKey.placeholder', 'MAGIC-EDITOR-XXXX-XXXX-XXXX')}
                        value={existingLicenseKey}
                        onChange={(e) => setExistingLicenseKey(e.target.value)}
                        required
                        disabled={isCreating}
                      />
                    </Box>
                  </>
                ) : adminUser ? (
                  <Box
                    background="success100"
                    padding={5}
                    style={{
                      borderRadius: '8px',
                      border: '2px solid #DCFCE7',
                      textAlign: 'center',
                    }}
                  >
                    <Typography variant="omega" fontWeight="bold" style={{ marginBottom: '12px', display: 'block' }}>
                      {t('licenseGuard.readyToActivate', 'Ready to activate with your account:')}
                    </Typography>
                    <Typography variant="pi" style={{ marginBottom: '4px', display: 'block' }}>
                      {adminUser.firstname || 'Admin'} {adminUser.lastname || 'User'}
                    </Typography>
                    <Typography variant="pi" textColor="neutral600">
                      {adminUser.email || 'Loading...'}
                    </Typography>
                  </Box>
                ) : (
                  <Box padding={4} background="neutral100" hasRadius style={{ textAlign: 'center' }}>
                    <Loader small />
                    <Typography variant="pi" marginTop={2}>{t('licenseGuard.loadingUser', 'Loading admin user data...')}</Typography>
                  </Box>
                )}

                <Flex gap={3} justifyContent="center" style={{ marginTop: '16px' }}>
                  <Button
                    variant="tertiary"
                    onClick={handleSkip}
                    disabled={isCreating}
                  >
                    {t('licenseGuard.skip', 'Skip for now')}
                  </Button>
                  
                  {useExistingKey ? (
                    <Button
                      type="submit"
                      size="L"
                      startIcon={<CheckIcon style={{ width: 20, height: 20 }} />}
                      loading={isCreating}
                      disabled={isCreating || !existingLicenseKey.trim() || !existingEmail.trim()}
                      style={{
                        background: 'linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%)',
                        color: 'white',
                        fontWeight: '600',
                        border: 'none',
                      }}
                    >
                      {t('licenseGuard.validate', 'Validate License')}
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      size="L"
                      startIcon={<CheckIcon style={{ width: 20, height: 20 }} />}
                      loading={isCreating}
                      disabled={isCreating || !adminUser}
                      style={{
                        background: 'linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%)',
                        color: 'white',
                        fontWeight: '600',
                        border: 'none',
                      }}
                    >
                      {t('licenseGuard.activate', 'Activate FREE License')}
                    </Button>
                  )}
                </Flex>
              </Flex>
            </Box>
          </form>
        </ModalContent>
      </ModalOverlay>
    );
  }

  return <>{children}</>;
};

export default LicenseGuard;

