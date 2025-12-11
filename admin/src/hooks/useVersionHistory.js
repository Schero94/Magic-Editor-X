import { useState, useCallback } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import { useLicense } from './useLicense';

const apiBase = '/magic-editor-x';

/**
 * Hook to manage Version History (snapshots).
 */
export const useVersionHistory = () => {
  const { get, post } = useFetchClient();
  const { tier } = useLicense();

  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchSnapshots = useCallback(
    async (roomId) => {
      if (!roomId) return;
      setLoading(true);
      setError(null);
      try {
        const { data } = await get(`${apiBase}/snapshots/${roomId}`);
        setSnapshots(data?.data || []);
      } catch (err) {
        setError(err?.message || 'Failed to load snapshots');
      } finally {
        setLoading(false);
      }
    },
    [get],
  );

  const restoreSnapshot = useCallback(
    async (documentId, roomId) => {
      if (!documentId) return;
      setLoading(true);
      setError(null);
      try {
        const { data } = await post(`${apiBase}/snapshots/restore/${documentId}`, { roomId });
        return data?.data;
      } catch (err) {
        setError(err?.message || 'Failed to restore snapshot');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [get],
  );

  /**
   * Create a new snapshot
   * @param {object} params - Snapshot parameters
   * @param {string} params.roomId - Room identifier
   * @param {string} params.contentType - Content type UID
   * @param {string} params.entryId - Entry document ID
   * @param {string} params.fieldName - Field name
   * @param {object} params.content - Optional: Editor.js JSON content (fallback when no Y.Doc)
   */
  const createSnapshot = useCallback(
    async ({ roomId, contentType, entryId, fieldName, content }) => {
      if (!roomId || !contentType || !entryId || !fieldName) return;
      setLoading(true);
      setError(null);
      try {
        const { data } = await post(`${apiBase}/snapshots/${roomId}`, {
          contentType,
          entryId,
          fieldName,
          content, // Include editor content as fallback
        });
        return data?.data;
      } catch (err) {
        setError(err?.message || 'Failed to create snapshot');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [post],
  );

  return {
    snapshots,
    loading,
    error,
    tier,
    fetchSnapshots,
    restoreSnapshot,
    createSnapshot,
  };
};

