import type { Lesson } from './types'

export function LessonEvidence({lesson}:{lesson:Lesson}) {
  const references=(lesson.references??[]).filter(item=>{
    try{return new URL(item.url).protocol==='https:'}catch{return false}
  })
  return <details className="small muted"><summary>Lesson evidence</summary>
    <p>{lesson.evidence_limit}</p>
    {references.length>0&&<ul>{references.map(item=><li key={item.url}>
      <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
    </li>)}</ul>}
  </details>
}
