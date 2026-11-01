import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { ArrowLeft, Check, Settings, Share2, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';
import { mapPanelIconButtonClass } from '../components/home/map-panel-chrome';

const source = readFileSync(new URL('../components/restaurant/RestaurantDetailPanel.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('detail.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = parsed.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'RestaurantDetailHeader');
if (!declaration) throw new Error('Missing detail header');

// Execute the production header without mounting the unrelated query/auth/media shell.
// The bookmark boundary records its real props; its count/auth implementation is unchanged.
const BookmarkBoundary = (_props: { restaurantId: string; onRequireAuth: () => void; className?: string; showCount?: boolean }) =>
  createElement('button', { 'aria-label': '북마크' });
const ImageBoundary = () => null;
const compiled = ts.transpileModule(declaration.getText(parsed) + '\nreturn RestaurantDetailHeader;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'createElement' },
}).outputText;
const Header = new Function('createElement', 'Button', 'Badge', 'BookmarkButton', 'Image', 'cn',
  'mapPanelIconButtonClass', 'ArrowLeft', 'Check', 'Settings', 'Share2', 'X', compiled)(
  createElement, Button, Badge, BookmarkBoundary, ImageBoundary, cn,
  mapPanelIconButtonClass, ArrowLeft, Check, Settings, Share2, X,
) as (props: typeof defaults) => ReactElement;

const defaults = {
  name: '아주 긴 맛집 상호명 본점',
  categories: ['한식', '찜·탕', '야식'],
  categoryImagePath: '/images/maker-images/webp/korean.webp',
  restaurantId: 'restaurant-header-fixture',
  isMobile: false,
  isAdmin: false,
  isShareCopied: false,
  onShare: () => {},
  onRequireAuth: () => {},
  onEditRestaurant: undefined as (() => void) | undefined,
  onClose: () => {},
  showDesktopBackButton: false,
};

type ElementProps = { children?: ReactNode; [key: string]: unknown };
function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}
function render(overrides: Partial<typeof defaults> = {}) {
  const props = { ...defaults, ...overrides };
  const tree = Header(props);
  return { props, nodes: elements(tree), html: renderToStaticMarkup(tree) };
}
function button(nodes: ReactElement<ElementProps>[], label: string) {
  const found = nodes.find((node) => node.type === Button && node.props['aria-label'] === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

describe('restaurant detail header', () => {
  test('name, representative category and every action share one header without a second toolbar', () => {
    const { html, nodes, props } = render({ isAdmin: true, onEditRestaurant: () => {} });
    expect(nodes.filter((node) => node.type === 'header')).toHaveLength(1);
    expect(html).not.toContain('data-map-panel-toolbar');
    const heading = nodes.find((node) => node.type === 'h2')!;
    expect(heading.props.children).toBe(props.name);
    expect(heading.props.title).toBe(props.name);
    const titleGroup = nodes.find((node) => Children.toArray(node.props.children).some((child) => isValidElement(child) && child.type === 'h2'))!;
    const siblings = Children.toArray(titleGroup.props.children).filter(isValidElement);
    expect(siblings[0]?.type).toBe('h2');
    expect((siblings[1] as ReactElement<ElementProps>).props['data-restaurant-detail-categories']).toBe('true');
    expect(html).toContain('카테고리: 한식, 찜·탕, 야식');
    expect(html).toContain('+2');
    expect(nodes.filter((node) => node.type === Badge)).toHaveLength(1);
    expect(nodes.filter((node) => node.type === Button)).toHaveLength(3);
    expect(nodes.filter((node) => node.type === BookmarkBoundary)).toHaveLength(1);
  });

  test('empty and single categories do not invent a category or remainder', () => {
    const empty = render({ categories: [] });
    expect(empty.html).not.toContain('data-restaurant-detail-categories');
    const single = render({ categories: ['카페·디저트'] });
    expect(single.html).toContain('카테고리: 카페·디저트');
    expect(single.html).not.toContain('+1');
    expect(single.nodes.filter((node) => node.type === Badge)).toHaveLength(1);
  });

  test('admin action requires both permission and an edit callback', () => {
    for (const [isAdmin, onEditRestaurant, expected] of [
      [false, undefined, false], [false, () => {}, false],
      [true, undefined, false], [true, () => {}, true],
    ] as const) {
      const { nodes } = render({ isAdmin, onEditRestaurant });
      expect(nodes.some((node) => node.props['aria-label'] === '맛집 정보 관리자 편집')).toBe(expected);
    }
  });

  test('share, edit, return and bookmark-auth callbacks retain identity and bookmark count stays enabled', () => {
    const onShare = () => {};
    const onEditRestaurant = () => {};
    const onClose = () => {};
    const onRequireAuth = () => {};
    const { nodes } = render({ isAdmin: true, onShare, onEditRestaurant, onClose, onRequireAuth });
    expect(button(nodes, '맛집 공유 링크 복사').props.onClick).toBe(onShare);
    expect(button(nodes, '맛집 정보 관리자 편집').props.onClick).toBe(onEditRestaurant);
    expect(button(nodes, '맛집 상세 닫기').props.onClick).toBe(onClose);
    const bookmark = nodes.find((node) => node.type === BookmarkBoundary)!;
    expect(bookmark.props.restaurantId).toBe(defaults.restaurantId);
    expect(bookmark.props.onRequireAuth).toBe(onRequireAuth);
    expect(bookmark.props.showCount).not.toBe(false);
  });

  test('mobile and desktop return intentions and copied-share feedback survive', () => {
    for (const [isMobile, showDesktopBackButton, label, icon] of [
      [false, false, '맛집 상세 닫기', X],
      [false, true, '이전 목록으로 돌아가기', ArrowLeft],
      [true, false, '이전 화면으로 돌아가기', ArrowLeft],
      [true, true, '이전 화면으로 돌아가기', ArrowLeft],
    ] as const) {
      const { nodes } = render({ isMobile, showDesktopBackButton });
      expect(elements(button(nodes, label)).some((node) => node.type === icon)).toBe(true);
    }
    const copied = render({ isShareCopied: true });
    expect(elements(button(copied.nodes, '공유 링크 복사됨')).some((node) => node.type === Check)).toBe(true);
  });

  test('panel wires original handlers into detail chrome and preserves the review return branch', () => {
    const calls: ts.JsxSelfClosingElement[] = [];
    function visit(node: ts.Node) {
      if (ts.isJsxSelfClosingElement(node)) calls.push(node);
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    const detail = calls.find((node) => node.tagName.getText(parsed) === 'RestaurantDetailHeader')!;
    const attributes = Object.fromEntries(detail.attributes.properties.filter(ts.isJsxAttribute).map((attr) =>
      [attr.name.getText(parsed), attr.initializer?.getText(parsed)]));
    expect(attributes).toMatchObject({
      name: '{restaurant.name}', restaurantId: '{restaurant.id}', categories: '{categories}',
      onShare: '{handleShareUrl}', onRequireAuth: '{handleBookmarkRequireAuth}',
      onEditRestaurant: '{onEditRestaurant}', onClose: '{onClose}', isAdmin: '{isAdmin}',
      isMobile: '{isMobile}', showDesktopBackButton: '{showDesktopBackButton}',
    });
    const reviews = calls.find((node) => node.tagName.getText(parsed) === 'MapPanelHeader')!;
    expect(reviews.attributes.properties.filter(ts.isJsxAttribute).find((attr) => attr.name.getText(parsed) === 'onClose')?.initializer?.getText(parsed)).toBe('{handleBackToDetail}');
  });
});
