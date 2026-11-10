// False-positive bait: "pan" here is a map gesture, not a tax ID.
export function onMapMove(pan: { x: number; y: number }) {
  console.log("map moved", pan);
}
