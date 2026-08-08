import { expect, test as base } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

type NightlyFixtures = {
  isMobile: boolean;
};

export const test = base.extend<NightlyFixtures>({
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callbacks use a non-React `use` function.
  isMobile: async ({}, useIsMobile, testInfo) => {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture callbacks use a non-React `use` function.
    await useIsMobile(testInfo.project.use.isMobile === true);
  },
});

export { expect };
export type { Page, TestInfo };
