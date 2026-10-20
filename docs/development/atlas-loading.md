# Full precision atlas loading

The formal release uses reusable browser buffers to avoid repeating source decoding on every atlas opening. Independent binary memberships are stored as sorted source-grid indices. Mesh caches retain every original float32 vertex and triangle, plus exactly the normal bytes produced by NiiVue 0.69.0. Integer delta coding and HTTP gzip reduce transfers without changing any of these bits. MRI/CT requests use native browser gzip decoding of the unchanged source NIfTI.

The cache lives under the workspace's SSD state directory at `browser-cache/v2`. Read-only `serve` uses `~/.cache/NeuroImage/browser/v2`. Original packages and manifests stay on the data drive. Entries are bound to source SHA-256 values, checked against their own checksums, and atomically rebuilt when invalid. The configured SSD free-space reserve still applies. Workspace startup prepares the latest available configuration for each dataset before announcing that the local service is ready; new construction results use the same preparation path.

The frontend uploads the complete image stack after palette preparation, preserves background textures on overlay-only changes, and skips gradient textures when gradient shading is disabled. Binary membership loading does not construct an intensity image or compute histograms. MRI/CT intensity calibration and contrast controls remain available.

The loading indicator remains inside the atlas canvas: its usual opaque background and `Loading`. The canvas becomes visible only after the complete requested data and geometry are ready. Large datasets retain full precision and may exceed three seconds, as agreed on 2026-10-21. No preview resolution, mesh simplification or early readiness is used.

## Verification

Run the Python and frontend suites, the production build, and `scripts/browser_anatomy_release.js` through Playwright CLI. The browser check records opening time before exercising complete structure visibility, image layouts, magnification and model framing. Its `check-from` and `check-count` parameters allow bounded batches.

`scripts/browser_atlas_loading.js` checks the local loading indicator, full readiness, MRI contrast replacement and restoration, and recovery from a failed geometry request. `scripts/browser_home_navigation.js` checks resource-discovery reuse across home navigation.

`node scripts/verify_browser_cache.mjs packages.json /path/to/state/browser-cache/v2` compares every cached vertex, triangle and normal byte against the pinned renderer's original GIFTI decoder. `packages.json` is an array of local package records containing `manifest` and `dataset_id`. It does not modify those source packages.

The 2026-10-21 verification covered 39 local source configurations and 1,878 meshes. All mesh inputs matched exactly, and all 39 canvas captures were pixel-identical to the original baseline. Of 39 configurations, 26 opened within three seconds; the other 13 took 3.3–13.2 seconds with full source data. Brainstem Navigator took 1.8 seconds. The [complete measurements](atlas-loading-timings.json) describe this machine and browser, not a universal time guarantee. The testing checkout remains independent and unchanged.

The final run passed 223 Python tests, 152 frontend tests, type checking and the production build. Browser checks also passed for loading and recovery, resource discovery across home navigation, and the complete anatomy workflow, including scene import/export, independent comparison and narrow layouts. The testing branch retained its original commit and all 581 tracked files unchanged.
