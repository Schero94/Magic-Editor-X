/**
 * Magic Editor X - App Component
 * Main application wrapper with routing
 */
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Page } from '@strapi/strapi/admin';
import HomePage from './HomePage';
import CollaborationSettings from './CollaborationSettings';

const App = () => {
  return (
    <Routes>
      <Route index element={<HomePage />} />
      <Route path="collaboration" element={<CollaborationSettings />} />
      <Route path="*" element={<Page.Error />} />
    </Routes>
  );
};

export { App };
export default App;
