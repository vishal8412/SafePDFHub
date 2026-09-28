export const SITE_CONFIG = {
  name: 'SafePDFHub',
  url: 'https://safepdfhub.com',
  logoUrl: 'https://safepdfhub.com/assets/brand/safepdfhub-logo-primary.svg',
  contactEmail: 'hello@safepdfhub.com',
  description: 'Privacy-first PDF tools that process documents locally in your browser.',
  staticIndexablePaths: [
    '/',
    '/support',
    '/about',
    '/contact',
    '/privacy',
    '/terms'
  ] as const
} as const;
