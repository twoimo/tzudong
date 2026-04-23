type QueryRoot = Pick<Document, 'querySelector' | 'getElementById'>;

export function shouldResetNaverMapOnPathChange(previousPathname: string, pathname: string) {
    return previousPathname !== pathname && pathname === '/';
}

export function resolveRestaurantDetailPanelElement(root: QueryRoot) {
    return (
        root.querySelector('[data-panel-type="restaurant-detail"]') ||
        root.getElementById('restaurant-detail-panel') ||
        root.querySelector('.restaurant-detail-panel')
    );
}
