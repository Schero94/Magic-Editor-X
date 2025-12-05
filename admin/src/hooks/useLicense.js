/**
 * Magic Editor X - License Hook
 * Manages license state and feature access
 */
import { useState, useEffect } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';

/**
 * Hook to check license status for Magic Editor X
 * @returns {object} License state and helpers
 */
export const useLicense = () => {
  const { get } = useFetchClient();
  const [isPremium, setIsPremium] = useState(false);
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [isEnterprise, setIsEnterprise] = useState(false);
  const [tier, setTier] = useState('free');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [licenseData, setLicenseData] = useState(null);
  const [limits, setLimits] = useState(null);

  useEffect(() => {
    let mounted = true;
    
    const fetchLicense = async () => {
      if (mounted) {
        await checkLicense();
      }
    };
    
    fetchLicense();
    
    // Auto-refresh every 1 hour
    const interval = setInterval(() => {
      if (mounted) {
        checkLicense(true);
      }
    }, 60 * 60 * 1000);
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  /**
   * Check license status from server
   * @param {boolean} silent - Silent refresh without loading state
   */
  const checkLicense = async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    
    try {
      const response = await get('/magic-editor-x/license/status');
      
      const isValid = response.data?.valid || false;
      const tierName = response.data?.tier || 'free';
      const hasPremiumFeature = response.data?.data?.features?.premium || tierName === 'premium';
      const hasAdvancedFeature = response.data?.data?.features?.advanced || tierName === 'advanced';
      const hasEnterpriseFeature = response.data?.data?.features?.enterprise || tierName === 'enterprise';
      
      setTier(tierName);
      setIsPremium(isValid && (hasPremiumFeature || hasAdvancedFeature || hasEnterpriseFeature));
      setIsAdvanced(isValid && (hasAdvancedFeature || hasEnterpriseFeature));
      setIsEnterprise(isValid && hasEnterpriseFeature);
      setLicenseData(response.data?.data || null);
      setError(null);
      
      // Also fetch limits
      await fetchLimits();
    } catch (err) {
      if (err.name === 'AbortError') {
        return;
      }
      
      if (!silent) {
        console.error('[Magic Editor X] License check error:', err);
      }
      setTier('free');
      setIsPremium(false);
      setIsAdvanced(false);
      setIsEnterprise(false);
      setLicenseData(null);
      setError(err);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  /**
   * Fetch current limits
   */
  const fetchLimits = async () => {
    try {
      const response = await get('/magic-editor-x/license/limits');
      setLimits(response.data?.limits || null);
    } catch (err) {
      console.error('[Magic Editor X] Error fetching limits:', err);
    }
  };

  /**
   * Check if a specific feature is available
   * @param {string} featureName - Feature name to check
   * @returns {boolean} Feature availability
   */
  const hasFeature = (featureName) => {
    if (!featureName) return false;
    
    // Free tier features (always available)
    const freeFeatures = [
      'editor',
      'allTools',
      'collaboration-basic', // 2 collaborators
    ];
    
    if (freeFeatures.includes(featureName)) return true;
    
    // Premium+ features
    const premiumFeatures = [
      'collaboration-extended', // 10 collaborators
      'ai-basic',
    ];
    
    if (premiumFeatures.includes(featureName) && isPremium) return true;
    
    // Advanced+ features
    const advancedFeatures = [
      'collaboration-unlimited',
      'ai-full',
    ];
    
    if (advancedFeatures.includes(featureName) && isAdvanced) return true;
    
    // Enterprise features
    const enterpriseFeatures = [
      'priority-support',
      'custom-branding',
    ];
    
    if (enterpriseFeatures.includes(featureName) && isEnterprise) return true;
    
    return false;
  };

  /**
   * Check if user can add more collaborators
   * @returns {boolean} Can add collaborator
   */
  const canAddCollaborator = () => {
    if (!limits?.collaborators) return true;
    return limits.collaborators.canAdd;
  };

  /**
   * Get collaborator limit info
   * @returns {object} Collaborator limit info
   */
  const getCollaboratorInfo = () => {
    if (!limits?.collaborators) {
      return { current: 0, max: 2, unlimited: false, canAdd: true };
    }
    return limits.collaborators;
  };

  return { 
    tier,
    isPremium, 
    isAdvanced,
    isEnterprise,
    loading, 
    error, 
    licenseData,
    limits,
    features: {
      premium: isPremium,
      advanced: isAdvanced,
      enterprise: isEnterprise,
    },
    hasFeature,
    canAddCollaborator,
    getCollaboratorInfo,
    refetch: checkLicense,
  };
};

export default useLicense;

