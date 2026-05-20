import { createElement, type ReactElement, type ReactNode } from "react";
import { toast as appToast } from "@/hooks/use-toast";
import { AppToaster } from "@/components/ui/app-toaster";

type ToastResult = {
  id: string;
  dismiss: () => void;
  update: (_payload?: unknown) => void;
};

type ToastOptions = {
  title?: ReactNode;
  description?: ReactNode;
  variant?: "default" | "destructive";
};

type ToastPromiseMessages = {
  loading?: ReactNode;
  success?: ReactNode | ((_value: unknown) => ReactNode);
  error?: ReactNode | ((_error: unknown) => ReactNode);
};

type ToastFn = {
  (message?: unknown, options?: ToastOptions): ToastResult;
  success: (message?: unknown, options?: ToastOptions) => ToastResult;
  error: (message?: unknown, options?: ToastOptions) => ToastResult;
  info: (message?: unknown, options?: ToastOptions) => ToastResult;
  warning: (message?: unknown, options?: ToastOptions) => ToastResult;
  loading: (message?: unknown, options?: ToastOptions) => ToastResult;
  promise: <T>(promise: Promise<T>, messages?: ToastPromiseMessages) => Promise<T>;
  dismiss: (_id?: string) => void;
};

const isToastOptions = (value: unknown): value is ToastOptions => {
  return Boolean(value && typeof value === "object" && ("title" in value || "description" in value || "variant" in value));
};

const toToastOptions = (message?: unknown, options: ToastOptions = {}, variant?: "default" | "destructive"): ToastOptions => {
  if (isToastOptions(message)) {
    return { ...message, ...options, variant: options.variant ?? variant ?? message.variant };
  }

  return {
    ...options,
    title: options.title ?? (message as ReactNode),
    variant: options.variant ?? variant,
  };
};

const showToast = (message?: unknown, options?: ToastOptions, variant?: "default" | "destructive") => {
  return appToast(toToastOptions(message, options, variant) as Parameters<typeof appToast>[0]) as ToastResult;
};

const baseToast = ((message?: unknown, options?: ToastOptions) => showToast(message, options)) as ToastFn;

baseToast.success = (message?: unknown, options?: ToastOptions) => showToast(message, options);
baseToast.error = (message?: unknown, options?: ToastOptions) => showToast(message, options, "destructive");
baseToast.info = (message?: unknown, options?: ToastOptions) => showToast(message, options);
baseToast.warning = (message?: unknown, options?: ToastOptions) => showToast(message, options);
baseToast.loading = (message?: unknown, options?: ToastOptions) => showToast(message, options);
baseToast.promise = async <T,>(promise: Promise<T>, messages?: ToastPromiseMessages) => {
  if (messages?.loading) {
    showToast(messages.loading);
  }

  try {
    const value = await promise;
    const successMessage = typeof messages?.success === "function" ? messages.success(value) : messages?.success;
    if (successMessage) {
      showToast(successMessage);
    }
    return value;
  } catch (error) {
    const errorMessage = typeof messages?.error === "function" ? messages.error(error) : messages?.error;
    if (errorMessage) {
      showToast(errorMessage, undefined, "destructive");
    }
    throw error;
  }
};
baseToast.dismiss = (_id?: string) => undefined;

export const toast = baseToast;

export const Toaster = (_props: Record<string, unknown>): ReactElement => createElement(AppToaster);
