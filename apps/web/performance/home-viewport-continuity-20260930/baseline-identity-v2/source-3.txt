import React from 'react';

// Service contexts and lazy chrome are controlled inputs in this structural lab.
// No live session, provider SDK, navigation, or user payload is used here.
export const QueryProvider = ({ children }) => children;
export const LayoutProvider = QueryProvider;
export const AnonymousHomeAuthProvider = QueryProvider;
export const StaticNotificationProvider = QueryProvider;
export const HomeSessionProviderBridge = QueryProvider;
export const useAuth = () => ({ user: null, needsNicknameSetup: false, completeNicknameSetup() {} });
const queryClient = { removeQueries() {} };
export const useQueryClient = () => queryClient;
export const useDeferredComponent = () => null;
export const hasSupabaseAuthSessionHint = () => false;
export const isPublicRestrictedMode = false;
export const useHomeViewportMode = () => globalThis.__viewportMode;
export const AUTH_UI_REQUEST_EVENT = 'auth-ui-request';
export const HOME_AUTH_SESSION_UPDATED_EVENT = 'home-auth-session-updated';
export const AUTH_PRIVACY_ONBOARDING_REASON = 'privacy-onboarding';
export const readHomeAuthLoginRequestFromLocation = () => ({ requested: false, reason: null, nextPath: '/' });
export const APP_HEADER_HEIGHT_VAR = '--app-header-height';
export const MOBILE_SHEET_HEADER_OFFSET_VAR = '--mobile-sheet-header-offset';
export const MOBILE_SHEET_HEADER_PROGRESS_VAR = '--mobile-sheet-header-progress';
export const AppToaster = () => null;
export default function Chrome({ style }) {
    return <nav data-lab-chrome={style ? 'mobile' : 'desktop'} style={style} />;
}
