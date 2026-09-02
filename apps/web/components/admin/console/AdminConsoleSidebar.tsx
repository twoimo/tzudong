"use client";

import Image from "next/image";
import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  UserRound,
} from "lucide-react";

import { AdminConsoleSidebarOrderEditor } from "@/components/admin/console/AdminConsoleSidebarOrderEditor";
import { useAdminPendingBadges } from "@/components/admin/console/use-admin-pending-badges";
import { useAdminSidebarOrder } from "@/components/admin/console/use-admin-sidebar-order";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip as UiTooltip,
  TooltipContent as UiTooltipContent,
  TooltipProvider as UiTooltipProvider,
  TooltipTrigger as UiTooltipTrigger,
} from "@/components/ui/tooltip";
import type { AdminConsoleRouteModuleId } from "@/lib/admin/admin-module-routing";
import {
  ADMIN_CONSOLE_SECTION_LABELS,
  getAdminConsoleMenu,
  getAdminConsoleMenuIdsBySection,
  getAdminConsoleSection,
  type AdminConsoleMenuId,
  type AdminConsoleSectionLabel,
} from "@/lib/admin/console-menu-registry";
import { ADMIN_CONSOLE_MENU_ICONS } from "@/lib/admin/console-menu-icons";
import type { PendingBadgeState } from "@/lib/admin/console-pending-badges";
import {
  normalizeAdminSidebarOrder,
  type AdminSidebarOrderPreference,
} from "@/lib/admin/sidebar-order";
import { cn } from "@/lib/utils";

type AdminModuleId = AdminConsoleRouteModuleId;

const ADMIN_THEME_STORAGE_KEY = "tzudong-admin-theme";
const SIDEBAR_PURPOSE_REVEAL_DELAY_MS = 120;
const SIDEBAR_LANDMARK_NAME = "관리자 콘솔 사이드바";
const SIDEBAR_NAV_LANDMARK_NAME = "관리자 통합 메뉴";

type AdminThemePreference = "light" | "dark" | "system";

function getSystemThemePreference(): Exclude<AdminThemePreference, "system"> {
  if (typeof window === "undefined") return "light";

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyAdminThemePreference(theme: AdminThemePreference) {
  if (typeof document === "undefined") return;

  const resolvedTheme = theme === "system" ? getSystemThemePreference() : theme;
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
}

function normalizeAdminThemePreference(
  theme: string | null,
): AdminThemePreference {
  if (theme === "dark" || theme === "system") return theme;

  return "light";
}
const ADMIN_THEME_OPTIONS = [
  ["light", "라이트 모드", "다크모드", Sun],
  ["dark", "다크모드", "시스템 모드", Moon],
  ["system", "시스템 모드", "라이트 모드", Monitor],
] as const;

function getAdminThemeOption(theme: AdminThemePreference) {
  return (
    ADMIN_THEME_OPTIONS.find(([themeValue]) => themeValue === theme) ??
    ADMIN_THEME_OPTIONS[0]
  );
}

function getNextAdminThemePreference(theme: AdminThemePreference) {
  const currentIndex = ADMIN_THEME_OPTIONS.findIndex(
    ([themeValue]) => themeValue === theme,
  );
  const nextIndex =
    currentIndex < 0 ? 0 : (currentIndex + 1) % ADMIN_THEME_OPTIONS.length;

  return ADMIN_THEME_OPTIONS[nextIndex][0];
}

function getAdminThemeChangeLabel(themeLabel: string) {
  return `${themeLabel}${themeLabel.endsWith("모드") ? "로" : "으로"} 변경`;
}

type SidebarNavItem = {
  id: AdminConsoleMenuId;
  title: string;
  purpose: string;
  icon: (typeof ADMIN_CONSOLE_MENU_ICONS)[AdminConsoleMenuId];
};

type SidebarNavSection = {
  label: AdminConsoleSectionLabel;
  purpose: string;
  items: SidebarNavItem[];
};

function buildRegistrySidebarSections(): SidebarNavSection[] {
  return ADMIN_CONSOLE_SECTION_LABELS.map((label) => ({
    label,
    purpose: getAdminConsoleSection(label).purpose,
    items: getAdminConsoleMenuIdsBySection(label).map((id) => {
      const menu = getAdminConsoleMenu(id);
      return {
        id: menu.id,
        title: menu.title,
        purpose: menu.purpose,
        icon: ADMIN_CONSOLE_MENU_ICONS[menu.id],
      };
    }),
  }));
}

const REGISTRY_SIDEBAR_SECTIONS = buildRegistrySidebarSections();

function buildOrderedSidebarSections(
  order: AdminSidebarOrderPreference,
): SidebarNavSection[] {
  const normalized = normalizeAdminSidebarOrder(order);
  const sourceSections = new Map(
    REGISTRY_SIDEBAR_SECTIONS.map((section) => [section.label, section]),
  );

  return normalized.sections.flatMap((sectionLabel) => {
    const section = sourceSections.get(sectionLabel as AdminConsoleSectionLabel);
    if (!section) return [];

    const itemMap = new Map(section.items.map((item) => [item.id, item]));
    const orderedItems = (normalized.items[sectionLabel] ?? [])
      .map((itemId) => itemMap.get(itemId as AdminConsoleMenuId))
      .filter((item): item is SidebarNavItem => Boolean(item));

    return [{ ...section, items: orderedItems }];
  });
}

function getSidebarBadgeClassName(_sectionLabel: string, isActive: boolean) {
  return isActive ? "text-foreground/70" : "text-muted-foreground";
}

function describePendingBadge(title: string, badge: PendingBadgeState): string {
  if (badge.kind !== "shown") return title;
  const notes = [
    badge.partialAggregate ? "일부 집계" : null,
    badge.staleAggregate ? "지연" : null,
  ].filter((note): note is string => Boolean(note));
  if (notes.length === 0) return `${title} ${badge.accessibleText}`;
  return `${title} ${badge.accessibleText} ${notes.join(" ")}`;
}

export function AdminConsoleSidebar({
  activeModuleId,
  onSelectModule,
  isCollapsed,
  showLabels,
  onToggleCollapsed,
  showMobileHeader,
  canLoadPreferences,
  accountDisplayName,
  accountEmail,
}: {
  activeModuleId: AdminModuleId;
  onSelectModule: (moduleId: AdminModuleId) => void;
  isCollapsed: boolean;
  showLabels: boolean;
  onToggleCollapsed: () => void;
  showMobileHeader: boolean;
  canLoadPreferences: boolean;
  accountDisplayName: string;
  accountEmail: string;
}) {
  const sidebarOrderState = useAdminSidebarOrder(canLoadPreferences);
  const pendingBadges = useAdminPendingBadges(canLoadPreferences);
  const sidebarOrder = sidebarOrderState.order;
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const mobileHeaderRef = useRef<HTMLDivElement | null>(null);
  const orderedSidebarSections = useMemo(
    () => buildOrderedSidebarSections(sidebarOrder),
    [sidebarOrder],
  );
  const activeSidebarItem = orderedSidebarSections
    .flatMap((section) => section.items)
    .find((item) => item.id === activeModuleId);
  const activeSidebarLabel =
    activeSidebarItem?.title ?? getAdminConsoleMenu("overview").title;
  const [describedMenuKey, setDescribedMenuKey] = useState<string | null>(null);
  const purposeRevealTimerRef = useRef<number | null>(null);

  const clearPurposeReveal = useCallback(() => {
    if (purposeRevealTimerRef.current != null) {
      window.clearTimeout(purposeRevealTimerRef.current);
      purposeRevealTimerRef.current = null;
    }
    setDescribedMenuKey(null);
  }, []);

  const schedulePurposeReveal = useCallback((menuKey: string) => {
    if (purposeRevealTimerRef.current != null) {
      window.clearTimeout(purposeRevealTimerRef.current);
    }
    purposeRevealTimerRef.current = window.setTimeout(() => {
      setDescribedMenuKey(menuKey);
      purposeRevealTimerRef.current = null;
    }, SIDEBAR_PURPOSE_REVEAL_DELAY_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (purposeRevealTimerRef.current != null) {
        window.clearTimeout(purposeRevealTimerRef.current);
      }
    };
  }, []);

  const [themePreference, setThemePreference] =
    useState<AdminThemePreference>("light");

  useEffect(() => {
    const initialTheme = normalizeAdminThemePreference(
      window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY),
    );
    setThemePreference(initialTheme);
    applyAdminThemePreference(initialTheme);
  }, []);

  useEffect(() => {
    if (themePreference !== "system") return;

    const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => applyAdminThemePreference("system");

    systemThemeQuery.addEventListener("change", syncSystemTheme);

    return () => {
      systemThemeQuery.removeEventListener("change", syncSystemTheme);
    };
  }, [themePreference]);

  const updateThemePreference = useCallback(
    (nextTheme: AdminThemePreference) => {
      setThemePreference(nextTheme);
      window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, nextTheme);
      applyAdminThemePreference(nextTheme);
    },
    [],
  );

  const handleMenuNavigation = (moduleId: AdminModuleId) => {
    onSelectModule(moduleId);
    setIsAdminMenuOpen(false);
  };

  useEffect(() => {
    if (!showMobileHeader) {
      setIsAdminMenuOpen(false);
    }
  }, [showMobileHeader]);
  useEffect(() => {
    const element = mobileHeaderRef.current;
    if (!element) return;

    element.setAttribute(
      "data-admin-console-mobile-header-visible",
      showMobileHeader ? "true" : "false",
    );
    element.style.transform = showMobileHeader
      ? "translate3d(0, 0, 0)"
      : "translate3d(0, -120%, 0)";
    element.style.pointerEvents = showMobileHeader ? "" : "none";
  }, [showMobileHeader]);


  const renderMenuItem = (
    item: SidebarNavItem,
    section: SidebarNavSection,
    mode: "dropdown" | "sidebar",
  ) => {
    const Icon = item.icon;
    const isActive = activeModuleId === item.id;
    const isDropdown = mode === "dropdown";
    const collapsedRail = !isDropdown && isCollapsed;
    const pendingBadge = pendingBadges.getBadge(item.id, collapsedRail);
    const menuKey = `${mode}-${item.id}`;
    const purposeId = `admin-console-menu-purpose-${menuKey}`;
    const isPurposeDescribed = describedMenuKey === menuKey;
    const button = (
      <button
        type="button"
        aria-label={describePendingBadge(item.title, pendingBadge)}
        aria-current={isActive ? "page" : undefined}
        aria-controls="admin-console-canvas"
        aria-describedby={isPurposeDescribed ? purposeId : undefined}
        data-admin-console-menu-item-mode={isDropdown ? "mobile-dropdown" : "desktop-sidebar"}
        data-admin-console-menu-item-state={isActive ? "active" : "inactive"}
        className={cn(
          "group relative flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap border text-left transition touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
          isDropdown
            ? "min-h-9 w-full rounded-lg px-2 py-1.5 text-[13px]"
            : "min-h-9 w-full rounded-lg px-2 py-1 text-sm",
          !isDropdown &&
            isCollapsed &&
            "md:mx-auto md:h-8 md:min-h-8 md:w-8 md:justify-center md:gap-0 md:px-0",
          isActive
            ? "border-border bg-muted text-foreground"
            : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/70 hover:text-foreground",
        )}
        onFocus={() => schedulePurposeReveal(menuKey)}
        onBlur={clearPurposeReveal}
        onPointerEnter={() => schedulePurposeReveal(menuKey)}
        onPointerLeave={clearPurposeReveal}
        onClick={() =>
          isDropdown ? handleMenuNavigation(item.id) : onSelectModule(item.id)
        }
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center border transition-colors motion-reduce:transition-none",
            isDropdown ? "h-6 w-6 rounded-md" : "h-6 w-6 rounded-md",
            isActive
              ? "border-border bg-background text-foreground"
              : "border-border bg-background/80 text-muted-foreground group-hover:border-border group-hover:text-foreground",
          )}
          aria-hidden="true"
        >
          <Icon className={cn(isDropdown ? "h-3.5 w-3.5" : "h-3.5 w-3.5")} />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-opacity duration-100 motion-reduce:transition-none",
            !isDropdown &&
              (!showLabels || isCollapsed) &&
              "md:hidden md:w-0 md:flex-none md:opacity-0",
          )}
        >
          <span className="block truncate font-semibold leading-5">
            {item.title}
          </span>
        </span>
        <span id={purposeId} className="sr-only">
          {item.purpose}
        </span>
        {pendingBadge.kind === "shown" ? (
          <span
            className={cn(
              "ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold leading-4 transition-all duration-100 motion-reduce:transition-none",
              getSidebarBadgeClassName(section.label, isActive),
              "border-border bg-muted/80",
              pendingBadge.dotOnly &&
                "md:absolute md:right-1 md:top-1 md:h-2 md:w-2 md:border-0 md:p-0 md:text-[0px]",
              !isDropdown &&
                (!showLabels || isCollapsed) &&
                "md:absolute md:right-1 md:top-1 md:h-2 md:w-2 md:border-0 md:p-0 md:text-[0px]",
            )}
            data-admin-sidebar-badge-tone={section.label}
            data-admin-sidebar-badge-partial={
              pendingBadge.partialAggregate ? "true" : "false"
            }
            data-admin-sidebar-badge-stale={
              pendingBadge.staleAggregate ? "true" : "false"
            }
            aria-hidden="true"
          >
            {pendingBadge.displayText}
          </span>
        ) : null}
      </button>
    );

    if (mode === "sidebar" && isCollapsed) {
      return (
        <UiTooltipProvider key={item.id} delayDuration={120}>
          <UiTooltip>
            <UiTooltipTrigger asChild>{button}</UiTooltipTrigger>
            <UiTooltipContent
              side="right"
              align="center"
              className="max-w-[14rem] px-2 py-1.5 text-xs"
              data-admin-sidebar-collapsed-tooltip="true"
            >
              <span className="block font-semibold">{item.title}</span>
              <span className="mt-0.5 block text-muted-foreground">
                {item.purpose}
              </span>
            </UiTooltipContent>
          </UiTooltip>
        </UiTooltipProvider>
      );
    }

    return <Fragment key={item.id}>{button}</Fragment>;
  };


  const renderThemeControls = (
    placement: "dropdown" | "sidebar",
    options: { compact?: boolean } = {},
  ) => {
    const isSidebarPlacement = placement === "sidebar";
    const isCompactSidebar =
      options.compact ?? (isSidebarPlacement && isCollapsed);
    const [currentTheme, currentThemeLabel, nextThemeLabel, ThemeIcon] =
      getAdminThemeOption(themePreference);
    const nextTheme = getNextAdminThemePreference(themePreference);
    const controlLabel = `${currentThemeLabel} 사용 중 · 클릭하면 ${getAdminThemeChangeLabel(nextThemeLabel)}`;

    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          "h-9 rounded-full border border-border bg-card text-xs font-bold text-muted-foreground shadow-inner transition-[background-color,color,box-shadow,transform] duration-150 hover:bg-muted/70 hover:text-foreground focus-visible:ring-primary focus-visible:ring-offset-background dark:border-border/70 dark:bg-muted/35 dark:text-foreground dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] dark:hover:bg-muted/55 data-[admin-sidebar-theme-current=dark]:border-border/70 data-[admin-sidebar-theme-current=dark]:bg-muted/35 data-[admin-sidebar-theme-current=dark]:text-foreground data-[admin-sidebar-theme-current=dark]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] data-[admin-sidebar-theme-current=dark]:hover:bg-muted/55",
          isCompactSidebar
            ? "w-9 justify-center p-0"
            : "w-full min-w-0 justify-start gap-2 px-3",
        )}
        aria-label={controlLabel}
        title={controlLabel}
        data-admin-sidebar-theme-toggle="true"
        data-admin-sidebar-theme-cycle="single-button"
        data-admin-sidebar-theme-current={currentTheme}
        data-admin-sidebar-preference-placement={placement}
        data-admin-sidebar-theme-layout={placement}
        onClick={() => updateThemePreference(nextTheme)}
      >
        <ThemeIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className={cn("min-w-0 truncate", isCompactSidebar && "sr-only")}>
          {currentThemeLabel}
        </span>
        <span
          className={cn(
            "ml-auto shrink-0 text-[10px] font-semibold text-muted-foreground",
            isCompactSidebar && "sr-only",
          )}
          aria-hidden="true"
        >
          다음: {nextThemeLabel}
        </span>
      </Button>
    );
  };

  const renderAdminMenuContent = (contentId: string) => (
    <PopoverContent
      id={contentId}
      align="end"
      sideOffset={10}
      className="scrollbar-hide max-h-[min(720px,calc(100dvh-20px))] w-[min(23rem,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-xl border-border bg-card p-2 shadow-primary"
      style={{ maxHeight: "min(720px, calc(100dvh - 20px))" }}
      aria-label="관리자 콘솔 메뉴"
      data-admin-console-menu-dropdown="true"
    >
      <div className="mb-2 flex items-center gap-2 rounded-xl bg-muted/35 p-2">
        <Link
          href="/"
          className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background"
          aria-label="쯔동여지도 홈으로 이동"
          onClick={() => setIsAdminMenuOpen(false)}
        >
          <Image
            src="/logo.webp"
            alt=""
            aria-hidden="true"
            width={32}
            height={32}
            className="h-7 w-7 rounded-lg object-contain"
            priority
          />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold text-foreground">
            관리자 콘솔
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            현재 화면 · {activeSidebarLabel}
          </p>
        </div>
      </div>

      <nav className="grid gap-1.5" aria-label={SIDEBAR_NAV_LANDMARK_NAME}>
        {orderedSidebarSections.map((section) => (
          <div key={section.label} className="min-w-0 rounded-xl bg-background/45 p-1">
            <p className="px-1.5 pb-1 text-[10px] font-extrabold tracking-[0.08em] text-muted-foreground">
              {section.label}
            </p>
            {section.items.map((item) =>
              renderMenuItem(item, section, "dropdown"),
            )}
          </div>
        ))}
      </nav>

      <div className="mt-2">{renderThemeControls("dropdown")}</div>

      <div className="mt-2"><AdminConsoleSidebarOrderEditor placement="dropdown" orderState={sidebarOrderState} /></div>
    </PopoverContent>
  );
  const sidebarAccountAvatarClassName =
    "relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/10 text-primary transition-colors group-hover/sidebar-account:bg-primary/15";
  const sidebarAccountAvatarIconClassName = "h-5 w-5 -translate-y-px";

  const renderSidebarAccountMenuContent = (contentId: string) => (
    <PopoverContent
      id={contentId}
      side="right"
      align="end"
      sideOffset={10}
      className="max-h-[min(760px,calc(100dvh-24px))] w-[min(24rem,calc(100vw-24px))] overflow-y-auto rounded-2xl border-border bg-card p-2.5 shadow-primary"
      aria-label="계정 및 사이드바 설정"
      data-admin-sidebar-account-menu-content="true"
    >
      <div
        className="mb-3 flex items-center gap-2 rounded-2xl bg-muted/35 p-2"
        data-admin-sidebar-account-summary="true"
      >
        <span
          className={sidebarAccountAvatarClassName}
          aria-hidden="true"
          data-admin-sidebar-account-avatar="true"
        >
          <UserRound className={sidebarAccountAvatarIconClassName} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold text-foreground">
            {accountDisplayName}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {accountEmail}
          </p>
        </div>
      </div>

      <div className="space-y-2" data-admin-sidebar-account-theme-section="true">
        <p className="px-1 text-[11px] font-bold tracking-[0.08em] text-muted-foreground">
          표시 모드
        </p>
        {renderThemeControls("sidebar", { compact: false })}
      </div>

      <div
        className="mt-3 border-t border-border/60 pt-3"
        data-admin-sidebar-account-order-section="true"
      >
        <AdminConsoleSidebarOrderEditor placement="sidebar" orderState={sidebarOrderState} />
      </div>
    </PopoverContent>
  );

  const renderSidebarAccountMenu = () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "group/sidebar-account transition-colors duration-150 focus-visible:ring-primary focus-visible:ring-offset-background",
            isCollapsed
              ? "grid h-9 w-9 place-items-center rounded-xl bg-transparent p-0 text-muted-foreground shadow-none hover:bg-background/80 hover:text-foreground dark:hover:bg-muted/55"
              : "h-11 w-full min-w-0 justify-start gap-2 rounded-2xl border border-border bg-background/95 px-1.5 py-1 text-foreground shadow-sm backdrop-blur-sm hover:bg-secondary/80 hover:text-accent-foreground dark:border-border/70 dark:bg-background/80",
          )}
          aria-label={`${accountDisplayName} 계정 및 사이드바 설정 열기`}
          data-admin-sidebar-account-trigger={isCollapsed ? "collapsed" : "expanded"}
          data-admin-sidebar-account-chrome="integrated"
        >
          <span
            className={sidebarAccountAvatarClassName}
            aria-hidden="true"
            data-admin-sidebar-account-avatar="true"
          >
            <UserRound className={sidebarAccountAvatarIconClassName} aria-hidden="true" />
          </span>
          <span className={cn("min-w-0 flex-1 text-left", isCollapsed && "sr-only")}>
            <span className="block truncate text-xs font-extrabold text-foreground">
              {accountDisplayName}
            </span>
            <span className="block truncate text-[10px] font-semibold text-muted-foreground">
              계정·표시·메뉴 설정
            </span>
          </span>
        </Button>
      </PopoverTrigger>
      {renderSidebarAccountMenuContent("admin-sidebar-account-menu")}
    </Popover>
  );

  return (
    <>
      <Popover open={isAdminMenuOpen} onOpenChange={setIsAdminMenuOpen}>
        <div
          ref={mobileHeaderRef}
          className={cn(
            "flex h-14 shrink-0 transform-gpu items-center gap-2 overflow-hidden border-b border-border bg-card/95 px-3 py-2 shadow-sm transition-[transform,border-color] duration-300 ease-out will-change-transform motion-reduce:transition-none md:hidden",
            !showMobileHeader && "pointer-events-none border-transparent",
          )}
          style={{
            transform: showMobileHeader
              ? "translate3d(0, 0, 0)"
              : "translate3d(0, -120%, 0)",
          }}
          data-admin-console-mobile-header="true"
          data-admin-console-mobile-header-visible={
            showMobileHeader ? "true" : "false"
          }
        >
          <Link
            href="/"
            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background text-foreground"
            aria-label="쯔동여지도 홈으로 이동"
          >
            <Image
              src="/logo.webp"
              alt=""
              aria-hidden="true"
              width={32}
              height={32}
              className="h-7 w-7 rounded-lg object-contain"
              priority
            />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold text-foreground">
              관리자 콘솔
            </p>
            <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
              현재 화면 · {activeSidebarLabel}
            </p>
          </div>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 w-11 shrink-0 rounded-lg bg-transparent p-0 shadow-none hover:bg-muted/70 focus-visible:ring-primary focus-visible:ring-offset-background"
              aria-label="관리자 메뉴 열기"
              aria-expanded={isAdminMenuOpen}
              aria-controls="admin-console-menu-dropdown"
              data-admin-console-menu-trigger="hamburger"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
        </div>
        {renderAdminMenuContent("admin-console-menu-dropdown")}
      </Popover>

      <aside
        className={cn(
          "relative z-30 hidden h-full min-h-0 w-max shrink-0 flex-col overflow-hidden border-r border-border bg-gradient-to-b from-card via-card to-background/95 p-2 font-sans tracking-normal shadow-sm transition-[width,padding] duration-300 motion-reduce:transition-none md:flex",
          isCollapsed
            ? "md:w-[4.5rem] md:min-w-[4.5rem] md:max-w-[4.5rem] md:items-center md:px-1.5"
            : "md:min-w-[var(--admin-sidebar-expanded-width)] md:max-w-[var(--admin-sidebar-expanded-max-width)]",
        )}
        aria-label={SIDEBAR_LANDMARK_NAME}
        data-admin-left-panel-expanded={isCollapsed ? "false" : "true"}
        data-admin-sidebar-scroll="hidden-scrollbar"
        data-layout-primitives="fixed-sidenav-shell scroll-body-shell sidebar"
      >
        <div
          className={cn(
            "mb-1.5 flex min-h-9 items-center gap-2 border-b border-border/70 px-1 pb-1.5 transition-[border-color] duration-200 motion-reduce:transition-none",
            isCollapsed &&
              "md:h-[3.5625rem] md:min-h-[3.5625rem] md:w-[3.5625rem] md:items-center md:justify-center md:px-0 md:py-0",
          )}
          data-admin-sidebar-header="true"
        >
          <Link
            href="/"
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-transparent text-foreground transition hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
              isCollapsed && "md:hidden",
            )}
            aria-label="쯔동여지도 홈으로 이동"
          >
            <Image
              src="/logo.webp"
              alt=""
              aria-hidden="true"
              width={32}
              height={32}
              className="h-7 w-7 rounded-lg object-contain"
              priority
            />
          </Link>
          <div
            className={cn(
              "min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-opacity duration-100 motion-reduce:transition-none",
              (!showLabels || isCollapsed) && "md:hidden",
            )}
            data-admin-sidebar-header-copy="true"
          >
            <h2 className="truncate whitespace-nowrap text-sm font-bold tracking-normal text-foreground text-pretty">
              관리자 콘솔
            </h2>
            <p className="mt-0.5 whitespace-nowrap text-[11px] leading-4 text-muted-foreground">
              현재 화면 · {activeSidebarLabel}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "group relative ml-auto inline-flex h-8 w-8 shrink-0 overflow-hidden rounded-xl bg-transparent p-0 text-muted-foreground shadow-none transition-colors hover:bg-background/80 hover:text-foreground focus-visible:ring-primary focus-visible:ring-offset-background dark:hover:bg-muted/55",
              isCollapsed && "md:m-0",
            )}
            aria-label={
              isCollapsed ? "관리자 사이드바 펼치기" : "관리자 사이드바 접기"
            }
            aria-expanded={!isCollapsed}
            aria-controls="admin-console-menu"
            data-admin-sidebar-collapse-toggle="true"
            data-admin-sidebar-collapse-logo-mode={
              isCollapsed ? "logo-hover-open-icon" : "icon"
            }
            data-admin-sidebar-collapse-visibility={
              isCollapsed ? "logo-hover" : "always-visible"
            }
            onClick={onToggleCollapsed}
          >
            {isCollapsed ? (
              <>
                <span
                  className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-100 transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0 motion-reduce:transition-none"
                  aria-hidden="true"
                  data-admin-sidebar-collapsed-logo="true"
                >
                  <Image
                    src="/logo.webp"
                    alt=""
                    width={28}
                    height={28}
                    sizes="28px"
                    className="h-7 w-7 rounded-lg object-contain"
                    priority
                  />
                </span>
                <PanelLeftOpen
                  className="relative z-10 h-5 w-5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
                  aria-hidden="true"
                  data-admin-sidebar-collapsed-open-icon="true"
                />
              </>
            ) : (
              <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
            )}
          </Button>
        </div>

        <div
          className={cn(
            "scrollbar-hide min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-4 pt-2",
            isCollapsed && "md:w-full",
          )}
          data-admin-sidebar-menu-scroll="hidden-scrollbar"
        >
          <nav
            id="admin-console-menu"
            aria-label={SIDEBAR_NAV_LANDMARK_NAME}
            className={cn(
              "block space-y-3",
              isCollapsed && "md:flex md:w-full md:flex-col md:items-center",
            )}
            data-admin-sidebar-section-list="spacious"
          >
            {orderedSidebarSections.map((section) => (
              <div
                key={section.label}
                className={cn(
                  "block space-y-1.5",
                  isCollapsed &&
                    "md:flex md:w-full md:flex-col md:items-center",
                )}
              >
                <p
                  className={cn(
                    "px-2.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground transition-opacity duration-100 motion-reduce:transition-none",
                    (!showLabels || isCollapsed) &&
                      "md:h-px md:px-0 md:opacity-0",
                  )}
                >
                  {section.label}
                </p>
                {section.items.map((item) =>
                  renderMenuItem(item, section, "sidebar"),
                )}
              </div>
            ))}
          </nav>
        </div>

        <div
          className={cn(
            "shrink-0 pt-4",
            isCollapsed
              ? "flex w-full flex-col items-center gap-2 pb-1"
              : "space-y-3",
          )}
          data-admin-sidebar-footer-actions="true"
          aria-label="관리자 사이드바 설정"
        >
          {renderSidebarAccountMenu()}
        </div>
      </aside>
    </>
  );
}
