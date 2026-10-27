import type { Vec3 } from './types'

/** Retain a source hit independently of active selection and display visibility. */
export class CursorReadout {
  private hit?: { position: Vec3; structureId: string | null }

  remember(position: Vec3, structureId: string | null): void {
    this.hit = { position: [position[0], position[1], position[2]], structureId }
  }

  at(position: Vec3): { structureId: string | null } | undefined {
    const hit = this.hit
    if (!hit || !hit.position.every((value, axis) => Math.abs(value - position[axis]) < 1e-4)) return undefined
    return { structureId: hit.structureId }
  }

  clear(): void { this.hit = undefined }
}
