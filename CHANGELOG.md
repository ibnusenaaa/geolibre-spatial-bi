# Changelog

## 0.4.1 — 2026-11-16
- Authors: Ego Ibnu Wijaksena and Defani Arman Alfitriansyah. No change in behaviour.
- MIT licence; the description names the optional OSRM server.

## 0.4.0 — 2026-11-16
- Sites: road distance or travel time from the OSRM server.
- Fix: *Open Spatial BI* did nothing after a project was loaded with the panel folded on its rail.
- Reach areas are filled in the colour of their outlet.
- Development: the end-to-end script runs in Firefox and WebKit, the local server can serve https, and the code passes Biome's lint.

## 0.3.0 — 2026-11-16
- Market: travel time as well as road distance from the OSRM server, and reach areas contoured from the road network.
- Market: β calibrated against an observed sales field, with R².
- Sites: attractiveness field for existing outlets and a value for new sites in the Huff goal.
- Panel settings are saved with the GeoLibre project.
- Trend: a date column is preferred over a month or year column; no duplicate count column.
- Sample outlet revenue now follows a Huff split of customer spend.
- Output fields renamed: `sbi_dist_km` is `sbi_to_outlet_km`, ring `radius_km` is `limit_km`.

## 0.2.0 — 2026-11-15
- Trend tab: totals per day, month, quarter or year from a date or period field, with change and a linear trend.
- Sites tab: greedy selection of new outlet locations for coverage, mean distance or Huff share.
- Market: distances as straight lines, straight lines times a detour factor, or along the road network from an OSRM server.
- Sample customers carry an order date.

## 0.1.0 — 2026-11-15
- First version: Summary (KPIs, ranked breakdown, ABC, Gini, histogram, highlight on the map), Thematic (graduated, categorized, proportional points), Zones (hexagon grid or polygon layer), Market (Huff model, nearest outlet, distance rings, HHI) and Hot spots (Getis-Ord Gi*).
- CSV export from every tab.
- English and Indonesian interface.
