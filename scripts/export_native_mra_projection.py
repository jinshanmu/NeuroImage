"""Export an attributed axial MRA maximum-intensity projection from native samples."""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import nibabel as nib
import numpy as np

from neuroimage.build import atomic_json, sha256, utc_now
from neuroimage.contracts import Manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--first-slice', required=True, type=int)
    parser.add_argument('--stop-slice', required=True, type=int)
    parser.add_argument('--selected-value', required=True, type=int)
    parser.add_argument('--window', nargs=2, type=float, default=[.5, 11])
    args = parser.parse_args()
    manifest = Manifest.model_validate_json(args.manifest.read_text())
    source = next(v for v in manifest.volumes if v.id == 'mra' and v.kind == 'image')
    labels = next(v for v in manifest.volumes if v.kind == 'labels')
    image = nib.load(args.manifest.parent / source.file)
    mask = nib.load(args.manifest.parent / labels.file)
    affine = image.affine
    if (image.shape != mask.shape or not np.array_equal(affine, mask.affine)
            or not np.allclose(affine[:3, :3], np.diag(np.diag(affine[:3, :3])))
            or not np.all(np.sign(np.diag(affine)[:3]) == [-1, -1, 1])):
        raise ValueError('This projection requires an original axial LPS-indexed paired source grid')
    start, stop = args.first_slice, args.stop_slice
    if not 0 <= start < stop <= image.shape[2] or args.window[0] >= args.window[1]:
        raise ValueError('Select a valid original slice interval and increasing intensity range')
    selected = next(s for s in manifest.structures if s.label_value == args.selected_value)
    scalar = np.asanyarray(image.dataobj[:, :, start:stop])
    categorical = np.asanyarray(mask.dataobj[:, :, start:stop])
    projected = np.max(scalar, axis=2)
    outline = np.any(categorical == args.selected_value, axis=2)
    if not np.any(outline):
        raise ValueError('The selected original segment is absent from this slab')
    x = affine[0, 3] + np.arange(image.shape[0]) * affine[0, 0]
    y = affine[1, 3] + np.arange(image.shape[1]) * affine[1, 1]
    edges = [x[0] - affine[0, 0] / 2, x[-1] + affine[0, 0] / 2,
             y[-1] + affine[1, 1] / 2, y[0] - affine[1, 1] / 2]
    low = float(affine[2, 3] + (start - .5) * affine[2, 2])
    high = float(affine[2, 3] + (stop - .5) * affine[2, 2])
    fig = plt.figure(figsize=(12, 12), dpi=180, facecolor='#071018')
    ax = fig.add_axes([.08, .24, .84, .67], facecolor='#071018')
    ax.imshow(projected.T, cmap='gray', origin='upper', extent=edges,
              vmin=args.window[0], vmax=args.window[1], interpolation='nearest')
    ax.contour(x, y, outline.T.astype(float), levels=[.5], colors=['#ffbc42'], linewidths=1.4)
    ax.set_aspect('equal'); ax.axis('off')
    center = np.argwhere(outline).mean(axis=0)
    target = [affine[0, 3] + center[0] * affine[0, 0], affine[1, 3] + center[1] * affine[1, 1]]
    ax.annotate('Source segment '+str(args.selected_value), xy=target, xytext=(x[8], y[22]),
                color='#ffcf80', fontsize=12, arrowprops={'arrowstyle':'->','color':'#ffcf80','linewidth':1.5},
                bbox={'boxstyle':'round,pad=.3','fc':'#071018','ec':'none','alpha':.9})
    for label,pos in [('R',(.01,.5)),('L',(.99,.5)),('A',(.5,.99)),('P',(.5,.01))]:
        ax.text(*pos,label,transform=ax.transAxes,color='white',fontsize=16,ha='center',va='center')
    fig.text(.06,.96,manifest.title,color='white',fontsize=18,weight='bold')
    fig.text(.06,.925,'Native axial MRA maximum-intensity projection',color='#b9d6e8',fontsize=14)
    notes=[f'Original slices {start} to {stop-1} (zero based); RAS S slab edges {low:.2f} to {high:.2f} mm.',
           'Projection: maximum measured intensity per native X,Y sample across the stated slab.',
           'Orange outline: projected extent of the retained source segment; overlapping depths are combined.',
           'Project name correspondence: '+selected.name+'.',
           f'Original sampling: {source.voxel_size_mm[0]:.6f} x {source.voxel_size_mm[1]:.6f} x {source.voxel_size_mm[2]:.6f} mm.',
           'THU cerebral MRA / healthy UNC volunteers. Tan et al., CMIG 114 (2024), 102364.',
           'Publisher permission: noncommercial research and education. '+manifest.package_version,
           'Source values and geometry retained. This figure is a computed projection of the stated source slab.']
    for i,text in enumerate(notes):fig.text(.06,.205-i*.023,text,color='#d0dde4',fontsize=10)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    fig.savefig(args.output,facecolor=fig.get_facecolor());plt.close(fig)
    record={'recorded_utc':utc_now(),'kind':'native-slab-maximum-intensity-projection','manifest_sha256':sha256(args.manifest),
            'dataset_id':manifest.dataset_id,'package_version':manifest.package_version,'space_id':manifest.space.id,
            'volume_id':source.id,'original_volume_asset':next(a.model_dump() for a in manifest.assets if a.path==source.file),
            'axis':2,'first_slice':start,'exclusive_stop_slice':stop,'slab_edges_ras_s_mm':[low,high],
            'projection_shape_xy':list(projected.shape),'window':args.window,'selected_source_value':args.selected_value,
            'outline':'Union of original selected label voxels along the same source slab',
            'resampling':'none','image_sha256':sha256(args.output),'script_sha256':sha256(Path(__file__)),
            'sources':[s.model_dump() for s in manifest.sources],'processing':manifest.build}
    atomic_json(args.output.with_suffix('.json'),record)
    print(json.dumps({'figure':str(args.output),'source_slices':stop-start,'projection_shape':list(projected.shape)}))


if __name__=='__main__':
    main()
