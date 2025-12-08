/**
 * Magic Editor X - License Page
 * Shows pricing tiers and upgrade options
 */
import { useState, useEffect } from 'react';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import { getTranslation } from '../utils/getTranslation';
import styled from 'styled-components';
import {
  Box,
  Button,
  Flex,
  Typography,
  Badge,
  Loader,
} from '@strapi/design-system';
import {
  Check as CheckIcon,
  Cross as XMarkIcon,
  Sparkle as SparklesIcon,
  Lightning as BoltIcon,
  Rocket as RocketLaunchIcon,
} from '@strapi/icons';

const Container = styled(Box)`
  padding: 32px;
  max-width: 1400px;
  margin: 0 auto;
`;

const Header = styled(Box)`
  text-align: center;
  margin-bottom: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
`;

const Title = styled(Typography)`
  font-size: 2.5rem;
  font-weight: 700;
  margin-bottom: 8px;
  background: linear-gradient(135deg, #7C3AED, #6d28d9);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  display: block;
`;

const Subtitle = styled(Typography)`
  font-size: 1.125rem;
  color: ${props => props.theme.colors.neutral600};
  line-height: 1.6;
  display: block;
`;

const TierGrid = styled(Flex)`
  gap: 32px;
  margin: 0 auto 48px;
  max-width: 1080px;
  justify-content: center;
  flex-wrap: wrap;
  align-items: stretch;
`;

const TierWrapper = styled(Box)`
  flex: 1;
  min-width: 280px;
  max-width: 340px;
  display: flex;
`;

const TierCard = styled(Box)`
  background: ${props => props.theme.colors.neutral0};
  border-radius: 16px;
  padding: 32px;
  border: 2px solid ${props => props.$featured ? '#7C3AED' : props.theme.colors.neutral200};
  position: relative;
  transition: all 0.3s ease;
  box-shadow: ${props => props.$featured
    ? '0 20px 25px -5px rgba(124, 58, 237, 0.25), 0 8px 10px -6px rgba(124, 58, 237, 0.2)'
    : '0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.05)'};
  display: flex;
  flex-direction: column;
  width: 100%;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 20px 25px -5px rgba(15, 23, 42, 0.15), 0 8px 10px -6px rgba(15, 23, 42, 0.1);
  }
`;

const PopularBadge = styled(Badge)`
  position: absolute;
  top: -12px;
  right: 24px;
  background: linear-gradient(135deg, #7C3AED, #6d28d9);
  color: white;
  padding: 4px 16px;
  font-size: 12px;
  font-weight: 600;
`;

const TierIcon = styled(Box)`
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  background: ${props => props.$color};
  
  svg {
    width: 28px;
    height: 28px;
    color: white;
  }
`;

const TierName = styled(Typography)`
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 8px;
`;

const TierPrice = styled(Typography)`
  font-size: 2rem;
  font-weight: 800;
  margin-bottom: 4px;
`;

const TierDescription = styled(Typography)`
  color: ${props => props.theme.colors.neutral600};
  margin-bottom: 24px;
`;

const FeatureList = styled(Box)`
  margin-bottom: 24px;
  flex: 1;
`;

const Feature = styled(Flex)`
  gap: 12px;
  margin-bottom: 12px;
  align-items: flex-start;
`;

const FeatureIcon = styled(Box)`
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
  
  ${props => props.$included ? `
    background: #DCFCE7;
    svg { color: #16A34A; }
  ` : `
    background: #FEE2E2;
    svg { color: #DC2626; }
  `}
`;

const UpgradeButton = styled(Button)`
  width: 100%;
  height: 48px;
  font-weight: 600;
  font-size: 15px;
  background: ${props => props.$gradient};
  border: none;
  color: white;
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
`;

const CurrentPlanBadge = styled(Badge)`
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${props => props.theme.colors.neutral100};
  color: ${props => props.theme.colors.neutral600};
  font-weight: 600;
  font-size: 15px;
`;

const UsageBox = styled(Box)`
  background: ${props => props.theme.colors.neutral100};
  border: 1px solid ${props => props.theme.colors.neutral200};
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 32px;
`;

const UsageBar = styled.div`
  height: 8px;
  background: ${props => props.theme.colors.neutral200};
  border-radius: 4px;
  overflow: hidden;
  margin-top: 8px;
`;

const UsageProgress = styled.div`
  height: 100%;
  background: ${props => props.$percentage > 80 ? '#ef4444' : props.$percentage > 50 ? '#f59e0b' : '#10b981'};
  width: ${props => Math.min(props.$percentage, 100)}%;
  transition: width 0.3s ease;
`;

/**
 * License Page Component
 */
const LicensePage = () => {
  const { formatMessage } = useIntl();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [currentTier, setCurrentTier] = useState('free');
  const [limits, setLimits] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLicenseInfo();
  }, []);

  /**
   * Fetch license info from server
   */
  const fetchLicenseInfo = async () => {
    try {
      const response = await get('/magic-editor-x/license/limits');
      const licenseData = response.data || {};
      
      setCurrentTier(licenseData.tier || 'free');
      setLimits(licenseData.limits);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch license info:', error);
      setLoading(false);
    }
  };

  /**
   * Get tier rank for comparison
   */
  const getTierRank = (tierId) => {
    const ranks = {
      'free': 0,
      'premium': 1,
      'advanced': 2,
      'enterprise': 3,
    };
    return ranks[tierId] || 0;
  };

  /**
   * Get button text based on tier comparison
   */
  const getButtonText = (tierId) => {
    const currentRank = getTierRank(currentTier);
    const targetRank = getTierRank(tierId);
    
    if (currentRank === targetRank) {
      return t('upgradePage.currentPlan', 'Current Plan');
    } else if (targetRank > currentRank) {
      return t('upgradePage.upgradeNow', 'Upgrade Now');
    } else {
      return t('upgradePage.downgrade', 'Downgrade');
    }
  };

  // Tier configurations
  const tiers = [
    {
      id: 'free',
      name: 'FREE',
      price: '$0',
      period: 'forever',
      description: 'Perfect for small projects and testing',
      icon: <SparklesIcon />,
      color: 'linear-gradient(135deg, #6B7280, #4B5563)',
      features: [
        { name: 'Full Editor Access', included: true },
        { name: 'All Editor Tools', included: true },
        { name: '2 Collaborators', included: true },
        { name: 'Real-time Sync', included: true },
        { name: 'AI Grammar Check (3/day)', included: true },
        { name: 'AI Style + Rewrite', included: false },
        { name: 'Version History', included: false },
        { name: 'Priority Support', included: false },
      ],
      limits: {
        collaborators: '2',
      }
    },
    {
      id: 'premium',
      name: 'PREMIUM',
      price: '$9.90',
      period: '/month',
      description: 'Enhanced collaboration for teams',
      icon: <BoltIcon />,
      color: 'linear-gradient(135deg, #8B5CF6, #7C3AED)',
      featured: true,
      features: [
        { name: 'Full Editor Access', included: true },
        { name: 'All Editor Tools', included: true },
        { name: '10 Collaborators', included: true },
        { name: 'Real-time Sync', included: true },
        { name: 'AI Grammar + Style (10/day)', included: true },
        { name: 'Version History', included: true },
        { name: 'Priority Support', included: true },
      ],
      limits: {
        collaborators: '10',
      }
    },
    {
      id: 'advanced',
      name: 'ADVANCED',
      price: '$24.90',
      period: '/month',
      description: 'Unlimited collaboration for enterprises',
      icon: <RocketLaunchIcon />,
      color: 'linear-gradient(135deg, #7C3AED, #6d28d9)',
      features: [
        { name: 'Full Editor Access', included: true },
        { name: 'All Editor Tools', included: true },
        { name: 'Unlimited Collaborators', included: true },
        { name: 'Real-time Sync', included: true },
        { name: 'AI All Types (Unlimited)', included: true },
        { name: 'Version History', included: true },
        { name: 'Priority Support', included: true },
      ],
      limits: {
        collaborators: 'Unlimited',
      }
    }
  ];

  /**
   * Handle upgrade click
   */
  const handleUpgrade = (tierId) => {
    window.open('https://store.magicdx.dev/', '_blank');
  };

  if (loading) {
    return (
      <Container>
        <Flex justifyContent="center" alignItems="center" style={{ minHeight: '400px' }}>
          <Loader>{t('license.loading', 'Loading license information...')}</Loader>
        </Flex>
      </Container>
    );
  }

  // Calculate usage percentage
  const collaboratorUsage = limits?.collaborators ? {
    current: limits.collaborators.current || 0,
    max: limits.collaborators.max,
    unlimited: limits.collaborators.unlimited,
    percentage: limits.collaborators.unlimited ? 0 : ((limits.collaborators.current / limits.collaborators.max) * 100)
  } : { current: 0, max: 2, unlimited: false, percentage: 0 };

  return (
    <Container>
      <Header>
        <Title variant="alpha">{t('upgradePage.title', 'Magic Editor X')}</Title>
        <Subtitle variant="omega">
          {t('upgradePage.subtitle', 'Choose your plan for collaborative editing')}
        </Subtitle>
      </Header>

      {/* Current Usage */}
      <UsageBox>
        <Flex justifyContent="space-between" alignItems="center">
          <Typography variant="beta" fontWeight="bold">{t('upgradePage.currentUsage', 'Current Usage')}</Typography>
          <Badge style={{ background: currentTier === 'free' ? '#6B7280' : '#7C3AED', color: 'white' }}>
            {currentTier.toUpperCase()}
          </Badge>
        </Flex>
        
        <Box marginTop={4}>
          <Flex justifyContent="space-between">
            <Typography variant="omega">{t('upgradePage.collaborators', 'Collaborators')}</Typography>
            <Typography variant="omega" fontWeight="bold">
              {collaboratorUsage.current} / {collaboratorUsage.unlimited ? t('license.unlimited', 'Unlimited') : collaboratorUsage.max}
            </Typography>
          </Flex>
          {!collaboratorUsage.unlimited && (
            <UsageBar>
              <UsageProgress $percentage={collaboratorUsage.percentage} />
            </UsageBar>
          )}
        </Box>
      </UsageBox>

      <TierGrid>
        {tiers.map((tier) => (
          <TierWrapper key={tier.id}>
            <TierCard $featured={tier.featured}>
              {tier.featured && <PopularBadge>{t('upgradePage.mostPopular', 'MOST POPULAR')}</PopularBadge>}
              
              <TierIcon $color={tier.color}>
                {tier.icon}
              </TierIcon>
              
              <TierName variant="beta">{tier.name}</TierName>
              
              <Flex alignItems="baseline" gap={1}>
                <TierPrice variant="alpha">{tier.price}</TierPrice>
                <Typography variant="omega" style={{ color: '#6B7280' }}>
                  {tier.period}
                </Typography>
              </Flex>
              
              <TierDescription variant="omega">
                {tier.description}
              </TierDescription>
              
              {/* Limits Summary */}
              <Box 
                background="neutral100" 
                hasRadius 
                padding={3} 
                marginBottom={5}
              >
                <Typography variant="pi" style={{ fontSize: '13px' }}>
                  <strong>Collaborators:</strong> {tier.limits.collaborators}
                </Typography>
              </Box>
              
              <FeatureList>
                {tier.features.map((feature, index) => (
                  <Feature key={index}>
                    <FeatureIcon $included={feature.included}>
                      {feature.included ? (
                        <CheckIcon style={{ width: 14, height: 14 }} />
                      ) : (
                        <XMarkIcon style={{ width: 14, height: 14 }} />
                      )}
                    </FeatureIcon>
                    <Typography 
                      variant="omega" 
                      textColor={feature.included ? 'neutral800' : 'neutral500'}
                      style={{ 
                        fontSize: '14px',
                        textDecoration: feature.included ? 'none' : 'line-through'
                      }}
                    >
                      {feature.name}
                    </Typography>
                  </Feature>
                ))}
              </FeatureList>
              
              {currentTier === tier.id ? (
                <CurrentPlanBadge>{t('upgradePage.currentPlan', 'Current Plan')}</CurrentPlanBadge>
              ) : (
                <UpgradeButton
                  $gradient={tier.color}
                  onClick={() => handleUpgrade(tier.id)}
                >
                  {getButtonText(tier.id)}
                </UpgradeButton>
              )}
            </TierCard>
          </TierWrapper>
        ))}
      </TierGrid>
    </Container>
  );
};

export default LicensePage;

