'use client';

import { fetchSupabaseRows } from '@/lib/supabase-rest-client';
import { mergeRestaurants, RESTAURANT_MERGE_SELECT } from '@/hooks/use-restaurants';
import type { Announcement } from '@/types/announcement';
import type { Restaurant } from '@/types/restaurant';

type AnnouncementRow = {
    id: string;
    title: string;
    content: string;
    is_active: boolean;
    show_on_banner: boolean;
    priority: number;
    created_at: string;
    updated_at: string;
};

function toAnnouncement(row: AnnouncementRow): Announcement {
    return {
        id: row.id,
        title: row.title,
        content: row.content,
        isActive: row.is_active,
        showOnBanner: row.show_on_banner,
        priority: row.priority,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function getMapModeForRestaurant(restaurant: Restaurant): 'domestic' | 'overseas' | null {
    const { lat, lng } = restaurant;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return lat < 33 || lat > 39 || lng < 124 || lng > 132 ? 'overseas' : 'domestic';
}

async function fetchMergedRestaurantById(restaurantId: string) {
    const [targetRestaurant] = await fetchSupabaseRows<Restaurant>('restaurants', [
        ['select', RESTAURANT_MERGE_SELECT],
        ['id', `eq.${restaurantId}`],
        ['limit', 1],
    ]);

    if (!targetRestaurant) {
        return null;
    }

    const restaurant = targetRestaurant as Restaurant;
    const sameNameRestaurants = await fetchSupabaseRows<Restaurant>('restaurants', [
        ['select', RESTAURANT_MERGE_SELECT],
        ['approved_name', `eq.${restaurant.name}`],
        ['status', 'eq.approved'],
    ]).catch(() => []);

    const merged = mergeRestaurants((sameNameRestaurants.length > 0 ? sameNameRestaurants : [targetRestaurant]) as Restaurant[]);
    return merged.find((item) => item.id === restaurantId) || merged[0] || null;
}

export async function fetchHomeAnnouncementById(announcementId: string) {
    const [announcementRow] = await fetchSupabaseRows<AnnouncementRow>('announcements', [
        ['select', 'id, title, content, is_active, show_on_banner, priority, created_at, updated_at'],
        ['id', `eq.${announcementId}`],
        ['limit', 1],
    ]);

    if (!announcementRow) {
        return null;
    }

    return toAnnouncement(announcementRow);
}

export async function resolveHomeRestaurantDeepLink(restaurantId: string) {
    const restaurant = await fetchMergedRestaurantById(restaurantId);
    if (!restaurant) return null;

    return {
        restaurant,
        inferredMode: getMapModeForRestaurant(restaurant),
    };
}

export async function resolveHomeRestaurantByCoordinates(lat: number, lng: number) {
    const tolerance = 0.0001;
    const restaurants = await fetchSupabaseRows<Restaurant>('restaurants', [
        ['select', RESTAURANT_MERGE_SELECT],
        ['lat', `gte.${lat - tolerance}`],
        ['lat', `lte.${lat + tolerance}`],
        ['lng', `gte.${lng - tolerance}`],
        ['lng', `lte.${lng + tolerance}`],
        ['status', 'eq.approved'],
    ]);

    if (restaurants.length === 0) {
        return null;
    }

    return mergeRestaurants(restaurants as Restaurant[])[0] || null;
}

export async function resolveHomeBookmarkRestaurantSelection(restaurantId: string, explicitMode: 'domestic' | 'overseas' | null) {
    const restaurant = await fetchMergedRestaurantById(restaurantId);
    if (!restaurant) return null;

    return {
        restaurant,
        inferredMode: explicitMode ?? getMapModeForRestaurant(restaurant),
    };
}
