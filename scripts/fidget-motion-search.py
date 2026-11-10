"""Research tool: independent rigid-transform search for the default cube.

Requires local NumPy; does not run in the site or CI. Axis coordinates below are
transcribed from the MIT reference, not read back from the builder. A result is
only a candidate: mesh collision and intermediate loop closure still need checks.
"""
import itertools
import json
import math
import numpy as np

AXES = [
    (1, (16, 10, 4)), (1, (25, 10, 4)),
    (2, (37, 4, 10)), (2, (46, 4, 10)),
    (1, (58, 10, 4)), (1, (67, 10, 4)),
    (0, (73, 16, 16)), (0, (73, 25, 16)),
    (1, (67, 31, 4)), (1, (58, 31, 4)),
    (2, (46, 37, 10)), (2, (37, 37, 10)),
    (1, (25, 31, 4)), (1, (16, 31, 4)),
    (0, (10, 25, 16)), (0, (10, 16, 16)),
]
BODY_ORDER = [1, 2, 3, 7, 6, 5, 4, 0]
CENTERS = np.array([[10 + (i % 4) * 21, 10 + (i // 4) * 21, 10] for i in range(8)])


def rotation(axis, point, degrees):
    angle = degrees * math.pi / 180
    c, s = math.cos(angle), math.sin(angle)
    a, b = ((1, 2), (2, 0), (0, 1))[axis]
    r = np.eye(3)
    r[a, a] = r[b, b] = c
    r[a, b], r[b, a] = -s, s
    result = np.eye(4)
    result[:3, :3] = r
    result[:3, 3] = np.array(point) - r @ point
    return result


def transforms(angles):
    result = np.eye(4)
    bodies = {0: result.copy()}
    links = []
    for i, ((axis, point), angle) in enumerate(zip(AXES, angles)):
        result = result @ rotation(axis, point, angle)
        if i % 2:
            if i < 15:
                bodies[BODY_ORDER[i // 2]] = result.copy()
        else:
            links.append(result.copy())
    return result, bodies, links


def key(matrix):
    return tuple(np.rint(matrix).astype(int).flatten())


def bounds(bodies):
    centers = np.array([bodies[i][:3, :3] @ CENTERS[i] + bodies[i][:3, 3] for i in range(8)])
    for i in range(8):
        for j in range(i):
            if np.all(np.abs(centers[i] - centers[j]) < 19.99):
                return None
    return centers.max(axis=0) - centers.min(axis=0) + 20


def main():
    options = (-90, 0, 90)
    maps = [[rotation(axis, point, angle) for angle in options] for axis, point in AXES]
    first = {}
    for picks in itertools.product(range(3), repeat=8):
        matrix = np.eye(4)
        for i, pick in enumerate(picks):
            matrix = matrix @ maps[i][pick]
        first.setdefault(key(matrix), []).append(picks)
    found = []
    next_cubes = []
    unfolded = np.array([90,90,0,0,90,90,90,90,-90,-90,0,0,-90,-90,-90,-90])
    closure_count = 0
    for picks in itertools.product(range(3), repeat=8):
        matrix = np.eye(4)
        for i, pick in enumerate(picks):
            matrix = matrix @ maps[i + 8][pick]
        inverse = np.eye(4)
        inverse[:3, :3] = matrix[:3, :3].T
        inverse[:3, 3] = -matrix[:3, :3].T @ matrix[:3, 3]
        for earlier in first.get(key(inverse), []):
            angles = np.array([options[i] for i in (*earlier, *picks)])
            if not np.any(angles):
                continue
            closure_count += 1
            _, bodies, _ = transforms(angles)
            size = bounds(bodies)
            if size is None or max(size) > 70:
                continue
            if max(size) < 42:
                error = max(float(np.max(np.abs(transforms(unfolded + (angles - unfolded) * f)[0] - np.eye(4)))) for f in (0.1,0.25,0.5,0.75,0.9))
                if error < 1e-7:
                    next_cubes.append({"angles": angles.tolist(), "bounds": np.round(size,6).tolist(), "closure_error": error})
            max_error = max(float(np.max(np.abs(transforms(angles * f)[0] - np.eye(4)))) for f in (0.1, 0.25, 0.5, 0.75, 0.9))
            if max_error < 1e-7:
                found.append({"angles": angles.tolist(), "bounds": np.round(size, 6).tolist(), "closure_error": max_error})
    print(json.dumps({"closed_endpoints": closure_count, "continuous_candidates": found,"next_cube_candidates": next_cubes}, indent=2))


if __name__ == '__main__':
    main()
