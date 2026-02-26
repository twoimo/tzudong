import { test as setup, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { hidePopupOverlay } from '../helpers';

const authFile = path.join(__dirname, '..', '.auth', 'admin.json');

setup('authenticate admin', async ({ page }) => {
    const email = process.env.E2E_ADMIN_EMAIL;
    const password = process.env.E2E_ADMIN_PASSWORD;

    const authDir = path.dirname(authFile);
    fs.mkdirSync(authDir, { recursive: true });

    if (!email || !password) {
        await page.context().storageState({ path: authFile });
        return;
    }

    await page.goto('/');
    await hidePopupOverlay(page);

    const loginButton = page.getByRole('button', { name: /로그인/i }).first();
    await expect(loginButton).toBeVisible({ timeout: 10000 });
    await loginButton.click();

    const emailInput = page.locator('input[type="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();

    await emailInput.fill(email);
    await passwordInput.fill(password);

    await page.getByRole('button', { name: /로그인|login/i }).first().click();

    await expect(page.getByRole('button', { name: /로그인/i })).toHaveCount(0, { timeout: 15000 });
    await page.context().storageState({ path: authFile });
});
