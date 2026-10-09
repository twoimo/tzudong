# Historical PG17.11 source bindings

`historical-artifact-map.json` is the byte-preserved map from the intermediate PG17.11 experiment. The three live-looking source paths in that historical map resolve to the adjacent `*.source.txt` files through `source-recovery.json`, whose recovery required the original hashes to match. Historical runtime JSON and logs remain unchanged.

The parent `artifact-map.json` will be regenerated for the current delivery. Historical runtime success is not promoted to changed source hashes; current runtime results are retained in separately named PG17.6 directories.
