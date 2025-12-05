/**
 * Magic Editor X - Initializer Component
 * Handles plugin initialization in Strapi Admin
 */
import { useEffect, useRef } from 'react';
import { PLUGIN_ID } from '../pluginId';

const Initializer = ({ setPlugin }) => {
  const ref = useRef(setPlugin);

  useEffect(() => {
    ref.current(PLUGIN_ID);
  }, []);

  return null;
};

export { Initializer };
export default Initializer;
