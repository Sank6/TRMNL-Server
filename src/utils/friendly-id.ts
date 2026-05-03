const ADJECTIVES = [
  "amber", "azure", "bold", "calm", "crisp", "dark", "deep", "epic", "fast",
  "fern", "gold", "jade", "keen", "lime", "lunar", "misty", "neon", "noble",
  "opal", "pale", "pine", "polar", "rapid", "rusty", "sage", "silk", "slim",
  "solar", "stark", "still", "storm", "swift", "teal", "vast", "warm", "wild",
];

const NOUNS = [
  "beacon", "blade", "brook", "circuit", "cloud", "comet", "creek", "delta",
  "drift", "echo", "ember", "field", "flare", "forge", "frost", "gate",
  "grove", "harbor", "haven", "haze", "horizon", "isle", "lantern", "leaf",
  "light", "mesa", "mist", "moon", "nexus", "node", "orbit", "peak", "pixel",
  "pulse", "quartz", "ridge", "river", "shore", "signal", "spark", "stone",
  "stream", "tide", "torch", "tower", "vale", "veil", "wave", "wisp",
];

export function generateFriendlyId(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0");
  return `${adj}-${noun}-${suffix}`;
}
