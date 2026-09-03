"use client";

import dynamic from "next/dynamic";
import type { ComponentType, ReactNode } from "react";

import { AdminEmbeddedModuleShell } from "@/components/admin/AdminEmbeddedModuleShell";
import { AdminConsoleModuleSkeleton } from "@/components/admin/console/AdminConsoleModuleSkeleton";
import type { StoryboardInitialResult } from "@/lib/admin/storyboard/initial-result";
import {
  getAdminConsoleMenu,
  isAdminConsoleMenuId,
  type AdminConsoleMenuId,
} from "@/lib/admin/console-menu-registry";
import { CONSOLE_FIXED_MESSAGES } from "@/lib/admin/console-messages";
import { cn } from "@/lib/utils";
import type { DashboardSummaryResponse } from "@/types/dashboard";

export type AdminConsoleModulePanelStats = {
  pendingSubmissions: number | null;
  pendingReviews: number | null;
  pendingRestaurantSubmissions: number | null;
  pendingRecommendationRequests: number | null;
  pendingTotal: number | null;
  totalRestaurants: number | null;
  totalVideos: number | null;
  withCoordinates: number | null;
  activeBanners: number | null;
  inactiveBanners: number | null;
  latestRestaurantUpdate: string | null;
  dashboardVideos: DashboardSummaryResponse["videos"] | null;
};

export type AdminConsoleModulePanelProps = {
  stats?: AdminConsoleModulePanelStats;
  isLoading?: boolean;
  hasError?: boolean;
  isAdmin?: boolean;
  onSelectModule?: (moduleId: AdminConsoleMenuId) => void;
  initialStoryboardResult?: StoryboardInitialResult | null;
};

type AdminConsoleModulePanelComponent = ComponentType<AdminConsoleModulePanelProps>;

function ModulePanelFrame({
  menuId,
  children,
}: {
  menuId: AdminConsoleMenuId;
  children: ReactNode;
}) {
  const moduleTitle = getAdminConsoleMenu(menuId).title;
  return (
    <section
      aria-label={`${moduleTitle} 작업 화면`}
      className="flex min-h-full min-w-0 flex-col md:h-full md:min-h-0"
      data-admin-console-inline-module-frame="true"
      data-admin-console-inline-module-id={menuId}
    >
      <div
        className={cn(
          "min-h-[360px] flex-1 rounded-lg bg-background shadow-none md:min-h-0 md:rounded-xl md:border md:border-border md:shadow-sm",
          "overflow-visible md:overflow-hidden",
        )}
        data-admin-console-inline-module-panel="true"
      >
        {children}
      </div>
    </section>
  );
}

function loadAdminEvaluationModule() {
  return import("@/app/admin/evaluations/page").then(
    (module) => module.default.Embedded,
  );
}

function loadAdminBannerModule() {
  return import("@/app/admin/banners/page").then(
    (module) => module.default.Embedded,
  );
}

function loadAdminRestaurantRefreshHistoryModule() {
  return import("@/components/admin/AdminRestaurantRefreshHistoryPanel").then(
    (module) => module.AdminRestaurantRefreshHistoryPanel,
  );
}

function loadAdminUsersModule() {
  return import("@/components/admin/AdminUsersPanel");
}

function loadAdminStoryboardGenerator() {
  return import("@/components/admin/storyboard/AdminStoryboardGenerator").then(
    (module) => module.AdminStoryboardGenerator,
  );
}

function loadAdminYoutubeThumbnailGenerator() {
  return import(
    "@/components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator"
  ).then((module) => module.AdminYoutubeThumbnailGenerator);
}

function loadInsightsModule() {
  return import("@/app/insights/insights-client");
}

function loadAdminRouteRecommendationModule() {
  return import("@/components/admin/AdminOverviewDashboard").then(
    (module) => module.AdminOverviewDashboard,
  );
}

function loadAdminPipelineModule() {
  return import("@/components/admin/pipeline/AdminPipelineDashboard").then(
    (module) => module.AdminPipelineDashboard,
  );
}

function loadAdminOverviewCanvasPanel() {
  return import("@/components/admin/AdminConsoleOverview").then((module) => {
    const Panel = module.AdminOverviewCanvasPanel;
    return function AdminOverviewRegisteredPanel(
      props: AdminConsoleModulePanelProps,
    ) {
      return (
        <Panel
          stats={props.stats}
          isLoading={Boolean(props.isLoading)}
          hasError={Boolean(props.hasError)}
          isAdmin={Boolean(props.isAdmin)}
        />
      );
    };
  });
}

function loadAdminLlmWorkspacePanel() {
  return import("@/components/admin/AdminConsoleOverview").then(
    (module) => module.AdminLlmWorkspacePanel,
  );
}

function loadAdminAuditCanvasPanel() {
  return import("@/components/admin/AdminConsoleOverview").then(
    (module) => module.AdminAuditCanvasPanel,
  );
}

function loadAdminMapOverlayOperationsModule() {
  return import("@/components/admin/AdminConsoleOverview").then(
    (module) => module.AdminMapOverlayOperationsModule,
  );
}

const AdminEvaluationModule = dynamic(loadAdminEvaluationModule, {
  ssr: false,
  loading: () => <AdminConsoleModuleSkeleton menuId="restaurants" />,
});

const AdminBannerModule = dynamic(loadAdminBannerModule, {
  ssr: false,
  loading: () => <AdminConsoleModuleSkeleton menuId="banners" />,
});

const AdminRestaurantRefreshHistoryModule = dynamic(
  loadAdminRestaurantRefreshHistoryModule,
  {
    ssr: false,
    loading: () => (
      <AdminConsoleModuleSkeleton menuId="restaurant-refresh-history" />
    ),
  },
);

const AdminUsersModule = dynamic(loadAdminUsersModule, {
  ssr: false,
  loading: () => <AdminConsoleModuleSkeleton menuId="users" />,
});

const AdminStoryboardGenerator = dynamic(loadAdminStoryboardGenerator, {
  ssr: false,
  loading: () => <AdminConsoleModuleSkeleton menuId="storyboard" />,
});

const AdminYoutubeThumbnailGenerator = dynamic(
  loadAdminYoutubeThumbnailGenerator,
  {
    ssr: false,
    loading: () => (
      <AdminConsoleModuleSkeleton menuId="youtube-thumbnail-generator" />
    ),
  },
);

const InsightsModule = dynamic(loadInsightsModule, {
  ssr: false,
  loading: () => <AdminConsoleModuleSkeleton menuId="insights" />,
});

const AdminRouteRecommendationModule = dynamic(
  loadAdminRouteRecommendationModule,
  {
    ssr: false,
    loading: () => <AdminConsoleModuleSkeleton menuId="routes" />,
  },
);

const AdminOverviewPanel = dynamic(loadAdminOverviewCanvasPanel, {
  ssr: false,
  loading: () => <AdminConsoleModuleSkeleton menuId="overview" />,
});

const AdminLlmPanel = dynamic(loadAdminLlmWorkspacePanel, {
  ssr: false,
  loading: () => <AdminConsoleModuleSkeleton menuId="llm" />,
});

const AdminAuditPanel = dynamic(loadAdminAuditCanvasPanel, {
  ssr: false,
  loading: () => <AdminConsoleModuleSkeleton menuId="audit" />,
});

const AdminMapOverlaysPanel = dynamic(loadAdminMapOverlayOperationsModule, {
  ssr: false,
  loading: () => <AdminConsoleModuleSkeleton menuId="map-overlays" />,
});

const AdminPipelinePanel = dynamic(loadAdminPipelineModule, {
  ssr: false,
  loading: () => <AdminConsoleModuleSkeleton menuId="pipeline" />,
});

const AdminSubmissionsPanel = dynamic(loadAdminEvaluationModule, {
  ssr: false,
  loading: () => <AdminConsoleModuleSkeleton menuId="submissions" />,
});

const AdminReviewsPanel = dynamic(loadAdminEvaluationModule, {
  ssr: false,
  loading: () => <AdminConsoleModuleSkeleton menuId="reviews" />,
});

function AdminRestaurantsRegisteredPanel() {
  return (
    <ModulePanelFrame menuId="restaurants">
      <AdminEmbeddedModuleShell
        menuId="restaurants"
        contentClassName="overflow-y-auto"
      >
        <AdminEvaluationModule
          key="restaurants"
          embedded
          initialView="evaluations"
        />
      </AdminEmbeddedModuleShell>
    </ModulePanelFrame>
  );
}

function AdminSubmissionsRegisteredPanel() {
  return (
    <ModulePanelFrame menuId="submissions">
      <AdminEmbeddedModuleShell
        menuId="submissions"
        contentClassName="overflow-y-auto"
      >
        <AdminSubmissionsPanel
          key="submissions"
          embedded
          initialView="submissions"
          initialSubmissionTab="new"
        />
      </AdminEmbeddedModuleShell>
    </ModulePanelFrame>
  );
}

function AdminReviewsRegisteredPanel() {
  return (
    <ModulePanelFrame menuId="reviews">
      <AdminEmbeddedModuleShell
        menuId="reviews"
        contentClassName="overflow-y-auto"
      >
        <AdminReviewsPanel
          key="reviews"
          embedded
          initialView="submissions"
          initialSubmissionTab="reviews"
        />
      </AdminEmbeddedModuleShell>
    </ModulePanelFrame>
  );
}

function AdminRestaurantRefreshHistoryRegisteredPanel() {
  return (
    <ModulePanelFrame menuId="restaurant-refresh-history">
      <AdminEmbeddedModuleShell
        menuId="restaurant-refresh-history"
        contentClassName="overflow-y-auto"
      >
        <AdminRestaurantRefreshHistoryModule key="restaurant-refresh-history" />
      </AdminEmbeddedModuleShell>
    </ModulePanelFrame>
  );
}

function AdminInsightsRegisteredPanel() {
  return (
    <ModulePanelFrame menuId="insights">
      <InsightsModule key="admin-insights" embedded />
    </ModulePanelFrame>
  );
}

function AdminBannersRegisteredPanel() {
  return (
    <ModulePanelFrame menuId="banners">
      <AdminEmbeddedModuleShell
        menuId="banners"
        contentClassName="overflow-y-auto"
      >
        <AdminBannerModule key="admin-banners" embedded />
      </AdminEmbeddedModuleShell>
    </ModulePanelFrame>
  );
}

function AdminRoutesRegisteredPanel({
  stats,
  isLoading,
  hasError,
  onSelectModule,
}: AdminConsoleModulePanelProps) {
  return (
    <AdminEmbeddedModuleShell menuId="routes" contentClassName="overflow-hidden">
      <AdminRouteRecommendationModule
        stats={stats}
        isLoading={Boolean(isLoading)}
        hasError={Boolean(hasError)}
        onSelectModule={onSelectModule}
      />
    </AdminEmbeddedModuleShell>
  );
}

function AdminUsersRegisteredPanel() {
  return (
    <ModulePanelFrame menuId="users">
      <AdminEmbeddedModuleShell
        menuId="users"
        contentClassName="overflow-y-auto"
      >
        <AdminUsersModule key="admin-users" />
      </AdminEmbeddedModuleShell>
    </ModulePanelFrame>
  );
}

function AdminPipelineRegisteredPanel() {
  return (
    <ModulePanelFrame menuId="pipeline">
      <AdminEmbeddedModuleShell
        menuId="pipeline"
        contentClassName="overflow-y-auto"
      >
        <AdminPipelinePanel key="admin-pipeline" />
      </AdminEmbeddedModuleShell>
    </ModulePanelFrame>
  );
}

function AdminStoryboardRegisteredPanel({
  initialStoryboardResult,
}: AdminConsoleModulePanelProps) {
  return (
    <ModulePanelFrame menuId="storyboard">
      <AdminStoryboardGenerator
        key="admin-storyboard"
        initialStoryboardResult={initialStoryboardResult}
      />
    </ModulePanelFrame>
  );
}

function AdminYoutubeThumbnailRegisteredPanel() {
  return (
    <ModulePanelFrame menuId="youtube-thumbnail-generator">
      <AdminYoutubeThumbnailGenerator key="admin-youtube-thumbnail-generator" />
    </ModulePanelFrame>
  );
}

export const ADMIN_CONSOLE_MODULE_PANELS = {
  overview: AdminOverviewPanel,
  insights: AdminInsightsRegisteredPanel,
  llm: AdminLlmPanel,
  restaurants: AdminRestaurantsRegisteredPanel,
  "restaurant-refresh-history": AdminRestaurantRefreshHistoryRegisteredPanel,
  submissions: AdminSubmissionsRegisteredPanel,
  reviews: AdminReviewsRegisteredPanel,
  "map-overlays": AdminMapOverlaysPanel,
  banners: AdminBannersRegisteredPanel,
  routes: AdminRoutesRegisteredPanel,
  users: AdminUsersRegisteredPanel,
  pipeline: AdminPipelineRegisteredPanel,
  audit: AdminAuditPanel,
  storyboard: AdminStoryboardRegisteredPanel,
  "youtube-thumbnail-generator": AdminYoutubeThumbnailRegisteredPanel,
} as const satisfies Record<
  AdminConsoleMenuId,
  AdminConsoleModulePanelComponent
>;

export function resolveAdminConsoleModulePanel(
  menuId: string,
): AdminConsoleModulePanelComponent | null {
  if (!isAdminConsoleMenuId(menuId)) {
    return null;
  }
  return ADMIN_CONSOLE_MODULE_PANELS[menuId];
}

export function AdminConsoleRegisteredModulePanel({
  menuId,
  ...props
}: { menuId: string } & AdminConsoleModulePanelProps) {
  const Panel = resolveAdminConsoleModulePanel(menuId);
  if (!Panel) {
    return (
      <div role="alert" data-admin-module-panel-missing="true">
        {CONSOLE_FIXED_MESSAGES.modulePanelMissing}
      </div>
    );
  }
  return <Panel {...props} />;
}

export function preloadAdminConsoleModule(
  moduleId: AdminConsoleMenuId,
): Promise<unknown> {
  switch (moduleId) {
    case "overview":
      return loadAdminOverviewCanvasPanel();
    case "llm":
      return loadAdminLlmWorkspacePanel();
    case "audit":
      return loadAdminAuditCanvasPanel();
    case "map-overlays":
      return loadAdminMapOverlayOperationsModule();
    case "restaurants":
    case "submissions":
    case "reviews":
      return loadAdminEvaluationModule();
    case "restaurant-refresh-history":
      return loadAdminRestaurantRefreshHistoryModule();
    case "banners":
      return loadAdminBannerModule();
    case "storyboard":
      return loadAdminStoryboardGenerator();
    case "youtube-thumbnail-generator":
      return loadAdminYoutubeThumbnailGenerator();
    case "users":
      return loadAdminUsersModule();
    case "insights":
      return loadInsightsModule();
    case "pipeline":
      return loadAdminPipelineModule();
    case "routes":
      return loadAdminRouteRecommendationModule();
    default: {
      const exhaustiveModuleId: never = moduleId;
      return Promise.resolve(exhaustiveModuleId);
    }
  }
}
