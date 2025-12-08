/**
 * Magic Editor X - AI Assistant Hook
 * API Client for the Magic Editor AI Writing Assistant
 */
import { useState, useCallback, useRef } from 'react';

const API_BASE_URL = 'https://magicapi.fitlex.me/api/magic-editor';

/**
 * Hook for AI Writing Assistant functionality
 * @param {string} licenseKey - The license key for API authentication
 * @returns {object} AI Assistant state and methods
 */
export const useAIAssistant = (licenseKey) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [usage, setUsage] = useState(null);
  const [credits, setCredits] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  
  // Cache for usage data (refresh every 5 minutes)
  const usageCacheRef = useRef({ data: null, timestamp: 0 });
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Make an authenticated API request
   * License key is sent in body (POST) or query params (GET) to avoid CORS issues
   * @param {string} endpoint - API endpoint
   * @param {object} options - Fetch options
   * @returns {Promise<object>} API response
   */
  const apiRequest = useCallback(async (endpoint, options = {}) => {
    if (!licenseKey) {
      throw new Error('No license key available');
    }

    let url = `${API_BASE_URL}${endpoint}`;
    
    // For GET requests, add license key as query parameter
    if (!options.method || options.method === 'GET') {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}licenseKey=${encodeURIComponent(licenseKey)}`;
    }
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      const error = new Error(data.error?.message || 'API request failed');
      error.code = data.error?.code;
      error.status = response.status;
      error.upgrade = data.upgrade;
      throw error;
    }

    return data;
  }, [licenseKey]);

  /**
   * Perform text correction
   * @param {string} text - Text to correct
   * @param {string} type - Correction type: 'grammar' | 'style' | 'rewrite'
   * @param {object} options - Additional options (tone, length)
   * @returns {Promise<object>} Correction result
   */
  const correct = useCallback(async (text, type = 'grammar', options = {}) => {
    if (!text?.trim()) {
      throw new Error('No text provided');
    }

    setLoading(true);
    setError(null);

    try {
      // License key is included in body for POST requests
      const result = await apiRequest('/correct', {
        method: 'POST',
        body: JSON.stringify({ text, type, options, licenseKey }),
      });

      setLastResult(result.data);
      
      // Update credits from response
      if (result.credits) {
        setCredits(prev => ({
          ...prev,
          balance: result.credits.remaining,
        }));
      }
      
      // Update usage from response
      if (result.usage) {
        setUsage(prev => ({
          ...prev,
          daily: {
            ...prev?.daily,
            used: result.usage.used,
            remaining: result.usage.remaining,
          },
        }));
      }

      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [apiRequest]);

  /**
   * Get current usage and credits
   * @param {boolean} forceRefresh - Force refresh, ignore cache
   * @returns {Promise<object>} Usage data
   */
  const getUsage = useCallback(async (forceRefresh = false) => {
    const now = Date.now();
    
    // Return cached data if still valid
    if (!forceRefresh && usageCacheRef.current.data && 
        (now - usageCacheRef.current.timestamp) < CACHE_TTL) {
      return usageCacheRef.current.data;
    }

    try {
      const result = await apiRequest('/usage');
      
      setUsage(result.data);
      setCredits(result.data?.credits || null);
      
      // Update cache
      usageCacheRef.current = {
        data: result.data,
        timestamp: now,
      };

      return result.data;
    } catch (err) {
      console.error('[AI Assistant] Failed to fetch usage:', err);
      throw err;
    }
  }, [apiRequest]);

  /**
   * Get credit packages for purchase
   * @returns {Promise<object>} Credits and packages
   */
  const getCredits = useCallback(async () => {
    try {
      const result = await apiRequest('/credits');
      setCredits(result.data);
      return result.data;
    } catch (err) {
      console.error('[AI Assistant] Failed to fetch credits:', err);
      throw err;
    }
  }, [apiRequest]);

  /**
   * Get available AI models
   * @returns {Promise<object>} Models info
   */
  const getModels = useCallback(async () => {
    try {
      const result = await apiRequest('/models');
      return result.data;
    } catch (err) {
      console.error('[AI Assistant] Failed to fetch models:', err);
      throw err;
    }
  }, [apiRequest]);

  /**
   * Get tier limits and pricing
   * @returns {Promise<object>} Limits info
   */
  const getLimits = useCallback(async () => {
    try {
      const result = await apiRequest('/limits');
      return result.data;
    } catch (err) {
      console.error('[AI Assistant] Failed to fetch limits:', err);
      throw err;
    }
  }, [apiRequest]);

  /**
   * Check if user has credits available
   * @returns {boolean} Has credits
   */
  const hasCredits = useCallback(() => {
    return credits?.balance > 0 || credits?.hasCredits === true;
  }, [credits]);

  /**
   * Get allowed correction types based on tier and credits
   * @returns {string[]} Allowed types
   */
  const getAllowedTypes = useCallback(() => {
    // If user has credits, all types are allowed
    if (hasCredits()) {
      return ['grammar', 'style', 'rewrite'];
    }
    
    // Otherwise, check tier-based allowedTypes
    return usage?.allowedTypes || ['grammar'];
  }, [usage, hasCredits]);

  /**
   * Check if a specific correction type is allowed
   * @param {string} type - Correction type
   * @returns {boolean} Is allowed
   */
  const isTypeAllowed = useCallback((type) => {
    return getAllowedTypes().includes(type);
  }, [getAllowedTypes]);

  /**
   * Get remaining daily corrections
   * @returns {number} Remaining count
   */
  const getRemainingDaily = useCallback(() => {
    return usage?.daily?.remaining ?? 0;
  }, [usage]);

  /**
   * Get remaining monthly corrections
   * @returns {number} Remaining count
   */
  const getRemainingMonthly = useCallback(() => {
    return usage?.monthly?.remaining ?? 0;
  }, [usage]);

  /**
   * Check if daily limit is reached
   * @returns {boolean} Limit reached
   */
  const isDailyLimitReached = useCallback(() => {
    return getRemainingDaily() <= 0 && !hasCredits();
  }, [getRemainingDaily, hasCredits]);

  /**
   * Check if AI Assistant is available
   * @returns {boolean} Is available
   */
  const isAvailable = useCallback(() => {
    return !!licenseKey && usage?.platform?.available !== false;
  }, [licenseKey, usage]);

  /**
   * Clear last result
   */
  const clearResult = useCallback(() => {
    setLastResult(null);
    setError(null);
  }, []);

  return {
    // State
    loading,
    error,
    usage,
    credits,
    lastResult,
    
    // Core methods
    correct,
    getUsage,
    getCredits,
    getModels,
    getLimits,
    
    // Helpers
    hasCredits,
    getAllowedTypes,
    isTypeAllowed,
    getRemainingDaily,
    getRemainingMonthly,
    isDailyLimitReached,
    isAvailable,
    clearResult,
  };
};

/**
 * Standalone API client class for use outside React components
 * (Used by Editor.js Inline Tool and AIAssistantPopup)
 * License key is sent in body (POST) or query params (GET) to avoid CORS issues
 */
export class MagicEditorAPI {
  constructor(licenseKey) {
    this.licenseKey = licenseKey;
    this.baseUrl = API_BASE_URL;
  }

  async request(endpoint, options = {}) {
    if (!this.licenseKey) {
      throw new Error('No license key available');
    }

    let url = `${this.baseUrl}${endpoint}`;
    
    // For GET requests, add license key as query parameter
    if (!options.method || options.method === 'GET') {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}licenseKey=${encodeURIComponent(this.licenseKey)}`;
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const data = await response.json();
    
    if (!response.ok) {
      const error = new Error(data.error?.message || 'API request failed');
      error.code = data.error?.code;
      error.status = response.status;
      error.upgrade = data.upgrade;
      throw error;
    }

    return data;
  }

  async correct(text, type = 'grammar', options = {}) {
    // License key in body for POST
    return this.request('/correct', {
      method: 'POST',
      body: JSON.stringify({ text, type, options, licenseKey: this.licenseKey }),
    });
  }

  async getUsage() {
    // License key in query for GET
    return this.request('/usage');
  }

  async getCredits() {
    return this.request('/credits');
  }

  async getModels() {
    return this.request('/models');
  }

  async getLimits() {
    return this.request('/limits');
  }
}

export default useAIAssistant;
