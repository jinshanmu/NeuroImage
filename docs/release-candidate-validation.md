# Release candidate 1.0.0

This is a local author-review candidate, not a published release. The verified environment is Linux x86_64, Python 3.12 in the dedicated NeuroImage environment, Node 24.21.0 and Chromium with WebGL2.

## Verification

Run `python -m pytest`, `npm test`, and `npm run build` from an independently extracted source archive. Tests cover source identity, geometry and file boundaries, interruption recovery, teaching contracts, navigation, transaction-completion semantics, legacy storage recovery, failed-write preservation and large notebook records. Exact final counts and artifact hashes are recorded in the candidate's external `RELEASE_VERIFICATION.json`; they are not embedded in the archives whose hashes they describe.

Browser review uses independently acquired local anatomy in an isolated profile. Check library discovery and source opening; source-specific viewing; scene save/restore; notebook capture, import, export and presentation; course recovery; ordinary and expanded layouts; open structure and learning panels; browser resizing and page zoom. The document must own vertical scrolling. Text, controls and canvas bounds must fit the page at the checked sizes. A renderer may clip its drawing surface without creating an inner page scrollbar.

`scripts/browser_page_flow.js` repeats the whole-page overflow checks at 1600, 1100, 800 and 390 CSS pixels against an already opened atlas or native model. Run it through Playwright CLI in an isolated profile. It examines every visible scroll container, not just canvas ancestors.

`scripts/browser_course_navigation.js` checks a saved course in an isolated browser profile. It warms two views of the same source and background, then verifies repeated view restoration, reuse of the same canvas and absence of repeated source-asset requests. The check changes the test course position and browser scene saves.

Historical browser scripts retain their documented source and interface assumptions. Their presence does not imply that every historical script was rerun for this candidate. New release evidence distinguishes current software checks from the preserved anatomical-source receipts. Engineering checks do not establish anatomical completeness or educational effectiveness.

## Distribution verification

`scripts/build_distribution.py` normalizes and audits wheel and source archives. `scripts/prepare_public_release.py --destination /path/to/new-candidate` creates a separate source snapshot, archives, file hashes and a release manifest. The snapshot excludes acquired datasets, machine-specific paths, local development history, build environments and caches. It does not create a repository or push anything.

Independently rebuild the source archive, compare both archive hashes, install the wheel outside the checkout and check its included frontend. Verify the clean snapshot's documentation links and CFF citation metadata. The release record states any dependency or bundler warnings. GitHub CI is configured; a local unpushed candidate has no GitHub Actions run to report.
