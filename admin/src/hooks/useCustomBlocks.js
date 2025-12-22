/**
 * useCustomBlocks Hook
 * Loads custom blocks from the database and generates Editor.js tool classes
 */
import { useState, useEffect, useCallback } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import { createBlockClasses } from '../utils/blockFactory';
import { PLUGIN_ID } from '../pluginId';

/**
 * Hook to load and manage custom blocks
 * @returns {object} Custom blocks state and utilities
 */
export function useCustomBlocks() {
  const { get } = useFetchClient();
  
  const [customBlocks, setCustomBlocks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  /**
   * Fetch custom blocks from API
   */
  const fetchCustomBlocks = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await get(`/${PLUGIN_ID}/custom-blocks?enabledOnly=true`);
      const blocksData = response.data?.data || [];
      
      // Generate Editor.js tool classes from block configurations
      const blockClasses = createBlockClasses(blocksData);
      
      console.log(`[useCustomBlocks] Loaded ${blockClasses.length} custom blocks`);
      
      setCustomBlocks(blockClasses);
      setLastFetched(new Date());
      
      return blockClasses;
      
    } catch (err) {
      console.error('[useCustomBlocks] Error loading custom blocks:', err);
      setError(err.message || 'Failed to load custom blocks');
      return [];
      
    } finally {
      setIsLoading(false);
    }
  }, [get]);

  /**
   * Refresh custom blocks
   */
  const refresh = useCallback(() => {
    return fetchCustomBlocks();
  }, [fetchCustomBlocks]);

  /**
   * Initial load on mount
   */
  useEffect(() => {
    fetchCustomBlocks();
  }, [fetchCustomBlocks]);

  return {
    customBlocks,
    isLoading,
    error,
    lastFetched,
    refresh,
  };
}

export default useCustomBlocks;

