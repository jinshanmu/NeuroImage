import { datasetAtlasCases } from './datasetAtlases'
import type { DatasetAtlasEntry } from './datasetAtlases'
import type { BrowseTarget } from './anatomyNavigation'
import type { DatasetFamily } from './datasetFamilies'
import type { SourceInfo } from './useAnatomyLibrary'
import type { DatasetSource } from './types'

interface Props {
  family: DatasetFamily<SourceInfo>; targets: BrowseTarget[]; busy: boolean;
  onOpen: (target: BrowseTarget) => void;
}

const unique = (values: string[]) => [...new Set(values.filter(Boolean))]
const infoOf = (entry: DatasetAtlasEntry) => entry.target?.dataset_info ?? entry.source.dataset_info
const sourcesOf = (entry: DatasetAtlasEntry) => entry.target?.sources?.length&&entry.target.sources.every(source=>source.title&&source.url)?entry.target.sources:entry.source.sources
const representations:Record<string,string>={
  'mri-labels':'Source MRI and anatomical labels', 'ct-labels':'Source CT and anatomical labels',
  'mri-regions':'MRI and independent regional fields', 'mri-streamlines':'MRI and computational streamline bundles',
  'mri-volume':'Native MRI image', 'scalar-fields':'Original statistical fields',
  'label-model':'Categorical tissue model', 'surface-model':'Independent source surface model',
}

export function DatasetDetail({family,targets,busy,onOpen}:Props) {
  const cases=datasetAtlasCases(family.members,targets)
  const entries=cases.flatMap(item=>item.entries)
  const description=unique(entries.flatMap(entry=>infoOf(entry)?.description??[]))
  const referenceMap=new Map<string,{source:DatasetSource;target?:BrowseTarget}>()
  for(const entry of entries)for(const source of sourcesOf(entry)){
    const key=[source.id??source.title,source.version,source.url].join('|')
    const previous=referenceMap.get(key)
    if(!previous||(!(previous.target?.active&&previous.target.base_url&&previous.source.license_file)&&entry.target?.active&&entry.target.base_url&&source.license_file))
      referenceMap.set(key,{source,target:entry.target})
  }
  const references=[...referenceMap.values()]
  return <div className="dataset-detail">
    <section className="dataset-overview" aria-label="About this dataset">
      <h2>About this dataset</h2>
      {description.map(text=><p key={text}>{text}</p>)}
      {!!references.length&&<details className="dataset-references"><summary>Source publications and licenses</summary>{references.map(({source,target})=><section key={[source.id??source.title,source.version,source.url].join('|')}>
        <h3>{source.title}</h3>{source.citation&&<p>{source.citation}</p>}
        <div className="dataset-reference-links"><a href={source.url} target="_blank" rel="noreferrer">Official source ↗</a><span>{source.version}</span>
          {source.license_url?<a href={source.license_url} target="_blank" rel="noreferrer">{source.license_name}</a>:<span>{source.license_name}</span>}
          {target?.active&&target.base_url&&source.license_file&&<a href={target.base_url+source.license_file} target="_blank" rel="noreferrer">Local license and attribution</a>}
        </div>
      </section>)}</details>}
      {entries.some(entry=>infoOf(entry))&&<details className="dataset-coverage"><summary>Source coverage and coordinates</summary>{cases.map(item=>item.entries.map(entry=>{
        const info=infoOf(entry)
        return info&&<section key={entry.source.id}>
          <h3>{cases.length>1?item.title+' · ':''}{entry.label}</h3>
          <dl><dt>Representation</dt><dd>{representations[info.representation]??info.representation}</dd><dt>Native space</dt><dd>{info.space.name}</dd>{entry.target&&<><dt>Package version</dt><dd><code>{entry.target.package_version}</code></dd></>}</dl>
          <p>{info.space.correspondence}</p>{info.space.unit_basis&&<p>{info.space.unit_basis}</p>}
          {info.image_evidence?.map((image,index)=><section className="dataset-acquisition" key={index}><h4>{image.modality} acquisition and sampling</h4><p>{image.acquisition}</p><p>{image.sampling}</p><p>{image.intensity_units}. {image.calibration}</p><p className="small muted">Original source array: <code>{image.source_dataset}</code></p></section>)}
          {unique(info.scope_notes).map(note=><p key={note}>{note}</p>)}
        </section>
      }))}</details>}
    </section>
    <section className="dataset-atlases" aria-label={family.title+' atlases'}>
      {cases.length>1&&<div className="dataset-section-heading"><span>{cases.length} cases</span></div>}
      <div className="dataset-case-grid">{cases.map(item=><article className="dataset-case" key={item.id} aria-label={cases.length>1?item.title:'Complete atlas'}>
        <h3>{cases.length>1?item.title:'Complete atlas'}</h3>
        {cases.length===1&&item.id!=='complete'&&<p className="dataset-case-identity">{item.title}</p>}
        <div className="dataset-atlas-actions">{item.entries.map(entry=>entry.target?<div className="dataset-atlas-entry" key={entry.source.id}><button className="dataset-atlas-button" disabled={busy} onClick={()=>onOpen(entry.target!)} aria-label={'Open '+(item.entries.length===1?'Complete atlas':entry.label)}>
          <span>{entry.label}</span><span aria-hidden="true">↗</span>
        </button></div>:<div className="dataset-atlas-unavailable" key={entry.source.id}><span>{entry.label}</span><span className="small muted">Atlas is not available locally.</span></div>)}</div>
      </article>)}</div>
    </section>
  </div>
}
