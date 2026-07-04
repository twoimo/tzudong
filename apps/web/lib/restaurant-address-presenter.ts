export type RestaurantAddressEntryType = 'road' | 'jibun' | 'english' | 'local';

export interface RestaurantAddressFields {
    road_address?: string | null;
    jibun_address?: string | null;
    english_address?: string | null;
}

export interface RestaurantAddressDisplayEntry {
    type: RestaurantAddressEntryType;
    label: string;
    address: string;
}

interface AddressCandidate {
    type: Exclude<RestaurantAddressEntryType, 'local'>;
    label: string;
    address: string;
    normalized: string;
}

const ADDRESS_LABELS: Record<Exclude<RestaurantAddressEntryType, 'local'>, string> = {
    road: '도로명 주소',
    jibun: '지번 주소',
    english: '영어 주소',
};

const LOCAL_ADDRESS_LABEL = '현지 주소';

function normalizeAddressForDisplayDedupe(address: string): string {
    return address.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function buildRestaurantAddressDisplayEntries(
    fields: RestaurantAddressFields,
): RestaurantAddressDisplayEntry[] {
    const candidateInputs: Array<{ type: Exclude<RestaurantAddressEntryType, 'local'>; value?: string | null }> = [
        { type: 'road', value: fields.road_address },
        { type: 'jibun', value: fields.jibun_address },
        { type: 'english', value: fields.english_address },
    ];

    const candidates: AddressCandidate[] = candidateInputs.flatMap(({ type, value }) => {
        const address = value?.trim();
        if (!address) return [];

        return [{
            type,
            label: ADDRESS_LABELS[type],
            address,
            normalized: normalizeAddressForDisplayDedupe(address),
        }];
    });

    if (candidates.length === 0) return [];

    const uniqueNormalizedAddresses = new Set(candidates.map((candidate) => candidate.normalized));
    if (candidates.length > 1 && uniqueNormalizedAddresses.size === 1) {
        return [{
            type: 'local',
            label: LOCAL_ADDRESS_LABEL,
            address: candidates[0].address,
        }];
    }

    const seen = new Set<string>();
    return candidates.flatMap((candidate) => {
        if (seen.has(candidate.normalized)) return [];
        seen.add(candidate.normalized);

        return [{
            type: candidate.type,
            label: candidate.label,
            address: candidate.address,
        }];
    });
}
