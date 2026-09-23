import { FontAwesome6 } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

type NativeIconName = ComponentProps<typeof FontAwesome6>['name'];

export type AppIconName =
  | 'arrow-left' | 'arrow-right' | 'bell' | 'bolt' | 'box' | 'briefcase' | 'calendar'
  | 'camera' | 'car' | 'check' | 'chevron-down' | 'chevron-left' | 'chevron-right'
  | 'circle-check' | 'info' | 'clock' | 'comments' | 'credit-card' | 'door'
  | 'envelope' | 'eye' | 'football' | 'fuel' | 'gauge' | 'gears' | 'handshake' | 'heart'
  | 'home' | 'id-card' | 'image' | 'laptop' | 'location' | 'lock' | 'search'
  | 'map' | 'message' | 'palette' | 'phone' | 'plus' | 'list' | 'ruler'
  | 'share' | 'shield' | 'shirt' | 'sparkles' | 'star' | 'store' | 'truck'
  | 'user' | 'user-shield' | 'wallet' | 'wand' | 'tools' | 'child' | 'couch'
  | 'motorcycle' | 'paw' | 'wifi' | 'grip'
  | NativeIconName;

const PWA_ICON_MAP: Partial<Record<string, NativeIconName>> = {
  calendar: 'calendar-days',
  door: 'door-open',
  football: 'futbol',
  fuel: 'gas-pump',
  gauge: 'gauge-high',
  gears: 'gears',
  home: 'house',
  location: 'location-dot',
  search: 'magnifying-glass',
  map: 'map-location-dot',
  share: 'share-nodes',
  shield: 'shield-halved',
  sparkles: 'wand-magic-sparkles',
  wand: 'wand-magic-sparkles',
  tools: 'screwdriver-wrench',
  child: 'child-reaching',
  list: 'rectangle-list',
  ruler: 'ruler-combined',
  grip: 'grip-lines',
};

export function AppIcon({
  name,
  size = 18,
  color = '#5b4cf0',
  solid,
}: {
  name: AppIconName;
  size?: number;
  color?: ColorValue;
  solid?: boolean;
}) {
  const semantic = String(name);
  const resolved = (PWA_ICON_MAP[semantic] ?? name) as NativeIconName;
  const resolvedSolid = solid ?? semantic !== 'heart';
  return <FontAwesome6 name={resolved} size={size} color={color} solid={resolvedSolid} accessible={false} />;
}