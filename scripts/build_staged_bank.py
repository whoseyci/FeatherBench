#!/usr/bin/env python3
"""Build the private staged ASCII visual-packing bank.

The public Worker response exposes one stage at a time. This source and the
resulting src/bank.json are maintainer-private and must never be mounted into an
evaluated model's environment.
"""
from __future__ import annotations

import hashlib
import json
import random
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = "featherbench-packing-stages-private-v1"
COLORS = ["red", "green", "blue", "yellow", "purple", "cyan", "pink", "forest", "orange", "brown"]
LETTERS = "ABCDEFGHIJ"


def norm(cells):
    cells = set(cells)
    mx = min(x for x, _ in cells)
    my = min(y for _, y in cells)
    return frozenset((x - mx, y - my) for x, y in cells)


def transform(cells, turns=0, reflect=False):
    pts = [(-x if reflect else x, y) for x, y in cells]
    for _ in range(turns % 4):
        pts = [(-y, x) for x, y in pts]  # visually clockwise in +y-down grids
    return norm(pts)


def variants(cells):
    return {transform(cells, r, f) for f in (False, True) for r in range(4)}


def polyomino(rng, n):
    cells = {(0, 0)}
    while len(cells) < n:
        x, y = rng.choice(sorted(cells))
        dx, dy = rng.choice(((1, 0), (-1, 0), (0, 1), (0, -1)))
        cells.add((x + dx, y + dy))
    return norm(cells)


def connected(cells):
    cells = set(cells)
    seen = {next(iter(cells))}
    stack = list(seen)
    while stack:
        x, y = stack.pop()
        for p in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if p in cells and p not in seen:
                seen.add(p)
                stack.append(p)
    return len(seen) == len(cells)


def compact_blob(rng, total):
    cells = {(0, 0)}
    while len(cells) < total:
        boundary = set()
        for x, y in cells:
            boundary.update(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
        boundary -= cells
        scored = []
        for x, y in sorted(boundary):
            neighbors = sum((x + dx, y + dy) in cells for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            scored.append((neighbors * 10 - 0.12 * (abs(x) + abs(y)) - rng.random() * 5, (x, y)))
        scored.sort(reverse=True)
        cells.add(rng.choice(scored[: min(8, len(scored))])[1])
    return set(norm(cells))


def partition(rng, target, k):
    target = set(target)
    seeds = rng.sample(sorted(target), k)
    parts = [{s} for s in seeds]
    owner = {s: i for i, s in enumerate(seeds)}
    while len(owner) < len(target):
        choices = []
        for cell in sorted(target - owner.keys()):
            x, y = cell
            adjacent = {owner[p] for p in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)) if p in owner}
            for i in adjacent:
                choices.append((len(parts[i]) + rng.random(), i, cell))
        if not choices:
            return None
        _, i, cell = min(choices)
        owner[cell] = i
        parts[i].add(cell)
    return parts


def exact_solutions(piece_map, target, limit=2):
    target = set(target)
    maxx = max(x for x, _ in target)
    maxy = max(y for _, y in target)
    placements = []
    for label, cells in piece_map.items():
        for shape in sorted(variants(cells), key=lambda s: sorted(s)):
            w = max(x for x, _ in shape)
            h = max(y for _, y in shape)
            for dx in range(maxx - w + 1):
                for dy in range(maxy - h + 1):
                    placed = frozenset((x + dx, y + dy) for x, y in shape)
                    if placed <= target:
                        placements.append((label, placed))
    by_cell = defaultdict(list)
    for p in placements:
        for cell in p[1]:
            by_cell[cell].append(p)
    out = []

    def visit(covered, used, chosen):
        if len(out) >= limit:
            return
        if covered == target:
            out.append(list(chosen))
            return
        cell = min(target - covered, key=lambda c: sum(p[0] not in used and not (p[1] & covered) for p in by_cell[c]))
        for p in by_cell[cell]:
            if p[0] in used or p[1] & covered:
                continue
            visit(covered | set(p[1]), used | {p[0]}, chosen + [p])

    visit(set(), set(), [])
    return out


def rows(cells, width=None, height=None, fill="#"):
    cells = set(cells)
    width = width if width is not None else max(x for x, _ in cells) + 1
    height = height if height is not None else max(y for _, y in cells) + 1
    return ["".join(fill if (x, y) in cells else "." for x in range(width)) for y in range(height)]


def answer_rows(solution, target):
    labels = {cell: label for label, cells in solution for cell in cells}
    return ["".join(labels.get((x, y), ".") for x in range(max(x for x, _ in target) + 1))
            for y in range(max(y for _, y in target) + 1)]


def prompt_for(target_rows, shown, has_decoys):
    pool_rule = "One or more candidates may be decoys." if has_decoys else "Every candidate tile is used exactly once; there are no decoys in this stage."
    parts = [
        "Solve this purely by visual deduction and reasoning. Solving tools are strictly prohibited: do not use scripts, code, image extraction, search, SAT/exact-cover solvers, or external assistance. Transport-only API calls are allowed.",
        "The only workspace exception is one optional plain-text file named notes.txt, used solely to write and reread your own reasoning notes. Do not create or use any other workspace file, and do not execute or parse notes.txt with code.",
        "Tiles may be rotated and flipped. " + pool_rule,
        "Your goal is 8/8 in this one run. Do not stop voluntarily. Try your hardest, take as much reasoning time as needed, and submit only your strongest answer after full effort. If this answer is not accepted, the run ends and your score is the highest consecutively solved puzzle; score retention is a fallback, not a reason to stop early.",
        "Return only an ASCII map with exactly the TARGET dimensions. Use actual newline characters between rows; `/` is not a row separator. Keep `.` outside the target and fill every `#` target cell with the uppercase letter of the tile covering it. Use each selected tile exactly once; do not add commentary or fences.",
        "",
        "TARGET",
        *target_rows,
    ]
    for i, (label, shape) in enumerate(shown.items()):
        parts.extend(["", f"PIECE {label} ({COLORS[i]})", *rows(shape)])
    return "\n".join(parts)


def generated_stage(stage, required, decoys, size_each):
    rng = random.Random(f"{SEED}|{stage}")
    for _ in range(5000):
        target = compact_blob(rng, required * size_each)
        parts = partition(rng, target, required)
        if not parts or min(map(len, parts)) < max(3, size_each - 3):
            continue
        canonical = [norm(p) for p in parts]
        if any(len(variants(p)) < 4 for p in canonical):
            continue
        shown_shapes = [transform(p, rng.randrange(4), bool(rng.getrandbits(1))) for p in canonical]
        while len(shown_shapes) < required + decoys:
            d = polyomino(rng, rng.choice([len(p) for p in canonical]))
            if any(d in variants(p) for p in canonical) or any(d in variants(p) for p in shown_shapes):
                continue
            shown_shapes.append(transform(d, rng.randrange(4), bool(rng.getrandbits(1))))
        # Shuffle candidate labels, including which letters are decoys.
        rng.shuffle(shown_shapes)
        piece_map = {LETTERS[i]: shape for i, shape in enumerate(shown_shapes)}
        sols = exact_solutions(piece_map, target)
        if len(sols) != 1:
            continue
        target_rows = rows(target)
        return {
            "stage": stage,
            "prompt": prompt_for(target_rows, piece_map, decoys > 0),
            "public": {"target_width": len(target_rows[0]), "target_height": len(target_rows), "candidates": len(piece_map)},
            "key": {
                "target": target_rows,
                "pieces": {k: rows(v) for k, v in piece_map.items()},
                "reference_map": answer_rows(sols[0], target),
            },
        }
    raise RuntimeError(f"could not generate unique stage {stage}")


def parse_rows(text):
    return [line for line in text.strip().splitlines() if line]


def maximum_stage():
    target = parse_rows("""..####..
..####..
.#######
.####.#.
.######.
.######.
.######.
#######.
#####...
.####...""")
    pieces = {
        "A": parse_rows(""".#..
##..
.#..
.##.
..##
..##
..##"""),
        "B": parse_rows("""##..
.#..
.###
.###
..#."""),
        "C": parse_rows(""".#..
####
.###"""),
        "D": parse_rows("""##.
.##
###
#.."""),
        "E": parse_rows("""..##
.###
.###
.#..
##.."""),
        "F": parse_rows("""#.
#.
##
#."""),
        "G": parse_rows(""".##..
###..
#####
.#..."""),
        "H": parse_rows("""..#.
.###
.##.
##.."""),
    }
    # The original maximum pool included G and H as decoys. Stages 4+ deliberately
    # omit decoys so the benchmark measures packing rather than long subset search.
    pieces = {label: shape for label, shape in pieces.items() if label in "ABCDEF"}
    to_cells = lambda rs: frozenset((x, y) for y, row in enumerate(rs) for x, ch in enumerate(row) if ch == "#")
    target_cells = to_cells(target)
    piece_map = {k: to_cells(v) for k, v in pieces.items()}
    sols = exact_solutions(piece_map, target_cells)
    if len(sols) != 1:
        raise RuntimeError(f"maximum stage must have exactly one solution, got {len(sols)}")
    return {
        "stage": 8,
        "prompt": prompt_for(target, piece_map, False),
        "public": {"target_width": 8, "target_height": 10, "candidates": 6},
        "key": {"target": target, "pieces": pieces, "reference_map": answer_rows(sols[0], target_cells)},
    }


def main():
    specs = [(1, 1, 4), (2, 1, 5), (3, 1, 6), (4, 0, 6), (5, 0, 7), (6, 0, 8), (7, 0, 9)]
    stages = [generated_stage(i, required, decoys, size) for i, (required, decoys, size) in enumerate(specs, 1)]
    stages.append(maximum_stage())
    public_digest = hashlib.sha256(json.dumps([{"stage": x["stage"], "prompt": x["prompt"]} for x in stages], sort_keys=True).encode()).hexdigest()
    bank = {
        "manifest": {"version": "featherbench-packing-staged-1.4", "stages": len(stages), "public_commitment": public_digest},
        "stages": stages,
    }
    out = ROOT / "src" / "bank.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bank, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(bank["manifest"], indent=2))
    for x in stages:
        print(f"stage {x['stage']}: {x['public']}; answer={x['key']['reference_map']}")


if __name__ == "__main__":
    main()
