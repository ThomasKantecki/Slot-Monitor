# ZIP-radius geography

`florida-zip-centroids.js` is the local Florida origin dataset previously generated for v3. It contains 2025 U.S. Census Gazetteer representative latitude/longitude points for Florida ZIP Code Tabulation Areas, joined to the 2020 Census state-ZCTA relationship.

The Slot Availability build embeds these points into the self-contained dashboard. Facility distance is measured between the selected origin ZCTA point and each facility ZIP's ZCTA point using the Haversine great-circle formula. It is an approximate ZIP-to-ZIP distance, not driving distance or exact street-address distance.
