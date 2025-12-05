/**
 * Magic Editor X - App Component
 * Main application wrapper with routing
 */
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Page } from '@strapi/strapi/admin';
import HomePage from './HomePage';
import CollaborationSettings from './CollaborationSettings';
import LicensePage from './LicensePage';
import LicenseGuard from '../components/LicenseGuard';

const App = () => {
  return (
    <LicenseGuard>
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="collaboration" element={<CollaborationSettings />} />
        <Route path="license" element={<LicensePage />} />
        <Route path="*" element={<Page.Error />} />
      </Routes>
    </LicenseGuard>
  );
};

export { App };
export default App;
