import type { ReactNode } from "react";

type ToastResult = {
  id: string;
  dismiss: () => void;
  update: (_payload?: unknown) => void;
};

type ToastPromiseMessages = {
  loading?: ReactNode;
  success?: ReactNode | ((_value: unknown) => ReactNode);
  error?: ReactNode | ((_error: unknown) => ReactNode);
};

type ToastFn = {
  (message?: unknown, _options?: unknown): ToastResult;
  success: (message?: unknown, _options?: unknown) => ToastResult;
  error: (message?: unknown, _options?: unknown) => ToastResult;
  info: (message?: unknown, _options?: unknown) => ToastResult;
  warning: (message?: unknown, _options?: unknown) => ToastResult;
  loading: (message?: unknown, _options?: unknown) => ToastResult;
  promise: <T>(promise: Promise<T>, _messages?: ToastPromiseMessages) => Promise<T>;
  dismiss: (_id?: string) => void;
};

const createResult = (): ToastResult => ({
  id: "toast-disabled",
  dismiss: () => undefined,
  update: () => undefined,
});

const baseToast = ((_message?: unknown, _options?: unknown) => createResult()) as ToastFn;

baseToast.success = (_message?: unknown, _options?: unknown) => createResult();
baseToast.error = (_message?: unknown, _options?: unknown) => createResult();
baseToast.info = (_message?: unknown, _options?: unknown) => createResult();
baseToast.warning = (_message?: unknown, _options?: unknown) => createResult();
baseToast.loading = (_message?: unknown, _options?: unknown) => createResult();
baseToast.promise = <T,>(promise: Promise<T>, _messages?: ToastPromiseMessages) => promise;
baseToast.dismiss = (_id?: string) => undefined;

export const toast = baseToast;

export const Toaster = (_props: Record<string, unknown>) => null;
