# Full scientific deployment

Deploy the repository's root Dockerfile to a Linux AMD64 **web service**. The same public origin serves the built React application and every Python API route. Visitors need no ChatGPT, Google or Render account.

The static/Worker build is a different, limited distribution. It does not replace this container when native terrain, SPICE or the coupled engineering study is required.

## Current public service

https://lunar-oracle-7wcq.onrender.com/

The existing service is named lunar-oracle in Rudy Gabriel's workspace, on Render Free. It was created directly as one Docker web service, using main. The render.yaml is a reproducible reference, not an automatically synchronized Blueprint for this existing service. Do not create duplicate services to publish updates. Use its existing Render Dashboard and a manual deploy after checking the new commit.

The scientific data verification and public frontend/API checks passed for application commit 9005dc6. The key is configured as a server-side secret. A separate real-generation test returned Google HTTP 429: configured credentials do not remove Google's daily free-tier quota. Paying the web host does not change Google's quota.

## What the image includes

- The frontend built with Node 22 and the Python 3.11 scientific API.
- Seven original NASA LOLA rasters and six NASA/JPL NAIF kernels. Large files are downloaded from the official source URLs; the small frozen Earth kernel whose dated source now returns 404 is included unchanged under data/pinned/naif/. SHA-256 values come from the scientific manifests already committed in this repository.
- A build-time scientific layer cached separately from application edits. Every downloaded file must match its pinned digest. Truncated or altered responses are retried, never accepted or silently repinned.
- Startup verification of all thirteen files. Missing data, a missing built frontend or a missing required Gemini key stops startup.
- A single Uvicorn worker and one BLAS thread to constrain memory and preserve the scientific process's SPICE state.
- Runtime caches under /app/data/cache. Their loss on replacement is acceptable; original data is baked into the image. No paid persistent disk is necessary.
- /api/ready for platform readiness. It confirms startup verification and key presence, not successful Gemini generation or numerical certification.

## Render setup

The root render.yaml describes one Docker web service on Render Free (512 MB RAM, 0.1 CPU), branch main and health check /api/ready. It creates no database, worker or disk. Do not upgrade it to paid compute. Automatic deploys are off so new commits can be reviewed before publication.

Connect GitHub from Render Account Settings > Account Security > Git Deployment Credentials > Add credential. Grant access to GabrielChambi/NASA_MISION_ARTEMISA. If the repo is absent, its owner must configure the Render GitHub application's repository access.

After this configuration has been pushed to main, the Blueprint form is:
https://dashboard.render.com/blueprint/new?repo=https://github.com/GabrielChambi/NASA_MISION_ARTEMISA

Review the workspace and confirm that the compute plan is Free. Enter GEMINI_API_KEY in Render's secret field, never in Git or a chat message. The proposed AI_PROVIDER and AI_MODEL values are non-secret and configurable. Keep the account without a payment method to prevent usage overages from becoming charges; on the free plan, exceeding included usage can suspend service or builds. Never authorize a paid upgrade. The eventual HTTPS address is supplied by Render and normally ends in .onrender.com.

## Free-tier behavior

Render Free suspends after 15 minutes without incoming traffic and needs approximately one minute to wake. The included hours, bandwidth and build minutes are limited. Do not promise uninterrupted availability or production capacity on this tier.

Scientific raster access reads original pixels in 256-pixel windows with at most eight cached tiles per source. It does not resample the NASA data. GDAL cache and BLAS threads are bounded. This removes the peak allocation from reading and masking an entire regional raster into RAM. The native 5 m products remain available only in their actual original footprints.

## Gemini

A configured key is not proof that the model can generate. Google availability, project permissions, quotas and billing remain independent of Render. Test a real request after publication. If Google rejects it, the deterministic interpreter remains explicitly identified and the scientific engine can still calculate supported requests. Do not describe that fallback as Gemini.

The local .env file is excluded from the Docker context and Git. Do not use VITE_ variables for credentials, Docker ARG for secrets, or a static hosting service as a place to store the private key.

## Local production verification

From the repository root:

~~~powershell
docker build -t lunar-oracle:production .
docker run --rm --name lunar-oracle-production --memory=512m --memory-swap=512m --cpus=0.1 --env-file .env -p 127.0.0.1:8080:8000 lunar-oracle:production
~~~

Open http://127.0.0.1:8080/ and http://127.0.0.1:8080/api/ready. This is the production container, without Vite or a development proxy. Do not run a second container with the same name or port.

## Acceptance after publication

1. Wait for Render's specific deployment to become live; a successful build or accepted trigger alone is insufficient.
2. Check /, an actual versioned asset and /api/ready without authentication.
3. Confirm unknown /api paths return JSON 404, not the frontend HTML.
4. Plan a mission and inspect the regional result, native study, engineering report and SPICE comparisons. Test English and mobile navigation.
5. Check a real Gemini generation separately from key presence.
6. Review runtime logs and peak memory during an engineering calculation and trajectory request. A successful health check does not measure computational capacity.

The bundled Earth orientation kernel has finite coverage, recorded in the SPICE manifest. Unsupported dates and missing source coverage remain unavailable. A successful deployment does not make this planning prototype an operationally validated physical twin.
