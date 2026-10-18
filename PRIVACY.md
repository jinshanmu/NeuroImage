# Local data and browser storage

NeuroImage uses a loopback web server on your computer. Anatomical images, labels, models and teaching exports remain in the data directory you choose. The viewer uses local browser assets and local atlas resources. It has no account system, analytics endpoint or remote rendering service.

Installation contacts the package registries and official runtime distribution used by the pinned dependencies. Dataset acquisition contacts the URLs in the selected recipe. Source and reference links open their external websites when selected. Those sites apply their own policies.

Scenes, draft notebooks and study records can be saved in the browser's IndexedDB database. Browser storage belongs to the browser profile and the local service address, including its port. Clearing browser data can remove these saves. Export JSON files for backup. Courses and imported teaching content can also be stored on the data drive.

Saved notes and exported teaching files may include text entered by their author. Check that text before sharing a file. Software distributions contain code and documentation; separately exported images retain source attribution and are subject to the dataset's terms.

Workspace operation records and bounded logs are stored in the SSD state directory you select. Removing software does not remove your original datasets, local atlases or teaching exports. Remove those separately only when you intend to do so.
