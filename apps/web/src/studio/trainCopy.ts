/** Train exercise copy must not be shown as a Create facet. */

const MARKERS = ["create a 4-bar", "create a 4 bar", "recreate it in logic", "recognise and recreate", "recognise the progression"]

export function isTrainExerciseText(value: string): boolean {
  const text = value.trim().toLowerCase().replace(/\s+/g, " ")
  if (text.length < 24) return false
  return MARKERS.some((marker) => text.includes(marker))
}
