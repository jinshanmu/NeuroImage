import { describe, expect, it } from 'vitest'
import { resolveSurfaceSelection } from './selection'

describe('categorical surface boundaries', () => {
  it('selects a visible surface when nearest voxel rounding names a hidden neighbor', () => {
    const result = resolveSurfaceSelection([.5, 0, 0], [['putamen', {visible:true,pts:[.5,0,0]}], ['claustrum',{visible:false,pts:[.5,0,0]}]], 'claustrum', 1, null)
    expect(result.selected).toBe('putamen')
    expect(result.selectionEvidence).toEqual({kind:'visible-surface',candidates:['putamen']})
  })
  it('records coincident visible boundaries and retains an existing candidate', () => {
    const result = resolveSurfaceSelection([.5, 0, 0], [['putamen',{visible:true,pts:[.5,0,0]}],['claustrum',{visible:true,pts:[.5,0,0]}]], 'claustrum', 1, 'putamen')
    expect(result.selected).toBe('putamen')
    expect(new Set(result.selectionEvidence.candidates)).toEqual(new Set(['putamen','claustrum']))
  })
  it('does not claim a surface selection when no displayed surface is nearby', () => {
    const result = resolveSurfaceSelection([10,0,0], [['putamen',{visible:true,pts:[0,0,0]}]], null, 1, 'putamen')
    expect(result.selected).toBeNull()
    expect(result.selectionEvidence.kind).toBe('label-voxel')
  })
  it('does not select an invisible zero-opacity boundary over a displayed neighbor', () => {
    const result = resolveSurfaceSelection([.5, 0, 0], [['transparent', {visible:true,opacity:0,pts:[.5,0,0]}], ['context', {visible:true,opacity:.2,pts:[.5,0,0]}]], 'transparent', 1, 'transparent')
    expect(result.selected).toBe('context')
    expect(result.selectionEvidence.candidates).toEqual(['context'])
  })
})
