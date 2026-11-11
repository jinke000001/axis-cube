# AXIS release checkpoints

## 2026-11-11 · AXIS U8 r1

C114 r1 and U8 r1 are live on the existing Netlify site. The release includes 119 cases, 121 mechanical fingering demonstrations and personal cube restoration from six photos. The white Wuji hand and the original formula notation and fingering annotations carry through to the current exhibition.

| Release record | Value |
| --- | --- |
| Version | `axis-u8-r1` |
| Production deploy | `6af3c7841b3aa36b2577957c` |
| Accepted preview deploy | `6af3bdb58649921f2cff317d` |
| Previous production deploy | `6ae91f01555fc0c83f131871` |
| Artifact SHA-256 identity | `8439ce3191eeb4663bc2cf977d6410c0750a7e9a7a05079376a5800008fbf675` |
| Package | 42 files, 21,014,873 bytes |

[Production](https://axis-cube-jinke.netlify.app/) · [Personal restore](https://axis-cube-jinke.netlify.app/solve) · [Previous production](https://6ae91f01555fc0c83f131871--axis-cube-jinke.netlify.app)

Independent preview acceptance covered real six-photo recognition, narrow viewport, alternate formulas, legacy storage and a short solve at 2×. Production verification matched 40 served files and 131 routes, including deep links and reloads. It also confirmed F2L40 playback, 54 recognized stickers, a 63-move solve, a short playback to the solved state and six preserved legacy records in an isolated browser profile.

The source checkpoint uses the versioned build instructions in [README.md](README.md) and the input hashes in [the source manifest](release/axis-u8-r1-sources.json). The 247 focused motion and formula checks are reproducible from the tracked sources. iPhone camera and touch interaction, user learning outcomes and robot hardware remain pending real-world validation.


## 2026-11-03: CFOP web, first 54 demonstrations

Final source checkpoint: `axis-web-cfop-54-2026-11-03-r2`. The follow-up packaging commit excludes a local dependency-directory symlink; runtime files are unchanged.

Production: https://axis-cube-jinke.netlify.app/
Netlify deploy: `6ae91f01555fc0c83f131871`.
119 cases and 121 source algorithms retained; 54 validated mechanical demonstrations enabled, 67 marked as calibrating. Web only; native projects are preserved but no new APK or iOS build is included.

Source and motion assets match the sealed candidate 33 (source digest `3fc604b6e2c6d4ae91edaa8fe0a82db86332ab51a696f45daade1df9af45bf46`), except updated README and omitted Blender recovery copy. Native project sources, this release note, and ignore rules are also preserved. Generated chart-verification fixtures are included for reproducible tests; original chart images, private photos and acceptance records are excluded.

Validated before release: 1208 existing checks, 14 affected UI/router checks, 15 packaging fixtures, independent motion evidence and stage/data review. Production checked 144 assets, 54 motion identities, 12 legacy routes and responsive browser interactions. Real phone performance and human learning outcomes remain untested.

## History audit on 2026-11-03

Before this checkpoint, local and GitHub history contained only `dc38f2d852e6ec61ab08ce1f210a25df1a06d1ea`, the initial release. No intermediate version commits or tags existed. Initial commit remains an ancestor; this checkpoint does not rewrite history.

Three local source archives remain readable: before beginner-site changes, before museum changes, and before the CFOP refactor. They are local backups, not Git history, and are not published because they contain private project records. Former production deploy `6ae6da002fd1851b13234e30` remains the rollback deployment. Full recovery and audit records stay local.
