# Maintenance and releases

Shanmu Jin maintains NeuroImage Atlas and makes release decisions after reviewing the software and its scientific scope. Contributions are reviewed for correctness, usability, provenance, licensing and reproducibility. The current scope is normal intracranial anatomy and normal anatomical variation for education and research.

## Versioning

Software releases follow semantic versioning. A major version identifies an incompatible public interface change; a minor version adds compatible features; a patch version corrects compatible behavior. Dataset packages have separate construction identities. Upgrading the software preserves existing local packages and teaching files; recovery uses the exact source package required by each saved view.

Changes to portable teaching formats must include validation, migration guidance and tests for supported historical files. Source terms, definitions and geometry remain attached to their original dataset. New anatomical content should include source evidence, a stated representation, working views and an explicit review status.

## Release review

Prepare releases locally from a recorded commit. Run the Python and frontend suites, build the viewer, audit code-only archives, and verify the installation outside the checkout. Exercise representative image, probability, model, streamline and teaching workflows in a real browser. Record the tested platform and any material limitations.

The author reviews the source snapshot, software archives, license notices, citation metadata and verification report before publication. Repository URLs, release tags and archival identifiers are added when those public records actually exist. Continuous integration produces validation artifacts and does not publish releases automatically.

## Support

Use a public issue for a reproducible software problem or a documented content proposal once the repository is published. Use the private route in [SECURITY.md](SECURITY.md) for a suspected vulnerability. Maintenance is conducted as research software; support and response times depend on maintainer availability.
