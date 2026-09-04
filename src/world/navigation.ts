import { NavigationGrid } from "../core/navigation-grid";
import {
  NAVIGATION_GRID_VERSION,
  ZONE_BUNDLE_VERSION,
  type CompiledNavigationGridBundle,
  type CompiledZoneBundle,
} from "./contracts";

export function navigationGridForZone(
  zone: CompiledZoneBundle,
  navigation: CompiledNavigationGridBundle,
): NavigationGrid {
  if (
    zone.bundleVersion !== ZONE_BUNDLE_VERSION ||
    navigation.gridVersion !== NAVIGATION_GRID_VERSION ||
    navigation.zoneBundleVersion !== zone.bundleVersion
  ) {
    throw new Error("Navigation and zone bundle versions are incompatible.");
  }
  if (navigation.sourceZoneId !== zone.zoneId) {
    throw new Error(
      `Navigation grid "${navigation.gridId}" targets "${navigation.sourceZoneId}", not "${zone.zoneId}".`,
    );
  }
  return new NavigationGrid(navigation);
}
