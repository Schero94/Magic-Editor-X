/**
 * AI Assistant Popup Component
 * Modal popup for AI-powered text corrections
 */
import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components';
import { MagicEditorAPI } from '../hooks/useAIAssistant';

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999999;
`;

const PopupContainer = styled.div`
  background: ${props => props.theme.colors.neutral0};
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  width: 100%;
  max-width: 500px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

const Header = styled.div`
  background: linear-gradient(135deg, #7C3AED 0%, #a855f7 100%);
  padding: 20px 24px;
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const HeaderTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 16px;
  font-weight: 600;
`;

const CreditsBadge = styled.div`
  background: rgba(255, 255, 255, 0.2);
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
`;

const Content = styled.div`
  padding: 24px;
  overflow-y: auto;
  flex: 1;
`;

const TextPreview = styled.div`
  background: ${props => props.theme.colors.neutral100};
  border: 1px solid ${props => props.theme.colors.neutral200};
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 20px;
  max-height: 100px;
  overflow-y: auto;
  font-size: 14px;
  color: ${props => props.theme.colors.neutral600};
  line-height: 1.6;
`;

const TypeButtons = styled.div`
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
`;

const TypeButton = styled.button`
  flex: 1;
  padding: 14px 16px;
  border: 2px solid ${props => props.$active ? '#7C3AED' : props.theme.colors.neutral200};
  border-radius: 10px;
  background: ${props => props.$active ? '#f5f3ff' : props.theme.colors.neutral0};
  color: ${props => props.$active ? '#7C3AED' : props.theme.colors.neutral700};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  
  &:hover:not(:disabled) {
    border-color: #7C3AED;
    background: #faf8ff;
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ResultArea = styled.div`
  min-height: 80px;
`;

const LoadingSpinner = styled.div`
  text-align: center;
  padding: 40px;
  
  .spinner {
    width: 40px;
    height: 40px;
    border: 4px solid ${props => props.theme.colors.neutral200};
    border-top-color: #7C3AED;
    border-radius: 50%;
    margin: 0 auto 16px;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

const ResultBox = styled.div`
  margin-bottom: 16px;
`;

const ResultLabel = styled.div`
  font-size: 11px;
  font-weight: 700;
  color: ${props => props.theme.colors.neutral500};
  text-transform: uppercase;
  margin-bottom: 8px;
  letter-spacing: 0.5px;
`;

const OriginalText = styled.div`
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 14px;
  font-size: 14px;
  color: #991b1b;
  text-decoration: line-through;
  line-height: 1.6;
`;

const CorrectedText = styled.div`
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  padding: 14px;
  font-size: 14px;
  color: #166534;
  line-height: 1.6;
`;

const SuccessMessage = styled.div`
  text-align: center;
  padding: 30px;
  color: #10b981;
  
  .icon {
    font-size: 48px;
    margin-bottom: 12px;
  }
  
  .title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  
  .subtitle {
    font-size: 13px;
    color: ${props => props.theme.colors.neutral500};
  }
`;

const ErrorMessage = styled.div`
  text-align: center;
  padding: 30px;
  color: #dc2626;
  
  .icon {
    font-size: 48px;
    margin-bottom: 12px;
  }
  
  .title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  
  .subtitle {
    font-size: 13px;
    color: ${props => props.theme.colors.neutral500};
  }
`;

const Footer = styled.div`
  padding: 16px 24px;
  border-top: 1px solid ${props => props.theme.colors.neutral200};
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  background: ${props => props.theme.colors.neutral100};
`;

const Button = styled.button`
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
`;

const CancelButton = styled(Button)`
  background: ${props => props.theme.colors.neutral0};
  border: 1px solid ${props => props.theme.colors.neutral300};
  color: ${props => props.theme.colors.neutral700};
  
  &:hover {
    background: ${props => props.theme.colors.neutral100};
  }
`;

const ApplyButton = styled(Button)`
  background: linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%);
  border: none;
  color: white;
  
  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
`;

const PlaceholderText = styled.div`
  text-align: center;
  padding: 40px;
  color: ${props => props.theme.colors.neutral400};
  font-size: 14px;
`;

const SparklesIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>
    <path d="M5 3v4"/>
    <path d="M3 5h4"/>
    <path d="M19 17v4"/>
    <path d="M17 19h4"/>
  </svg>
);

const AIAssistantPopup = ({ selectedText, licenseKey, onClose, onApply }) => {
  const [activeType, setActiveType] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [credits, setCredits] = useState(0);
  const [usage, setUsage] = useState(null);
  const [apiClient, setApiClient] = useState(null);

  // Initialize API client and fetch usage data
  useEffect(() => {
    if (licenseKey) {
      const client = new MagicEditorAPI(licenseKey);
      setApiClient(client);
      
      // Fetch usage/credits with tier info
      client.getUsage().then(res => {
        setUsage(res.data);
        setCredits(res.data?.credits?.balance || 0);
      }).catch(err => {
        console.error('[AI Popup] Failed to fetch usage:', err);
      });
    }
  }, [licenseKey]);

  const handleCorrection = useCallback(async (type) => {
    if (!apiClient || !selectedText) return;
    
    setActiveType(type);
    setIsLoading(true);
    setResult(null);
    setError(null);
    
    try {
      const response = await apiClient.correct(selectedText, type);
      setResult(response.data);
      
      // Update credits from response (can be null or object)
      if (response.credits?.remaining !== undefined) {
        setCredits(response.credits.remaining);
      }
      // Update daily usage after correction
      if (response.usage) {
        setUsage(prev => ({
          ...prev,
          daily: {
            ...prev?.daily,
            used: response.usage.used,
            remaining: response.usage.remaining,
            limit: response.usage.limit,
          },
        }));
      }
    } catch (err) {
      console.error('[AI Popup] Correction failed:', err);
      setError(err.message || 'Korrektur fehlgeschlagen');
    } finally {
      setIsLoading(false);
    }
  }, [apiClient, selectedText]);

  const handleApply = useCallback(() => {
    if (result?.corrected) {
      onApply(result.corrected);
    }
  }, [result, onApply]);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <Overlay onClick={handleOverlayClick}>
      <PopupContainer onClick={e => e.stopPropagation()}>
        <Header>
          <HeaderTitle>
            <SparklesIcon />
            <span>KI-Assistent</span>
          </HeaderTitle>
          <CreditsBadge>
            {usage?.tier === 'free' && `Free • ${usage?.daily?.remaining ?? 0}/${usage?.daily?.limit ?? 3} heute`}
            {usage?.tier === 'basic' && `Basic • ${usage?.daily?.remaining ?? 0}/${usage?.daily?.limit ?? 10} heute`}
            {usage?.tier === 'pro' && `Pro • ${usage?.daily?.remaining ?? 0}/${usage?.daily?.limit ?? 50} heute`}
            {!usage?.tier && 'Wird geladen...'}
          </CreditsBadge>
        </Header>
        
        <Content>
          <TextPreview>
            {selectedText.length > 300 ? selectedText.substring(0, 300) + '...' : selectedText}
          </TextPreview>
          
          <TypeButtons>
            <TypeButton
              type="button"
              $active={activeType === 'grammar'}
              onClick={() => handleCorrection('grammar')}
              disabled={isLoading || ((usage?.daily?.remaining ?? 0) <= 0 && credits <= 0)}
            >
              <span>✓</span>
              <span>Grammatik</span>
            </TypeButton>
            <TypeButton
              type="button"
              $active={activeType === 'style'}
              onClick={() => handleCorrection('style')}
              disabled={isLoading || !usage?.allowedTypes?.includes('style') || ((usage?.daily?.remaining ?? 0) <= 0 && credits <= 0)}
              title={!usage?.allowedTypes?.includes('style') ? 'Basic oder höher erforderlich' : undefined}
            >
              <span>{usage?.allowedTypes?.includes('style') ? '✨' : '🔒'}</span>
              <span>Stil</span>
            </TypeButton>
            <TypeButton
              type="button"
              $active={activeType === 'rewrite'}
              onClick={() => handleCorrection('rewrite')}
              disabled={isLoading || !usage?.allowedTypes?.includes('rewrite') || ((usage?.daily?.remaining ?? 0) <= 0 && credits <= 0)}
              title={!usage?.allowedTypes?.includes('rewrite') ? 'Pro erforderlich' : undefined}
            >
              <span>{usage?.allowedTypes?.includes('rewrite') ? '↻' : '🔒'}</span>
              <span>Umschreiben</span>
            </TypeButton>
          </TypeButtons>
          
          <ResultArea>
            {isLoading && (
              <LoadingSpinner>
                <div className="spinner" />
                <div>Korrigiere...</div>
              </LoadingSpinner>
            )}
            
            {!isLoading && !result && !error && (
              <PlaceholderText>
                Wähle einen Korrektur-Typ, um den Text zu verbessern
              </PlaceholderText>
            )}
            
            {!isLoading && result && !result.hasChanges && (
              <SuccessMessage>
                <div className="icon">✓</div>
                <div className="title">Keine Änderungen nötig</div>
                <div className="subtitle">Der Text ist bereits korrekt</div>
              </SuccessMessage>
            )}
            
            {!isLoading && result && result.hasChanges && (
              <>
                <ResultBox>
                  <ResultLabel>Original</ResultLabel>
                  <OriginalText>{result.original}</OriginalText>
                </ResultBox>
                <ResultBox>
                  <ResultLabel>Korrigiert</ResultLabel>
                  <CorrectedText>{result.corrected}</CorrectedText>
                </ResultBox>
              </>
            )}
            
            {!isLoading && error && (
              <ErrorMessage>
                <div className="icon">✕</div>
                <div className="title">Fehler</div>
                <div className="subtitle">{error}</div>
              </ErrorMessage>
            )}
          </ResultArea>
        </Content>
        
        <Footer>
          <CancelButton type="button" onClick={onClose}>
            Abbrechen
          </CancelButton>
          <ApplyButton
            type="button"
            onClick={handleApply}
            disabled={!result?.hasChanges}
          >
            Übernehmen
          </ApplyButton>
        </Footer>
      </PopupContainer>
    </Overlay>
  );
};

export default AIAssistantPopup;
