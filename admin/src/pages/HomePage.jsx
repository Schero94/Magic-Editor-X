/**
 * Magic Editor X - Dashboard & Playground
 * Interactive demo, collaboration status, and tool documentation
 */
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import styled, { keyframes, css } from 'styled-components';
import { theme } from '../utils/theme';
import { 
  SparklesIcon,
  DocumentTextIcon,
  ChevronRightIcon,
  CubeTransparentIcon,
  CommandLineIcon,
  BookOpenIcon,
  BeakerIcon,
  ArrowPathIcon,
  EyeIcon,
  CodeBracketIcon,
  PhotoIcon,
  ListBulletIcon,
  TableCellsIcon,
  LinkIcon,
  ChatBubbleBottomCenterTextIcon,
  ExclamationTriangleIcon,
  CheckIcon,
  HashtagIcon,
  PaperClipIcon,
  BellAlertIcon,
  PlayCircleIcon,
  DocumentDuplicateIcon,
  UserGroupIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import EditorJS from '@editorjs/editorjs';
import { useIntl } from 'react-intl';
import { getTools } from '../config/tools';
import { PLUGIN_ID } from '../pluginId';
import { getTranslation } from '../utils/getTranslation';

/* ============================================
   ANIMATIONS
   ============================================ */

const fadeInUp = keyframes`
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.05); }
`;

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

/* ============================================
   STYLED COMPONENTS
   ============================================ */

const PageWrapper = styled.div`
  min-height: 100vh;
  background: ${props => props.theme.colors.neutral100};
`;

const Container = styled.div`
  max-width: 1400px;
  margin: 0 auto;
  padding: 32px;
`;

const Header = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid ${props => props.theme.colors.neutral200};
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`;

const Logo = styled.div`
  width: 48px;
  height: 48px;
  background: linear-gradient(135deg, #7C3AED 0%, #6366f1 100%);
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 24px rgba(124, 58, 237, 0.3);
  
  svg {
    width: 26px;
    height: 26px;
    color: white;
  }
`;

const HeaderTitle = styled.div`
  h1 {
    font-size: 24px;
    font-weight: 700;
    color: ${props => props.theme.colors.neutral800};
    margin: 0 0 4px 0;
  }
  
  p {
    font-size: 14px;
    color: ${props => props.theme.colors.neutral600};
    margin: 0;
  }
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const StatusBadge = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: ${props => props.$active ? 'rgba(34, 197, 94, 0.1)' : 'rgba(100, 116, 139, 0.1)'};
  border: 1px solid ${props => props.$active ? 'rgba(34, 197, 94, 0.2)' : 'rgba(100, 116, 139, 0.2)'};
  border-radius: 100px;
  font-size: 13px;
  font-weight: 500;
  color: ${props => props.$active ? '#22c55e' : '#64748b'};
  
  &::before {
    content: '';
    width: 8px;
    height: 8px;
    background: ${props => props.$active ? '#22c55e' : '#64748b'};
    border-radius: 50%;
    animation: ${props => props.$active ? pulse : 'none'} 2s ease-in-out infinite;
  }
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: 24px;
  
  @media (max-width: 1100px) {
    grid-template-columns: 1fr;
  }
`;

const MainArea = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const Sidebar = styled.aside`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const Card = styled.div`
  background: ${props => props.theme.colors.neutral0};
  border: 1px solid ${props => props.theme.colors.neutral200};
  border-radius: 16px;
  overflow: hidden;
  animation: ${fadeInUp} 0.5s ease ${props => props.$delay || 0}s both;
`;

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid ${props => props.theme.colors.neutral200};
  background: ${props => props.theme.colors.neutral100};
`;

const CardTitle = styled.h2`
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
  color: ${props => props.theme.colors.neutral800};
  margin: 0;
  
  svg {
    width: 20px;
    height: 20px;
    color: #7C3AED;
  }
`;

const CardContent = styled.div`
  padding: ${props => props.$noPadding ? '0' : '24px'};
`;

const CardActions = styled.div`
  display: flex;
  gap: 8px;
`;

const IconButton = styled.button`
  width: 36px;
  height: 36px;
  border: 1px solid ${props => props.theme.colors.neutral200};
  border-radius: 10px;
  background: ${props => props.theme.colors.neutral0};
  color: ${props => props.theme.colors.neutral600};
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
  
  svg {
    width: 18px;
    height: 18px;
  }
  
  &:hover {
    background: ${props => props.theme.colors.neutral100};
    border-color: #7C3AED;
    color: #7C3AED;
  }
  
  ${props => props.$spinning && css`
    svg {
      animation: ${spin} 1s linear infinite;
    }
  `}
`;

const Button = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: ${props => props.$primary 
    ? 'linear-gradient(135deg, #7C3AED 0%, #6366f1 100%)' 
    : props.theme.colors.neutral0};
  border: 1px solid ${props => props.$primary ? 'transparent' : props.theme.colors.neutral200};
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  color: ${props => props.$primary ? 'white' : props.theme.colors.neutral800};
  cursor: pointer;
  transition: all 0.2s ease;
  
  svg {
    width: 18px;
    height: 18px;
  }
  
  &:hover {
    transform: translateY(-2px);
    box-shadow: ${props => props.$primary 
      ? '0 8px 24px rgba(124, 58, 237, 0.3)' 
      : '0 4px 12px rgba(0, 0, 0, 0.1)'};
  }
  
  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }
`;

/* Playground Editor */
const PlaygroundWrapper = styled.div`
  min-height: 400px;
  border: 2px dashed ${props => props.theme.colors.neutral300};
  border-radius: 12px;
  margin: 16px;
  position: relative;
  transition: all 0.2s ease;
  
  &:focus-within {
    border-color: #7C3AED;
    border-style: solid;
  }
`;

const PlaygroundEditor = styled.div`
  padding: 24px;
  min-height: 350px;
  
  .codex-editor__redactor {
    padding-bottom: 60px !important;
  }
`;

const PlaygroundEmpty = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: ${props => props.theme.colors.neutral500};
  pointer-events: none;
  
  svg {
    width: 48px;
    height: 48px;
    margin-bottom: 12px;
    opacity: 0.5;
  }
  
  p {
    font-size: 15px;
    margin: 0;
  }
`;

const OutputPreview = styled.div`
  background: #1e293b;
  border-radius: 12px;
  margin: 16px;
  overflow: hidden;
`;

const OutputHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #0f172a;
  border-bottom: 1px solid #334155;
`;

const OutputTitle = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const OutputContent = styled.pre`
  padding: 16px;
  margin: 0;
  font-family: 'JetBrains Mono', 'SF Mono', Monaco, monospace;
  font-size: 12px;
  color: #e2e8f0;
  overflow-x: auto;
  max-height: 300px;
  
  .key { color: #7dd3fc; }
  .string { color: #86efac; }
  .number { color: #fcd34d; }
  .boolean { color: #f472b6; }
  .null { color: #94a3b8; }
`;

/* Tool Documentation */
const ToolGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  padding: 16px;
  
  @media (max-width: 480px) {
    grid-template-columns: 1fr;
  }
`;

const ToolItem = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: ${props => props.$active ? 'rgba(124, 58, 237, 0.08)' : props.theme.colors.neutral100};
  border: 1px solid ${props => props.$active ? 'rgba(124, 58, 237, 0.2)' : 'transparent'};
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  
  &:hover {
    background: rgba(124, 58, 237, 0.05);
  }
`;

const ToolIcon = styled.div`
  width: 32px;
  height: 32px;
  background: ${props => props.$color || 'linear-gradient(135deg, #7C3AED 0%, #6366f1 100%)'};
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  
  svg {
    width: 16px;
    height: 16px;
    color: white;
  }
`;

const ToolInfo = styled.div`
  flex: 1;
  min-width: 0;
  
  h4 {
    font-size: 13px;
    font-weight: 600;
    color: ${props => props.theme.colors.neutral800};
    margin: 0 0 2px 0;
  }
  
  p {
    font-size: 11px;
    color: ${props => props.theme.colors.neutral600};
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

/* Keyboard Shortcuts */
const ShortcutList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px;
`;

const ShortcutItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: ${props => props.theme.colors.neutral100};
  border-radius: 8px;
`;

const ShortcutLabel = styled.span`
  font-size: 13px;
  color: ${props => props.theme.colors.neutral800};
`;

const ShortcutKeys = styled.div`
  display: flex;
  gap: 4px;
`;

const Kbd = styled.kbd`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 8px;
  background: ${props => props.theme.colors.neutral0};
  border: 1px solid ${props => props.theme.colors.neutral200};
  border-radius: 6px;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 11px;
  font-weight: 600;
  color: ${props => props.theme.colors.neutral600};
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
`;

/* Stats */
const StatsGrid = styled.div`
  display: grid;
    grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  padding: 16px;
`;

const StatCard = styled.div`
  padding: 16px;
  background: linear-gradient(135deg, ${props => props.$bg || 'rgba(124, 58, 237, 0.05)'} 0%, transparent 100%);
  border-radius: 12px;
  text-align: center;
`;

const StatNumber = styled.div`
  font-size: 28px;
  font-weight: 800;
  color: ${props => props.$color || '#7C3AED'};
  margin-bottom: 4px;
`;

const StatLabel = styled.div`
  font-size: 12px;
  color: #64748b;
  font-weight: 500;
`;

/* Tabs */
const TabsContainer = styled.div`
  display: flex;
  gap: 4px;
  padding: 4px;
  background: ${props => props.theme.colors.neutral150};
  border-radius: 10px;
`;

const Tab = styled.button`
  flex: 1;
  padding: 8px 16px;
  background: ${props => props.$active ? props.theme.colors.neutral0 : 'transparent'};
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: ${props => props.$active ? props.theme.colors.neutral800 : props.theme.colors.neutral600};
  cursor: pointer;
  transition: all 0.15s ease;
  box-shadow: ${props => props.$active ? '0 1px 3px rgba(0, 0, 0, 0.1)' : 'none'};
    
    &:hover {
    color: ${props => props.theme.colors.neutral800};
  }
`;

/* ============================================
   COMPONENT
   ============================================ */

/* Quick Links */
const QuickLinksGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
`;

const QuickLinkItem = styled.button`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: ${props => props.$active ? 'rgba(124, 58, 237, 0.08)' : props.theme.colors.neutral100};
  border: 1px solid ${props => props.$active ? 'rgba(124, 58, 237, 0.2)' : 'transparent'};
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
  width: 100%;
  
  &:hover {
    background: rgba(124, 58, 237, 0.08);
    border-color: rgba(124, 58, 237, 0.2);
    transform: translateX(4px);
  }
`;

const QuickLinkIcon = styled.div`
  width: 40px;
  height: 40px;
  background: ${props => props.$color || 'linear-gradient(135deg, #7C3AED 0%, #6366f1 100%)'};
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  
  svg {
    width: 20px;
    height: 20px;
    color: white;
  }
`;

const QuickLinkInfo = styled.div`
  flex: 1;
  min-width: 0;
  
  h4 {
    font-size: 14px;
    font-weight: 600;
    color: ${props => props.theme.colors.neutral800};
    margin: 0 0 2px 0;
  }
  
  p {
    font-size: 12px;
    color: ${props => props.theme.colors.neutral600};
    margin: 0;
  }
`;

const QuickLinkArrow = styled.div`
  color: ${props => props.theme.colors.neutral500};
  
  svg {
    width: 16px;
    height: 16px;
  }
`;

const HomePage = () => {
  const navigate = useNavigate();
  const { formatMessage } = useIntl();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  
  const [activeTab, setActiveTab] = useState('playground');
  const [editorData, setEditorData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const editorRef = useRef(null);
  const editorInstanceRef = useRef(null);

  const toolsData = [
    { name: t('tools.header', 'Header'), desc: t('tools.header.desc', 'H1-H6 Headings'), icon: HashtagIcon, color: 'linear-gradient(135deg, #7C3AED, #6366f1)' },
    { name: t('tools.paragraph', 'Paragraph'), desc: t('tools.paragraph.desc', 'Text paragraphs'), icon: DocumentTextIcon, color: 'linear-gradient(135deg, #334155, #475569)' },
    { name: t('tools.list', 'List'), desc: t('tools.list.desc', 'Nested lists'), icon: ListBulletIcon, color: 'linear-gradient(135deg, #14b8a6, #2dd4bf)' },
    { name: t('tools.checklist', 'Checklist'), desc: t('tools.checklist.desc', 'Interactive checkboxes'), icon: CheckIcon, color: 'linear-gradient(135deg, #22c55e, #4ade80)' },
    { name: t('tools.quote', 'Quote'), desc: t('tools.quote.desc', 'Quotes with author'), icon: ChatBubbleBottomCenterTextIcon, color: 'linear-gradient(135deg, #f59e0b, #fbbf24)' },
    { name: t('tools.code', 'Code'), desc: t('tools.code.desc', 'Code blocks'), icon: CodeBracketIcon, color: 'linear-gradient(135deg, #06b6d4, #22d3ee)' },
    { name: t('tools.image', 'Image'), desc: t('tools.image.desc', 'Upload images'), icon: PhotoIcon, color: 'linear-gradient(135deg, #ec4899, #f472b6)' },
    { name: t('tools.table', 'Table'), desc: t('tools.table.desc', 'Create tables'), icon: TableCellsIcon, color: 'linear-gradient(135deg, #8b5cf6, #a78bfa)' },
    { name: t('tools.link', 'Link'), desc: t('tools.link.desc', 'Link preview'), icon: LinkIcon, color: 'linear-gradient(135deg, #3b82f6, #60a5fa)' },
    { name: t('tools.warning', 'Warning'), desc: t('tools.warning.desc', 'Warning notices'), icon: ExclamationTriangleIcon, color: 'linear-gradient(135deg, #ef4444, #f87171)' },
    { name: t('tools.attaches', 'Attaches'), desc: t('tools.attaches.desc', 'File attachments'), icon: PaperClipIcon, color: 'linear-gradient(135deg, #64748b, #94a3b8)' },
    { name: t('tools.alert', 'Alert'), desc: t('tools.alert.desc', 'Colored alerts'), icon: BellAlertIcon, color: 'linear-gradient(135deg, #f97316, #fb923c)' },
  ];

  const shortcuts = [
    { keys: ['⌘', 'B'], label: t('shortcuts.bold', 'Bold') },
    { keys: ['⌘', 'I'], label: t('shortcuts.italic', 'Italic') },
    { keys: ['⌘', 'U'], label: t('shortcuts.underline', 'Underline') },
    { keys: ['⌘', '⇧', 'H'], label: t('shortcuts.heading', 'Heading') },
    { keys: ['⌘', '⇧', 'L'], label: t('shortcuts.list', 'List') },
    { keys: ['⌘', '⇧', 'M'], label: t('shortcuts.highlight', 'Highlight') },
    { keys: ['Tab'], label: t('shortcuts.blockMenu', 'Block Menu') },
    { keys: ['⌘', 'Z'], label: t('shortcuts.undo', 'Undo') },
  ];

  // Initialize playground editor
  useEffect(() => {
    if (activeTab === 'playground' && editorRef.current && !editorInstanceRef.current) {
      const tools = getTools({ 
        mediaLibToggleFunc: () => {},
        pluginId: PLUGIN_ID 
      });

      // Remove tools that need server endpoints for playground
      const playgroundTools = { ...tools };
      delete playgroundTools.image;
      delete playgroundTools.attaches;
      delete playgroundTools.linkTool;
      delete playgroundTools.personality;
      delete playgroundTools.mediaLib;

      editorInstanceRef.current = new EditorJS({
        holder: editorRef.current,
        tools: playgroundTools,
        placeholder: t('homepage.playground.placeholder', 'Type / for block menu or start writing...'),
        onChange: async () => {
          try {
            const data = await editorInstanceRef.current.save();
            setEditorData(data);
            setHasContent(data.blocks && data.blocks.length > 0);
          } catch (e) {
            console.warn('Could not save:', e);
          }
        },
      });
    }

    return () => {
      if (editorInstanceRef.current && editorInstanceRef.current.destroy) {
        editorInstanceRef.current.destroy();
        editorInstanceRef.current = null;
      }
    };
  }, [activeTab]);

  const clearPlayground = async () => {
    if (editorInstanceRef.current) {
      await editorInstanceRef.current.clear();
      setEditorData(null);
      setHasContent(false);
    }
  };

  const copyJSON = () => {
    if (editorData) {
      navigator.clipboard.writeText(JSON.stringify(editorData, null, 2));
    }
  };

  const formatJSON = (obj) => {
    if (!obj) return '';
    const json = JSON.stringify(obj, null, 2);
    return json
      .replace(/"([^"]+)":/g, '<span class="key">"$1"</span>:')
      .replace(/: "([^"]*)"/g, ': <span class="string">"$1"</span>')
      .replace(/: (\d+)/g, ': <span class="number">$1</span>')
      .replace(/: (true|false)/g, ': <span class="boolean">$1</span>')
      .replace(/: null/g, ': <span class="null">null</span>');
  };

  return (
    <PageWrapper>
      <Container>
        {/* Header */}
        <Header>
          <HeaderLeft>
            <Logo>
            <SparklesIcon />
            </Logo>
            <HeaderTitle>
              <h1>{t('homepage.title', 'Magic Editor X')}</h1>
              <p>{t('homepage.subtitle', 'Block Editor Dashboard for Strapi v5')}</p>
            </HeaderTitle>
          </HeaderLeft>
          <HeaderRight>
            <StatusBadge $active={true}>
              {t('homepage.status.ready', 'Realtime Ready')}
            </StatusBadge>
          </HeaderRight>
        </Header>

        <Grid>
          {/* Main Content */}
          <MainArea>
            {/* Playground Card */}
            <Card $delay={0.1}>
              <CardHeader>
                <CardTitle>
                  <BeakerIcon />
                  {t('homepage.playground', 'Editor Playground')}
                </CardTitle>
                <CardActions>
                  <TabsContainer>
                    <Tab $active={activeTab === 'playground'} onClick={() => setActiveTab('playground')}>
                      {t('homepage.tabs.editor', 'Editor')}
                    </Tab>
                    <Tab $active={activeTab === 'output'} onClick={() => setActiveTab('output')}>
                      {t('homepage.tabs.output', 'JSON Output')}
                    </Tab>
                  </TabsContainer>
                </CardActions>
              </CardHeader>

              {activeTab === 'playground' ? (
                <CardContent $noPadding>
                  <PlaygroundWrapper>
                    <PlaygroundEditor ref={editorRef} />
                    {!hasContent && (
                      <PlaygroundEmpty>
                        <PlayCircleIcon />
                        <p>{t('homepage.playground.empty', 'Type here to try the editor')}</p>
                      </PlaygroundEmpty>
                    )}
                  </PlaygroundWrapper>
                  <div style={{ padding: '0 16px 16px', display: 'flex', gap: '8px' }}>
                    <Button onClick={clearPlayground}>
                      <ArrowPathIcon />
                      {t('homepage.button.clear', 'Clear')}
                    </Button>
                    {hasContent && (
                      <Button $primary onClick={() => setActiveTab('output')}>
                        <EyeIcon />
                        {t('homepage.button.showJson', 'Show JSON')}
                      </Button>
                    )}
                  </div>
                </CardContent>
              ) : (
                <CardContent $noPadding>
                  <OutputPreview>
                    <OutputHeader>
                      <OutputTitle>{t('homepage.output.title', 'Editor.js JSON Output')}</OutputTitle>
                      <IconButton onClick={copyJSON} title={t('homepage.button.copyJson', 'Copy JSON')}>
                        <DocumentDuplicateIcon />
                      </IconButton>
                    </OutputHeader>
                    <OutputContent 
                      dangerouslySetInnerHTML={{ 
                        __html: editorData 
                          ? formatJSON(editorData) 
                          : `<span class="null">${t('homepage.output.empty', '// No content - create blocks in the editor')}</span>` 
                      }} 
                    />
                  </OutputPreview>
                  <div style={{ padding: '0 16px 16px' }}>
                    <Button onClick={() => setActiveTab('playground')}>
                      <ChevronRightIcon style={{ transform: 'rotate(180deg)' }} />
                      {t('homepage.button.backToEditor', 'Back to Editor')}
                    </Button>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Quick Stats */}
            <Card $delay={0.2}>
              <CardHeader>
                <CardTitle>
                  <CubeTransparentIcon />
                  {t('homepage.features.title', 'Editor Features')}
                </CardTitle>
              </CardHeader>
              <CardContent $noPadding>
          <StatsGrid>
                  <StatCard $bg="rgba(124, 58, 237, 0.08)">
                    <StatNumber $color="#7C3AED">21+</StatNumber>
              <StatLabel>{t('homepage.stats.blockTools', 'Block Tools')}</StatLabel>
            </StatCard>
                  <StatCard $bg="rgba(236, 72, 153, 0.08)">
                    <StatNumber $color="#ec4899">6</StatNumber>
              <StatLabel>{t('homepage.stats.inlineTools', 'Inline Tools')}</StatLabel>
            </StatCard>
                  <StatCard $bg="rgba(34, 197, 94, 0.08)">
                    <StatNumber $color="#22c55e">✓</StatNumber>
                    <StatLabel>{t('homepage.stats.realtimeCollab', 'Realtime Collab')}</StatLabel>
            </StatCard>
                  <StatCard $bg="rgba(59, 130, 246, 0.08)">
                    <StatNumber $color="#3b82f6">v5</StatNumber>
              <StatLabel>{t('homepage.stats.strapiReady', 'Strapi Ready')}</StatLabel>
            </StatCard>
          </StatsGrid>
              </CardContent>
            </Card>
          </MainArea>

          {/* Sidebar */}
          <Sidebar>
            {/* Quick Links */}
            <Card $delay={0.25}>
              <CardHeader>
                <CardTitle>
                  <Cog6ToothIcon />
                  {t('homepage.quickLinks.title', 'Quick Access')}
                </CardTitle>
              </CardHeader>
              <CardContent $noPadding>
                <QuickLinksGrid>
                  <QuickLinkItem onClick={() => navigate('collaboration')}>
                    <QuickLinkIcon $color="linear-gradient(135deg, #7C3AED 0%, #6366f1 100%)">
                      <UserGroupIcon />
                    </QuickLinkIcon>
                    <QuickLinkInfo>
                      <h4>{t('homepage.quickLinks.collaboration', 'Collaboration')}</h4>
                      <p>{t('homepage.quickLinks.collaboration.desc', 'Manage users & permissions')}</p>
                    </QuickLinkInfo>
                    <QuickLinkArrow>
                      <ChevronRightIcon />
                    </QuickLinkArrow>
                  </QuickLinkItem>
                  
                  <QuickLinkItem onClick={() => window.open('https://editorjs.io/base-concepts/', '_blank')}>
                    <QuickLinkIcon $color="linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)">
                      <BookOpenIcon />
                    </QuickLinkIcon>
                    <QuickLinkInfo>
                      <h4>{t('homepage.quickLinks.docs', 'Editor.js Docs')}</h4>
                      <p>{t('homepage.quickLinks.docs.desc', 'Official documentation')}</p>
                    </QuickLinkInfo>
                    <QuickLinkArrow>
                      <ChevronRightIcon />
                    </QuickLinkArrow>
                  </QuickLinkItem>
                </QuickLinksGrid>
              </CardContent>
            </Card>

            {/* Tools Overview */}
            <Card $delay={0.3}>
              <CardHeader>
                <CardTitle>
                  <BookOpenIcon />
                  {t('homepage.tools.title', 'Available Tools')}
                </CardTitle>
              </CardHeader>
              <CardContent $noPadding>
                <ToolGrid>
                  {toolsData.map((tool, i) => (
                    <ToolItem key={i}>
                      <ToolIcon $color={tool.color}>
                        <tool.icon />
                      </ToolIcon>
                      <ToolInfo>
                        <h4>{tool.name}</h4>
                        <p>{tool.desc}</p>
                      </ToolInfo>
                    </ToolItem>
              ))}
                </ToolGrid>
              </CardContent>
            </Card>

            {/* Keyboard Shortcuts */}
            <Card $delay={0.4}>
              <CardHeader>
                <CardTitle>
            <CommandLineIcon />
                  {t('homepage.shortcuts.title', 'Keyboard Shortcuts')}
                </CardTitle>
              </CardHeader>
              <CardContent $noPadding>
                <ShortcutList>
                  {shortcuts.map((shortcut, i) => (
                    <ShortcutItem key={i}>
                <ShortcutLabel>{shortcut.label}</ShortcutLabel>
                      <ShortcutKeys>
                        {shortcut.keys.map((key, j) => (
                          <Kbd key={j}>{key}</Kbd>
            ))}
                      </ShortcutKeys>
                    </ShortcutItem>
                  ))}
                </ShortcutList>
              </CardContent>
            </Card>
          </Sidebar>
        </Grid>
      </Container>
    </PageWrapper>
  );
};

export default HomePage;
