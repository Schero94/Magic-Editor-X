/**
 * Credits Modal Component
 * Shows credit packages when user has no credits
 */
import React from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100000;
  animation: fadeIn 0.2s ease-out;
  
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`;

const Modal = styled.div`
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  max-width: 600px;
  width: 90%;
  overflow: hidden;
  animation: slideUp 0.3s ease-out;
  
  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

const Header = styled.div`
  background: linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%);
  padding: 24px;
  text-align: center;
  color: white;
`;

const Icon = styled.div`
  width: 64px;
  height: 64px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  font-size: 28px;
`;

const Title = styled.h2`
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 700;
`;

const Subtitle = styled.p`
  margin: 0;
  font-size: 14px;
  opacity: 0.9;
`;

const Content = styled.div`
  padding: 24px;
`;

const PackagesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 24px;
  
  @media (max-width: 540px) {
    grid-template-columns: 1fr;
  }
`;

const Package = styled.div`
  background: ${props => props.$best ? 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)' : '#f8fafc'};
  border: 2px solid ${props => props.$best ? '#7C3AED' : '#e2e8f0'};
  border-radius: 12px;
  padding: 20px;
  text-align: center;
  position: relative;
  transition: all 0.2s ease;
  
  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(124, 58, 237, 0.15);
  }
  
  ${props => props.$best && `
    transform: scale(1.05);
    
    &:hover {
      transform: scale(1.05) translateY(-4px);
    }
  `}
`;

const BestBadge = styled.div`
  position: absolute;
  top: -10px;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%);
  color: white;
  font-size: 10px;
  font-weight: 700;
  padding: 4px 12px;
  border-radius: 20px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const Credits = styled.div`
  font-size: 32px;
  font-weight: 800;
  color: #1e293b;
  margin-bottom: 4px;
`;

const CreditsLabel = styled.div`
  font-size: 12px;
  color: #64748b;
  margin-bottom: 12px;
`;

const Price = styled.div`
  font-size: 24px;
  font-weight: 700;
  color: ${props => props.$best ? '#7C3AED' : '#334155'};
  
  span {
    font-size: 14px;
    font-weight: 400;
    color: #64748b;
  }
`;

const PerCredit = styled.div`
  font-size: 11px;
  color: #94a3b8;
  margin-top: 4px;
`;

const Actions = styled.div`
  display: flex;
  gap: 12px;
  justify-content: center;
`;

const Button = styled.button`
  padding: 12px 32px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  
  ${props => props.$primary ? `
    background: linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%);
    border: none;
    color: white;
    
    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(124, 58, 237, 0.4);
    }
  ` : `
    background: white;
    border: 1px solid #e2e8f0;
    color: #64748b;
    
    &:hover {
      background: #f8fafc;
      border-color: #cbd5e1;
    }
  `}
  
  &:active {
    transform: scale(0.98);
  }
`;

const Footer = styled.div`
  padding: 16px 24px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  text-align: center;
  font-size: 12px;
  color: #64748b;
  
  a {
    color: #7C3AED;
    text-decoration: none;
    font-weight: 500;
    
    &:hover {
      text-decoration: underline;
    }
  }
`;

/**
 * CreditsModal Component
 */
export const CreditsModal = ({ 
  isOpen, 
  onClose, 
  upgradeInfo 
}) => {
  const navigate = useNavigate();
  
  if (!isOpen) return null;
  
  const packages = upgradeInfo?.packages || [
    { credits: 50, price: 4.99, currency: 'EUR' },
    { credits: 200, price: 14.99, currency: 'EUR', bestValue: true },
    { credits: 500, price: 29.99, currency: 'EUR' },
  ];
  
  const handleUpgrade = () => {
    onClose();
    navigate('/settings/magic-editor-x/upgrade');
  };
  
  const formatPrice = (price, currency) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: currency || 'EUR',
    }).format(price);
  };
  
  const getPerCredit = (price, credits) => {
    return (price / credits).toFixed(3).replace('.', ',');
  };
  
  return (
    <Overlay onClick={onClose}>
      <Modal onClick={e => e.stopPropagation()}>
        <Header>
          <Icon>✨</Icon>
          <Title>Keine Credits verfügbar</Title>
          <Subtitle>
            {upgradeInfo?.message || 'Kaufe Credits um Magic Editor AI zu nutzen'}
          </Subtitle>
        </Header>
        
        <Content>
          <PackagesGrid>
            {packages.map((pkg, index) => (
              <Package key={index} $best={pkg.bestValue}>
                {pkg.bestValue && <BestBadge>Best Value</BestBadge>}
                <Credits>{pkg.credits}</Credits>
                <CreditsLabel>Credits</CreditsLabel>
                <Price $best={pkg.bestValue}>
                  {formatPrice(pkg.price, pkg.currency)}
                </Price>
                <PerCredit>
                  {getPerCredit(pkg.price, pkg.credits)} € / Credit
                </PerCredit>
              </Package>
            ))}
          </PackagesGrid>
          
          <Actions>
            <Button onClick={onClose}>
              Später
            </Button>
            <Button $primary onClick={handleUpgrade}>
              Credits kaufen
            </Button>
          </Actions>
        </Content>
        
        <Footer>
          Credits werden nie ablaufen • <a href="#" onClick={handleUpgrade}>Alle Pakete ansehen</a>
        </Footer>
      </Modal>
    </Overlay>
  );
};

export default CreditsModal;
