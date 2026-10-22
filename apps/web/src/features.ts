type Flags = {
  record: boolean
  soloMute: boolean
  fullMix: boolean
  styleguideLink: boolean
  demo: boolean
  create: boolean
  genre: boolean
  analyser: boolean
  edits: boolean
  soundcharts: boolean
}

export const features: Flags = {
  record: true,
  soloMute: true,
  fullMix: true,
  styleguideLink: true,
  demo: true,
  create: true,
  genre: false,
  analyser: true,
  edits: false,
  soundcharts: false,
}
