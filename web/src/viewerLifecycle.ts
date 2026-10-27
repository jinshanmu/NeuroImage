interface InitializableViewer<State> {
  initialize(state: State): Promise<void>
  apply(state: State): Promise<void>
  dispose(): void
}

/** State echoes can arrive while the canvas and source assets are attaching. */
export class ViewerLifecycle<State> {
  private latest: State | undefined
  private initialized = false
  private disposed = false

  constructor(private viewer: InitializableViewer<State>) {}

  get active() { return !this.disposed }

  async initialize(state: State): Promise<boolean> {
    this.latest = state
    await this.viewer.initialize(state)
    if (this.disposed) return false
    // Initialization can report a corrected native camera before resolving.
    // Apply its latest acknowledgement only after the renderer has attached.
    while (this.latest !== state) {
      state = this.latest!
      await this.viewer.apply(state)
      if (this.disposed) return false
    }
    this.initialized = true
    return true
  }

  apply(state: State): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.latest = state
    return this.initialized ? this.viewer.apply(state) : Promise.resolve()
  }

  dispose(): void {
    this.disposed = true
    this.initialized = false
    this.latest = undefined
    this.viewer.dispose()
  }
}
