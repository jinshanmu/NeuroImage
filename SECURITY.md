# Local service security

NeuroImage serves selected local atlas packages over loopback. The application is designed for one user's local machine. It has no public multi-user authentication layer and should not be exposed through a public reverse proxy or a network-wide bind address.

The server checks local Host and Origin headers, requires JSON for state-changing workspace requests, validates package paths and hashes, and serves declared assets. Source recipes can acquire and unpack files; inspect their URLs, sizes, licenses and hashes before adding a recipe. Locally pinned hashes support reproducibility and are not publisher signatures.

Report suspected vulnerabilities privately to the maintainer, Shanmu Jin, at jinshanmu1129@pku.edu.cn. Include the software version, a minimal synthetic reproduction and the observed behavior. Do not send acquired images, personal teaching notes, credentials or patient information. No response-time guarantee is offered for this research software.

Browser storage is scoped to the browser profile and local service origin. IndexedDB is a working store, not a backup. Export teaching files for durable recovery. A blocked or failed save must not be interpreted as a successful write.

## Supported release

Version 1.0.0 is the current review release. Security fixes target the latest release; older local datasets remain separate from the installed software. Include the exact software version when reporting a problem.
