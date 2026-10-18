/** Keep the complete recipe once in the required atlas package. */
export function processingRecord<T extends object>(build:T):T & {recipe_reference?:string} {
  const record:T & {recipe_reference?:string}={...build}
  if('recipe' in record){delete (record as Record<string,unknown>).recipe;record.recipe_reference='manifest.json#/build/recipe'}
  return record
}
