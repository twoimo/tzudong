import type { QueryClient } from "@tanstack/react-query";

export async function invalidateProfileDisplayQueries(
  queryClient: QueryClient,
  userId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["user-profile", userId] }),
    queryClient.invalidateQueries({ queryKey: ["user-profile-identity", userId] }),
    queryClient.invalidateQueries({ queryKey: ["home-map-user-menu-avatar", userId] }),
    queryClient.invalidateQueries({ queryKey: ["review-feed"] }),
    queryClient.invalidateQueries({ queryKey: ["review-feed-overlay"] }),
    queryClient.invalidateQueries({ queryKey: ["restaurant-reviews"] }),
    queryClient.invalidateQueries({ queryKey: ["leaderboard-users"] }),
  ]);
}
