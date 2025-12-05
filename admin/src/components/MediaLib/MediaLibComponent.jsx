/**
 * Magic Editor X - Media Library Component
 * Strapi v5 Media Library Dialog integration
 * 
 * In Strapi v5, the 'media-library' component is registered by @strapi/upload plugin
 * using app.addComponents(). We access it via useStrapiApp().
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useStrapiApp } from '@strapi/strapi/admin';

/**
 * Get the backend URL for assets
 */
const getBackendUrl = () => {
  return window.location.origin;
};

/**
 * Prefix file URL with backend URL if needed
 */
const prefixFileUrl = (url) => {
  if (!url) return url;
  
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  return `${getBackendUrl()}${url}`;
};

/**
 * Media Library Component
 * Uses the Strapi v5 component registration system
 */
const MediaLibComponent = ({ 
  isOpen = false, 
  onChange = () => {}, 
  onToggle = () => {},
  allowedTypes = ['images', 'files', 'videos', 'audios'],
  multiple = true,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  
  // Access components from Strapi's app context
  const components = useStrapiApp('MediaLibComponent', (state) => state.components);
  
  // Get the MediaLibraryDialog component registered by @strapi/upload
  const MediaLibraryDialog = components?.['media-library'];

  // Retry mechanism - sometimes the upload plugin loads after our component
  useEffect(() => {
    if (isOpen && !MediaLibraryDialog && retryCount < 5) {
      const timer = setTimeout(() => {
        setRetryCount(prev => prev + 1);
      }, 200);
      return () => clearTimeout(timer);
    }
    setIsLoading(false);
  }, [isOpen, MediaLibraryDialog, retryCount]);
  
  // Reset retry count when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setRetryCount(0);
      setIsLoading(true);
    }
  }, [isOpen]);
  
  // Debug logging
  useEffect(() => {
    if (isOpen) {
      console.log('[Magic Editor X] MediaLib opened');
      console.log('[Magic Editor X] Available components:', Object.keys(components || {}));
      console.log('[Magic Editor X] MediaLibraryDialog:', MediaLibraryDialog ? '✅ Found' : '❌ Not found');
      console.log('[Magic Editor X] Retry count:', retryCount);
    }
  }, [isOpen, components, MediaLibraryDialog, retryCount]);

  /**
   * Handle asset selection
   */
  const handleSelectAssets = useCallback((files) => {
    console.log('[Magic Editor X] Selected assets:', files);
    
    if (!files || files.length === 0) {
      onToggle();
      return;
    }

    const formattedFiles = files.map((file) => ({
      alt: file.alternativeText || file.name || '',
      url: prefixFileUrl(file.url),
      width: file.width,
      height: file.height,
      size: file.size,
      mime: file.mime,
      formats: file.formats,
      name: file.name,
      caption: file.caption || '',
      id: file.id,
      documentId: file.documentId,
    }));

    console.log('[Magic Editor X] Formatted files:', formattedFiles);
    onChange(formattedFiles);
  }, [onChange, onToggle]);

  /**
   * Handle dialog close
   */
  const handleClose = useCallback(() => {
    console.log('[Magic Editor X] MediaLib closing');
    onToggle();
  }, [onToggle]);

  // Don't render anything if not open
  if (!isOpen) {
    return null;
  }

  // Show loading while retrying
  if (isLoading && !MediaLibraryDialog && retryCount < 5) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100000, // Higher than fullscreen (9999)
        }}
      >
        <div
          style={{
            backgroundColor: 'white',
            padding: '40px',
            borderRadius: '16px',
            textAlign: 'center',
            maxWidth: '400px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
          }}
        >
          <div style={{ 
            width: '48px', 
            height: '48px', 
            margin: '0 auto 20px',
            border: '4px solid #e2e8f0',
            borderTop: '4px solid #7C3AED',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <style>{`
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
          <p style={{ fontSize: '14px', color: '#64748b' }}>
            Media Library wird geladen...
          </p>
        </div>
      </div>
    );
  }

  // Fallback if MediaLibraryDialog is not available after retries
  if (!MediaLibraryDialog) {
    console.warn('[Magic Editor X] Media Library component not available after retries');
    console.log('[Magic Editor X] Registered components:', Object.keys(components || {}));
    
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100000, // Higher than fullscreen (9999)
        }}
        onClick={handleClose}
      >
        <div
          style={{
            backgroundColor: 'white',
            padding: '40px',
            borderRadius: '16px',
            textAlign: 'center',
            maxWidth: '400px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ 
            width: '64px', 
            height: '64px', 
            margin: '0 auto 20px',
            background: 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h3 style={{ 
            fontSize: '18px', 
            fontWeight: '600', 
            color: '#1e293b',
            marginBottom: '12px',
          }}>
            Media Library nicht verfügbar
          </h3>
          <p style={{ 
            fontSize: '14px', 
            color: '#64748b', 
            marginBottom: '16px',
            lineHeight: '1.5',
          }}>
            Die Strapi Media Library konnte nicht geladen werden.
          </p>
          <p style={{ 
            fontSize: '12px', 
            color: '#94a3b8', 
            marginBottom: '24px',
            background: '#f1f5f9',
            padding: '8px 12px',
            borderRadius: '6px',
            fontFamily: 'monospace',
          }}>
            Verfügbare Komponenten: {Object.keys(components || {}).join(', ') || 'Keine'}
          </p>
          <button
            onClick={handleClose}
            style={{
              padding: '12px 24px',
              background: 'linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseOver={(e) => e.target.style.transform = 'translateY(-1px)'}
            onMouseOut={(e) => e.target.style.transform = 'translateY(0)'}
          >
            Schließen
          </button>
        </div>
      </div>
    );
  }

  // Render the actual Media Library Dialog with error boundary wrapper
  return (
    <MediaLibErrorBoundary onClose={handleClose}>
    <MediaLibraryDialog
        allowedTypes={allowedTypes}
      onClose={handleClose}
      onSelectAssets={handleSelectAssets}
        multiple={multiple}
      />
    </MediaLibErrorBoundary>
  );
};

/**
 * Error Boundary for Media Library
 * Catches errors from Strapi's MediaLibraryDialog (e.g., 403 permission errors)
 */
class MediaLibErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[Magic Editor X] Media Library error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100000,
          }}
          onClick={this.props.onClose}
        >
          <div
            style={{
              backgroundColor: 'white',
              padding: '40px',
              borderRadius: '16px',
              textAlign: 'center',
              maxWidth: '450px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ 
              width: '64px', 
              height: '64px', 
              margin: '0 auto 20px',
              background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
            </div>
            <h3 style={{ 
              fontSize: '18px', 
              fontWeight: '600', 
              color: '#1e293b',
              marginBottom: '12px',
            }}>
              Keine Upload-Berechtigung
            </h3>
            <p style={{ 
              fontSize: '14px', 
              color: '#64748b', 
              marginBottom: '20px',
              lineHeight: '1.6',
            }}>
              Du benötigst Upload-Berechtigungen um die Media Library zu nutzen.
              <br /><br />
              <strong>Lösung:</strong> Bitte einen Super Admin, dir die Upload-Rechte 
              unter <em>Settings → Administration panel → Roles</em> zu geben.
            </p>
            <button
              onClick={this.props.onClose}
              style={{
                padding: '12px 24px',
                background: 'linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Schließen
            </button>
          </div>
        </div>
  );
    }

    return this.props.children;
  }
}

export default MediaLibComponent;
