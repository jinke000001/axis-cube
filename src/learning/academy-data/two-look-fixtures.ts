/** Independent public J Perm trainer scrambles, with only AUF alignment added.
 * See evidence/museum-upgrade-2026-11-01/academy/jperm-two-look-reference.json. */
export const TWO_LOOK_FIXTURES: Record<string, {sourceScramble:string;setup:string;algorithm:string}[]> = {
  "two-oll-line": [
    {
      "sourceScramble": "R2 B' R F R F' R2 B R2 F2 D2 L2 D L2 D F2 R2 U' R2 U'",
      "setup": "z2 R2 B' R F R F' R2 B R2 F2 D2 L2 D L2 D F2 R2 U' R2 U'",
      "algorithm": "F R U R' U' F'"
    },
    {
      "sourceScramble": "F U2 B' R' F R' B D R2 F2 L2 U2 F2 U' B2 U F2 U' L2",
      "setup": "z2 F U2 B' R' F R' B D R2 F2 L2 U2 F2 U' B2 U F2 U' L2",
      "algorithm": "F R U R' U' F'"
    }
  ],
  "two-oll-elbow": [
    {
      "sourceScramble": "R' F' L F' R' D2 L F2 R2 U2 L2 B2 L2 U2 L2",
      "setup": "z2 R' F' L F' R' D2 L F2 R2 U2 L2 B2 L2 U2 L2  y2",
      "algorithm": "f R U R' U' f'"
    },
    {
      "sourceScramble": "R L2 B' L2 B L2 B' R U' R2 U F2 L2 F2 U B2 U' R2 B2 U'",
      "setup": "z2 R L2 B' L2 B L2 B' R U' R2 U F2 L2 F2 U B2 U' R2 B2 U'  y2",
      "algorithm": "f R U R' U' f'"
    }
  ],
  "two-oll-dot": [
    {
      "sourceScramble": "F' U2 B L' U2 B L F' D2 R2 U B2 U F2 R2 B2 D B2 D L2",
      "setup": "z2 F' U2 B L' U2 B L F' D2 R2 U B2 U F2 R2 B2 D B2 D L2",
      "algorithm": "F R U R' U' F' f R U R' U' f'"
    },
    {
      "sourceScramble": "L' B L B U2 L' B L U' R2 U R2 U' R2 F2 B2 D' L2 D F2",
      "setup": "z2 L' B L B U2 L' B L U' R2 U R2 U' R2 F2 B2 D' L2 D F2",
      "algorithm": "F R U R' U' F' f R U R' U' f'"
    }
  ],
  "two-oll-h": [
    {
      "sourceScramble": "R U B2 R' B2 R2 U' R' U L2 F2 R2 U L2 U L2 U' F2 U' L2",
      "setup": "z2 R U B2 R' B2 R2 U' R' U L2 F2 R2 U L2 U L2 U' F2 U' L2  y",
      "algorithm": "R U R' U R U' R' U R U2 R'"
    },
    {
      "sourceScramble": "R U B2 R' B2 R2 U' R U R2 B2 L2 D2 B2 L2 U F2 U R2 F2",
      "setup": "z2 R U B2 R' B2 R2 U' R U R2 B2 L2 D2 B2 L2 U F2 U R2 F2  y",
      "algorithm": "R U R' U R U' R' U R U2 R'"
    }
  ],
  "two-oll-pi": [
    {
      "sourceScramble": "R D L2 B2 D' B2 D' R U2 F2 R2 D' L2 U' L2 U L2 D' B2 D'",
      "setup": "z2 R D L2 B2 D' B2 D' R U2 F2 R2 D' L2 U' L2 U L2 D' B2 D'",
      "algorithm": "R U2 R2 U' R2 U' R2 U2 R"
    },
    {
      "sourceScramble": "R D B2 D B2 L2 D' R U' R2 U' R2 D2 L2 D R2 F2 D' F2 D",
      "setup": "z2 R D B2 D B2 L2 D' R U' R2 U' R2 D2 L2 D R2 F2 D' F2 D",
      "algorithm": "R U2 R2 U' R2 U' R2 U2 R"
    }
  ],
  "two-oll-u": [
    {
      "sourceScramble": "F D B2 D' F U' F2 U' R2 D R2 B2 U2 B2 D B2 D2",
      "setup": "z2 F D B2 D' F U' F2 U' R2 D R2 B2 U2 B2 D B2 D2  y2",
      "algorithm": "R2 D R' U2 R D' R' U2 R'"
    },
    {
      "sourceScramble": "F D B2 D' F L2 U R2 F2 U' L2 D R2 D' F2 U2",
      "setup": "z2 F D B2 D' F L2 U R2 F2 U' L2 D R2 D' F2 U2  y2",
      "algorithm": "R2 D R' U2 R D' R' U2 R'"
    }
  ],
  "two-oll-t": [
    {
      "sourceScramble": "R' F' L F' L' F' R F' R2 U2 F' U2 F R2 B' R2 B R2 U2",
      "setup": "z2 R' F' L F' L' F' R F' R2 U2 F' U2 F R2 B' R2 B R2 U2",
      "algorithm": "r U R' U' r' F R F'"
    },
    {
      "sourceScramble": "L D R2 D' L U F2 U L2 D2 R2 F2 U2 F2 D2 B2",
      "setup": "z2 L D R2 D' L U F2 U L2 D2 R2 F2 U2 F2 D2 B2",
      "algorithm": "r U R' U' r' F R F'"
    }
  ],
  "two-oll-l": [
    {
      "sourceScramble": "R U2 R F2 R' U2 R' U R2 U F2 U' R2 D R2 D' R2 U'",
      "setup": "z2 R U2 R F2 R' U2 R' U R2 U F2 U' R2 D R2 D' R2 U'  y'",
      "algorithm": "F R' F' r U R U' r'"
    },
    {
      "sourceScramble": "R U2 R F2 R' U2 R F2 D' F2 D B2 D' F2 D L2 D2 L2 B2 R2",
      "setup": "z2 R U2 R F2 R' U2 R F2 D' F2 D B2 D' F2 D L2 D2 L2 B2 R2  y'",
      "algorithm": "F R' F' r U R U' r'"
    }
  ],
  "two-oll-antisune": [
    {
      "sourceScramble": "R U R2 U' R2 U R U2 F2 R2 F2 U2 F2 R2 F2 U",
      "setup": "z2 R U R2 U' R2 U R U2 F2 R2 F2 U2 F2 R2 F2 U",
      "algorithm": "R U2 R' U' R U' R'"
    },
    {
      "sourceScramble": "R U R2 U' R2 U R L2 D' R2 D' R2 D' R2 D' R2 D' L2",
      "setup": "z2 R U R2 U' R2 U R L2 D' R2 D' R2 D' R2 D' R2 D' L2",
      "algorithm": "R U2 R' U' R U' R'"
    }
  ],
  "two-oll-sune": [
    {
      "sourceScramble": "F' U B U' F U B U F2 R2 U R2 U' R2 D R2 D' F2 B2",
      "setup": "z2 F' U B U' F U B U F2 R2 U R2 U' R2 D R2 D' F2 B2",
      "algorithm": "R U R' U R U2 R'"
    },
    {
      "sourceScramble": "R U2 R' U' R U' R U' R2 U R2 B2 R2 U B2 U' R2 B2",
      "setup": "z2 R U2 R' U' R U' R U' R2 U R2 B2 R2 U B2 U' R2 B2",
      "algorithm": "R U R' U R U2 R'"
    }
  ],
  "two-pll-headlights": [
    {
      "sourceScramble": "R L U2 R L' U F2 U2 R2 F2 R2 U' B2 U' F2 U R2 B2",
      "setup": "z2 R L U2 R L' U F2 U2 R2 F2 R2 U' B2 U' F2 U R2 B2",
      "algorithm": "R U R' U' R' F R2 U' R' U' R U R' F' U"
    },
    {
      "sourceScramble": "F B U2 F B L2 U R2 B2 U L2 U' B2 R2 U' L2 F2 B2",
      "setup": "z2 F B U2 F B L2 U R2 B2 U L2 U' B2 R2 U' L2 F2 B2",
      "algorithm": "R U R' U' R' F R2 U' R' U' R U R' F' U"
    }
  ],
  "two-pll-diagonal": [
    {
      "sourceScramble": "R L F2 R L' U' L2 D2 F2 U' B2 U' R2 F2 D2 B2 U' R2",
      "setup": "z2 R L F2 R L' U' L2 D2 F2 U' B2 U' R2 F2 D2 B2 U' R2",
      "algorithm": "F R U' R' U' R U R' F' R U R' U' R' F R F' U"
    },
    {
      "sourceScramble": "F B L2 F' B' L2 U R2 D' L2 B2 L2 D R2 U F2 U2 L2",
      "setup": "z2 F B L2 F' B' L2 U R2 D' L2 B2 L2 D R2 U F2 U2 L2",
      "algorithm": "F R U' R' U' R U R' F' R U R' U' R' F R F' U"
    }
  ],
  "two-pll-h": [
    {
      "sourceScramble": "R L D2 R L D2 R2 B2 D2 B2 L2 F2 U2 R2 F2 U2",
      "setup": "z2 R L D2 R L D2 R2 B2 D2 B2 L2 F2 U2 R2 F2 U2",
      "algorithm": "M2 U M2 U2 M2 U M2"
    },
    {
      "sourceScramble": "F B D2 F B D2 F2 R2 D2 R2 B2 L2 U2 F2 L2 U2",
      "setup": "z2 F B D2 F B D2 F2 R2 D2 R2 B2 L2 U2 F2 L2 U2",
      "algorithm": "M2 U M2 U2 M2 U M2"
    }
  ],
  "two-pll-z": [
    {
      "sourceScramble": "R L U2 R L' U' R2 U' R2 U' R2 U' R2 U' R2 B2 R2 B2",
      "setup": "z2 R L U2 R L' U' R2 U' R2 U' R2 U' R2 U' R2 B2 R2 B2 U y",
      "algorithm": "M' U M2 U M2 U M' U2 M2 U'"
    },
    {
      "sourceScramble": "F B U2 F B' U R2 F2 R2 U F2 U R2 F2 R2 U F2 U'",
      "setup": "z2 F B U2 F B' U R2 F2 R2 U F2 U R2 F2 R2 U F2 U' U y",
      "algorithm": "M' U M2 U M2 U M' U2 M2 U'"
    }
  ],
  "two-pll-ua": [
    {
      "sourceScramble": "F2 D F2 R2 F2 D R2 F2 D2 F2 B2 L2 B2 R2 D2 R2",
      "setup": "z2 F2 D F2 R2 F2 D R2 F2 D2 F2 B2 L2 B2 R2 D2 R2",
      "algorithm": "R U' R U R U R U' R' U' R2"
    },
    {
      "sourceScramble": "R2 U' B2 R2 B2 U B2 R2 B2 U2 B2 U2 R2 B2 R2 U2 B2",
      "setup": "z2 R2 U' B2 R2 B2 U B2 R2 B2 U2 B2 U2 R2 B2 R2 U2 B2",
      "algorithm": "R U' R U R U R U' R' U' R2"
    }
  ],
  "two-pll-ub": [
    {
      "sourceScramble": "F2 U' L2 F2 L2 U F2 L2 U2 L2 F2 L2 U2 F2 L2 U2 F2",
      "setup": "z2 F2 U' L2 F2 L2 U F2 L2 U2 L2 F2 L2 U2 F2 L2 U2 F2",
      "algorithm": "R2 U R U R' U' R' U' R' U R'"
    },
    {
      "sourceScramble": "F2 D' F2 R2 B2 U R D2 F2 B2 U2 L' F2 R2 U2 B2 U2",
      "setup": "z2 F2 D' F2 R2 B2 U R D2 F2 B2 U2 L' F2 R2 U2 B2 U2",
      "algorithm": "R2 U R U R' U' R' U' R' U R'"
    }
  ]
};
