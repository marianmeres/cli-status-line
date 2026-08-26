// Public surface is expanded in a later task; for now the seam type is the only
// export a downstream test would want (to inject its own `Io` fake).
export type { Io } from "./io.ts";
