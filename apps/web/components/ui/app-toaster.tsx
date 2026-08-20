'use client';

import { usePathname } from 'next/navigation';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';

const HOME_MAP_TOAST_VIEWPORT_CLASS_NAME =
  'top-auto bottom-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+env(safe-area-inset-bottom)+0.75rem)] sm:bottom-4';
const APP_MOBILE_TOAST_VIEWPORT_CLASS_NAME =
  'top-auto bottom-[calc(var(--mobile-bottom-nav-effective-height,var(--mobile-bottom-nav-height,60px))+env(safe-area-inset-bottom)+0.75rem)] sm:bottom-4';

const isHomeMapToastRoute = (pathname: string | null) => pathname === '/' || pathname === '/home-frame';

export function AppToaster() {
  const { toasts } = useToast();
  const pathname = usePathname();
  const toastViewportClassName = isHomeMapToastRoute(pathname)
    ? HOME_MAP_TOAST_VIEWPORT_CLASS_NAME
    : APP_MOBILE_TOAST_VIEWPORT_CLASS_NAME;

  return (
    <ToastProvider swipeDirection="right" duration={12000}>
      {toasts.map(({ id, title, description, action, ...props }) => (
        <Toast key={id} {...props}>
          <div className="min-w-0 flex-1 space-y-1">
            {title ? <ToastTitle>{title}</ToastTitle> : null}
            {description ? <ToastDescription>{description}</ToastDescription> : null}
          </div>
          {action}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport className={toastViewportClassName} />
    </ToastProvider>
  );
}
