export const siteConfig = {
  name: '쯔동여지도',
  productionUrl: (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.tzudong.app').replace(/\/$/, ''),
  contact: {
    email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'cs@tzudong.app',
    mailtoSubject: '쯔동여지도 문의',
  },
  operator: {
    companyName: process.env.NEXT_PUBLIC_OPERATOR_COMPANY_NAME || '타이니번 데이터랩',
    representative: process.env.NEXT_PUBLIC_OPERATOR_REPRESENTATIVE || '최연우',
    businessRegistrationNumber:
      process.env.NEXT_PUBLIC_OPERATOR_BUSINESS_REGISTRATION_NUMBER || '601-09-04613',
    copyrightLabel: process.env.NEXT_PUBLIC_COPYRIGHT_LABEL || 'v1.2.0 © Tzudong Map',
  },
  legal: {
    privacyPath: '/privacy',
    dataDeletionPath: '/data-deletion',
    myPageProfilePath: '/mypage/profile',
  },
} as const;

export const supportMailto = (subject: string = siteConfig.contact.mailtoSubject) =>
  `mailto:${siteConfig.contact.email}?subject=${encodeURIComponent(subject)}`;
