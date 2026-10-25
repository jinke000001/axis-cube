/** Minimal, checked boundary for the pinned upstream implementation. */
export interface Cubie {
  colors(): string[];
}

export interface Partition {
  moves: string[];
  caseNumber: string | number | number[];
  cubies: { corner?: Cubie; edge?: Cubie };
}

export class RubiksCube {
  constructor(state: string);
  static Solved(): RubiksCube;
  static FromMoves(algorithm: string): RubiksCube;
  static reverseMoves(algorithm: string): string;
  move(algorithm: string | string[]): void;
  toString(): string;
  isSolved(): boolean;
}

export class Solver {
  constructor(state: string, options?: Record<string, unknown>);
  cube: RubiksCube;
  progress: Record<"cross" | "f2l" | "oll" | "pll", Partition[]>;
  solve(): void;
}

export class OLLSolver {
  constructor(cube: RubiksCube);
  algorithms: Record<string, string>;
  solve(): Partition;
}

export class PLLSolver {
  constructor(cube: RubiksCube);
  algorithms: Record<string, string>;
  solve(): Partition;
}
