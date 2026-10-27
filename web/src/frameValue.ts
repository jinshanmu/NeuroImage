type FrameScheduler = {
  request: (callback: FrameRequestCallback) => number
  cancel: (frame: number) => void
}

/** Keep native range feedback immediate while submitting only the latest frame. */
export class FrameValue {
  private frame: number | null = null
  private pending: number | undefined
  private submitted: number[] = []
  private authoritative: number
  private displayed: number
  private lastSent: number

  constructor(value: number, private send: (value: number) => void,
    private display: (value: number) => void,
    private scheduler: FrameScheduler = {
      request: callback => requestAnimationFrame(callback),
      cancel: frame => cancelAnimationFrame(frame),
    }) {
    this.authoritative = this.displayed = this.lastSent = value
  }

  queue(value: number): void {
    if (!Number.isFinite(value)) return
    this.show(value)
    this.pending = value
    if (this.frame === null) this.frame = this.scheduler.request(() => {
      this.frame = null
      this.flush()
    })
  }

  flush(): void {
    if (this.frame !== null) this.scheduler.cancel(this.frame)
    this.frame = null
    const value = this.pending
    this.pending = undefined
    if (value === undefined || value === this.lastSent) return
    this.lastSent = value
    this.submitted.push(value)
    this.send(value)
  }

  /** An older submitted value must not rewind a newer thumb/pending update. */
  synchronize(value: number): void {
    if (value === this.authoritative) return
    this.authoritative = value
    const acknowledgement = this.submitted.lastIndexOf(value)
    if (acknowledgement < 0) { this.cancel(value); return }
    this.submitted.splice(0, acknowledgement + 1)
    this.show(this.pending ?? this.submitted.at(-1) ?? value)
  }

  /** External resets/disable/unmount discard work that has not been submitted. */
  cancel(value?: number): void {
    if (this.frame !== null) this.scheduler.cancel(this.frame)
    this.frame = null
    this.pending = undefined
    this.submitted = []
    if (value !== undefined) {
      this.authoritative = this.lastSent = value
      this.show(value)
    }
  }

  private show(value: number): void {
    if (value === this.displayed) return
    this.displayed = value
    this.display(value)
  }
}
