export async function workspacePost<T>(path:string, body:unknown):Promise<T> {
  const sessionResponse=await fetch('/api/workspace/session'),session=await sessionResponse.json()
  if(!sessionResponse.ok)throw Error(session.error??'Reopen the local workspace to continue.')
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-NeuroImage-Token':session.session_token},body:JSON.stringify(body)})
  const result=await response.json()
  if(!response.ok)throw Error(result.error??'The local workspace could not complete this operation.')
  return result as T
}
