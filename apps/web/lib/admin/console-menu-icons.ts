import {
  BarChart2,
  Bot,
  Clapperboard,
  ClipboardList,
  Image,
  Layers3,
  LayoutList,
  MessageSquareText,
  RefreshCw,
  Route,
  ScrollText,
  Store,
  UsersRound,
  Workflow,
} from "lucide-react";

import type { AdminConsoleMenuId } from "@/lib/admin/console-menu-registry";

export const ADMIN_CONSOLE_MENU_ICONS = {
  overview: LayoutList,
  insights: BarChart2,
  llm: Bot,
  restaurants: Store,
  "restaurant-refresh-history": RefreshCw,
  submissions: ClipboardList,
  reviews: MessageSquareText,
  "map-overlays": Layers3,
  banners: Image,
  routes: Route,
  users: UsersRound,
  pipeline: Workflow,
  audit: ScrollText,
  storyboard: Clapperboard,
  "youtube-thumbnail-generator": Image,
} as const satisfies Record<AdminConsoleMenuId, typeof Store>;
