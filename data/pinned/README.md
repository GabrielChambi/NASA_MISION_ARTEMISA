# Pinned NASA/JPL source

The NAIF Earth orientation binary kernel in naif/ is an unchanged copy of the product recorded in data/prepared/spice_manifest.json. Its original dated public URL now returns HTTP 404. The current earth_latest_high_prec.bpc has different bytes and is deliberately not substituted.

This small frozen kernel is included to reproduce the exact validated scientific inputs. Its SHA-256, original official URL, byte count and original retrieval time remain in the existing manifest. Deployment checks the same digest before accepting the bundled copy. All other large rasters and kernels are downloaded from their official sources with pinned digests.

Origin: NASA/JPL NAIF, https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/
No spacecraft telemetry or secret configuration is included.
