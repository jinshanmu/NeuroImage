import catalog from '../../src/neuroimage/catalogs/teaching-evidence.json'
import variation from '../../src/neuroimage/catalogs/normal-variation-observations.json'
import segments from '../../src/neuroimage/catalogs/thu-cerebral-mra-segments.json'

export function EvidenceTopics({ source }: { source: string }) {
  const topics = catalog.topics.filter(topic => topic.source_ids.includes('*') || topic.source_ids.includes(source))
  const sourceCase = variation.cases.find(item => item.dataset_id === source)
  return <details className="teaching-evidence-topics"><summary>Observation and interpretation · {topics.length + Number(!!sourceCase)} topics</summary>
    {sourceCase&&<section aria-label="Individual arterial source observations">
      <h3>Case {sourceCase.case}: arterial source observations</h3>
      <p>{sourceCase.present_values.length} of 20 numeric segment values are represented in this source annotation.</p>
      <p>{sourceCase.unlabelled_values.length?'Unlabelled values: '+sourceCase.unlabelled_values.map(value=>`${value} (${segments.segments.find(item=>item.value===value)?.name??'source segment'})`).join('; ')+'.':'All 20 numeric segment values occur in this annotation.'}</p>
      <p>Arterial names follow the project correspondence to the source diagram. An unlabelled value does not establish anatomical absence or hypoplasia.</p>
      <p><strong>Observe:</strong> Follow the candidate course through adjacent original MRA sections. Record image visibility, labelled extent, side and unresolved interpretation in the teaching notes.</p>
      <details><summary>Eight-case comparison guide</summary>
        <p>Open the “Normal arterial variation: source observations across eight volunteers” course from the teaching library. The first eight views compare anterior regions; the next eight compare posterior regions. Each view retains its own source coordinates.</p>
        <ul>{variation.cases.map(item=><li key={item.case}>Case {item.case}: {item.present_values.length}/20 labelled values; {item.unlabelled_values.length?'unlabelled '+item.unlabelled_values.join(', '):'none unlabelled'}.</li>)}</ul>
        <p>{variation.selection_basis} {variation.interpretation}</p>
      </details>
      <p className="small"><a href={variation.source_url} target="_blank" rel="noreferrer">Original MRA dataset and source terms</a> · <a href={variation.source_doi} target="_blank" rel="noreferrer">Source methods</a></p>
    </section>}
    {topics.map(topic => <section key={topic.id} aria-label={topic.title}>
      <h3>{topic.title}</h3><p>{topic.observation}</p><p className="small muted">{topic.limit}</p>
      <p><strong>Discuss:</strong> {topic.question}</p>
      <details><summary>Compare reasoning</summary><p>{topic.answer}</p></details>
      <details><summary>References</summary>{topic.references.map(reference => <p key={reference.url} className="small"><a href={reference.url} target="_blank" rel="noreferrer">{reference.title}</a><br/>{reference.basis}</p>)}</details>
    </section>)}
  </details>
}
