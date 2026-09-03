"use client";

import dynamic from "next/dynamic";
import type { ComponentType, ReactNode } from "react";

import { AdminEmbeddedModuleShell } from "@/components/admin/AdminEmbeddedModuleShell";
import { AdminConsoleModuleCompleteness } from "@/components/admin/console/AdminConsoleModuleCompleteness";
import { RiskyWorkProcedureSteps } from "@/components/admin/console/RiskyWorkProcedureSteps";
import { isRiskyWorkMenuId } from "@/lib/admin/risky-work-procedure";
import type { StoryboardInitialResult } from "@/lib/admin/storyboard/initial-result";
import {
  getAdminConsoleMenu,
  isAdminConsoleMenuId,
  type AdminConsoleMenuId,
} from "@/lib/admin/console-menu-registry";
import {
  isAdminConsoleCanvasStatsEmpty,
  pickHighestPendingAdminConsoleMenu,
  resolveAdminConsolePanelRequest,
  usesAdminConsoleCanvasStats,
} from "@/lib/admin/console-module-state";
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
  isUnauthorized?: boolean;
  isEmpty?: boolean;
  isAdmin?: boolean;
  onRetry?: () => void;
  onSelectModule?: (moduleId: AdminConsoleMenuId) => void;
  initialStoryboardResult?: StoryboardInitialResult | null;
};

type AdminConsoleModulePanelComponent = ComponentType<AdminConsoleModulePanelProps>;

function withCompleteness(
  menuId: AdminConsoleMenuId,
  props: AdminConsoleModulePanelProps,
  children: ReactNode,
) {
  const canvasEmpty =
    usesAdminConsoleCanvasStats(menuId) && props.stats
      ? isAdminConsoleCanvasStatsEmpty(props.stats)
      : false;
  const onPrimaryAction =
    menuId === "overview" && props.onSelectModule && props.stats
      ? () => {
          props.onSelectModule?.(
            pickHighestPendingAdminConsoleMenu(props.stats!),
          );
        }
      : undefined;

  return (
    <AdminConsoleModuleCompleteness
      menuId={menuId}
      request={resolveAdminConsolePanelRequest(menuId, {
        isLoading: props.isLoading,
        hasError: props.hasError,
        isUnauthorized: props.isUnauthorized,
        isEmpty: props.isEmpty ?? canvasEmpty,
      })}
      onRetry={props.onRetry}
      onPrimaryAction={onPrimaryAction}
    >
      {isRiskyWorkMenuId(menuId) ? (
        <RiskyWorkProcedureSteps menuId={menuId} />
      ) : null}
      {children}
    </AdminConsoleModuleCompleteness>
  );
}

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
          onSelectModule={props.onSelectModule}
        />
      );
    };
  });
}

function loadAdminLlmWorkspacePanel() {
  return import("@/components/admin/console/AdminOpsAssistPanel").then(
    (module) => module.AdminOpsAssistPanel,
  );
}

function loadAdminAuditCanvasPanel() {
  return import("@/components/admin/console/AdminAuditEventsPanel").then(
    (module) => module.AdminAuditEventsPanel,
  );
}

function loadAdminMapOverlayOperationsModule() {
  return import("@/components/admin/AdminConsoleOverview").then(
    (module) => module.AdminMapOverlayOperationsModule,
  );
}

function completenessLoading(menuId: AdminConsoleMenuId) {
  return (
    <AdminConsoleModuleCompleteness
      menuId={menuId}
      request={{ isLoading: true }}
    />
  );
}

const AdminEvaluationModule = dynamic(loadAdminEvaluationModule, {
  ssr: false,
  loading: () => completenessLoading("restaurants"),
});

const AdminBannerModule = dynamic(loadAdminBannerModule, {
  ssr: false,
  loading: () => completenessLoading("banners"),
});

const AdminRestaurantRefreshHistoryModule = dynamic(
  loadAdminRestaurantRefreshHistoryModule,
  {
    ssr: false,
    loading: () => completenessLoading("restaurant-refresh-history"),
  },
);

const AdminUsersModule = dynamic(loadAdminUsersModule, {
  ssr: false,
  loading: () => completenessLoading("users"),
});

const AdminStoryboardGenerator = dynamic(loadAdminStoryboardGenerator, {
  ssr: false,
  loading: () => completenessLoading("storyboard"),
});

const AdminYoutubeThumbnailGenerator = dynamic(
  loadAdminYoutubeThumbnailGenerator,
  {
    ssr: false,
    loading: () => completenessLoading("youtube-thumbnail-generator"),
  },
);

const InsightsModule = dynamic(loadInsightsModule, {
  ssr: false,
  loading: () => completenessLoading("insights"),
});

const AdminRouteRecommendationModule = dynamic(
  loadAdminRouteRecommendationModule,
  {
    ssr: false,
    loading: () => completenessLoading("routes"),
  },
);

const AdminOverviewPanel = dynamic(loadAdminOverviewCanvasPanel, {
  ssr: false,
  loading: () => completenessLoading("overview"),
});

const AdminLlmPanel = dynamic(loadAdminLlmWorkspacePanel, {
  ssr: false,
  loading: () => completenessLoading("llm"),
});

const AdminAuditPanel = dynamic(loadAdminAuditCanvasPanel, {
  ssr: false,
  loading: () => completenessLoading("audit"),
});

const AdminMapOverlaysPanel = dynamic(loadAdminMapOverlayOperationsModule, {
  ssr: false,
  loading: () => completenessLoading("map-overlays"),
});

const AdminPipelinePanel = dynamic(loadAdminPipelineModule, {
  ssr: false,
  loading: () => completenessLoading("pipeline"),
});

const AdminSubmissionsPanel = dynamic(loadAdminEvaluationModule, {
  ssr: false,
  loading: () => completenessLoading("submissions"),
});

const AdminReviewsPanel = dynamic(loadAdminEvaluationModule, {
  ssr: false,
  loading: () => completenessLoading("reviews"),
});

function AdminRestaurantsRegisteredPanel(props: AdminConsoleModulePanelProps) {
  return withCompleteness(
    "restaurants",
    props,
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
    </ModulePanelFrame>,
  );
}

function AdminSubmissionsRegisteredPanel(props: AdminConsoleModulePanelProps) {
  return withCompleteness(
    "submissions",
    props,
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
    </ModulePanelFrame>,
  );
}

function AdminReviewsRegisteredPanel(props: AdminConsoleModulePanelProps) {
  return withCompleteness(
    "reviews",
    props,
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
    </ModulePanelFrame>,
  );
}

function AdminRestaurantRefreshHistoryRegisteredPanel(
  props: AdminConsoleModulePanelProps,
) {
  return withCompleteness(
    "restaurant-refresh-history",
    props,
    <ModulePanelFrame menuId="restaurant-refresh-history">
      <AdminEmbeddedModuleShell
        menuId="restaurant-refresh-history"
        contentClassName="overflow-y-auto"
      >
        <AdminRestaurantRefreshHistoryModule key="restaurant-refresh-history" />
      </AdminEmbeddedModuleShell>
    </ModulePanelFrame>,
  );
}

function AdminInsightsRegisteredPanel(props: AdminConsoleModulePanelProps) {
  return withCompleteness(
    "insights",
    props,
    <ModulePanelFrame menuId="insights">
      <InsightsModule key="admin-insights" embedded />
    </ModulePanelFrame>,
  );
}

function AdminBannersRegisteredPanel(props: AdminConsoleModulePanelProps) {
  return withCompleteness(
    "banners",
    props,
    <ModulePanelFrame menuId="banners">
      <AdminEmbeddedModuleShell
        menuId="banners"
        contentClassName="overflow-y-auto"
      >
        <AdminBannerModule key="admin-banners" embedded />
      </AdminEmbeddedModuleShell>
    </ModulePanelFrame>,
  );
}

function AdminRoutesRegisteredPanel(props: AdminConsoleModulePanelProps) {
  return withCompleteness(
    "routes",
    props,
    <AdminEmbeddedModuleShell menuId="routes" contentClassName="overflow-hidden">
      <AdminRouteRecommendationModule
        stats={props.stats}
        isLoading={Boolean(props.isLoading)}
        hasError={Boolean(props.hasError)}
        onSelectModule={props.onSelectModule}
      />
    </AdminEmbeddedModuleShell>,
  );
}

function AdminUsersRegisteredPanel(props: AdminConsoleModulePanelProps) {
  return withCompleteness(
    "users",
    props,
    <ModulePanelFrame menuId="users">
      <AdminEmbeddedModuleShell
        menuId="users"
        contentClassName="overflow-y-auto"
      >
        <AdminUsersModule key="admin-users" />
      </AdminEmbeddedModuleShell>
    </ModulePanelFrame>,
  );
}

function AdminPipelineRegisteredPanel(props: AdminConsoleModulePanelProps) {
  return withCompleteness(
    "pipeline",
    props,
    <ModulePanelFrame menuId="pipeline">
      <AdminEmbeddedModuleShell
        menuId="pipeline"
        contentClassName="overflow-y-auto"
      >
        <AdminPipelinePanel key="admin-pipeline" />
      </AdminEmbeddedModuleShell>
    </ModulePanelFrame>,
  );
}

function AdminStoryboardRegisteredPanel(props: AdminConsoleModulePanelProps) {
  return withCompleteness(
    "storyboard",
    props,
    <ModulePanelFrame menuId="storyboard">
      <AdminStoryboardGenerator
        key="admin-storyboard"
        initialStoryboardResult={props.initialStoryboardResult}
      />
    </ModulePanelFrame>,
  );
}

function AdminYoutubeThumbnailRegisteredPanel(
  props: AdminConsoleModulePanelProps,
) {
  return withCompleteness(
    "youtube-thumbnail-generator",
    props,
    <ModulePanelFrame menuId="youtube-thumbnail-generator">
      <AdminYoutubeThumbnailGenerator key="admin-youtube-thumbnail-generator" />
    </ModulePanelFrame>,
  );
}

function AdminOverviewRegisteredPanel(props: AdminConsoleModulePanelProps) {
  return withCompleteness("overview", props, <AdminOverviewPanel {...props} />);
}

function AdminLlmRegisteredPanel(props: AdminConsoleModulePanelProps) {
  return withCompleteness("llm", props, <AdminLlmPanel {...props} />);
}

function AdminAuditRegisteredPanel(props: AdminConsoleModulePanelProps) {
  return withCompleteness("audit", props, <AdminAuditPanel {...props} />);
}

function AdminMapOverlaysRegisteredPanel(props: AdminConsoleModulePanelProps) {
  return withCompleteness(
    "map-overlays",
    props,
    <AdminMapOverlaysPanel {...props} />,
  );
}

export const ADMIN_CONSOLE_MODULE_PANELS = {
  overview: AdminOverviewRegisteredPanel,
  insights: AdminInsightsRegisteredPanel,
  llm: AdminLlmRegisteredPanel,
  restaurants: AdminRestaurantsRegisteredPanel,
  "restaurant-refresh-history": AdminRestaurantRefreshHistoryRegisteredPanel,
  submissions: AdminSubmissionsRegisteredPanel,
  reviews: AdminReviewsRegisteredPanel,
  "map-overlays": AdminMapOverlaysRegisteredPanel,
  banners: AdminBannersRegisteredPanel,
  routes: AdminRoutesRegisteredPanel,
  users: AdminUsersRegisteredPanel,
  pipeline: AdminPipelineRegisteredPanel,
  audit: AdminAuditRegisteredPanel,
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
