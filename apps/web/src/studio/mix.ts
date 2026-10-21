import { useStudio } from "../state/studio.ts"

export function audibleLayers(layers: string[]): string[] {
  const { solo, muted } = useStudio.getState()
  if (solo) return layers.filter((layer) => layer === solo)
  return layers.filter((layer) => !muted.includes(layer))
}
