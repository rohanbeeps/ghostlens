declare module 'virtual:embedded-demo' {
  const demo: string | null
  export default demo
}

declare module 'ghostlens-har-worker' {
  export default class HarWorker extends Worker {
    constructor()
  }
}
