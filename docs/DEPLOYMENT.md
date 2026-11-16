# Full scientific deployment

Deploy the repository's root Dockerfile to a Linux AMD64 **web service**. The same public origin serves the built React application and every Python API route. Visitors need no ChatGPT, Google or Render account.

The static/Worker build is a different, limited distribution. It does not replace this container when native terrain, SPICE or the coupled engineering study is required.

## What the image includes

- The frontend built with Node 22 and the Python 3.11 scientific API.
- Seven original NASA LOLA rasters and six NASA/JPL NAIF kernels, downloaded from the official source URLs. SHA-256 values come from the scientific manifests already committed in this repository.
- A build-time scientific layer cached separately from application edits. Every downloaded file must match its pinned digest. Truncated or altered responses are retried, never accepted or silently repinned.
- Startup verification of all thirteen files. Missing data, a missing built frontend or a missing required Gemini key stops startup.
- A single Uvicorn worker and one BLAS thread to constrain memory and preserve the scientific process's SPICE state.
- Runtime caches under /app/data/cache. Their loss on replacement is acceptable; original data is baked into the image. No paid persistent disk is necessary.
- /api/ready for platform readiness. It confirms startup verification and key presence, not successful Gemini generation or numerical certification.

## Render setup

The root render.yaml describes one Docker web service, branch main, health check /api/ready and the proposed 1 CPU / 2 GB compute plan. **Review the current price before applying it.** Creating the file or validating it does not buy compute. It creates no database, worker or disk. Automatic deploys are off so new commits can be reviewed before publication.

Connect GitHub from Render Account Settings > Account Security > Git Deployment Credentials > Add credential. Grant access to GabrielChambi/NASA_MISION_ARTEMISA. If the repo is absent, its owner must configure the Render GitHub application's repository access.

After this configuration has been pushed to main, the Blueprint form is:
https://dashboard.render.com/blueprint/new?repo=https://github.com/GabrielChambi/NASA_MISION_ARTEMISA

Review the workspace, compute plan and bill. Enter GEMINI_API_KEY in Render's secret field, never in Git or a chat message. The proposed AI_PROVIDER and AI_MODEL values are non-secret and configurable. Apply only after accepting the displayed cost. The eventual HTTPS address is supplied by Render and normally ends in .onrender.com.

## Gemini

A configured key is not proof that the model can generate. Google availability, project permissions, quotas and billing remain independent of Render. Test a real request after publication. If Google rejects it, the deterministic interpreter remains explicitly identified and the scientific engine can still calculate supported requests. Do not describe that fallback as Gemini.

The local .env file is excluded from the Docker context and Git. Do not use VITE_ variables for credentials, Docker ARG for secrets, or a static hosting service as a place to store the private key.

## Local production verification

From the repository root:

~~~powershell
docker build -t lunar-oracle:production .
docker run --rm --name lunar-oracle-production --memory=2g --cpus=1 --env-file .env -p 127.0.0.1:8080:8000 lunar-oracle:production
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
