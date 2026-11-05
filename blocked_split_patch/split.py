import hashlib
import os
import re

import numpy as np

from config import SEED, SPLIT_FRACTIONS, SPLIT_STRATEGY


def recording_name(path):
    return os.path.splitext(re.split(r"[\\/]", str(path))[-1])[0]


def recording_key(machine, mid, label, path):
    return f"{machine}:{mid}:{int(label)}:{recording_name(path)}"


def bucket(key):
    digest = hashlib.sha1(f"{SEED}:{key}".encode()).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def assign(value):
    train, val = SPLIT_FRACTIONS
    if value < train:
        return "train"
    if value < train + val:
        return "val"
    return "test"


def order_key(name):
    return (0, int(name), "") if name.isdigit() else (1, 0, name)


def file_splits(meta, paths, strategy=None):
    strategy = strategy or SPLIT_STRATEGY
    first = meta.drop_duplicates("file")
    mimii = first[first["source"] == "mimii"]
    keyed = {row.file: recording_key(row.machine, row.mid, row.label, paths[row.file])
             for row in mimii.itertuples()}
    if strategy == "blocked":
        groups = {}
        for row in mimii.itertuples():
            groups.setdefault((row.machine, row.mid, int(row.label)), set()).add(
                recording_name(paths[row.file]))
        position = {}
        for group, names in groups.items():
            ordered = sorted(names, key=order_key)
            for rank, name in enumerate(ordered):
                position[(*group, name)] = (rank + 0.5) / len(ordered)
        value = {f: position[(r.machine, r.mid, int(r.label), recording_name(paths[r.file]))]
                 for f, r in zip(mimii["file"], mimii.itertuples())}
    else:
        value = {f: bucket(k) for f, k in keyed.items()}
    table = {row.file: "external" for row in first.itertuples()}
    table.update({f: assign(v) for f, v in value.items()})
    return meta["file"].map(table).to_numpy()
