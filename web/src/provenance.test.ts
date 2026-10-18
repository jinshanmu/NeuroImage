import { expect,it } from 'vitest'
import { processingRecord } from './provenance'
it('keeps exact construction evidence while avoiding a repeated full recipe in each scene',()=>{
  const full={signature:'exact',software_version:'1.0.0',inputs:[{sha256:'original'}],parameters:{threshold:.5},recipe:{objects:['source-one','source-two']}}
  const compact=processingRecord(full)
  expect(compact.signature).toBe(full.signature)
  expect(compact.inputs).toEqual(full.inputs)
  expect(compact.parameters).toEqual(full.parameters)
  expect(compact.recipe_reference).toBe('manifest.json#/build/recipe')
  expect(compact).not.toHaveProperty('recipe')
  expect(full.recipe.objects).toHaveLength(2)
})
