import { useMemo } from 'react';
import styled from 'styled-components';
import { Box, Typography } from '@strapi/design-system';
import { sanitizeSvg, sanitizeTemplate } from '../../editor/sanitize';
import { fillTemplate } from './blockForm.mjs';

const IconFrame = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.2rem;
  height: 3.2rem;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral0};

  svg {
    width: 2rem;
    height: 2rem;
  }
`;

const TemplateFrame = styled(Box)`
  overflow-wrap: anywhere;
  color: ${({ theme }) => theme.colors.neutral800};
  font-size: ${({ theme }) => theme.fontSizes[2]};

  img {
    max-width: 100%;
    height: auto;
  }
`;

/**
 * Live preview of an SVG icon. The markup is sanitised with DOMPurify
 * (SVG profile, no scripts, styles or links) before it is rendered.
 * @param {{ svg: string, label: string }} props - SVG and accessible label.
 * @returns {JSX.Element} Preview.
 */
export const IconPreview = ({ svg, label }) => {
  const clean = useMemo(() => sanitizeSvg(svg), [svg]);
  return <IconFrame role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: clean }} />;
};

/**
 * Live preview of a simple block template with sample values.
 * @param {{ template: string, fields: Array<object>, label: string, empty: string }} props - Template and labels.
 * @returns {JSX.Element} Preview.
 */
export const TemplatePreview = ({ template, fields, label, empty }) => {
  const clean = useMemo(() => sanitizeTemplate(fillTemplate(template, fields)), [template, fields]);
  return (
    <Box>
      <Typography variant="sigma" textColor="neutral600" tag="p">
        {label}
      </Typography>
      <TemplateFrame marginTop={2} padding={4} hasRadius borderColor="neutral200" background="neutral100">
        {clean ? (
          // sanitised template HTML from sanitizeTemplate (DOMPurify)
          <div dangerouslySetInnerHTML={{ __html: clean }} />
        ) : (
          <Typography variant="pi" textColor="neutral600">
            {empty}
          </Typography>
        )}
      </TemplateFrame>
    </Box>
  );
};
