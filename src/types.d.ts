/// <reference types="vite/client" />
declare module "cubejs" {
  class Cube {
    static initSolver(): void;
    static fromString(state: string): Cube;
    static random(): Cube;
    static inverse(alg: string): string;
    asString(): string;
    move(alg: string): Cube;
    solve(maxDepth?: number): string;
    isSolved(): boolean;
  }
  export default Cube;
}
