import sanitizeHtml from 'sanitize-html';
import { stripUnsafeText } from './documentText';

type SanitizerOptions = NonNullable<Parameters<typeof sanitizeHtml>[1]>;

const EMAIL_ALLOWED_TAGS = sanitizeHtml.defaults.allowedTags.concat([
  'img',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'span',
  'div',
]);

const EMAIL_ALLOWED_ATTRIBUTES: SanitizerOptions['allowedAttributes'] = {
  ...sanitizeHtml.defaults.allowedAttributes,
  '*': ['class', 'style'],
  a: ['href', 'name', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  table: ['cellpadding', 'cellspacing', 'border', 'width'],
  td: ['colspan', 'rowspan', 'align', 'valign', 'width'],
  th: ['colspan', 'rowspan', 'align', 'valign', 'width'],
};

const EMAIL_ALLOWED_SCHEMES_BY_TAG: SanitizerOptions['allowedSchemesByTag'] = {
  a: ['http', 'https', 'mailto'],
  img: ['http', 'https', 'data'],
};

const EMAIL_ALLOWED_STYLES: SanitizerOptions['allowedStyles'] = {
  '*': {
    'color': [
      /^#(?:[0-9a-fA-F]{3}){1,2}$/,
      /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i,
      /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0(\.\d+)?|1)\s*\)$/i,
    ],
    'background-color': [
      /^#(?:[0-9a-fA-F]{3}){1,2}$/,
      /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i,
      /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0(\.\d+)?|1)\s*\)$/i,
    ],
    'font-size': [/^\d+(?:\.\d+)?(px|em|rem|%)$/],
    'text-align': [/^(left|right|center|justify)$/],
    'font-weight': [/^(normal|bold|[1-9]00)$/],
    'font-style': [/^(normal|italic|oblique)$/],
    'text-decoration': [/^(none|underline|line-through|overline)$/],
    'font-family': [/^[\w\s,"'-]+$/],
    'padding': [/^\d+(?:\.\d+)?(px|em|rem|%)$/],
    'padding-left': [/^\d+(?:\.\d+)?(px|em|rem|%)$/],
    'padding-right': [/^\d+(?:\.\d+)?(px|em|rem|%)$/],
    'padding-top': [/^\d+(?:\.\d+)?(px|em|rem|%)$/],
    'padding-bottom': [/^\d+(?:\.\d+)?(px|em|rem|%)$/],
    'margin': [/^\d+(?:\.\d+)?(px|em|rem|%)$/],
    'margin-left': [/^\d+(?:\.\d+)?(px|em|rem|%)$/],
    'margin-right': [/^\d+(?:\.\d+)?(px|em|rem|%)$/],
    'margin-top': [/^\d+(?:\.\d+)?(px|em|rem|%)$/],
    'margin-bottom': [/^\d+(?:\.\d+)?(px|em|rem|%)$/],
    'border': [/^\d+(?:\.\d+)?px\s+(solid|dashed|dotted)\s+#[0-9a-fA-F]{3,6}$/],
    'border-collapse': [/^(collapse|separate)$/],
    'width': [/^\d+(?:\.\d+)?(px|em|rem|%)$/],
    'max-width': [/^\d+(?:\.\d+)?(px|em|rem|%)$/],
  },
};

export const sanitizeEmailHtml = (input: unknown): string => {
  const raw = typeof input === 'string' ? input : String(input ?? '');
  if (!raw) {
    return '';
  }

  return sanitizeHtml(raw, {
    allowedTags: EMAIL_ALLOWED_TAGS,
    allowedAttributes: EMAIL_ALLOWED_ATTRIBUTES,
    allowedSchemesByTag: EMAIL_ALLOWED_SCHEMES_BY_TAG,
    allowedStyles: EMAIL_ALLOWED_STYLES,
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    },
  });
};

export const sanitizePlainText = (input: unknown): string => {
  const normalized = stripUnsafeText(input);
  if (!normalized) {
    return '';
  }

  return sanitizeHtml(normalized, { allowedTags: [], allowedAttributes: {} });
};
